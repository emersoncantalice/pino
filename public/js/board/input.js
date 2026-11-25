/** Interação: ponteiro (mouse/caneta/toque), roda, teclado, copiar/colar e arrastar arquivos. */
import {
  state, commit, canEdit, setSelection, toggleSelection, snapshot, finishGesture, pushHistory,
  setTool, emit, on, undo, redo, selectedItems,
} from './state.js';
import * as view from './view.js';
import * as net from './net.js';
import { hitItemId, flush, markOverlay } from './render.js';
import { startEditing, stopEditing, isEditing } from './editing.js';
import { itemBox, unionBox, isContainer, childrenOf, newSticky, newText, newShape, newFrame, topZ } from './items.js';
import { simplify, intersects, contains, pathD } from './geometry.js';
import { handlePaste, copySelection, duplicateSelection, importFiles } from './importer.js';
import { textLayout } from '../textfit.js';
import { uid, isTypingTarget, throttle, clamp } from '../util.js';
import { isModalOpen } from '../modal.js';
import { unlockAudio } from './sound.js';

let vp;
let draftLayer;
let marqueeEl;
let dropHint;
let mode = null;
let g = null;
let ghost = null;
const pointers = new Map();
let pinch = null;
let spaceDown = false;
let lastPointer = null;

const sendCursor = throttle((x, y) => net.send({ type: 'cursor', x, y }), 50);

export function initInput({ viewport, draft, marquee, drop }) {
  vp = viewport;
  draftLayer = draft;
  marqueeEl = marquee;
  dropHint = drop;

  vp.addEventListener('pointerdown', onPointerDown);
  vp.addEventListener('pointermove', onPointerMove);
  vp.addEventListener('pointerup', onPointerUp);
  vp.addEventListener('pointercancel', onPointerUp);
  vp.addEventListener('pointerleave', () => {
    if (!mode) {
      sendCursor(null, null);
      removeGhost();
    }
  });
  vp.addEventListener('wheel', onWheel, { passive: false });
  vp.addEventListener('dblclick', onDblClick);
  vp.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceDown = false;
      vp.classList.remove('panning-ready');
    }
  });
  window.addEventListener('blur', () => {
    spaceDown = false;
    vp.classList.remove('panning-ready');
  });

  const blocked = () => isModalOpen() || isEditing() || isTypingTarget(document.activeElement);
  document.addEventListener('copy', (e) => {
    if (!blocked()) copySelection(e);
  });
  document.addEventListener('cut', (e) => {
    if (!blocked() && canEdit() && copySelection(e)) deleteSelection();
  });
  document.addEventListener('paste', (e) => {
    if (!blocked()) handlePaste(e, pastePoint());
  });

  // Arrastar arquivos (imagens, SVG, backup .json) para o quadro
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (canEdit() && !isModalOpen()) dropHint.hidden = false;
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) dropHint.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dropHint.hidden = true;
    if (!canEdit() || isModalOpen()) return;
    importFiles([...e.dataTransfer.files], view.toWorld(e.clientX, e.clientY));
  });

  on('tool', (tool) => {
    vp.className = `viewport tool-${tool}`;
    removeGhost();
  });
  on('view', () => {
    if (lastPointer && !mode) {
      const wp = view.toWorld(lastPointer.x, lastPointer.y);
      sendCursor(wp.x, wp.y);
    }
  });
  vp.className = `viewport tool-${state.tool}`;
}

function pastePoint() {
  if (lastPointer) return view.toWorld(lastPointer.x, lastPointer.y);
  return view.centerWorld();
}

/* ------------------------------------------------------------------ */
/* Ponteiro                                                            */
/* ------------------------------------------------------------------ */

