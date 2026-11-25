/**
 * Agente "Foto → Post-its": a pessoa envia/tira uma foto, o servidor pede ao Google Gemini
 * para transcrever as notas e aqui elas viram post-its no quadro (com revisão antes).
 */
import { state, commit, setSelection } from './state.js';
import * as view from './view.js';
import { api } from '../api.js';
import { prepareInsert, unionBox, freeSpot, STICKY_SIZE } from './items.js';
import { STICKY_COLORS, stickyHex } from '../palette.js';
import { h, uid, clamp, toast, loadImage } from '../util.js';
import { icon } from '../icons.js';
import { openModal } from '../modal.js';

const MAX_SIDE = 2000;

async function prepareImage(file) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Escolha um arquivo de imagem (JPG ou PNG).');
  let src;
  let url = null;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    url = URL.createObjectURL(file);
    try {
      src = await loadImage(url);
    } catch {
      throw new Error('Não foi possível abrir esta imagem. Use uma foto JPG ou PNG.');
    }
  }
  const w0 = src.width || src.naturalWidth;
  const h0 = src.height || src.naturalHeight;
  if (!w0 || !h0) throw new Error('Imagem inválida.');
  const sc = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const w = Math.round(w0 * sc);
  const hgt = Math.round(h0 * sc);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, hgt);
  ctx.drawImage(src, 0, 0, w, hgt);
  if (url) URL.revokeObjectURL(url);
  let q = 0.88;
  let dataUrl = canvas.toDataURL('image/jpeg', q);
  while (dataUrl.length > 6.6e6 && q > 0.45) {
    q -= 0.12;
    dataUrl = canvas.toDataURL('image/jpeg', q);
  }
  return { dataUrl, width: w, height: hgt };
}

/* ---------------- disposição dos post-its ---------------- */
const GAP = 24;
const CELL = STICKY_SIZE + GAP;

function layoutGrid(n) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.5)));
  return Array.from({ length: n }, (_, i) => ({ x: (i % cols) * CELL, y: Math.floor(i / cols) * CELL }));
}

/** Mantém a posição relativa da foto, encaixando cada nota na célula livre mais próxima. */
function layoutPhoto(notes, aspect) {
  const n = notes.length;
  const cols = Math.max(1, Math.round(Math.sqrt(n * aspect) * 1.35));
  const rows = Math.max(1, Math.round(cols / aspect));
  const taken = new Set();
  const pos = new Array(n);
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].y - notes[b].y || notes[a].x - notes[b].x);
  for (const i of order) {
    const tx = clamp(Math.floor(notes[i].x * cols), 0, cols - 1);
    const ty = clamp(Math.floor(notes[i].y * rows), 0, rows - 1);
    let best = null;
    for (let r = 0; r < 80 && !best; r++) {
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = tx + dx;
          const cy = ty + dy;
          if (cx < 0 || cy < 0 || taken.has(`${cx},${cy}`)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = [cx, cy];
          }
        }
      }
    }
    taken.add(`${best[0]},${best[1]}`);
    pos[i] = { x: best[0] * CELL, y: best[1] * CELL };
  }
  const minX = Math.min(...pos.map((p) => p.x));
  const minY = Math.min(...pos.map((p) => p.y));
  return pos.map((p) => ({ x: p.x - minX, y: p.y - minY }));
}

