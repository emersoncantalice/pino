/** Exportação do quadro: SVG vetorial, PNG em alta resolução e backup JSON. */
import { state } from './state.js';
import { itemBox, unionBox } from './items.js';
import { stickyLayout, textLayout, shapeLayout, frameTitleSize, FONT_STACK, LINE } from '../textfit.js';
import { shapeMarkup, pathD, arrowParts } from './geometry.js';
import { esc, download, slug, readAsDataURL, toast, loadImage } from '../util.js';

const r1 = (n) => Math.round(n * 10) / 10;

async function assetDataURL(assetId, cache) {
  if (cache.has(assetId)) return cache.get(assetId);
  let url = '';
  try {
    const res = await fetch(`/api/assets/${assetId}`, { credentials: 'same-origin' });
    if (res.ok) url = await readAsDataURL(await res.blob());
  } catch {
    url = '';
  }
  cache.set(assetId, url);
  return url;
}

function textLines(lines, { x, top, size, weight = 400, color = '#1F2328', anchor = 'start' }) {
  const lh = size * LINE;
  const spans = lines
    .map((l, i) => `<tspan x="${r1(x)}" y="${r1(top + lh * i + lh / 2)}">${esc(l) || ' '}</tspan>`)
    .join('');
  return `<text font-size="${size}" font-weight="${weight}" fill="${esc(color)}" text-anchor="${anchor}" dominant-baseline="central" xml:space="preserve">${spans}</text>`;
}

async function itemSVG(it, cache) {
  const b = itemBox(it);
  switch (it.type) {
    case 'sticky': {
      const L = stickyLayout(it);
      const total = L.lines.length * L.size * LINE;
      return `<g><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3" fill="${esc(it.color || '#FFF27A')}" filter="url(#shadow)"/>${
        it.text ? textLines(L.lines, { x: b.x + b.w / 2, top: b.y + b.h / 2 - total / 2, size: L.size, anchor: 'middle' }) : ''
      }</g>`;
    }
    case 'text': {
      if (!it.text) return '';
      const L = textLayout(it);
      const align = it.align || 'left';
      const x = align === 'center' ? b.x + b.w / 2 : align === 'right' ? b.x + b.w - L.pad : b.x + L.pad;
      return textLines(L.lines, { x, top: b.y + L.pad, size: L.size, weight: L.weight, color: it.color, anchor: align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start' });
    }
    case 'shape': {
      const L = shapeLayout(it);
      const total = L.lines.length * L.size * LINE;
      const geo = shapeMarkup(it.shape || 'rect', b.w, b.h, esc(it.fill || '#E3F0FF'), esc(it.stroke || '#3E63DD'));
      const txt = it.text
        ? textLines(L.lines, { x: b.x + L.box.x + L.box.w / 2, top: b.y + L.box.y + L.box.h / 2 - total / 2, size: L.size, color: it.textColor, anchor: 'middle' })
        : '';
      return `<g><g transform="translate(${b.x} ${b.y})">${geo}</g>${txt}</g>`;
    }
    case 'frame': {
      const size = frameTitleSize(it);
      const fill = it.fill === 'transparent' ? 'none' : esc(it.fill || '#FFFFFF');
      return `<g><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="${fill}" stroke="#D0D5DD" stroke-width="1.5"/>${textLines(
        [it.title || 'Área'],
        { x: b.x + size * 0.9, top: b.y + size * 0.6, size, weight: 650, color: '#344054' },
      )}</g>`;
    }
    case 'image': {
      const href = it.assetId ? await assetDataURL(it.assetId, cache) : '';
      if (!href) return `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#EEF0F3"/>`;
      return `<image href="${href}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" preserveAspectRatio="none"/>`;
    }
    case 'path': {
      const pts = it.points || [];
      const sx = b.w / (it.vw || b.w);
      const sy = b.h / (it.vh || b.h);
      const w = it.width || 4;
      const color = esc(it.stroke || '#1F2328');
      const op = it.opacity || 1;
      if (it.arrow && pts.length >= 4) {
        const p = arrowParts(pts, sx, sy, w);
        return `<g transform="translate(${b.x} ${b.y})" opacity="${op}"><path d="${p.line}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/><path d="${p.head}" fill="${color}" stroke="${color}" stroke-width="${Math.max(1, w / 2)}" stroke-linejoin="round"/></g>`;
      }
      return `<path transform="translate(${b.x} ${b.y})" d="${pathD(pts, sx, sy)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"/>`;
    }
    default:
      return '';
  }
}

export async function buildSVG(items, { pad = 48, background = '#FFFFFF' } = {}) {
  const list = [...items].sort((a, b) => (a.z || 0) - (b.z || 0));
  const box = unionBox(list);
  const x = Math.floor(box.x - pad);
  const y = Math.floor(box.y - pad);
  const w = Math.ceil(box.w + pad * 2);
  const h = Math.ceil(box.h + pad * 2);
  const cache = new Map();
  const parts = [];
  for (const it of list) parts.push(await itemSVG(it, cache));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" font-family='${FONT_STACK}'>
<defs><filter id="shadow" x="-10%" y="-10%" width="130%" height="140%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000" flood-opacity="0.16"/></filter></defs>
${background ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${background}"/>` : ''}
${parts.join('\n')}
</svg>`;
  return { svg, width: w, height: h };
}

function targetItems(scope) {
  const all = [...state.items.values()];
  if (scope === 'selection') return all.filter((it) => state.selection.has(it.id));
  return all;
}

function filename(ext, scope) {
  const base = slug(state.board ? state.board.name : 'quadro');
  return `${base}${scope === 'selection' ? '-selecao' : ''}.${ext}`;
}

export async function exportSVG(scope = 'all') {
  const items = targetItems(scope);
  if (!items.length) return toast('Não há nada para exportar.', { type: 'error' });
  const hide = toast('Gerando SVG…', { timeout: 0 });
  try {
    const { svg } = await buildSVG(items);
    download(new Blob([svg], { type: 'image/svg+xml' }), filename('svg', scope));
  } finally {
    hide();
  }
}

export async function exportPNG(scope = 'all', scale = 2) {
  const items = targetItems(scope);
  if (!items.length) return toast('Não há nada para exportar.', { type: 'error' });
  const hide = toast('Gerando imagem…', { timeout: 0 });
  try {
    const { svg, width, height } = await buildSVG(items);
    const s = Math.max(0.1, Math.min(scale, 14000 / Math.max(width, height), Math.sqrt(100e6 / (width * height))));
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    let img;
    try {
      img = await loadImage(url);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * s);
    canvas.height = Math.round(height * s);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('O navegador não conseguiu gerar o PNG.');
    download(blob, filename('png', scope));
  } catch (err) {
    toast(err.message || 'Falha ao exportar PNG.', { type: 'error' });
  } finally {
    hide();
  }
}

export async function exportJSON() {
  const hide = toast('Gerando backup…', { timeout: 0 });
  try {
    const items = [...state.items.values()];
    const cache = new Map();
    const assets = {};
    for (const it of items) {
      if (it.type === 'image' && it.assetId && !(it.assetId in assets)) {
        const data = await assetDataURL(it.assetId, cache);
        if (data) assets[it.assetId] = data;
      }
    }
    const data = { app: 'pino', version: 1, name: state.board ? state.board.name : 'Quadro', exportedAt: new Date().toISOString(), items, assets };
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), filename('pino.json', 'all'));
  } finally {
    hide();
  }
}