function onPointerDown(e) {
  unlockAudio();
  if (e.target.closest('[contenteditable="true"]')) return;
  if (isEditing()) stopEditing();
  const active = document.activeElement;
  if (active && active !== document.body && active !== vp && typeof active.blur === 'function') active.blur();

  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) return beginPinch();
  if (pointers.size > 2) return;
  try {
    vp.setPointerCapture(e.pointerId);
  } catch {
    /* ignora */
  }
  const wp = view.toWorld(e.clientX, e.clientY);

  if (e.button === 1 || (e.button === 0 && spaceDown) || state.tool === 'hand') {
    e.preventDefault();
    return beginPan(e);
  }
  if (e.button !== 0) return;

  const tool = canEdit() ? state.tool : 'select';
  switch (tool) {
    case 'select':
      return selectDown(e, wp);
    case 'sticky':
    case 'text':
      mode = 'place';
      g = { tool, sx: e.clientX, sy: e.clientY };
      return;
    case 'shape':
    case 'frame':
      mode = 'rect';
      g = { tool, start: wp, box: null, el: draftRect() };
      return;
    case 'pen':
      removeGhost();
      mode = 'draw';
      g = { pts: [round2(wp.x), round2(wp.y)], el: draftPath() };
      updateDraftStroke();
      return;
    case 'arrow':
      mode = 'arrow';
      g = { start: wp, end: wp, el: draftPath() };
      return;
    case 'eraser':
      mode = 'erase';
      g = { removed: [], last: { x: e.clientX, y: e.clientY } };
      eraseAt(e.clientX, e.clientY);
      return;
    default:
  }
}

function selectDown(e, wp) {
  const handle = e.target.closest('[data-handle]');
  if (handle && canEdit()) return beginResize(handle.dataset.handle, wp);
  const add = e.target.closest('[data-add]');
  if (add && canEdit()) {
    mode = 'add';
    g = { dir: add.dataset.add };
    return;
  }
  const id = hitItemId(e.target);
  if (id) {
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (additive) {
      toggleSelection(id);
      if (!state.selection.has(id)) {
        mode = 'noop';
        return;
      }
    } else if (!state.selection.has(id)) {
      setSelection([id]);
    }
    mode = 'move';
    g = { start: wp, clickId: id, moved: false, additive, ids: [] };
    if (canEdit()) prepareMove();
    return;
  }
  if (e.pointerType === 'touch') return beginPan(e);
  mode = 'marquee';
  g = { sx: e.clientX, sy: e.clientY, base: e.shiftKey ? new Set(state.selection) : new Set(), moved: false };
  if (!e.shiftKey) setSelection([]);
}

function prepareMove() {
  const ids = new Set();
  for (const id of state.selection) {
    const it = state.items.get(id);
    if (it && !it.locked) ids.add(id);
  }
  for (const id of [...ids]) {
    const it = state.items.get(id);
    if (!isContainer(it)) continue;
    for (const c of childrenOf(it)) {
      const ci = state.items.get(c);
      if (ci && !ci.locked) ids.add(c);
    }
  }
  g.ids = [...ids];
  g.orig = new Map(g.ids.map((id) => [id, { x: state.items.get(id).x, y: state.items.get(id).y }]));
  g.snap = snapshot(g.ids, ['x', 'y']);
}

function beginResize(handle, wp) {
  const it = selectedItems()[0];
  if (!it || it.locked) return;
  mode = 'resize';
  g = {
    id: it.id, handle, type: it.type, b: itemBox(it), start: wp, fontSize: it.fontSize || 24,
    snap: snapshot([it.id], ['x', 'y', 'w', 'h', 'fontSize']),
  };
  state.gesture = true;
  emit('gesture', true);
}

function beginPan(e) {
  mode = 'pan';
  g = { x: e.clientX, y: e.clientY };
  vp.classList.add('panning');
}

function beginPinch() {
  if (mode === 'move' && g && g.moved) finishGesture(g.snap);
  if (mode === 'resize') finishGesture(g.snap);
  cleanupDraft();
  marqueeEl.hidden = true;
  state.gesture = false;
  const [a, b] = [...pointers.values()];
  mode = 'pinch';
  pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, v: { ...view.view } };
}

