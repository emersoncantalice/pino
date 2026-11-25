import os from 'node:os';
import * as store from './store.js';
import { HttpError, sendJSON, readJSON } from './http.js';
import { hashPassword, verifyPassword, getUserFromReq, getToken, sessionCookie, clearSessionCookie } from './auth.js';
import { roleFor, canEdit } from './access.js';
import * as collab from './collab.js';
import { photoToNotes, aiStatus, AiError } from './ai.js';
import { sanitizeItem } from './sanitize.js';
import { uid, str } from './util.js';
import { buildTemplate } from '../public/js/templates.js';

const ID ='([A-Za-z0-9_-]{1,64})';
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);
const AI_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']);
const MAX_ASSET_BYTES = 12 * 1024 * 1024;
const MAX_AI_IMAGE_BYTES = 5 * 1024 * 1024;

/* ---------------- limite de tentativas de login ---------------- */
const attempts = new Map();
function rateLimit(req, bucket, max, windowMs) {
  const ip = req.socket.remoteAddress || 'local';
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  let e = attempts.get(key);
  if (!e || now > e.reset) {
    e = { count: 0, reset: now + windowMs };
    attempts.set(key, e);
  }
  e.count++;
  if (e.count > max) throw new HttpError(429, 'Muitas tentativas. Aguarde um minuto e tente novamente.');
}
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of attempts) if (now > e.reset) attempts.delete(k);
}, 60000).unref();

const aiInFlight = new Set();

/** Endereços deste servidor na rede local (para compartilhar com outros computadores). */
function lanUrls(req) {
  const port = req.socket.localPort;
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if ((ni.family === 'IPv4' || ni.family === 4) && !ni.internal) out.push(`http://${ni.address}:${port}`);
    }
  }
  return out;
}

/* ---------------- helpers ---------------- */

function parseDataUrl(dataUrl, allowed) {
  if (typeof dataUrl !== 'string') throw new HttpError(400, 'Imagem ausente.');
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const m = header.match(/^data:([a-z0-9.+/-]+)(;charset=[^;]+)?;base64$/i);
  if (comma < 0 || !m) throw new HttpError(400, 'Formato de imagem inválido.');
  const mime = m[1].toLowerCase();
  if (!allowed.has(mime)) throw new HttpError(415, 'Tipo de imagem não suportado. Use PNG, JPG, WEBP, GIF ou SVG.');
  const base64 = dataUrl.slice(comma + 1);
  return { mime, base64, buffer: Buffer.from(base64, 'base64') };
}

function requireBoard(id, user) {
  const board = store.getBoard(id);
  if (!board) throw new HttpError(404, 'Quadro não encontrado.', 'not-found');
  const role = roleFor(board, user.id);
  if (!role) throw new HttpError(403, 'Você não tem acesso a este quadro.', 'no-access');
  return { board, role };
}

function summary(board, user) {
  const role = roleFor(board, user.id);
  const preview = Object.values(board.items)
    .filter((it) => it.type !== 'path')
    .sort((a, b) => (a.z || 0) - (b.z || 0))
    .slice(-400)
    .map((it) => ({ type: it.type, x: it.x, y: it.y, w: it.w, h: it.h, color: it.color, fill: it.fill, shape: it.shape }));
  const owner = store.getUser(board.ownerId);
  return {
    id: board.id,
    name: board.name,
    role,
    isOwner: board.ownerId === user.id,
    ownerName: owner ? owner.name : '—',
    shareMode: board.shareMode,
    updatedAt: board.updatedAt,
    createdAt: board.createdAt,
    itemCount: Object.keys(board.items).length,
    online: collab.onlineCount(board.id),
    preview,
  };
}

/* ---------------- rotas ---------------- */

export async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  try {
    if (m === 'POST' && p === '/api/auth/register') return await register(req, res);
    if (m === 'POST' && p === '/api/auth/login') return await login(req, res);
    if (m === 'POST' && p === '/api/auth/logout') return logout(req, res);

    const user = getUserFromReq(req);
    if (!user) throw new HttpError(401, 'Sua sessão expirou. Entre novamente.', 'unauthorized');

    if (m === 'GET' && p === '/api/auth/me') {
      return sendJSON(res, 200, { user: store.publicUser(user), ai: aiStatus(), lanUrls: lanUrls(req) });
    }

    if (p === '/api/boards') {
      if (m === 'GET') return listBoards(res, user);
      if (m === 'POST') return await createBoard(req, res, user);
    }

    let r;
    if ((r = p.match(new RegExp(`^/api/boards/${ID}$`)))) {
      if (m === 'GET') return getBoardMeta(res, r[1], user);
      if (m === 'PATCH') return await updateBoard(req, res, r[1], user);
      if (m === 'DELETE') return await deleteBoard(res, r[1], user);
    }
    if ((r = p.match(new RegExp(`^/api/boards/${ID}/members$`))) && m === 'POST') return await addMember(req, res, r[1], user);
    if ((r = p.match(new RegExp(`^/api/boards/${ID}/members/${ID}$`))) && m === 'DELETE') return removeMember(res, r[1], r[2], user);

    if (p === '/api/assets' && m === 'POST') return await uploadAsset(req, res, user);
    if ((r = p.match(new RegExp(`^/api/assets/${ID}$`))) && m === 'GET') return await getAsset(req, res, r[1], user);
    if ((r = p.match(new RegExp(`^/api/assets/${ID}/clone$`))) && m === 'POST') return await cloneAsset(req, res, r[1], user);

    if (p === '/api/ai/photo' && m === 'POST') return await aiPhoto(req, res, user);

    throw new HttpError(404, 'Rota não encontrada.');
  } catch (err) {
    if (err instanceof HttpError) return sendJSON(res, err.status, { error: err.message, code: err.code });
    if (err instanceof AiError) return sendJSON(res, err.status, { error: err.message });
    console.error('[api]', err);
    if (!res.headersSent) sendJSON(res, 500, { error: 'Erro interno do servidor.' });
  }
}

