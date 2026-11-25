/**
 * Conexão WebSocket com o servidor: reconexão automática, fila de operações
 * (agrupa atualizações do mesmo item para não sobrecarregar a rede).
 */
const handlers = new Map();
let ws = null;
let boardId = null;
let joined = false;
let attempts = 0;
let stopped = false;
let outbox = [];
let flushTimer = null;

export function onMsg(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
}

function dispatch(msg) {
  const set = handlers.get(msg.type);
  if (set) for (const fn of set) fn(msg);
}

export function connect(id) {
  boardId = id;
  open();
}

function open() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${proto}//${location.host}/ws`);
  ws = socket;
  dispatch({ type: 'status', status: attempts ? 'reconnecting' : 'connecting' });
  socket.onopen = () => socket.send(JSON.stringify({ type: 'join', boardId }));
  socket.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.type === 'joined') {
      joined = true;
      attempts = 0;
      dispatch(msg);
      dispatch({ type: 'status', status: 'online' });
      flush();
      return;
    }
    if (msg.type === 'error') stopped = true;
    dispatch(msg);
  };
  socket.onclose = () => {
    if (ws !== socket) return;
    joined = false;
    ws = null;
    if (stopped) return;
    attempts++;
    dispatch({ type: 'status', status: 'offline', attempts });
    const delay = Math.min(8000, 400 * 2 ** Math.min(attempts, 5)) * (0.8 + Math.random() * 0.4);
    setTimeout(open, delay);
  };
}

export const isOnline = () => joined;

export function send(msg) {
  if (joined && ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function queue(op) {
  if (op.op === 'upd') {
    for (let i = outbox.length - 1; i >= 0; i--) {
      const o = outbox[i];
      if (o.op === 'upd' && o.id === op.id) {
        Object.assign(o.patch, op.patch);
        return;
      }
      if (o.op === 'add' && o.item.id === op.id) {
        for (const [k, v] of Object.entries(op.patch)) {
          if (v === null) delete o.item[k];
          else o.item[k] = v;
        }
        return;
      }
      if (o.op === 'del' && o.id === op.id) break;
    }
  }
  outbox.push(op);
}

export function sendOps(ops) {
  for (const op of ops) queue(op);
  if (!flushTimer) flushTimer = setTimeout(flush, 40);
}

function flush() {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (!joined || !outbox.length || !ws || ws.readyState !== 1) return;
  const ops = outbox;
  outbox = [];
  ws.send(JSON.stringify({ type: 'ops', ops }));
}

/** Operações ainda não enviadas (reaplicadas após uma reconexão). */
export const pendingOps = () => outbox.map((o) => JSON.parse(JSON.stringify(o)));
