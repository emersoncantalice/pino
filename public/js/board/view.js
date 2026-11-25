/** Câmera do quadro: deslocamento (x, y) e zoom (s). */
import { emit } from './state.js';
import { clamp } from '../util.js';

export const view = { x: 0, y: 0, s: 1 };
export const MIN_ZOOM = 0.04;
export const MAX_ZOOM = 4;

let vp;
let world;
let anim = 0;

export function initView(viewportEl, worldEl) {
  vp = viewportEl;
  world = worldEl;
  window.addEventListener('resize', () => emit('view'));
  apply();
}

export function apply() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
  world.style.setProperty('--inv', String(1 / view.s));
  let g = 24 * view.s;
  while (g < 14) g *= 4;
  vp.style.backgroundSize = `${g}px ${g}px`;
  vp.style.backgroundPosition = `${view.x}px ${view.y}px`;
  emit('view');
}

export function setView(v) {
  cancelAnimationFrame(anim);
  view.x = v.x;
  view.y = v.y;
  view.s = clamp(v.s, MIN_ZOOM, MAX_ZOOM);
  apply();
}

export const size = () => ({ w: vp.clientWidth, h: vp.clientHeight });

export function toWorld(clientX, clientY) {
  return { x: (clientX - view.x) / view.s, y: (clientY - view.y) / view.s };
}

export function toScreen(wx, wy) {
  return { x: wx * view.s + view.x, y: wy * view.s + view.y };
}

export function zoomAt(clientX, clientY, factor) {
  cancelAnimationFrame(anim);
  const s2 = clamp(view.s * factor, MIN_ZOOM, MAX_ZOOM);
  view.x = clientX - (clientX - view.x) * (s2 / view.s);
  view.y = clientY - (clientY - view.y) * (s2 / view.s);
  view.s = s2;
  apply();
}

export function zoomBy(factor) {
  const { w, h } = size();
  zoomAt(w / 2, h / 2, factor);
}

export function zoomTo(s, animate = true) {
  const { w, h } = size();
  const c = toWorld(w / 2, h / 2);
  const s2 = clamp(s, MIN_ZOOM, MAX_ZOOM);
  const target = { s: s2, x: w / 2 - c.x * s2, y: h / 2 - c.y * s2 };
  if (animate) animateTo(target);
  else setView(target);
}

export function panBy(dx, dy) {
  cancelAnimationFrame(anim);
  view.x += dx;
  view.y += dy;
  apply();
}

export function centerWorld() {
  const { w, h } = size();
  return toWorld(w / 2, h / 2);
}

export function visibleWorld() {
  const { w, h } = size();
  const a = toWorld(0, 0);
  const b = toWorld(w, h);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

export function animateTo(target, ms = 340) {
  cancelAnimationFrame(anim);
  const from = { ...view };
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - t, 3);
    view.s = from.s + (target.s - from.s) * e;
    view.x = from.x + (target.x - from.x) * e;
    view.y = from.y + (target.y - from.y) * e;
    apply();
    if (t < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}

export function fitBox(box, { pad = 80, maxScale = 1, animate = true } = {}) {
  const { w, h } = size();
  const s = clamp(Math.min((w - pad * 2) / Math.max(1, box.w), (h - pad * 2 - 40) / Math.max(1, box.h)), MIN_ZOOM, maxScale);
  const target = { s, x: w / 2 - (box.x + box.w / 2) * s, y: h / 2 + 20 - (box.y + box.h / 2) * s };
  if (animate) animateTo(target);
  else setView(target);
}

export function centerOn(wx, wy, s = view.s) {
  const { w, h } = size();
  animateTo({ s, x: w / 2 - wx * s, y: h / 2 - wy * s });
}
