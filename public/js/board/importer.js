/** Importar imagens/estruturas (PNG, JPG, SVG), backups .json e conteúdo colado. */
import { state, commit, setSelection, canEdit } from './state.js';
import { api } from '../api.js';
import { uid, toast, readAsDataURL, readAsText, loadImage } from '../util.js';
import { topZ, bottomZ, prepareInsert, unionBox, childrenOf, isContainer, newSticky, freeSpot, STICKY_SIZE } from './items.js';
import * as view from './view.js';

const IMAGE_RE = /^image\/(png|jpeg|webp|gif|svg\+xml)$/;
const MAX_BYTES = 12 * 1024 * 1024;
export const CLIP_PREFIX = 'pino-clip:';

export async function uploadDataURL(dataUrl, name) {
  const res = await api('/api/assets', { method: 'POST', body: { boardId: state.boardId, name, dataUrl } });
  return res.id;
}

function svgSize(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') return null;
  const num = (v) => {
    const m = /^\s*([\d.]+)\s*(px)?\s*$/.exec(v || '');
    return m ? parseFloat(m[1]) : null;
  };
  const w = num(svg.getAttribute('width'));
  const h = num(svg.getAttribute('height'));
  if (w && h) return { w, h };
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: vb[2], h: vb[3] };
  return null;
}

export function fileKind(file) {
  if (/\.json$/i.test(file.name) || file.type === 'application/json') return 'json';
  if (IMAGE_RE.test(file.type) || /\.svg$/i.test(file.name)) return 'image';
  return null;
}

export async function importImageFile(file, { at, structure = false } = {}) {
  if (!canEdit()) return null;
  const type = file.type || (/\.svg$/i.test(file.name) ? 'image/svg+xml' : '');
  if (!IMAGE_RE.test(type)) {
    toast('Formato não suportado. Use PNG, JPG, WEBP, GIF ou SVG.', { type: 'error' });
    return null;
  }
  if (file.size > MAX_BYTES) {
    toast('Imagem muito grande (máximo 12 MB).', { type: 'error' });
    return null;
  }
  let dataUrl;
  let size = null;
  if (type === 'image/svg+xml') {
    const text = await readAsText(file);
    size = svgSize(text);
    if (!size && !/<svg[\s>]/i.test(text)) {
      toast('Este arquivo SVG parece inválido.', { type: 'error' });
      return null;
    }
    dataUrl = await readAsDataURL(new Blob([text], { type: 'image/svg+xml' }));
  } else {
    dataUrl = await readAsDataURL(file);
  }
  if (!size) {
    try {
      const img = await loadImage(dataUrl);
      size = { w: img.naturalWidth || 800, h: img.naturalHeight || 600 };
    } catch {
      toast('Não foi possível ler esta imagem.', { type: 'error' });
      return null;
    }
  }
  const max = structure ? 1800 : 900;
  const sc = Math.min(1, max / Math.max(size.w, size.h));
  const w = Math.max(20, Math.round(size.w * sc));
  const h = Math.max(20, Math.round(size.h * sc));
  // Estruturas ficam atrás de tudo: por isso vão para um espaço livre, nunca por baixo de outros itens.
  const c = structure ? freeSpot(w, h, at || view.centerWorld()) : at || view.centerWorld();
  const hide = toast(structure ? 'Importando estrutura…' : 'Enviando imagem…', { timeout: 0 });
  try {
    const assetId = await uploadDataURL(dataUrl, file.name);
    const item = {
      id: uid(), type: 'image', x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h,
      z: structure ? bottomZ() - 1 : topZ() + 1,
      assetId, name: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 80) || 'Imagem', structure,
      createdBy: state.me.id, author: state.me.name,
    };
    commit([{ op: 'add', item }]);
    setSelection([item.id]);
    if (structure) {
      view.fitBox({ x: item.x, y: item.y, w, h }, { maxScale: 1 });
      toast('Estrutura importada! Arraste post-its para cima dela.', { type: 'success' });
    }
    return item;
  } catch (err) {
    toast(err.message, { type: 'error' });
    return null;
  } finally {
    hide();
  }
}

export async function importBoardJSON(file, at) {
  if (!canEdit()) return;
  let data;
  try {
    data = JSON.parse(await readAsText(file));
  } catch {
    toast('Arquivo JSON inválido.', { type: 'error' });
    return;
  }
  if (!data || data.app !== 'pino' || !Array.isArray(data.items)) {
    toast('Este arquivo não é um backup do Pino.', { type: 'error' });
    return;
  }
  const hide = toast('Importando backup…', { timeout: 0 });
  try {
    const assetMap = {};
    for (const [oldId, dataUrl] of Object.entries(data.assets || {})) {
      try {
        assetMap[oldId] = await uploadDataURL(dataUrl, 'importada');
      } catch {
        /* imagem ignorada */
      }
    }
    const size = unionBox(data.items.filter((it) => it && it.type));
    const c = freeSpot(size.w, size.h, at || view.centerWorld());
    const items = prepareInsert(data.items, c.x, c.y, { assetMap });
    commit(items.map((item) => ({ op: 'add', item })));
    setSelection(items.map((i) => i.id));
    view.fitBox(unionBox(items), { maxScale: 1 });
    toast(`${items.length} ${items.length === 1 ? 'item importado' : 'itens importados'}.`, { type: 'success' });
  } finally {
    hide();
  }
}

