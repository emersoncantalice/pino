/**
 * Pino — quadro branco colaborativo.
 * Servidor HTTP + WebSocket em Node puro (sem dependências externas).
 *
 *   node server.js        (porta padrão 3000; use PORT=xxxx para mudar)
 */
import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadEnv } from './lib/env.js';
import * as store from './lib/store.js';
import { getUserFromReq } from './lib/auth.js';
import { handleApi } from './lib/api.js';
import { serveFile, serveStatic, redirect } from './lib/http.js';
import { acceptUpgrade, rejectUpgrade } from './lib/ws.js';
import * as collab from './lib/collab.js';
import { aiStatus } from './lib/ai.js';

loadEnv(store.ROOT);
store.init();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(store.ROOT, 'public');

const PAGE_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self' ws: wss:",
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join('; '),
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};

const page = (name) => path.join(PUBLIC_DIR, name);

function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

async function onRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  const p = url.pathname;
  try {
    if (p.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    if (p === '/' || p === '/index.html') {
      if (!getUserFromReq(req)) return redirect(res, '/login');
      return void (await serveFile(req, res, page('index.html'), PAGE_HEADERS));
    }
    if (p === '/login') {
      if (getUserFromReq(req)) return redirect(res, safeNext(url.searchParams.get('next')));
      return void (await serveFile(req, res, page('login.html'), PAGE_HEADERS));
    }
    if (/^\/b\/[A-Za-z0-9_-]{1,64}\/?$/.test(p)) {
      if (!getUserFromReq(req)) return redirect(res, `/login?next=${encodeURIComponent(p)}`);
      return void (await serveFile(req, res, page('board.html'), PAGE_HEADERS));
    }
    if (p.endsWith('.html')) return notFound(req, res);
    if (await serveStatic(req, res, PUBLIC_DIR, p)) return;
    notFound(req, res);
  } catch (err) {
    console.error('[http]', err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}

async function notFound(req, res) {
  const ok = await serveFile(req, res, page('404.html'), PAGE_HEADERS, 404).catch(() => false);
  if (!ok) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Página não encontrada');
  }
}

const server = http.createServer(onRequest);

server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => socket.destroy());
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return rejectUpgrade(socket, 400, 'Bad Request');
  }
  if (url.pathname !== '/ws') return rejectUpgrade(socket, 404, 'Not Found');
  // Impede que outros sites abram conexões em nome do usuário logado.
  const origin = req.headers.origin;
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      /* origem inválida */
    }
    if (originHost !== req.headers.host) return rejectUpgrade(socket, 403, 'Forbidden');
  }
  const user = getUserFromReq(req);
  if (!user) return rejectUpgrade(socket, 401, 'Unauthorized');
  const ws = acceptUpgrade(req, socket, head);
  if (ws) collab.handleConnection(ws, user);
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[erro] A porta ${PORT} já está em uso. Feche o outro programa ou defina outra porta (ex.: PORT=3001).\n`);
  } else {
    console.error('[erro]', err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const lines = [`  Local:  http://localhost:${PORT}`];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if ((ni.family === 'IPv4' || ni.family === 4) && !ni.internal) lines.push(`  Rede:   http://${ni.address}:${PORT}`);
    }
  }
  const ai = aiStatus();
  console.log('\n  Pino está no ar!\n');
  console.log(lines.join('\n'));
  console.log(
    ai.enabled
      ? `\n  IA (foto → post-its): ativa — ${ai.provider}, modelo ${ai.model}`
      : '\n  IA (foto → post-its): desativada — defina GEMINI_API_KEY no arquivo .env',
  );
  console.log(`  Dados em: ${store.DATA_DIR}`);
  console.log('  Para encerrar: Ctrl+C\n');
  if (process.argv.includes('--open')) openBrowser(`http://localhost:${PORT}`);
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: true }).unref();
  } catch {
    /* sem navegador disponível */
  }
}

function shutdown() {
  console.log('\nSalvando dados e encerrando...');
  try {
    store.flushSync();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);