function onPointerMove(e) {
  lastPointer = { x: e.clientX, y: e.clientY };
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const wp = view.toWorld(e.clientX, e.clientY);
  if (e.pointerType !== 'touch') sendCursor(Math.round(wp.x), Math.round(wp.y));

  if (!mode) {
    if (state.tool === 'sticky' && canEdit()) showGhost(wp);
    return;
  }
  switch (mode) {
    case 'pinch': {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const s = clamp((pinch.v.s * d) / pinch.d, view.MIN_ZOOM, view.MAX_ZOOM);
      const wx = (pinch.cx - pinch.v.x) / pinch.v.s, wy = (pinch.cy - pinch.v.y) / pinch.v.s;
      view.setView({ s, x: cx - wx * s, y: cy - wy * s });
      return;
    }
    case 'pan':
      view.panBy(e.clientX - g.x, e.clientY - g.y);
      g.x = e.clientX;
      g.y = e.clientY;
      return;
    case 'move':
      return doMove(wp, e);
    case 'resize':
      return doResize(wp, e);
    case 'marquee':
      return doMarquee(e);
    case 'rect': {
      let w = wp.x - g.start.x, h = wp.y - g.start.y;
      if (e.shiftKey) {
        const m = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * m;
        h = Math.sign(h || 1) * m;
      }
      g.box = { x: Math.min(g.start.x, g.start.x + w), y: Math.min(g.start.y, g.start.y + h), w: Math.abs(w), h: Math.abs(h) };
      Object.assign(g.el.style, { transform: `translate(${g.box.x}px, ${g.box.y}px)`, width: `${g.box.w}px`, height: `${g.box.h}px`, display: 'block' });
      return;
    }
    case 'draw': {
      const n = g.pts.length;
      if (Math.hypot(wp.x - g.pts[n - 2], wp.y - g.pts[n - 1]) * view.view.s < 1.5) return;
      g.pts.push(round2(wp.x), round2(wp.y));
      updateDraftStroke();
      return;
    }
    case 'arrow': {
      let end = wp;
      if (e.shiftKey) {
        const ang = Math.atan2(wp.y - g.start.y, wp.x - g.start.x);
        const snap = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
        const len = Math.hypot(wp.x - g.start.x, wp.y - g.start.y);
        end = { x: g.start.x + Math.cos(snap) * len, y: g.start.y + Math.sin(snap) * len };
      }
      g.end = end;
      updateDraftArrow();
      return;
    }
    case 'erase': {
      const steps = Math.max(1, Math.ceil(Math.hypot(e.clientX - g.last.x, e.clientY - g.last.y) / 6));
      for (let i = 1; i <= steps; i++) eraseAt(g.last.x + ((e.clientX - g.last.x) * i) / steps, g.last.y + ((e.clientY - g.last.y) * i) / steps);
      g.last = { x: e.clientX, y: e.clientY };
      return;
    }
    default:
  }
}

function onPointerUp(e) {
  pointers.delete(e.pointerId);
  try {
    vp.releasePointerCapture(e.pointerId);
  } catch {
    /* ignora */
  }
  if (mode === 'pinch') {
    if (pointers.size < 2) {
      mode = pointers.size ? 'noop' : null;
      pinch = null;
    }
    return;
  }
  if (pointers.size) return;
  const m = mode;
  const data = g;
  mode = null;
  g = null;
  const wp = view.toWorld(e.clientX, e.clientY);
  const cancelled = e.type === 'pointercancel';

  switch (m) {
    case 'pan':
      vp.classList.remove('panning');
      break;
    case 'move':
      if (data.moved) finishGesture(data.snap);
      else if (!data.additive && data.clickId && state.selection.size > 1) setSelection([data.clickId]);
      endGesture();
      break;
    case 'resize':
      finishGesture(data.snap);
      endGesture();
      break;
    case 'marquee':
      marqueeEl.hidden = true;
      break;
    case 'add':
      if (!cancelled) addNeighbor(data.dir);
      break;
    case 'place':
      if (!cancelled) placeAt(data.tool, wp);
      break;
    case 'rect':
      data.el.remove();
      if (!cancelled) createRect(data);
      break;
    case 'draw':
      data.el.remove();
      if (!cancelled) finishStroke(data.pts);
      break;
    case 'arrow':
      data.el.remove();
      if (!cancelled) finishArrow(data.start, data.end);
      break;
    case 'erase':
      if (data.removed.length) {
        pushHistory(data.removed.map((item) => ({ op: 'add', item })), data.removed.map((it) => ({ op: 'del', id: it.id })));
      }
      break;
    default:
  }
}