/* ---------------- autenticação ---------------- */

async function register(req, res) {
  rateLimit(req, 'register', 10, 60000);
  const body = await readJSON(req);
  const name = str(body.name, 60);
  const username = store.normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!name) throw new HttpError(400, 'Informe seu nome.');
  if (!store.USERNAME_RE.test(username)) {
    throw new HttpError(400, 'O usuário deve ter de 3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado (sem espaços).');
  }
  if (password.length < 6) throw new HttpError(400, 'A senha precisa ter pelo menos 6 caracteres.');
  if (password.length > 200) throw new HttpError(400, 'Senha muito longa.');
  if (store.getUserByUsername(username)) throw new HttpError(409, 'Este nome de usuário já está em uso. Escolha outro.');
  const user = store.createUser({ name, username, passwordHash: await hashPassword(password) });
  const token = store.createSession(user.id);
  sendJSON(res, 201, { user: store.publicUser(user) }, { 'Set-Cookie': sessionCookie(token) });
}

async function login(req, res) {
  rateLimit(req, 'login', 15, 60000);
  const body = await readJSON(req);
  const login = String(body.username || '');
  // Quem se cadastrou antes com e-mail pode digitá-lo: o usuário é a parte antes do @.
  const user = store.getUserByUsername(login) || (login.includes('@') ? store.getUserByUsername(login.split('@')[0]) : null);
  const ok = user && typeof body.password === 'string' && (await verifyPassword(body.password, user.passwordHash));
  if (!ok) throw new HttpError(401, 'Usuário ou senha incorretos.');
  const token = store.createSession(user.id);
  sendJSON(res, 200, { user: store.publicUser(user) }, { 'Set-Cookie': sessionCookie(token) });
}

