/** Desenha os itens do quadro no DOM (agrupado por quadro de animação). */
import { state, on, emit, canEdit } from './state.js';
import { stickyLayout, textLayout, shapeLayout, frameTitleSize } from '../textfit.js';
import { itemBox, unionBox } from './items.js';
import { pathD, arrowParts, shapeMarkup } from './geometry.js';
import { esc } from '../util.js';

let itemsLayer;
let overlayLayer;
const els = new Map();
const dirty = new Set();
let raf = 0;
let overlayDirty = false;

/** sid -> { ids, color, name } — seleções de outras pessoas. */
export const remoteSel = new Map();

export function initRender(itemsEl, overlayEl) {
  itemsLayer = itemsEl;
  overlayLayer = overlayEl;
  on('item', mark);
  on('remove', mark);
  on('reset', () => {
    for (const id of els.keys()) dirty.add(id);
    for (const id of state.items.keys()) dirty.add(id);
    overlayDirty = true;
    schedule();
  });
  on('selection', markOverlay);
  on('role', markOverlay);
  on('editing', markOverlay);
}

export function mark(id) {
  dirty.add(id);
  overlayDirty = true;
  schedule();
}

export function markOverlay() {
  overlayDirty = true;
  schedule();
}

function schedule() {
  if (!raf) raf = requestAnimationFrame(flush);
}

export function flush() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  for (const id of dirty) renderItem(id);
  dirty.clear();
  if (overlayDirty) {
    overlayDirty = false;
    renderOverlay();
  }
  emit('rendered');
}

export const itemEl = (id) => els.get(id) || null;

/** ID do item sob um elemento (ignora o "corpo" de frames/estruturas, que funciona como fundo). */
export function hitItemId(target, { includeBackground = false } = {}) {
  const el = target && target.closest ? target.closest('.item') : null;
  if (!el) return null;
  const it = state.items.get(el.dataset.id);
  if (!it) return null;
  if (!includeBackground) {
    if (it.type === 'frame' && !target.closest('.frame-title')) return null;
    if (it.type === 'image' && it.structure && !target.closest('.struct-tab')) return null;
  }
  return it.id;
}

/* ------------------------------------------------------------------ */

function create(it) {
  const el = document.createElement('div');
  el.className = `item t-${it.type}`;
  el.dataset.id = it.id;
  el.dataset.type = it.type;
  switch (it.type) {
    case 'sticky':
      el.innerHTML = '<div class="inner"><div class="content"></div></div>';
      break;
    case 'text':
      el.innerHTML = '<div class="content"></div>';
      break;
    case 'shape':
      el.innerHTML = '<svg class="shape-svg"></svg><div class="inner"><div class="content"></div></div>';
      break;
    case 'frame':
      el.innerHTML = '<div class="frame-title"></div>';
      break;
    case 'image':
      el.innerHTML = '<img alt="" draggable="false"><div class="struct-tab"></div>';
      break;
    case 'path':
      el.innerHTML = '<svg class="path-svg"><path class="hit"/><path class="stroke"/><path class="head"/></svg>';
      break;
    default:
  }
  return el;
}

function renderItem(id) {
  const it = state.items.get(id);
  let el = els.get(id);
  if (!it) {
    if (el) {
      el.remove();
      els.delete(id);
    }
    return;
  }
  if (!el || el.dataset.type !== it.type) {
    if (el) el.remove();
    el = create(it);
    els.set(id, el);
    itemsLayer.appendChild(el);
  }
  const box = itemBox(it);
  el.style.transform = `translate(${it.x}px, ${it.y}px)`;
  el.style.width = `${box.w}px`;
  el.style.height = `${box.h}px`;
  el.style.zIndex = String(Math.round(it.z || 0));
  el.classList.toggle('locked', !!it.locked);
  el.classList.toggle('selected', state.selection.has(id));
  const fn = UPDATE[it.type];
  if (fn) fn(el, it, box);
}

const editing = (it) => state.editingId === it.id;

function setText(content, lines, it) {
  if (editing(it)) return;
  const txt = lines.join('\n');
  if (content.textContent !== txt) content.textContent = txt;
}

