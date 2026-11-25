/**
 * Persistência em arquivos JSON dentro de /data.
 *
 *   data/users.json        contas (senha com hash scrypt)
 *   data/sessions.json     sessões de login
 *   data/boards/<id>.json  um arquivo por quadro (itens, membros, timer)
 *   data/assets.json       índice das imagens enviadas
 *   data/assets/<id>.json  conteúdo de cada imagem (base64 dentro do JSON)
 *
 * Tudo fica em memória e é gravado em disco com debounce e escrita atômica.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { uid } from './util.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
const BOARDS_DIR = path.join(DATA_DIR, 'boards');
const ASSETS_DIR = path.join(DATA_DIR, 'assets');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const ASSET_INDEX_FILE = path.join(DATA_DIR, 'assets.json');

const SESSION_TTL = 30 * 24 * 3600 * 1000;
const USER_COLORS = [
  '#5A4BFF', '#E5484D', '#30A46C', '#F76B15', '#0090FF', '#D6409F',
  '#12A594', '#AB4ABA', '#E54666', '#3E63DD', '#AD7F58', '#8E4EC6',
];

const users = new Map();
const emailIndex = new Map();
const sessions = new Map();
const boards = new Map();
const assets = new Map();

/* ------------------------------------------------------------------ */
/* Escrita em disco                                                    */
/* ------------------------------------------------------------------ */

