import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export function sendJSON(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

export function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(new HttpError(413, 'Conteúdo muito grande.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (!failed) reject(err);
    });
  });
}

export async function readJSON(req, limit = 1_000_000) {
  const type = String(req.headers['content-type'] || '');
  if (!type.includes('application/json')) throw new HttpError(415, 'Envie os dados em JSON.');
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    const data = JSON.parse(buf.toString('utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

export function serveFile(req, res, file, headers = {}, status = 200) {
  return new Promise((resolve) => {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return resolve(false);
      const mtime = st.mtime.toUTCString();
      if (status === 200 && req.headers['if-modified-since'] === mtime) {
        res.writeHead(304, { 'Last-Modified': mtime, 'Cache-Control': 'no-cache', ...headers });
        res.end();
        return resolve(true);
      }
      res.writeHead(status, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Last-Modified': mtime,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        ...headers,
      });
      if (req.method === 'HEAD') {
        res.end();
        return resolve(true);
      }
      fs.createReadStream(file)
        .on('error', () => res.destroy())
        .pipe(res);
      resolve(true);
    });
  });
}

export async function serveStatic(req, res, root, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (rel.includes('\0')) return false;
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep)) return false;
  return serveFile(req, res, file);
}