const UPDATE = {
  sticky(el, it) {
    el.style.background = it.color || '#FFF27A';
    const L = stickyLayout(it);
    const inner = el.firstChild;
    const content = inner.firstChild;
    inner.style.inset = `${L.pad}px`;
    content.style.fontSize = `${L.size}px`;
    setText(content, L.lines, it);
  },
  text(el, it) {
    const L = textLayout(it);
    const content = el.firstChild;
    content.style.fontSize = `${L.size}px`;
    content.style.fontWeight = String(L.weight);
    content.style.color = it.color || '#1F2328';
    content.style.textAlign = it.align || 'left';
    content.style.padding = `${L.pad}px`;
    setText(content, L.lines, it);
  },
  shape(el, it, box) {
    const svg = el.firstChild;
    const key = `${box.w}|${box.h}|${it.shape}|${it.fill}|${it.stroke}`;
    if (svg.dataset.key !== key) {
      svg.dataset.key = key;
      svg.setAttribute('width', box.w);
      svg.setAttribute('height', box.h);
      svg.innerHTML = shapeMarkup(it.shape || 'rect', box.w, box.h, esc(it.fill || '#E3F0FF'), esc(it.stroke || '#3E63DD'));
    }
    const L = shapeLayout(it);
    const inner = el.children[1];
    const content = inner.firstChild;
    Object.assign(inner.style, { left: `${L.box.x}px`, top: `${L.box.y}px`, width: `${L.box.w}px`, height: `${L.box.h}px` });
    content.style.fontSize = `${L.size}px`;
    content.style.color = it.textColor || '#1F2328';
    setText(content, L.lines, it);
  },
  frame(el, it) {
    el.style.background = it.fill === 'transparent' ? 'transparent' : it.fill || '#FFFFFF';
    const title = el.firstChild;
    title.style.fontSize = `${frameTitleSize(it)}px`;
    if (title.getAttribute('contenteditable') !== 'true') {
      const t = it.title || 'Área';
      if (title.textContent !== t) title.textContent = t;
    }
  },
  image(el, it) {
    const img = el.firstChild;
    const src = it.assetId ? `/api/assets/${it.assetId}` : '';
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    el.classList.toggle('structure', !!it.structure);
    el.lastChild.textContent = `▦ ${it.name || 'Estrutura'}`;
  },
  path(el, it, box) {
    const svg = el.firstChild;
    const [hit, stroke, head] = svg.children;
    const key = `${box.w}|${box.h}|${it.width}|${it.stroke}|${it.opacity}|${it.arrow}|${(it.points || []).length}|${it.vw}|${it.vh}`;
    if (svg.dataset.key === key && it.points === svg._pts) return;
    svg.dataset.key = key;
    svg._pts = it.points;
    svg.setAttribute('width', box.w);
    svg.setAttribute('height', box.h);
    const pts = it.points || [];
    const sx = box.w / (it.vw || box.w);
    const sy = box.h / (it.vh || box.h);
    const w = it.width || 4;
    const color = it.stroke || '#1F2328';
    let d;
    if (it.arrow && pts.length >= 4) {
      const p = arrowParts(pts, sx, sy, w);
      d = p.line;
      head.setAttribute('d', p.head);
      head.setAttribute('fill', color);
      head.setAttribute('stroke', color);
      head.setAttribute('stroke-width', String(Math.max(1, w / 2)));
      head.setAttribute('stroke-linejoin', 'round');
      hit.setAttribute('d', pathD([pts[0], pts[1], pts[2], pts[3]], sx, sy));
    } else {
      d = pathD(pts, sx, sy);
      head.removeAttribute('d');
      hit.setAttribute('d', d);
    }
    for (const [k, v] of [['d', d], ['fill', 'none'], ['stroke', color], ['stroke-width', String(w)], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]) {
      stroke.setAttribute(k, v);
    }
    stroke.setAttribute('opacity', String(it.opacity || 1));
    head.setAttribute('opacity', String(it.opacity || 1));
    hit.setAttribute('stroke-width', String(w + 14));
  },
};

/* ------------------------------------------------------------------ */
/* Seleção, alças e seleções remotas                                   */
/* ------------------------------------------------------------------ */

function boxDiv(cls, b) {
  const d = document.createElement('div');
  d.className = cls;
  d.style.transform = `translate(${b.x}px, ${b.y}px)`;
  d.style.width = `${b.w}px`;
  d.style.height = `${b.h}px`;
  d.style.left = '0';
  d.style.top = '0';
  return d;
}

function renderOverlay() {
  overlayLayer.textContent = '';
  for (const el of els.values()) el.classList.remove('selected');
  const sel = [...state.selection].map((id) => state.items.get(id)).filter(Boolean);
  for (const it of sel) {
    const el = els.get(it.id);
    if (el) el.classList.add('selected');
  }
  if (sel.length) {
    if (sel.length > 1) for (const it of sel) overlayLayer.appendChild(boxDiv('sel-item', itemBox(it)));
    const b = unionBox(sel);
    const box = boxDiv('sel-box', b);
    const single = sel.length === 1 ? sel[0] : null;
    if (single && canEdit() && !single.locked && !state.gesture) {
      const handles = single.type === 'text' ? ['nw', 'ne', 'sw', 'se', 'e', 'w'] : ['nw', 'ne', 'sw', 'se'];
      for (const hdl of handles) {
        const d = document.createElement('div');
        d.className = 'handle';
        d.dataset.handle = hdl;
        box.appendChild(d);
      }
      if (single.type === 'sticky' && !state.editingId) {
        for (const dir of ['n', 'e', 's', 'w']) {
          const d = document.createElement('div');
          d.className = 'add-btn';
          d.dataset.add = dir;
          d.title = 'Adicionar post-it ao lado';
          box.appendChild(d);
        }
      }
    }
    overlayLayer.appendChild(box);
  }
  for (const info of remoteSel.values()) {
    let first = true;
    for (const id of info.ids) {
      const it = state.items.get(id);
      if (!it) continue;
      const d = boxDiv('remote-sel', itemBox(it));
      d.style.setProperty('--c', info.color);
      if (first) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = info.name;
        d.appendChild(tag);
        first = false;
      }
      overlayLayer.appendChild(d);
    }
  }
}
