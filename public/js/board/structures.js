/** Estruturas: modelos prontos e importação de PNG/SVG como estrutura. */
import { commit, setSelection } from './state.js';
import * as view from './view.js';
import { prepareInsert, unionBox, freeSpot } from './items.js';
import { importImageFile } from './importer.js';
import { TEMPLATES, buildTemplate } from '../templates.js';
import { previewSVG } from '../preview.js';
import { h, uid, toast } from '../util.js';
import { icon } from '../icons.js';
import { openModal } from '../modal.js';

export function pickStructureFile() {
  const input = h('input', { type: 'file', accept: 'image/png,image/svg+xml,image/jpeg,image/webp,.svg,.png,.jpg,.jpeg,.webp', hidden: true });
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    input.remove();
    if (f) importImageFile(f, { structure: true });
  });
  document.body.appendChild(input);
  input.click();
}

export function insertTemplate(id) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  const raw = buildTemplate(id, uid);
  const size = unionBox(raw);
  const c = freeSpot(size.w, size.h, view.centerWorld());
  const items = prepareInsert(raw, c.x, c.y);
  commit(items.map((item) => ({ op: 'add', item })));
  setSelection([]);
  view.fitBox(unionBox(items), { maxScale: 1 });
  toast(`Estrutura “${t.name}” adicionada. Os post-its colocados nas áreas se movem junto com elas.`, { timeout: 5000 });
}

export function openStructures() {
  let modal;
  const drop = h('div', { class: 'dropzone' },
    h('span', { html: icon('upload', 28) }),
    h('b', { text: 'Importe sua própria estrutura (PNG ou SVG)' }),
    h('span', { class: 'hint', text: 'Ex.: um canvas, matriz ou fluxograma feito em outra ferramenta. Ela fica atrás dos post-its e leva junto o que estiver em cima.' }),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', html: `${icon('image', 16)} Escolher arquivo`, onclick: () => { modal.close(); pickStructureFile(); } })));

  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    drop.classList.remove('over');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) {
      modal.close();
      importImageFile(f, { structure: true });
    }
  });

  const grid = h('div', { class: 'tpl-grid' }, TEMPLATES.map((t) =>
    h('button', { class: 'tpl-card', type: 'button', onclick: () => { modal.close(); insertTemplate(t.id); } },
      h('div', { class: 'tpl-thumb', html: previewSVG(buildTemplate(t.id, uid), { width: 160, height: 96, bg: '#FFFFFF' }) }),
      h('span', { class: 'tpl-name', text: t.name }),
      h('span', { class: 'tpl-desc', text: t.description }))));

  modal = openModal({
    title: 'Estruturas',
    width: 760,
    body: h('div', {}, drop, h('div', { class: 'section-title', text: 'Modelos prontos' }), grid),
  });
  return modal;
}
