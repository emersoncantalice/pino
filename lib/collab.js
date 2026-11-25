/**
 * Colaboração em tempo real: salas por quadro, operações nos itens,
 * presença (cursores e seleções) e o timer compartilhado.
 */
import * as store from './store.js';
import { roleFor, canEdit } from './access.js';
import { sanitizeItem, sanitizePatch, applyPatch, ID_RE } from './sanitize.js';
import { uid, str } from './util.js';

const MAX_ITEMS = 20000;
const MAX_OPS_PER_MESSAGE = 5000;

const rooms = new Map(); // boardId -> Room
const clients = new Set();

export function boardMeta(board) {
  const owner = store.getUser(board.ownerId);
  const members = [];
  for (const [userId, memberRole] of Object.entries(board.members)) {
    const u = store.getUser(userId);
    if (!u) continue;
    members.push({
      userId,
      name: u.name,
      color: u.color,
      role: memberRole,
      username: u.username,
    });
  }
  return {
    id: board.id,
    name: board.name,
    ownerId: board.ownerId,
    ownerName: owner ? owner.name : '—',
    shareMode: board.shareMode,
    members,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  };
}

function peerInfo(c) {
  return {
    sid: c.sid,
    userId: c.user.id,
    name: c.user.name,
    color: c.user.color,
    role: c.role,
    cursor: c.cursor,
    sel: c.sel,
  };
}

class Room {
  constructor(board) {
    this.board = board;
    this.clients = new Map();
    this.timerHandle = null;
    this.scheduleTimer();
  }

  send(c, msg) {
    c.ws.send(JSON.stringify(msg));
  }

  broadcast(msg, exceptSid = null) {
    const data = JSON.stringify(msg);
    for (const c of this.clients.values()) if (c.sid !== exceptSid) c.ws.send(data);
  }

  presence() {
    this.broadcast({ type: 'presence', peers: [...this.clients.values()].map(peerInfo) });
  }

  sendMeta() {
    for (const c of this.clients.values()) this.send(c, { type: 'meta', board: boardMeta(this.board, c.role) });
  }

  scheduleTimer() {
    clearTimeout(this.timerHandle);
    this.timerHandle = null;
    const t = this.board.timer;
    if (!t || !t.running || !t.endsAt) return;
    const ms = t.endsAt - Date.now();
    if (ms <= 0) return this.finishTimer();
    this.timerHandle = setTimeout(() => this.finishTimer(), Math.min(ms, 2 ** 31 - 1));
  }

  finishTimer() {
    const t = this.board.timer;
    if (!t || !t.running) return;
    t.running = false;
    t.endsAt = null;
    t.remaining = 0;
    t.finishedAt = Date.now();
    store.saveBoard(this.board);
    this.broadcast({ type: 'timer', timer: t, now: Date.now() });
    this.broadcast({ type: 'timer:done', label: t.label || '' });
  }
}

function getRoom(board) {
  let room = rooms.get(board.id);
  if (!room) {
    room = new Room(board);
    rooms.set(board.id, room);
  }
  return room;
}

/* ------------------------------------------------------------------ */

export function handleConnection(ws, user) {
  const client = { sid: uid(10), ws, user, room: null, role: null, cursor: null, sel: [] };
  clients.add(client);
  ws.on('message', (data) => {
    if (typeof data !== 'string') return;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    try {
      onMessage(client, msg);
    } catch (err) {
      console.error('[ws] erro ao processar mensagem:', err);
    }
  });
  ws.on('close', () => {
    clients.delete(client);
    leave(client);
  });
}

function onMessage(c, msg) {
  if (msg.type === 'join') return join(c, msg);
  const room = c.room;
  if (!room) return;
  switch (msg.type) {
    case 'ops':
      return onOps(c, room, msg.ops);
    case 'cursor':
      return onCursor(c, room, msg);
    case 'sel':
      return onSelection(c, room, msg.ids);
    case 'timer':
      return onTimer(c, room, msg);
    case 'meta':
      return onMeta(c, room, msg);
    case 'summon':
      return onSummon(c, room, msg);
    default:
  }
}