function logout(req, res) {
  const token = getToken(req);
  if (token) store.deleteSession(token);
  sendJSON(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
}

/* ---------------- quadros ---------------- */

function listBoards(res, user) {
  const boards = store
    .allBoards()
    .filter((b) => roleFor(b, user.id) && (b.ownerId === user.id || b.members[user.id] || b.visitors.includes(user.id)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((b) => summary(b, user));
  sendJSON(res, 200, { boards });
}

async function createBoard(req, res, user) {
  const body = await readJSON(req);
  const name = str(body.name, 120) || 'Quadro sem título';
  const items = typeof body.template === 'string'
    ? buildTemplate(body.template, () => uid(12)).map((it) => sanitizeItem(it, user)).filter(Boolean)
    : [];
  const board = store.createBoard({ name, ownerId: user.id, items });
  sendJSON(res, 201, { board: summary(board, user) });
}

function getBoardMeta(res, id, user) {
  const { board, role } = requireBoard(id, user);
  sendJSON(res, 200, { board: collab.boardMeta(board, role), role });
}

async function updateBoard(req, res, id, user) {
  const { board, role } = requireBoard(id, user);
  const body = await readJSON(req);
  if (body.name !== undefined) {
    if (!canEdit(role)) throw new HttpError(403, 'Você só pode visualizar este quadro.');
    const name = str(body.name, 120);
    if (!name) throw new HttpError(400, 'O nome não pode ficar vazio.');
    board.name = name;
  }
  if (body.shareMode !== undefined) {
    if (role !== 'owner') throw new HttpError(403, 'Só o dono pode alterar o compartilhamento.');
    if (!['off', 'view', 'edit'].includes(body.shareMode)) throw new HttpError(400, 'Opção de compartilhamento inválida.');
    board.shareMode = body.shareMode;
  }
  board.updatedAt = Date.now();
  store.saveBoard(board);
  collab.refreshBoard(board);
  sendJSON(res, 200, { board: collab.boardMeta(board, role) });
}

async function deleteBoard(res, id, user) {
  const { board } = requireBoard(id, user);
  if (board.ownerId === user.id) {
    collab.closeBoard(id);
    await store.deleteBoard(id);
    return sendJSON(res, 200, { ok: true, deleted: true });
  }
  // Quem não é dono apenas remove o quadro da própria lista.
  delete board.members[user.id];
  board.visitors = board.visitors.filter((v) => v !== user.id);
  store.saveBoard(board);
  collab.refreshBoard(board);
  sendJSON(res, 200, { ok: true, deleted: false });
}

async function addMember(req, res, id, user) {
  const { board, role } = requireBoard(id, user);
  if (role !== 'owner') throw new HttpError(403, 'Só o dono pode convidar pessoas.');
  const body = await readJSON(req);
  const target = store.getUserByUsername(body.username);
  if (!target) throw new HttpError(404, 'Não há conta com este usuário. Peça para a pessoa se cadastrar no Pino primeiro.');
  if (target.id === board.ownerId) throw new HttpError(400, 'Esta pessoa já é dona do quadro.');
  board.members[target.id] = body.role === 'viewer' ? 'viewer' : 'editor';
  store.saveBoard(board);
  collab.refreshBoard(board);
  sendJSON(res, 200, { board: collab.boardMeta(board, role) });
}

function removeMember(res, id, memberId, user) {
  const { board, role } = requireBoard(id, user);
  if (role !== 'owner' && memberId !== user.id) throw new HttpError(403, 'Só o dono pode remover pessoas.');
  delete board.members[memberId];
  board.visitors = board.visitors.filter((v) => v !== memberId);
  store.saveBoard(board);
  collab.refreshBoard(board);
  sendJSON(res, 200, { board: collab.boardMeta(board, role) });
}

/* ---------------- imagens ---------------- */

async function uploadAsset(req, res, user) {
  const body = await readJSON(req, 18 * 1024 * 1024);
  const { role } = requireBoard(String(body.boardId || ''), user);
  if (!canEdit(role)) throw new HttpError(403, 'Você só pode visualizar este quadro.');
  const { mime, buffer } = parseDataUrl(body.dataUrl, IMAGE_TYPES);
  if (!buffer.length) throw new HttpError(400, 'Imagem vazia.');
  if (buffer.length > MAX_ASSET_BYTES) throw new HttpError(413, 'Imagem muito grande (máximo 12 MB).');
  const meta = await store.createAsset({ boardId: body.boardId, mime, name: str(body.name, 200), buffer, createdBy: user.id });
  sendJSON(res, 201, { id: meta.id, url: `/api/assets/${meta.id}`, mime });
}

async function getAsset(req, res, id, user) {
  const meta = store.getAssetMeta(id);
  if (!meta) throw new HttpError(404, 'Imagem não encontrada.');
  requireBoard(meta.boardId, user);
  const data = await store.readAssetData(id);
  if (!data) throw new HttpError(404, 'Imagem não encontrada.');
  res.writeHead(200, {
    'Content-Type': meta.mime,
    'Content-Length': data.length,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    // SVGs enviados por usuários nunca executam scripts, mesmo se abertos diretamente.
    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
  });
  res.end(data);
}

async function cloneAsset(req, res, id, user) {
  const meta = store.getAssetMeta(id);
  if (!meta) throw new HttpError(404, 'Imagem não encontrada.');
  requireBoard(meta.boardId, user);
  const body = await readJSON(req);
  const { role } = requireBoard(String(body.boardId || ''), user);
  if (!canEdit(role)) throw new HttpError(403, 'Você só pode visualizar este quadro.');
  const data = await store.readAssetData(id);
  const copy = await store.createAsset({ boardId: body.boardId, mime: meta.mime, name: meta.name, buffer: data, createdBy: user.id });
  sendJSON(res, 201, { id: copy.id, url: `/api/assets/${copy.id}`, mime: copy.mime });
}

/* ---------------- IA: foto → post-its ---------------- */

async function aiPhoto(req, res, user) {
  const body = await readJSON(req, 10 * 1024 * 1024);
  const { role } = requireBoard(String(body.boardId || ''), user);
  if (!canEdit(role)) throw new HttpError(403, 'Você só pode visualizar este quadro.');
  const { mime, base64, buffer } = parseDataUrl(body.image, AI_IMAGE_TYPES);
  if (buffer.length > MAX_AI_IMAGE_BYTES) throw new HttpError(413, 'Foto muito grande (máximo 5 MB).');
  if (aiInFlight.has(user.id)) throw new HttpError(429, 'Aguarde a leitura da foto anterior terminar.');
  aiInFlight.add(user.id);
  try {
    const result = await photoToNotes({ mediaType: mime, data: base64, hint: str(body.hint, 1000) });
    sendJSON(res, 200, result);
  } finally {
    aiInFlight.delete(user.id);
  }
}