function endGesture() {
  state.gesture = false;
  emit('gesture', false);
  markOverlay();
}

/* ---------------- mover / redimensionar / selecionar ---------------- */

function doMove(wp, e) {
  const dx = wp.x - g.start.x;
  const dy = wp.y - g.start.y;
  if (!g.moved) {
    if (Math.hypot(dx, dy) * view.view.s < 4 || !g.ids.length) return;
    g.moved = true;
    state.gesture = true;
    emit('gesture', true);
  }
  let mx = dx, my = dy;
  if (e.shiftKey) {
    if (Math.abs(dx) > Math.abs(dy)) my = 0;
    else mx = 0;
  }
  const ops = g.ids.map((id) => {
    const o = g.orig.get(id);
    return { op: 'upd', id, patch: { x: Math.round(o.x + mx), y: Math.round(o.y + my) } };
  });
  commit(ops, { record: false });
}

function doResize(wp, e) {
  const it = state.items.get(g.id);
  if (!it) return;
  const { b, handle, type } = g;
  let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
  if (handle.includes('w')) x1 = Math.min(wp.x, x2 - 10);
  if (handle.includes('e')) x2 = Math.max(wp.x, x1 + 10);
  if (handle.includes('n')) y1 = Math.min(wp.y, y2 - 10);
  if (handle.includes('s')) y2 = Math.max(wp.y, y1 + 10);
  let w = x2 - x1;
  let h = y2 - y1;
  const patch = {};
  if (type === 'text') {
    if (handle === 'e' || handle === 'w') {
      patch.w = Math.max(40, Math.round(w));
      patch.x = handle === 'w' ? Math.round(b.x + b.w - patch.w) : b.x;
      patch.y = b.y;
    } else {
      const sc = Math.max(0.05, w / b.w);
      patch.w = Math.max(40, Math.round(b.w * sc));
      patch.fontSize = clamp(Math.round(g.fontSize * sc * 10) / 10, 6, 600);
      patch.x = handle.includes('w') ? Math.round(b.x + b.w - patch.w) : b.x;
      const nh = textLayout({ ...it, ...patch }).h;
      patch.y = handle.includes('n') ? Math.round(b.y + b.h - nh) : b.y;
    }
    patch.h = textLayout({ ...it, ...patch }).h;
  } else {
    const keep = type === 'sticky' || type === 'image' || e.shiftKey;
    const min = type === 'sticky' ? 60 : 16;
    if (keep) {
      const sc = Math.max(w / b.w, h / b.h, min / Math.min(b.w, b.h));
      w = b.w * sc;
      h = b.h * sc;
    } else {
      w = Math.max(min, w);
      h = Math.max(min, h);
    }
    patch.w = Math.round(w);
    patch.h = Math.round(h);
    patch.x = Math.round(handle.includes('w') ? b.x + b.w - patch.w : b.x);
    patch.y = Math.round(handle.includes('n') ? b.y + b.h - patch.h : b.y);
  }
  commit([{ op: 'upd', id: g.id, patch }], { record: false });
}