function join(c, msg) {
  if (c.room) leave(c);
  const board = typeof msg.boardId === 'string' ? store.getBoard(msg.boardId) : null;
  if (!board) {
    c.ws.send(JSON.stringify({ type: 'error', code: 'not-found', message: 'Este quadro não existe ou foi excluído.' }));
    c.ws.close(4004, 'not-found');
    return;
  }
  const role = roleFor(board, c.user.id);
  if (!role) {
    c.ws.send(JSON.stringify({ type: 'error', code: 'no-access', message: 'Você não tem acesso a este quadro. Peça ao dono para compartilhar.' }));
    c.ws.close(4003, 'no-access');
    return;
  }
  const isListed = board.ownerId === c.user.id || board.members[c.user.id] || board.visitors.includes(c.user.id);
  if (!isListed) {
    board.visitors.push(c.user.id);
    store.saveBoard(board);
  }
  const room = getRoom(board);
  c.room = room;
  c.role = role;
  c.cursor = null;
  c.sel = [];
  room.clients.set(c.sid, c);
  room.send(c, {
    type: 'joined',
    board: { ...boardMeta(board, role), items: board.items },
    role,
    you: { sid: c.sid, userId: c.user.id, name: c.user.name, color: c.user.color },
    peers: [...room.clients.values()].map(peerInfo),
    timer: board.timer,
    now: Date.now(),
  });
  room.presence();
}

function leave(c) {
  const room = c.room;
  if (!room) return;
  room.clients.delete(c.sid);
  c.room = null;
  room.broadcast({ type: 'leave', sid: c.sid });
  room.presence();
}

function onOps(c, room, ops) {
  if (!canEdit(c.role) || !Array.isArray(ops)) return;
  const items = room.board.items;
  let count = Object.keys(items).length;
  const accepted = [];
  for (const op of ops.slice(0, MAX_OPS_PER_MESSAGE)) {
    if (!op || typeof op !== 'object') continue;
    if (op.op === 'add') {
      const item = sanitizeItem(op.item, c.user);
      if (!item) continue;
      const exists = Object.prototype.hasOwnProperty.call(items, item.id);
      if (!exists && count >= MAX_ITEMS) continue;
      if (!exists) count++;
      items[item.id] = item;
      accepted.push({ op: 'add', item });
    } else if (op.op === 'upd') {
      if (typeof op.id !== 'string' || !Object.prototype.hasOwnProperty.call(items, op.id)) continue;
      const patch = sanitizePatch(op.patch);
      if (!patch) continue;
      applyPatch(items[op.id], patch);
      accepted.push({ op: 'upd', id: op.id, patch });
    } else if (op.op === 'del') {
      if (typeof op.id !== 'string' || !Object.prototype.hasOwnProperty.call(items, op.id)) continue;
      delete items[op.id];
      count--;
      accepted.push({ op: 'del', id: op.id });
    }
  }
  if (!accepted.length) return;
  room.board.updatedAt = Date.now();
  store.saveBoard(room.board);
  room.broadcast({ type: 'ops', ops: accepted, by: c.sid }, c.sid);
}

function onCursor(c, room, msg) {
  const ok = typeof msg.x === 'number' && typeof msg.y === 'number' && Number.isFinite(msg.x) && Number.isFinite(msg.y);
  c.cursor = ok ? { x: Math.round(msg.x), y: Math.round(msg.y) } : null;
  room.broadcast({ type: 'cursor', sid: c.sid, cursor: c.cursor }, c.sid);
}

function onSelection(c, room, ids) {
  c.sel = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && ID_RE.test(id)).slice(0, 500) : [];
  room.broadcast({ type: 'sel', sid: c.sid, ids: c.sel }, c.sid);
}