export async function importFiles(files, at) {
  for (const f of files) {
    const kind = fileKind(f);
    if (kind === 'image') await importImageFile(f, { at });
    else if (kind === 'json') await importBoardJSON(f, at);
    else toast(`“${f.name}” não é um formato suportado.`, { type: 'error' });
  }
}

/* ---------------- copiar / colar / duplicar ---------------- */

/** Seleção + itens dentro de frames/estruturas selecionados. */
export function selectionWithChildren() {
  const ids = new Set(state.selection);
  for (const id of state.selection) {
    const it = state.items.get(id);
    if (it && isContainer(it)) for (const c of childrenOf(it)) ids.add(c);
  }
  return [...ids].map((id) => state.items.get(id)).filter(Boolean);
}

let memoryClip = null;

export function copySelection(e) {
  const items = selectionWithChildren();
  if (!items.length) return false;
  const clip = { boardId: state.boardId, items: JSON.parse(JSON.stringify(items)) };
  memoryClip = clip;
  if (e && e.clipboardData) {
    e.clipboardData.setData('text/plain', CLIP_PREFIX + JSON.stringify(clip));
    e.preventDefault();
  }
  return true;
}

export async function pasteItems(clip, at) {
  if (!canEdit() || !clip || !Array.isArray(clip.items) || !clip.items.length) return;
  const assetMap = {};
  if (clip.boardId !== state.boardId) {
    for (const id of new Set(clip.items.filter((i) => i.assetId).map((i) => i.assetId))) {
      try {
        const r = await api(`/api/assets/${id}/clone`, { method: 'POST', body: { boardId: state.boardId } });
        assetMap[id] = r.id;
      } catch {
        /* imagem de quadro sem acesso */
      }
    }
  }
  const c = at || view.centerWorld();
  const items = prepareInsert(clip.items, c.x, c.y, { assetMap });
  commit(items.map((item) => ({ op: 'add', item })));
  setSelection(items.map((i) => i.id));
}

export function pasteText(text, at) {
  if (!canEdit()) return;
  const c = at || view.centerWorld();
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length > 1 && lines.length <= 80) {
    const cols = Math.ceil(Math.sqrt(lines.length));
    const gap = 24;
    const cell = STICKY_SIZE + gap;
    const rows = Math.ceil(lines.length / cols);
    const x0 = c.x - (cols * cell - gap) / 2 + STICKY_SIZE / 2;
    const y0 = c.y - (rows * cell - gap) / 2 + STICKY_SIZE / 2;
    const ops = lines.map((t, i) => {
      const s = newSticky(x0 + (i % cols) * cell, y0 + Math.floor(i / cols) * cell, { text: t.slice(0, 2000) });
      s.z += i;
      return { op: 'add', item: s };
    });
    commit(ops);
    setSelection(ops.map((o) => o.item.id));
  } else {
    const s = newSticky(c.x, c.y, { text: text.trim().slice(0, 5000) });
    commit([{ op: 'add', item: s }]);
    setSelection([s.id]);
  }
}

export async function handlePaste(e, at) {
  if (!canEdit()) return;
  const dt = e.clipboardData;
  if (!dt) return;
  const files = [...dt.files].filter((f) => fileKind(f) === 'image');
  if (files.length) {
    e.preventDefault();
    for (const f of files) await importImageFile(f, { at });
    return;
  }
  const text = dt.getData('text/plain');
  if (!text) {
    if (memoryClip) await pasteItems(memoryClip, at);
    return;
  }
  e.preventDefault();
  if (text.startsWith(CLIP_PREFIX)) {
    let clip = null;
    try {
      clip = JSON.parse(text.slice(CLIP_PREFIX.length));
    } catch {
      /* conteúdo inválido */
    }
    if (clip) await pasteItems(clip, at);
    return;
  }
  pasteText(text, at);
}

export function duplicateSelection() {
  const items = selectionWithChildren();
  if (!items.length || !canEdit()) return;
  const b = unionBox(items);
  const copies = prepareInsert(items, b.x + b.w / 2 + 40, b.y + b.h / 2 + 40);
  commit(copies.map((item) => ({ op: 'add', item })));
  setSelection(copies.map((i) => i.id));
}