function doMarquee(e) {
  if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 3) return;
  g.moved = true;
  const x = Math.min(g.sx, e.clientX), y = Math.min(g.sy, e.clientY);
  const w = Math.abs(e.clientX - g.sx), h = Math.abs(e.clientY - g.sy);
  Object.assign(marqueeEl.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  marqueeEl.hidden = false;
  const a = view.toWorld(x, y);
  const r = { x: a.x, y: a.y, w: w / view.view.s, h: h / view.view.s };
  const ids = new Set(g.base);
  for (const it of state.items.values()) {
    const b = itemBox(it);
    if (isContainer(it) ? contains(r, b) : intersects(r, b)) ids.add(it.id);
  }
  setSelection(ids);
}

/* ---------------- criação ---------------- */

function placeAt(tool, wp) {
  const item = tool === 'sticky' ? newSticky(wp.x, wp.y) : newText(wp.x, wp.y - 20);
  commit([{ op: 'add', item }]);
  setSelection([item.id]);
  setTool('select');
  flush();
  startEditing(item.id, { isNew: true });
}

function createRect({ tool, start, box }) {
  const s = view.view.s;
  let b = box;
  if (!b || b.w * s < 10 || b.h * s < 10) {
    const [w, h] = tool === 'shape' ? [200, 140] : [800, 560];
    b = { x: start.x - w / 2, y: start.y - h / 2, w, h };
  }
  const item = tool === 'shape' ? newShape(b) : newFrame(b);
  commit([{ op: 'add', item }]);
  setSelection([item.id]);
  setTool('select');
  if (tool === 'frame') {
    flush();
    startEditing(item.id, { isNew: true, selectAll: true });
  }
}

export function addNeighbor(dir) {
  const it = selectedItems()[0];
  if (!it || it.type !== 'sticky') return;
  const gap = 24;
  const dx = dir === 'e' ? it.w + gap : dir === 'w' ? -(it.w + gap) : 0;
  const dy = dir === 's' ? it.h + gap : dir === 'n' ? -(it.h + gap) : 0;
  let x = it.x + dx;
  let y = it.y + dy;
  // Pula posições já ocupadas por outros itens (exceto frames/estruturas, que são fundo).
  const occupied = (bx, by) => {
    const box = { x: bx + 1, y: by + 1, w: it.w - 2, h: it.h - 2 };
    for (const o of state.items.values()) if (!isContainer(o) && intersects(box, itemBox(o))) return true;
    return false;
  };
  for (let i = 0; i < 50 && occupied(x, y); i++) {
    x += dx;
    y += dy;
  }
  const s = newSticky(0, 0, { color: it.color });
  Object.assign(s, { x, y, w: it.w, h: it.h });
  commit([{ op: 'add', item: s }]);
  setSelection([s.id]);
  flush();
  startEditing(s.id, { isNew: true });
}

const round2 = (n) => Math.round(n * 100) / 100;

function penStyle() {
  const o = state.toolOpts;
  return o.penKind === 'highlighter'
    ? { stroke: o.hlColor, width: 18, opacity: 0.45 }
    : { stroke: o.penColor, width: o.penWidth, opacity: 1 };
}

function finishStroke(raw) {
  const st = penStyle();
  let pts = simplify(raw, 0.6 / view.view.s);
  if (pts.length === 2) pts = [pts[0], pts[1], pts[0] + 0.1, pts[1] + 0.1];
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x1 = Math.min(x1, pts[i]);
    x2 = Math.max(x2, pts[i]);
    y1 = Math.min(y1, pts[i + 1]);
    y2 = Math.max(y2, pts[i + 1]);
  }
  const pad = st.width / 2 + 2;
  const x = Math.floor(x1 - pad), y = Math.floor(y1 - pad);
  const w = Math.ceil(x2 - x1 + pad * 2) + 1, h = Math.ceil(y2 - y1 + pad * 2) + 1;
  const points = pts.map((v, i) => round2(i % 2 ? v - y : v - x));
  const item = {
    id: uid(), type: 'path', x, y, w, h, vw: w, vh: h, z: topZ() + 1, points, ...st,
    createdBy: state.me.id, author: state.me.name,
  };
  commit([{ op: 'add', item }]);
}

