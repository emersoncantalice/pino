/** Criação de itens e utilidades de caixas/camadas. */
import { state } from './state.js';
import { textLayout } from '../textfit.js';
import { contains, intersects } from './geometry.js';
import { uid } from '../util.js';

export const STICKY_SIZE = 200;

export function itemBox(it) {
  if (it.type === 'text') return { x: it.x, y: it.y, w: it.w, h: textLayout(it).h };
  return { x: it.x, y: it.y, w: it.w, h: it.h };
}

export function unionBox(list) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const it of list) {
    const b = itemBox(it);
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w);
    y2 = Math.max(y2, b.y + b.h);
  }
  if (!Number.isFinite(x1)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export const isContainer = (it) => it.type === 'frame' || (it.type === 'image' && !!it.structure);

/** Itens que estão dentro de um frame/estrutura (movem junto com ele). */
export function childrenOf(container) {
  const b = itemBox(container);
  const area = b.w * b.h;
  const out = [];
  for (const it of state.items.values()) {
    if (it.id === container.id) continue;
    const ib = itemBox(it);
    if (!contains(b, ib)) continue;
    if (isContainer(it) && ib.w * ib.h >= area) continue;
    out.push(it.id);
  }
  return out;
}

/**
 * Centro onde um bloco (w × h) cabe sem cobrir o que já existe no quadro.
 * Usa o ponto preferido se estiver livre; senão, coloca à direita de todo o conteúdo.
 */
export function freeSpot(w, h, prefer) {
  const box = { x: prefer.x - w / 2, y: prefer.y - h / 2, w, h };
  const items = [...state.items.values()];
  if (!items.some((it) => intersects(box, itemBox(it)))) return prefer;
  const all = unionBox(items);
  return { x: Math.round(all.x + all.w + 240 + w / 2), y: Math.round(all.y + h / 2) };
}

export function topZ() {
  let m = 0;
  for (const it of state.items.values()) if ((it.z || 0) > m) m = it.z || 0;
  return m;
}

export function bottomZ() {
  let m = 0;
  for (const it of state.items.values()) if ((it.z || 0) < m) m = it.z || 0;
  return m;
}

const stamp = () => ({ createdBy: state.me ? state.me.id : undefined, author: state.me ? state.me.name : undefined });

export function newSticky(cx, cy, { color, text = '' } = {}) {
  return {
    id: uid(), type: 'sticky', x: Math.round(cx - STICKY_SIZE / 2), y: Math.round(cy - STICKY_SIZE / 2),
    w: STICKY_SIZE, h: STICKY_SIZE, z: topZ() + 1, color: color || state.toolOpts.stickyColor, text, ...stamp(),
  };
}

export function newText(x, y, { text = '', fontSize = 24 } = {}) {
  return { id: uid(), type: 'text', x: Math.round(x), y: Math.round(y), w: 320, h: 40, z: topZ() + 1, text, fontSize, color: '#1F2328', ...stamp() };
}

export function newShape(box, kind = state.toolOpts.shape) {
  return {
    id: uid(), type: 'shape', ...roundBox(box), z: topZ() + 1, shape: kind, fill: '#E3F0FF', stroke: '#3E63DD', text: '', fontSize: 22, ...stamp(),
  };
}

export function newFrame(box) {
  let n = 1;
  for (const it of state.items.values()) if (it.type === 'frame') n++;
  return { id: uid(), type: 'frame', ...roundBox(box), z: bottomZ() - 1, title: `Área ${n}`, fill: '#FFFFFF', ...stamp() };
}

export function roundBox(b) {
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.max(1, Math.round(b.w)), h: Math.max(1, Math.round(b.h)) };
}

/**
 * Prepara itens copiados/importados para inserir no quadro: novos IDs,
 * centralizados em (cx, cy), estruturas abaixo e o resto por cima.
 */
export function prepareInsert(items, cx, cy, { assetMap } = {}) {
  const list = items.filter((it) => it && it.type && it.id);
  if (!list.length) return [];
  const box = unionBox(list);
  const dx = Math.round(cx - (box.x + box.w / 2));
  const dy = Math.round(cy - (box.y + box.h / 2));
  const sorted = [...list].sort((a, b) => (a.z || 0) - (b.z || 0));
  const containers = sorted.filter(isContainer);
  const others = sorted.filter((it) => !isContainer(it));
  let zb = bottomZ() - containers.length - 1;
  let zt = topZ() + 1;
  const out = [];
  for (const it of containers) out.push({ ...JSON.parse(JSON.stringify(it)), z: zb++ });
  for (const it of others) out.push({ ...JSON.parse(JSON.stringify(it)), z: zt++ });
  for (const it of out) {
    it.id = uid();
    it.x += dx;
    it.y += dy;
    it.locked = undefined;
    delete it.locked;
    Object.assign(it, stamp());
    if (it.assetId && assetMap && assetMap[it.assetId]) it.assetId = assetMap[it.assetId];
  }
  return out;
}