function readJSONSync(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[dados] não foi possível ler ${file}: ${err.message}`);
    return fallback;
  }
}

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, data);
  try {
    await fsp.rename(tmp, file);
  } catch {
    // No Windows o rename pode falhar se outro processo estiver lendo o arquivo.
    await fsp.writeFile(file, data);
    await fsp.rm(tmp, { force: true });
  }
}

function writeAtomicSync(file, data) {
  const tmp = `${file}.${process.pid}.sync.tmp`;
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, data);
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignora */ }
  }
}

const pending = new Map(); // arquivo -> { timer, produce }
const chains = new Map(); // arquivo -> Promise da última escrita

function schedule(file, produce, delay) {
  const existing = pending.get(file);
  if (existing) {
    existing.produce = produce;
    return;
  }
  const entry = { produce, timer: null };
  entry.timer = setTimeout(() => {
    pending.delete(file);
    const data = entry.produce();
    const prev = chains.get(file) || Promise.resolve();
    const next = prev
      .then(() => writeAtomic(file, data))
      .catch((err) => console.error(`[dados] erro ao salvar ${file}:`, err.message));
    chains.set(file, next);
  }, delay);
  pending.set(file, entry);
}

function cancelPending(file) {
  const entry = pending.get(file);
  if (entry) {
    clearTimeout(entry.timer);
    pending.delete(file);
  }
}

/** Grava imediatamente tudo o que estiver pendente (usado ao encerrar o servidor). */
export function flushSync() {
  for (const [file, entry] of pending) {
    clearTimeout(entry.timer);
    try {
      writeAtomicSync(file, entry.produce());
    } catch (err) {
      console.error(`[dados] erro ao salvar ${file}:`, err.message);
    }
  }
  pending.clear();
}

/* ------------------------------------------------------------------ */
/* Inicialização                                                       */
/* ------------------------------------------------------------------ */

function normalizeBoard(b) {
  if (!b.items || typeof b.items !== 'object') b.items = {};
  if (!b.members || typeof b.members !== 'object') b.members = {};
  if (!Array.isArray(b.visitors)) b.visitors = [];
  if (!['off', 'view', 'edit'].includes(b.shareMode)) b.shareMode = 'edit';
  if (b.timer === undefined) b.timer = null;
  b.name = b.name || 'Quadro sem título';
  b.createdAt = b.createdAt || Date.now();
  b.updatedAt = b.updatedAt || b.createdAt;
  return b;
}

export function init() {
  for (const dir of [DATA_DIR, BOARDS_DIR, ASSETS_DIR]) fs.mkdirSync(dir, { recursive: true });

  for (const u of readJSONSync(USERS_FILE, [])) {
    if (!u || !u.id || !u.email) continue;
    users.set(u.id, u);
    emailIndex.set(u.email, u);
  }

  const now = Date.now();
  const saved = readJSONSync(SESSIONS_FILE, {});
  for (const [token, s] of Object.entries(saved)) {
    if (s && users.has(s.userId) && now - (s.lastSeen || 0) < SESSION_TTL) sessions.set(token, s);
  }

  for (const a of readJSONSync(ASSET_INDEX_FILE, [])) if (a && a.id) assets.set(a.id, a);

  for (const name of fs.readdirSync(BOARDS_DIR)) {
    if (!name.endsWith('.json')) continue;
    const b = readJSONSync(path.join(BOARDS_DIR, name), null);
    if (b && b.id) boards.set(b.id, normalizeBoard(b));
  }

  console.log(`[dados] ${users.size} usuário(s) e ${boards.size} quadro(s) carregados de ${DATA_DIR}`);
}

/* ------------------------------------------------------------------ */
/* Usuários                                                            */
/* ------------------------------------------------------------------ */

function saveUsers() {
  schedule(USERS_FILE, () => JSON.stringify([...users.values()], null, 2), 50);
}

export function getUser(id) {
  return users.get(id) || null;
}

export function getUserByEmail(email) {
  return emailIndex.get(String(email || '').trim().toLowerCase()) || null;
}

export function createUser({ name, email, passwordHash }) {
  const user = {
    id: uid(12),
    name,
    email: email.toLowerCase(),
    passwordHash,
    color: USER_COLORS[users.size % USER_COLORS.length],
    createdAt: Date.now(),
  };
  users.set(user.id, user);
  emailIndex.set(user.email, user);
  saveUsers();
  return user;
}

export function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, color: u.color };
}

/* ------------------------------------------------------------------ */
/* Sessões                                                             */
/* ------------------------------------------------------------------ */

function saveSessions() {
  schedule(SESSIONS_FILE, () => JSON.stringify(Object.fromEntries(sessions), null, 2), 200);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions.set(token, { userId, createdAt: now, lastSeen: now });
  saveSessions();
  return token;
}

export function getSessionUser(token) {
  const s = sessions.get(token);
  if (!s) return null;
  const now = Date.now();
  if (now - s.lastSeen > SESSION_TTL) {
    sessions.delete(token);
    saveSessions();
    return null;
  }
  if (now - s.lastSeen > 3600 * 1000) {
    s.lastSeen = now;
    saveSessions();
  }
  return users.get(s.userId) || null;
}

export function deleteSession(token) {
  if (sessions.delete(token)) saveSessions();
}

/* ------------------------------------------------------------------ */
/* Quadros                                                             */
/* ------------------------------------------------------------------ */

const boardFile = (id) => path.join(BOARDS_DIR, `${id}.json`);

export function getBoard(id) {
  return boards.get(id) || null;
}

export function allBoards() {
  return [...boards.values()];
}

export function createBoard({ name, ownerId, items = [] }) {
  const now = Date.now();
  const board = normalizeBoard({
    id: uid(12),
    name,
    ownerId,
    shareMode: 'edit',
    members: {},
    visitors: [],
    createdAt: now,
    updatedAt: now,
    items: {},
    timer: null,
  });
  for (const it of items) board.items[it.id] = it;
  boards.set(board.id, board);
  saveBoard(board, 0);
  return board;
}

export function saveBoard(board, delay = 800) {
  if (!boards.has(board.id)) return;
  schedule(boardFile(board.id), () => JSON.stringify(board), delay);
}

export async function deleteBoard(id) {
  boards.delete(id);
  const file = boardFile(id);
  cancelPending(file);
  await (chains.get(file) || Promise.resolve());
  await fsp.rm(file, { force: true });
  let changed = false;
  for (const a of [...assets.values()]) {
    if (a.boardId !== id) continue;
    assets.delete(a.id);
    changed = true;
    await fsp.rm(assetFile(a.id), { force: true });
  }
  if (changed) saveAssetIndex();
}

/* ------------------------------------------------------------------ */
/* Imagens (estruturas importadas, fotos, etc.)                        */
/* ------------------------------------------------------------------ */

const assetFile = (id) => path.join(ASSETS_DIR, `${id}.json`);

function saveAssetIndex() {
  schedule(ASSET_INDEX_FILE, () => JSON.stringify([...assets.values()], null, 2), 100);
}

export async function createAsset({ boardId, mime, name, buffer, createdBy }) {
  const meta = {
    id: uid(16),
    boardId,
    mime,
    name: String(name || 'imagem').slice(0, 200),
    size: buffer.length,
    createdBy,
    createdAt: Date.now(),
  };
  await writeAtomic(assetFile(meta.id), JSON.stringify({ ...meta, data: buffer.toString('base64') }));
  assets.set(meta.id, meta);
  saveAssetIndex();
  return meta;
}

export function getAssetMeta(id) {
  return assets.get(id) || null;
}

export async function readAssetData(id) {
  if (!assets.has(id)) return null;
  const raw = JSON.parse(await fsp.readFile(assetFile(id), 'utf8'));
  return Buffer.from(raw.data, 'base64');
}