function finishArrow(a, b) {
  if (Math.hypot(b.x - a.x, b.y - a.y) * view.view.s < 8) return;
  const width = Math.max(2, state.toolOpts.penWidth);
  const pad = width * 4.5 + 6;
  const x = Math.floor(Math.min(a.x, b.x) - pad), y = Math.floor(Math.min(a.y, b.y) - pad);
  const w = Math.ceil(Math.abs(b.x - a.x) + pad * 2), h = Math.ceil(Math.abs(b.y - a.y) + pad * 2);
  const item = {
    id: uid(), type: 'path', x, y, w, h, vw: w, vh: h, z: topZ() + 1, arrow: true,
    points: [round2(a.x - x), round2(a.y - y), round2(b.x - x), round2(b.y - y)],
    stroke: state.toolOpts.penColor, width, opacity: 1, createdBy: state.me.id, author: state.me.name,
  };
  commit([{ op: 'add', item }]);
  setSelection([item.id]);
  setTool('select');
}

function eraseAt(cx, cy) {
  for (const el of document.elementsFromPoint(cx, cy)) {
    const node = el.closest ? el.closest('.item.t-path') : null;
    if (!node) continue;
    const it = state.items.get(node.dataset.id);
    if (!it || it.locked) continue;
    g.removed.push(JSON.parse(JSON.stringify(it)));
    commit([{ op: 'del', id: it.id }], { record: false });
  }
}

/* ---------------- rascunhos ---------------- */

function draftRect() {
  const el = document.createElement('div');
  el.className = 'draft-rect';
  el.style.display = 'none';
  draftLayer.appendChild(el);
  return el;
}

function draftPath() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'draft-svg');
  svg.setAttribute('width', '1');
  svg.setAttribute('height', '1');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  draftLayer.appendChild(svg);
  return svg;
}

function updateDraftStroke() {
  const st = penStyle();
  const path = g.el.firstChild;
  path.setAttribute('d', pathD(g.pts));
  path.setAttribute('stroke', st.stroke);
  path.setAttribute('stroke-width', st.width);
  path.setAttribute('opacity', st.opacity);
}

function updateDraftArrow() {
  const path = g.el.firstChild;
  path.setAttribute('d', `M${g.start.x} ${g.start.y}L${g.end.x} ${g.end.y}`);
  path.setAttribute('stroke', state.toolOpts.penColor);
  path.setAttribute('stroke-width', Math.max(2, state.toolOpts.penWidth));
}

function cleanupDraft() {
  if (g && g.el) g.el.remove();
}

function showGhost(wp) {
  if (!ghost) {
    ghost = document.createElement('div');
    ghost.className = 'ghost-sticky';
    draftLayer.appendChild(ghost);
  }
  ghost.style.background = state.toolOpts.stickyColor;
  ghost.style.transform = `translate(${wp.x - 100}px, ${wp.y - 100}px)`;
}

function removeGhost() {
  if (ghost) {
    ghost.remove();
    ghost = null;
  }
}

/* ------------------------------------------------------------------ */
/* Roda do mouse / trackpad                                            */
/* ------------------------------------------------------------------ */

function onWheel(e) {
  if (e.target.closest('[contenteditable="true"]')) return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const dy = clamp(e.deltaY * (e.deltaMode === 1 ? 16 : 1), -60, 60);
    view.zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.012));
    return;
  }
  const mouseWheel = e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 40 && Math.abs(e.deltaX) < 1 && !e.shiftKey);
  if (mouseWheel && !e.shiftKey) {
    view.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    return;
  }
  const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
  const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
  view.panBy(-dx, -dy);
}

