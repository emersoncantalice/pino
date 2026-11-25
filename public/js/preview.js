import { esc } from './util.js';

/** Miniatura SVG de um conjunto de itens (usada no painel e na galeria de estruturas). */
export function previewSVG(items, { width = 240, height = 150, pad = 10, bg = '#F7F8FA' } = {}) {
  const list = (items || []).filter((it) => it && it.type !== 'path');
  let body = '';
  if (list.length) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const it of list) {
      x1 = Math.min(x1, it.x);
      y1 = Math.min(y1, it.y);
      x2 = Math.max(x2, it.x + it.w);
      y2 = Math.max(y2, it.y + it.h);
    }
    const bw = Math.max(1, x2 - x1), bh = Math.max(1, y2 - y1);
    const s = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh, 0.5);
    const ox = (width - bw * s) / 2 - x1 * s;
    const oy = (height - bh * s) / 2 - y1 * s;
    const sorted = [...list].sort((a, b) => (a.z || 0) - (b.z || 0));
    for (const it of sorted) {
      const x = (it.x * s + ox).toFixed(1), y = (it.y * s + oy).toFixed(1);
      const w = Math.max(1.5, it.w * s).toFixed(1), h = Math.max(1.5, it.h * s).toFixed(1);
      if (it.type === 'frame') {
        body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" fill="${esc(it.fill || '#fff')}" stroke="#D0D5DD" stroke-width="0.8"/>`;
      } else if (it.type === 'sticky') {
        body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${esc(it.color || '#FFF27A')}" stroke="rgba(0,0,0,.06)" stroke-width="0.6"/>`;
      } else if (it.type === 'shape') {
        const fill = esc(it.fill || '#E3F0FF');
        body += it.shape === 'ellipse'
          ? `<ellipse cx="${(+x + w / 2).toFixed(1)}" cy="${(+y + h / 2).toFixed(1)}" rx="${(w / 2).toFixed(1)}" ry="${(h / 2).toFixed(1)}" fill="${fill}" stroke="#8B95A1" stroke-width="0.6"/>`
          : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}" stroke="#8B95A1" stroke-width="0.6"/>`;
      } else if (it.type === 'text') {
        body += `<rect x="${x}" y="${(+y + h * 0.3).toFixed(1)}" width="${w}" height="${Math.max(1.5, h * 0.4).toFixed(1)}" rx="1" fill="#9AA3AE"/>`;
      } else if (it.type === 'image') {
        body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#DDE3EA"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><rect width="${width}" height="${height}" fill="${bg}"/>${body}</svg>`;
}
