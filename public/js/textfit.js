/**
 * Medição e quebra de texto com <canvas>. É a mesma lógica usada para desenhar
 * na tela e para exportar (SVG/PNG), garantindo o mesmo resultado nos dois.
 */
export const FONT_STACK = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Roboto, Arial, sans-serif';
export const LINE = 1.25;

let ctx = null;
let currentFont = '';
function font(size, weight) {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  const f = `${weight} ${size}px ${FONT_STACK}`;
  if (f !== currentFont) {
    ctx.font = f;
    currentFont = f;
  }
  return ctx;
}

let lastWrapBroke = false;

export function wrapLines(text, size, maxW, weight = 400) {
  const c = font(size, weight);
  const out = [];
  lastWrapBroke = false;
  for (const para of String(text ?? '').split('\n')) {
    if (!para) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(' ')) {
      const test = line === '' ? word : `${line} ${word}`;
      if (c.measureText(test).width <= maxW) {
        line = test;
        continue;
      }
      if (line !== '') out.push(line);
      line = '';
      if (c.measureText(word).width <= maxW) {
        line = word;
        continue;
      }
      // palavra maior que a largura: quebra por caracteres
      lastWrapBroke = true;
      let chunk = '';
      for (const ch of word) {
        if (chunk && c.measureText(chunk + ch).width > maxW) {
          out.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    }
    out.push(line);
  }
  return out;
}

/**
 * Maior tamanho de fonte (entre min e max) em que o texto cabe na caixa.
 * Prefere tamanhos em que nenhuma palavra precise ser partida ao meio.
 */
export function fitText(text, maxW, maxH, { max = 40, min = 6, weight = 400 } = {}) {
  max = Math.max(min, Math.floor(max));
  if (!text) return { size: max, lines: [''] };
  const search = (allowBreak) => {
    let lo = min;
    let hi = max;
    let best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const lines = wrapLines(text, mid, maxW, weight);
      if (lines.length * mid * LINE <= maxH && (allowBreak || !lastWrapBroke)) {
        best = { size: mid, lines };
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best;
  };
  return search(false) || search(true) || { size: min, lines: wrapLines(text, min, maxW, weight) };
}

const cache = new Map();
function cached(key, compute) {
  let v = cache.get(key);
  if (!v) {
    if (cache.size > 3000) cache.clear();
    v = compute();
    cache.set(key, v);
  }
  return v;
}

export function stickyLayout(it) {
  return cached(`s|${it.w}|${it.h}|${it.text || ''}`, () => {
    const pad = Math.round(Math.min(it.w, it.h) * 0.08);
    const max = Math.max(8, Math.round(Math.min(it.w, it.h) * 0.2));
    return { pad, ...fitText(it.text || '', it.w - pad * 2, it.h - pad * 2, { max }) };
  });
}

export function textLayout(it) {
  const size = it.fontSize || 24;
  const weight = it.bold ? 700 : 400;
  return cached(`t|${it.w}|${size}|${weight}|${it.text || ''}`, () => {
    const pad = Math.round(size * 0.2);
    const lines = wrapLines(it.text || '', size, Math.max(10, it.w - pad * 2), weight);
    return { size, pad, weight, lines, h: Math.ceil(lines.length * size * LINE + pad * 2) };
  });
}

/** Área útil para texto dentro de cada forma (frações da caixa). */
const SHAPE_INSET = {
  rect: [0, 0, 1, 1],
  round: [0, 0, 1, 1],
  ellipse: [0.15, 0.15, 0.7, 0.7],
  diamond: [0.25, 0.25, 0.5, 0.5],
  triangle: [0.25, 0.45, 0.5, 0.5],
};

export function shapeLayout(it) {
  const kind = it.shape || 'rect';
  return cached(`h|${kind}|${it.w}|${it.h}|${it.fontSize || 22}|${it.text || ''}`, () => {
    const [fx, fy, fw, fh] = SHAPE_INSET[kind] || SHAPE_INSET.rect;
    const pad = 10;
    const box = { x: it.w * fx + pad, y: it.h * fy + pad, w: Math.max(10, it.w * fw - pad * 2), h: Math.max(10, it.h * fh - pad * 2) };
    return { box, ...fitText(it.text || '', box.w, box.h, { max: it.fontSize || 22 }) };
  });
}

export function frameTitleSize(it) {
  return Math.max(16, Math.min(40, Math.round(Math.min(it.w, it.h) / 22)));
}