function insertNotes(notes, { title, layout, framed, aspect }) {
  const pos = layout === 'photo' ? layoutPhoto(notes, aspect) : layoutGrid(notes.length);
  const stamp = { createdBy: state.me.id, author: state.me.name };
  const items = notes.map((n, i) => ({
    id: uid(), type: 'sticky', x: pos[i].x, y: pos[i].y, w: STICKY_SIZE, h: STICKY_SIZE, z: i + 1,
    color: stickyHex(n.color), text: n.text, ...stamp,
  }));
  if (framed) {
    const b = unionBox(items);
    const pad = 60;
    const titleSpace = 100;
    items.unshift({
      id: uid(), type: 'frame', x: b.x - pad, y: b.y - pad - titleSpace, w: b.w + pad * 2, h: b.h + pad * 2 + titleSpace,
      z: 0, title: title || 'Post-its da foto', fill: '#FFFFFF', ...stamp,
    });
  }
  const size = unionBox(items);
  const c = freeSpot(size.w, size.h, view.centerWorld());
  const placed = prepareInsert(items, c.x, c.y);
  commit(placed.map((item) => ({ op: 'add', item })));
  setSelection(placed.filter((it) => it.type === 'sticky').map((it) => it.id));
  view.fitBox(unionBox(placed), { maxScale: 1 });
  toast(`${notes.length} ${notes.length === 1 ? 'post-it criado' : 'post-its criados'} a partir da foto!`, { type: 'success' });
}

/* ---------------- modal ---------------- */

