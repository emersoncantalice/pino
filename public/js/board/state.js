/**
 * Estado do quadro no navegador: itens, seleção, ferramenta atual e histórico.
 *
 * Toda alteração passa por operações:
 *   { op: 'add', item } | { op: 'upd', id, patch } | { op: 'del', id }
 * `commit()` aplica localmente, envia ao servidor e registra no histórico (desfazer/refazer).
 */
import * as net from './net.js';

export const state = {
  boardId: null,
  me: null, // { id, name, color }
  sid: null,
  board: null, // metadados (nome, dono, compartilhamento, membros)
  role: 'viewer',
  ai: { enabled: false },
  items: new Map(),
  selection: new Set(),
  tool: 'select',
  editingId: null,
  gesture: false,
  toolOpts: {
    stickyColor: '#FFF27A',
    shape: 'rect',
    penKind: 'pen',
    penColor: '#1F2328',
    penWidth: 4,
    hlColor: '#FFE14D',
  },
};

/* ---------------- eventos ---------------- */
const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, ...args) {
  const set = listeners.get(evt);
  if (set) for (const fn of [...set]) fn(...args);
}

export const canEdit = () => state.role === 'owner' || state.role === 'editor';
export const getItem = (id) => state.items.get(id);

const clone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

/* ---------------- aplicação de operações ---------------- */
function isValid(op) {
  if (!op) return false;
  if (op.op === 'add') return !!(op.item && op.item.id);
  if (op.op === 'upd') return state.items.has(op.id) && !!op.patch;
  if (op.op === 'del') return state.items.has(op.id);
  return false;
}

function applyOne(op) {
  if (op.op === 'add') {
    state.items.set(op.item.id, clone(op.item));
    emit('item', op.item.id);
  } else if (op.op === 'upd') {
    const it = state.items.get(op.id);
    if (!it) return;
    for (const k of Object.keys(op.patch)) {
      const v = op.patch[k];
      if (v === null) delete it[k];
      else it[k] = clone(v);
    }
    emit('item', op.id);
  } else if (op.op === 'del') {
    state.items.delete(op.id);
    if (state.selection.has(op.id)) {
      state.selection.delete(op.id);
      emit('selection');
    }
    emit('remove', op.id);
  }
}

function invert(op) {
  if (op.op === 'add') {
    const prev = state.items.get(op.item.id);
    return prev ? { op: 'add', item: clone(prev) } : { op: 'del', id: op.item.id };
  }
  if (op.op === 'del') return { op: 'add', item: clone(state.items.get(op.id)) };
  const it = state.items.get(op.id);
  const patch = {};
  for (const k of Object.keys(op.patch)) patch[k] = k in it ? clone(it[k]) : null;
  return { op: 'upd', id: op.id, patch };
}

/* ---------------- histórico ---------------- */
const undoStack = [];
const redoStack = [];

export function pushHistory(undo, redo) {
  if (!undo.length && !redo.length) return;
  undoStack.push({ undo, redo });
  if (undoStack.length > 300) undoStack.shift();
  redoStack.length = 0;
  emit('history');
}

export const lastHistory = () => undoStack[undoStack.length - 1] || null;
export function popHistory() {
  undoStack.pop();
  emit('history');
}
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

/** Aplica, envia e (opcionalmente) registra no histórico. */
export function commit(ops, { record = true, send = true } = {}) {
  if (!canEdit()) return false;
  const valid = ops.filter(isValid);
  if (!valid.length) return false;
  const inverse = [];
  for (const op of valid) {
    if (record) inverse.unshift(invert(op));
    applyOne(op);
  }
  if (send) net.sendOps(valid.map(clone));
  if (record) pushHistory(inverse, valid.map(clone));
  return true;
}

function travel(from, to, key) {
  const entry = from.pop();
  if (!entry) return;
  commit(entry[key], { record: false });
  to.push(entry);
  emit('history');
}
export const undo = () => travel(undoStack, redoStack, 'undo');
export const redo = () => travel(redoStack, undoStack, 'redo');

/** Operações vindas de outras pessoas (não entram no histórico local). */
export function applyRemote(ops) {
  for (const op of ops) if (isValid(op)) applyOne(op);
}

export function resetItems(itemsObj) {
  state.items.clear();
  for (const it of Object.values(itemsObj || {})) state.items.set(it.id, it);
  let changed = false;
  for (const id of [...state.selection]) {
    if (!state.items.has(id)) {
      state.selection.delete(id);
      changed = true;
    }
  }
  emit('reset');
  if (changed) emit('selection');
}

/* ---------------- gestos (arrastar, redimensionar) ---------------- */
export function pick(it, keys) {
  const out = {};
  for (const k of keys) out[k] = k in it ? clone(it[k]) : null;
  return out;
}

export function snapshot(ids, keys) {
  const snap = new Map();
  for (const id of ids) {
    const it = state.items.get(id);
    if (it) snap.set(id, pick(it, keys));
  }
  return snap;
}

/** Fecha um gesto contínuo registrando um único passo no histórico. */
export function finishGesture(snap) {
  const undoOps = [];
  const redoOps = [];
  for (const [id, before] of snap) {
    const it = state.items.get(id);
    if (!it) continue;
    const after = pick(it, Object.keys(before));
    if (JSON.stringify(after) === JSON.stringify(before)) continue;
    undoOps.push({ op: 'upd', id, patch: before });
    redoOps.push({ op: 'upd', id, patch: after });
  }
  if (undoOps.length) pushHistory(undoOps, redoOps);
}

/* ---------------- seleção ---------------- */
export function setSelection(ids) {
  const next = new Set([...ids].filter((id) => state.items.has(id)));
  if (next.size === state.selection.size && [...next].every((id) => state.selection.has(id))) return;
  state.selection = next;
  emit('selection');
}

export function toggleSelection(id) {
  const next = new Set(state.selection);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setSelection(next);
}

export const selectedItems = () => [...state.selection].map((id) => state.items.get(id)).filter(Boolean);

export function setTool(tool) {
  if (state.tool === tool) return;
  state.tool = tool;
  emit('tool', tool);
}
