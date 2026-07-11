const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.INSPECCIONES_DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'inspecciones.json');

const DEFAULT_STATE = {
  conductores: ['JACK', 'DINO', 'MIGUEL', 'GODOY', ''],
  data: {}
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.jfif': 'image/jpeg'
};

let writeQueue = Promise.resolve();

async function ensureDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DB_FILE);
  } catch {
    const bundled = path.join(ROOT, 'data', 'inspecciones.json');
    try {
      const initial = await fs.readFile(bundled, 'utf8');
      await fs.writeFile(DB_FILE, initial, 'utf8');
    } catch {
      await fs.writeFile(DB_FILE, JSON.stringify(DEFAULT_STATE, null, 2), 'utf8');
    }
  }
}

async function syncBundledData() {
  const bundled = path.join(ROOT, 'data', 'inspecciones.json');
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8');
    const current = JSON.parse(raw || '{}');
    const currentEntries = Object.keys(current.data || {}).length;
    if (currentEntries <= 1) {
      const bundledRaw = await fs.readFile(bundled, 'utf8');
      const bundledData = JSON.parse(bundledRaw);
      const bundledEntries = Object.keys(bundledData.data || {}).length;
      if (bundledEntries > currentEntries) {
        const merged = {
          conductores: current.conductores || bundledData.conductores,
          data: { ...bundledData.data, ...current.data }
        };
        await saveState(merged);
        console.log(`Sincronizados ${bundledEntries} registros del repositorio`);
      }
    }
  } catch {}
}

function normalizeState(parsed) {
  return {
    conductores: Array.isArray(parsed.conductores) ? parsed.conductores : DEFAULT_STATE.conductores,
    data: parsed.data && typeof parsed.data === 'object' ? parsed.data : {}
  };
}

async function readState() {
  await ensureDb();
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return normalizeState(parsed);
  } catch {
    return DEFAULT_STATE;
  }
}

function saveState(state) {
  writeQueue = writeQueue.then(async () => {
    await ensureDb();
    const next = {
      conductores: Array.isArray(state.conductores) ? state.conductores : DEFAULT_STATE.conductores,
      data: state.data && typeof state.data === 'object' ? state.data : {}
    };
    const tmp = `${DB_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
    await fs.rename(tmp, DB_FILE);
  });
  return writeQueue;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 25 * 1024 * 1024) throw new Error('Payload demasiado grande');
  }
  return body ? JSON.parse(body) : {};
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Acceso denegado');
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('No encontrado');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/state' && req.method === 'GET') {
      sendJson(res, 200, await readState());
      return;
    }

    if (req.url === '/api/state' && req.method === 'POST') {
      const body = await readBody(req);
      await saveState(body);
      sendJson(res, 200, { ok: true });
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || 'Error interno' });
  }
});

(async () => {
  await ensureDb();
  await syncBundledData();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Calendario de inspecciones listo: http://localhost:${PORT}`);
    console.log(`Datos: ${DB_FILE}`);
  });
})();