/* ------------------------------------------------------------------ */
/* Duplo clique                                                        */
/* ------------------------------------------------------------------ */

function onDblClick(e) {
  if (!canEdit() || e.target.closest('[contenteditable="true"]')) return;
  const title = e.target.closest('.frame-title');
  if (title) {
    const id = title.closest('.item').dataset.id;
    const it = state.items.get(id);
    if (it && !it.locked) startEditing(id, { selectAll: true });
    return;
  }
  const id = hitItemId(e.target);
  if (id) {
    const it = state.items.get(id);
    if (it && !it.locked && ['sticky', 'text', 'shape'].includes(it.type)) {
      setSelection([id]);
      startEditing(id);
    }
    return;
  }
  if (state.tool !== 'select') return;
  const wp = view.toWorld(e.clientX, e.clientY);
  const s = newSticky(wp.x, wp.y);
  commit([{ op: 'add', item: s }]);
  setSelection([s.id]);
  flush();
  startEditing(s.id, { isNew: true });
}

/* ------------------------------------------------------------------ */
/* Teclado                                                             */
/* ------------------------------------------------------------------ */

export function deleteSelection() {
  const ops = selectedItems()
    .filter((it) => !it.locked)
    .map((it) => ({ op: 'del', id: it.id }));
  if (ops.length) commit(ops);
}

export function fitAll() {
  const items = [...state.items.values()];
  if (!items.length) return view.animateTo({ x: view.size().w / 2, y: view.size().h / 2, s: 1 });
  view.fitBox(unionBox(items), { maxScale: 1 });
}

export function fitSelection() {
  const sel = selectedItems();
  if (sel.length) view.fitBox(unionBox(sel), { maxScale: 2 });
}

const TOOL_KEYS = { v: 'select', h: 'hand', n: 'sticky', t: 'text', s: 'shape', f: 'frame', p: 'pen', l: 'arrow', e: 'eraser' };

function onKeyDown(e) {
  if (isModalOpen() || isEditing() || isTypingTarget(e.target)) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (e.code === 'Space') {
    e.preventDefault();
    if (!spaceDown) {
      spaceDown = true;
      vp.classList.add('panning-ready');
    }
    return;
  }
  if (mod) {
    if (k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (k === 'y') {
      e.preventDefault();
      redo();
    } else if (k === 'd') {
      e.preventDefault();
      duplicateSelection();
    } else if (k === 'a') {
      e.preventDefault();
      setSelection(state.items.keys());
    } else if (k === '=' || k === '+') {
      e.preventDefault();
      view.zoomBy(1.2);
    } else if (k === '-') {
      e.preventDefault();
      view.zoomBy(1 / 1.2);
    } else if (k === '0') {
      e.preventDefault();
      view.zoomTo(1);
    }
    return;
  }
  if (e.altKey) return;
  if (k === 'delete' || k === 'backspace') {
    e.preventDefault();
    deleteSelection();
    return;
  }
  if (k === 'escape') {
    setSelection([]);
    setTool('select');
    return;
  }
  if (k === 'enter') {
    const sel = selectedItems();
    if (sel.length === 1) {
      e.preventDefault();
      startEditing(sel[0].id);
    }
    return;
  }
  if (k.startsWith('arrow') && state.selection.size && canEdit()) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    const dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0;
    const dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0;
    commit(selectedItems().filter((it) => !it.locked).map((it) => ({ op: 'upd', id: it.id, patch: { x: it.x + dx, y: it.y + dy } })));
    return;
  }
  if (e.shiftKey && e.code === 'Digit1') return fitAll();
  if (e.shiftKey && e.code === 'Digit2') return fitSelection();
  const tool = TOOL_KEYS[k];
  if (tool && !e.shiftKey) {
    if (tool !== 'select' && tool !== 'hand' && !canEdit()) return;
    setTool(tool);
  }
}