function onTimer(c, room, msg) {
  if (!canEdit(c.role)) return;
  const board = room.board;
  const now = Date.now();
  let t = board.timer;
  const seconds = (v) => Math.round(Math.min(24 * 3600, Math.max(1, Number(v) || 0)));
  switch (msg.action) {
    case 'start': {
      const d = seconds(msg.seconds);
      t = { duration: d, remaining: d, endsAt: now + d * 1000, running: true, label: str(msg.label, 80), startedBy: c.user.name, finishedAt: null };
      break;
    }
    case 'pause':
      if (!t || !t.running) return;
      t.remaining = Math.max(0, (t.endsAt - now) / 1000);
      t.running = false;
      t.endsAt = null;
      break;
    case 'resume':
      if (!t || t.running || t.remaining <= 0) return;
      t.endsAt = now + t.remaining * 1000;
      t.running = true;
      t.finishedAt = null;
      break;
    case 'add': {
      if (!t) return;
      const s = Math.round(Math.max(-3600, Math.min(3600, Number(msg.seconds) || 60)));
      if (t.running) t.endsAt = Math.max(now, t.endsAt + s * 1000);
      else t.remaining = Math.max(0, t.remaining + s);
      t.duration = Math.max(1, t.duration + s);
      t.finishedAt = null;
      break;
    }
    case 'reset':
      if (!t) return;
      t.running = false;
      t.endsAt = null;
      t.remaining = t.duration;
      t.finishedAt = null;
      break;
    case 'clear':
      t = null;
      break;
    default:
      return;
  }
  board.timer = t;
  store.saveBoard(board);
  room.broadcast({ type: 'timer', timer: t, now: Date.now(), by: c.user.name });
  room.scheduleTimer();
}

function onMeta(c, room, msg) {
  if (!canEdit(c.role)) return;
  const name = str(msg.name, 120);
  if (!name || name === room.board.name) return;
  room.board.name = name;
  room.board.updatedAt = Date.now();
  store.saveBoard(room.board);
  room.sendMeta();
}

function onSummon(c, room, msg) {
  const v = msg.view;
  if (!v || ![v.x, v.y, v.s].every((n) => typeof n === 'number' && Number.isFinite(n))) return;
  room.broadcast({ type: 'summon', sid: c.sid, name: c.user.name, view: { x: v.x, y: v.y, s: v.s } }, c.sid);
}

/* ------------------------------------------------------------------ */
/* Chamado pela API REST                                               */
/* ------------------------------------------------------------------ */

/** Recalcula permissões dos conectados após mudança de compartilhamento. */
export function refreshBoard(board) {
  const room = rooms.get(board.id);
  if (!room) return;
  for (const c of [...room.clients.values()]) {
    const role = roleFor(board, c.user.id);
    if (!role) {
      room.send(c, { type: 'error', code: 'no-access', message: 'O dono removeu seu acesso a este quadro.' });
      c.ws.close(4003, 'no-access');
      leave(c);
      continue;
    }
    if (role !== c.role) {
      c.role = role;
      room.send(c, { type: 'role', role });
    }
  }
  room.sendMeta();
  room.presence();
}

export function closeBoard(boardId) {
  const room = rooms.get(boardId);
  if (!room) return;
  clearTimeout(room.timerHandle);
  for (const c of [...room.clients.values()]) {
    room.send(c, { type: 'error', code: 'deleted', message: 'Este quadro foi excluído pelo dono.' });
    c.ws.close(4004, 'deleted');
    c.room = null;
  }
  rooms.delete(boardId);
}

export function onlineCount(boardId) {
  const room = rooms.get(boardId);
  return room ? room.clients.size : 0;
}

// Heartbeat: derruba conexões que pararam de responder.
setInterval(() => {
  for (const c of clients) {
    if (!c.ws.isAlive) {
      c.ws.terminate();
      continue;
    }
    c.ws.isAlive = false;
    c.ws.ping();
  }
}, 30000).unref();
