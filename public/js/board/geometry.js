/** Geometria compartilhada entre a tela e a exportação. */

const f1 = (n) => Math.round(n * 10) / 10;

/** Caminho suave (curvas quadráticas pelos pontos médios). pts = [x0, y0, x1, y1, ...] */
export function pathD(pts, sx = 1, sy = 1) {
  const n = pts.length / 2;
  const X = (i) => f1(pts[2 * i] * sx);
  const Y = (i) => f1(pts[2 * i + 1] * sy);
  if (n < 1) return '';
  if (n === 1) return `M${X(0)} ${Y(0)}l0.01 0`;
  if (n === 2) return `M${X(0)} ${Y(0)}L${X(1)} ${Y(1)}`;
  let d = `M${X(0)} ${Y(0)}`;
  for (let i = 1; i < n - 1; i++) {
    d += `Q${X(i)} ${Y(i)} ${f1((X(i) + X(i + 1)) / 2)} ${f1((Y(i) + Y(i + 1)) / 2)}`;
  }
  return `${d}L${X(n - 1)} ${Y(n - 1)}`;
}

/** Linha da seta (encurtada) + triângulo da ponta. */
export function arrowParts(pts, sx, sy, width) {
  const x1 = pts[0] * sx, y1 = pts[1] * sy, x2 = pts[2] * sx, y2 = pts[3] * sy;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.max(12, width * 4.2);
  const spread = 0.42;
  const lx = x2 - Math.cos(ang) * len * 0.75;
  const ly = y2 - Math.sin(ang) * len * 0.75;
  const ax = x2 - Math.cos(ang - spread) * len, ay = y2 - Math.sin(ang - spread) * len;
  const bx = x2 - Math.cos(ang + spread) * len, by = y2 - Math.sin(ang + spread) * len;
  return {
    line: `M${f1(x1)} ${f1(y1)}L${f1(lx)} ${f1(ly)}`,
    head: `M${f1(x2)} ${f1(y2)}L${f1(ax)} ${f1(ay)}L${f1(bx)} ${f1(by)}Z`,
  };
}

/** Marcação SVG da forma (sem o texto), em coordenadas locais 0..w, 0..h. */
export function shapeMarkup(kind, w, h, fill, stroke, sw = 2) {
  const i = sw / 2;
  const attrs = `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"`;
  switch (kind) {
    case 'ellipse':
      return `<ellipse cx="${f1(w / 2)}" cy="${f1(h / 2)}" rx="${f1(Math.max(1, w / 2 - i))}" ry="${f1(Math.max(1, h / 2 - i))}" ${attrs}/>`;
    case 'diamond':
      return `<polygon points="${f1(w / 2)},${i} ${f1(w - i)},${f1(h / 2)} ${f1(w / 2)},${f1(h - i)} ${i},${f1(h / 2)}" ${attrs}/>`;
    case 'triangle':
      return `<polygon points="${f1(w / 2)},${i} ${f1(w - i)},${f1(h - i)} ${i},${f1(h - i)}" ${attrs}/>`;
    case 'round':
      return `<rect x="${i}" y="${i}" width="${f1(Math.max(1, w - sw))}" height="${f1(Math.max(1, h - sw))}" rx="${f1(Math.min(w, h) * 0.18)}" ${attrs}/>`;
    default:
      return `<rect x="${i}" y="${i}" width="${f1(Math.max(1, w - sw))}" height="${f1(Math.max(1, h - sw))}" rx="3" ${attrs}/>`;
  }
}

/** Simplificação de traço (Ramer–Douglas–Peucker). */
export function simplify(pts, epsilon) {
  const n = pts.length / 2;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[2 * a], ay = pts[2 * a + 1], bx = pts[2 * b], by = pts[2 * b + 1];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[2 * i] - dx * pts[2 * i + 1] + bx * ay - by * ax) / len;
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > epsilon && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

export function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}