export function openAI() {
  const body = h('div');
  const modal = openModal({ title: 'Foto → Post-its', body, width: 640 });
  let photo = null;
  let hint = '';
  let busy = false;

  const pickFile = (capture) => {
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true });
    if (capture) input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.remove();
      if (f) load(f);
    });
    document.body.appendChild(input);
    input.click();
  };

  async function load(file) {
    try {
      photo = await prepareImage(file);
      stepReview();
    } catch (err) {
      stepChoose(err.message);
    }
  }

  function notConfigured() {
    return state.ai && state.ai.enabled
      ? null
      : h('div', { class: 'callout', html: 'A IA ainda não está configurada neste servidor: defina <b>GEMINI_API_KEY</b> no arquivo <code>.env</code> na raiz do Pino e reinicie. Você ainda pode escolher a foto, mas a leitura vai falhar.' });
  }

  function stepChoose(error) {
    body.textContent = '';
    const dz = h('div', { class: 'dropzone' },
      h('span', { html: icon('camera', 30) }),
      h('b', { text: 'Arraste uma foto aqui' }),
      h('span', { class: 'hint', text: 'Post-its na parede, quadro branco, flipchart ou anotações à mão. A IA lê o texto, identifica a cor de cada nota e cria os post-its digitais.' }),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', type: 'button', html: `${icon('image', 16)} Escolher foto`, onclick: () => pickFile(false) }),
        h('button', { class: 'btn', type: 'button', html: `${icon('camera', 16)} Tirar foto`, onclick: () => pickFile(true) })));
    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.add('over');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove('over');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) load(f);
    });
    body.append(...[notConfigured(), dz, error ? h('p', { class: 'form-error', text: error }) : null].filter(Boolean));
  }

  function stepReview(error) {
    body.textContent = '';
    const hintInput = h('textarea', { class: 'textarea', rows: 2, maxlength: 1000, placeholder: 'Instruções opcionais. Ex.: “ignore as notas riscadas” ou “as notas estão em inglês, traduza para português”.' });
    hintInput.value = hint;
    hintInput.addEventListener('input', () => (hint = hintInput.value));
    body.append(...[
      notConfigured(),
      h('div', { class: 'ai-preview' }, h('img', { src: photo.dataUrl, alt: 'Foto escolhida' })),
      h('div', { class: 'field' }, h('label', { text: 'Instruções para a IA (opcional)' }), hintInput),
      error ? h('p', { class: 'form-error', text: error }) : null,
      h('div', { class: 'modal-foot', style: { padding: '12px 0 0', margin: '0' } },
        h('button', { class: 'btn', type: 'button', text: 'Trocar foto', onclick: () => stepChoose() }),
        h('button', { class: 'btn primary', type: 'button', html: `${icon('sparkles', 16)} Gerar post-its`, onclick: run })),
    ].filter(Boolean));
  }

  async function run() {
    if (busy) return;
    busy = true;
    body.textContent = '';
    const msg = h('span', { text: 'Lendo a foto… isso costuma levar de 10 a 40 segundos.' });
    body.append(h('div', { class: 'ai-loading' }, h('div', { class: 'spinner' }), msg));
    const slow = setTimeout(() => (msg.textContent = 'Ainda lendo… fotos com muitas notas demoram um pouco mais.'), 30000);
    try {
      const res = await api('/api/ai/photo', { method: 'POST', body: { boardId: state.boardId, image: photo.dataUrl, hint: hint.trim() } });
      if (!res.notes.length) stepReview('Não encontrei texto legível nesta foto. Tente uma foto mais nítida, de frente e com boa luz.');
      else stepResult(res);
    } catch (err) {
      stepReview(err.message);
    } finally {
      clearTimeout(slow);
      busy = false;
    }
  }

  function stepResult(res) {
    body.textContent = '';
    const notes = res.notes.map((n) => ({ ...n, on: true }));
    let layout = 'photo';
    let framed = true;
    const titleInput = h('input', { class: 'input', value: res.title || 'Post-its da foto', maxlength: '120' });
    const addBtn = h('button', { class: 'btn primary', type: 'button' });
    const refresh = () => {
      const n = notes.filter((x) => x.on && x.text.trim()).length;
      addBtn.textContent = `Adicionar ${n} ${n === 1 ? 'post-it' : 'post-its'}`;
      addBtn.disabled = n === 0;
    };
    const list = h('div', { class: 'note-list' }, notes.map((n) => {
      const ta = h('textarea', { class: 'textarea', rows: 1 });
      ta.value = n.text;
      ta.addEventListener('input', () => {
        n.text = ta.value;
        refresh();
      });
      const sw = h('button', { class: 'swatch square', type: 'button', title: 'Trocar cor', style: { background: stickyHex(n.color) } });
      sw.addEventListener('click', () => {
        const idx = STICKY_COLORS.findIndex((c) => c.name === n.color);
        n.color = STICKY_COLORS[(idx + 1) % STICKY_COLORS.length].name;
        sw.style.background = stickyHex(n.color);
      });
      const cb = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Incluir este post-it' });
      const row = h('div', { class: 'note-row' }, h('label', { class: 'check', style: { marginTop: '10px' } }, cb), sw, ta);
      cb.addEventListener('change', () => {
        n.on = cb.checked;
        row.classList.toggle('off', !n.on);
        refresh();
      });
      return row;
    }));
    const seg = h('div', { class: 'segmented' });
    const segBtn = (value, label) => {
      const b = h('button', { type: 'button', text: label, class: layout === value ? 'active' : '' });
      b.addEventListener('click', () => {
        layout = value;
        for (const x of seg.children) x.classList.toggle('active', x === b);
      });
      return b;
    };
    seg.append(segBtn('photo', 'Como na foto'), segBtn('grid', 'Em grade'));
    const frameCb = h('input', { type: 'checkbox', checked: true });
    frameCb.addEventListener('change', () => (framed = frameCb.checked));
    addBtn.addEventListener('click', () => {
      const chosen = notes.filter((x) => x.on && x.text.trim());
      if (!chosen.length) return;
      modal.close();
      insertNotes(chosen, { title: titleInput.value.trim(), layout, framed, aspect: photo.width / photo.height });
    });
    refresh();
    body.append(
      h('p', { class: 'hint', style: { marginTop: '0' }, text: `Encontrei ${notes.length} ${notes.length === 1 ? 'nota' : 'notas'}. Revise o texto, a cor (clique no quadradinho) e desmarque o que não quiser.` }),
      h('div', { class: 'field' }, h('label', { text: 'Título da área' }), titleInput),
      list,
      h('div', { class: 'ai-options' }, seg, h('label', { class: 'check' }, frameCb, 'Agrupar em uma área com título')),
      h('div', { class: 'modal-foot', style: { padding: '14px 0 0', marginTop: '14px' } },
        h('button', { class: 'btn', type: 'button', text: 'Outra foto', onclick: () => stepChoose() }),
        addBtn),
    );
  }

  stepChoose();
  return modal;
}
