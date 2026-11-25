/** Barra flutuante sobre a seleção: cores, texto, camadas, travar, duplicar, excluir. */
import { state, on, commit, canEdit, selectedItems, setSelection } from './state.js';
import * as view from './view.js';
import { unionBox, topZ, bottomZ, STICKY_SIZE } from './items.js';
import { textLayout } from '../textfit.js';
import { icon } from '../icons.js';
import { h } from '../util.js';
import { STICKY_COLORS, INK_COLORS, FILL_COLORS, PEN_WIDTHS, FONT_SIZES } from '../palette.js';
import { openPopover, closePopover } from '../popover.js';
import { duplicateSelection } from './importer.js';
import { deleteSelection } from './input.js';

let bar;
let raf = 0;
let signature = '';

export function initCtxBar(el) {
  bar = el;
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  on('selection', schedule);
  on('item', (id) => {
    if (state.selection.has(id)) schedule();
  });
  on('remove', schedule);
  on('view', schedule);
  on('gesture', schedule);
  on('editing', schedule);
  on('role', schedule);
  window.addEventListener('resize', schedule);
}

function update() {
  raf = 0;
  const sel = selectedItems();
  if (!sel.length || state.gesture || !canEdit()) {
    if (!bar.hidden) closePopover();
    bar.hidden = true;
    signature = '';
    return;
  }
  const sig = JSON.stringify(sel.map((it) => [it.id, it.type, it.color, it.fill, it.stroke, it.locked, it.fontSize, it.bold, it.align, it.shape, it.structure, it.width, it.textColor]));
  if (sig !== signature) {
    signature = sig;
    build(sel);
  }
  bar.hidden = false;
  position(sel);
}

function position(sel) {
  const b = unionBox(sel);
  const a = view.toScreen(b.x, b.y);
  const c = view.toScreen(b.x + b.w, b.y + b.h);
  const w = bar.offsetWidth;
  const hgt = bar.offsetHeight;
  // Post-it sozinho tem os botões "+" por fora: a barra fica mais acima para não cobri-los.
  const gap = sel.length === 1 && sel[0].type === 'sticky' && !sel[0].locked ? 48 : 18;
  let x = (a.x + c.x) / 2 - w / 2;
  let y = a.y - hgt - gap;
  if (y < 72) y = c.y + gap;
  if (y > innerHeight - hgt - 70) y = Math.max(72, Math.min(innerHeight - hgt - 70, a.y + 12));
  x = Math.max(8, Math.min(innerWidth - w - 8, x));
  bar.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

const same = (sel, key) => (sel.every((it) => it[key] === sel[0][key]) ? sel[0][key] : null);

function patchAll(sel, patchFn) {
  const ops = sel
    .filter((it) => !it.locked)
    .map((it) => ({ op: 'upd', id: it.id, patch: typeof patchFn === 'function' ? patchFn(it) : patchFn }));
  if (ops.length) commit(ops);
}

function btn(iconName, label, onClick, { active = false, disabled = false } = {}) {
  return h('button', {
    class: `icon-btn${active ? ' active' : ''}`, type: 'button', 'aria-label': label,
    dataset: { tip: label, tipSide: 'top' }, html: icon(iconName, 18), disabled, onclick: onClick,
  });
}

function colorButton(label, color, colors, onPick, { ring = false, square = false } = {}) {
  const b = h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, dataset: { tip: label, tipSide: 'top' } });
  const dot = h('span', { class: `ctx-color${ring ? ' ring' : ''}` });
  if (color === 'transparent') dot.classList.add('swatch', 'transparent');
  dot.style.background = color || '#fff';
  dot.style.setProperty('--c', color || '#999');
  b.appendChild(dot);
  b.addEventListener('click', () => {
    openPopover(
      b,
      h('div', { class: 'tool-options' }, h('div', { class: 'opt-label', text: label }), h('div', { class: 'row' }, colors.map((c) =>
        h('button', {
          class: `swatch${square ? ' square' : ''}${c === 'transparent' ? ' transparent' : ''}${String(c).toLowerCase() === String(color).toLowerCase() ? ' active' : ''}`,
          type: 'button', 'aria-label': c, style: { background: c },
          onclick: () => {
            closePopover();
            onPick(c);
          },
        })))),
      { placement: 'bottom', align: 'center' },
    );
  });
  return b;
}

const sep = () => h('span', { class: 'sep' });

function build(sel) {
  bar.textContent = '';
  const types = new Set(sel.map((it) => it.type));
  const only = types.size === 1 ? sel[0].type : null;
  const anyLocked = sel.some((it) => it.locked);
  const allLocked = sel.every((it) => it.locked);
  const parts = [];

  if (!allLocked) {
    if (only === 'sticky') {
      parts.push(colorButton('Cor do post-it', same(sel, 'color'), STICKY_COLORS.map((c) => c.hex), (c) => patchAll(sel, { color: c }), { square: true }));
      if (sel.length > 1) parts.push(h('button', { class: 'ctx-text-btn', type: 'button', html: `${icon('grid', 16)} Organizar`, dataset: { tip: 'Organizar em grade', tipSide: 'top' }, onclick: () => arrange(sel) }));
    }
    if (only === 'shape') {
      parts.push(colorButton('Preenchimento', same(sel, 'fill'), FILL_COLORS, (c) => patchAll(sel, { fill: c })));
      parts.push(colorButton('Borda', same(sel, 'stroke'), INK_COLORS.concat('transparent'), (c) => patchAll(sel, { stroke: c }), { ring: true }));
      const kinds = [['rect', 'square'], ['round', 'round'], ['ellipse', 'circle'], ['diamond', 'diamond'], ['triangle', 'triangle']];
      const current = same(sel, 'shape') || 'rect';
      const kb = btn((kinds.find((k) => k[0] === current) || kinds[0])[1], 'Tipo de forma', () => {
        openPopover(kb, h('div', { class: 'tool-options' }, h('div', { class: 'row' }, kinds.map(([k, ic]) =>
          h('button', { class: `opt-btn${current === k ? ' active' : ''}`, type: 'button', html: icon(ic, 18), onclick: () => { closePopover(); patchAll(sel, { shape: k }); } })))), { placement: 'bottom', align: 'center' });
      });
      parts.push(kb);
      parts.push(colorButton('Cor do texto', same(sel, 'textColor') || '#1F2328', INK_COLORS, (c) => patchAll(sel, { textColor: c }), { ring: true }));
    }
    if (only === 'text') {
      parts.push(colorButton('Cor do texto', same(sel, 'color') || '#1F2328', INK_COLORS, (c) => patchAll(sel, { color: c }), { ring: true }));
      const size = same(sel, 'fontSize');
      const current = FONT_SIZES.reduce((best, f) => (Math.abs(f.size - (size || 24)) < Math.abs(best.size - (size || 24)) ? f : best), FONT_SIZES[1]);
      const sb = h('button', { class: 'ctx-text-btn', type: 'button', dataset: { tip: 'Tamanho', tipSide: 'top' }, html: `${size ? Math.round(size) : '—'} ${icon('chevronDown', 14)}` });
      sb.addEventListener('click', () => {
        openPopover(sb, h('div', { class: 'tool-options' }, h('div', { class: 'row' }, FONT_SIZES.map((f) =>
          h('button', { class: `opt-btn${f === current && size ? ' active' : ''}`, type: 'button', text: f.label, onclick: () => { closePopover(); patchAll(sel, (it) => ({ fontSize: f.size, h: textLayout({ ...it, fontSize: f.size }).h })); } })))), { placement: 'bottom', align: 'center' });
      });
      parts.push(sb);
      const bold = sel.every((it) => it.bold);
      parts.push(btn('bold', 'Negrito', () => patchAll(sel, (it) => ({ bold: !bold, h: textLayout({ ...it, bold: !bold }).h })), { active: bold }));
      const align = same(sel, 'align') || 'left';
      const nextAlign = { left: 'center', center: 'right', right: 'left' }[align];
      parts.push(btn({ left: 'alignLeft', center: 'alignCenter', right: 'alignRight' }[align], 'Alinhamento', () => patchAll(sel, { align: nextAlign })));
    }
    if (only === 'path') {
      parts.push(colorButton('Cor do traço', same(sel, 'stroke'), INK_COLORS, (c) => patchAll(sel, { stroke: c }), { ring: true }));
      const wb = h('button', { class: 'ctx-text-btn', type: 'button', dataset: { tip: 'Espessura', tipSide: 'top' }, html: `${Math.round(same(sel, 'width') || 0) || '—'}px ${icon('chevronDown', 14)}` });
      wb.addEventListener('click', () => {
        openPopover(wb, h('div', { class: 'tool-options' }, h('div', { class: 'row' }, PEN_WIDTHS.concat(22).map((w) =>
          h('button', { class: 'opt-btn', type: 'button', html: `<span class="width-dot" style="width:${Math.max(3, Math.min(18, w))}px;height:${Math.max(3, Math.min(18, w))}px"></span>`, onclick: () => { closePopover(); patchAll(sel, { width: w }); } })))), { placement: 'bottom', align: 'center' });
      });
      parts.push(wb);
    }
    if (only === 'frame') {
      parts.push(colorButton('Fundo da área', same(sel, 'fill'), FILL_COLORS, (c) => patchAll(sel, { fill: c }), { square: true }));
    }
    if (only === 'image' && sel.length === 1) {
      const isStruct = !!sel[0].structure;
      parts.push(h('button', {
        class: `ctx-text-btn${isStruct ? ' active' : ''}`, type: 'button', html: `${icon('structure', 16)} ${isStruct ? 'Estrutura' : 'Usar como estrutura'}`,
        dataset: { tip: isStruct ? 'É uma estrutura: os post-its sobre ela se movem junto' : 'Transformar em estrutura (fica atrás e leva os post-its junto)', tipSide: 'top' },
        onclick: () => patchAll(sel, isStruct ? { structure: false } : { structure: true, z: bottomZ() - 1 }),
      }));
    }
    if (parts.length) parts.push(sep());
    parts.push(btn('front', 'Trazer para frente', () => toFront(sel)));
    parts.push(btn('back', 'Enviar para trás', () => toBack(sel)));
    parts.push(btn('copy', 'Duplicar (Ctrl+D)', () => duplicateSelection()));
  }
  parts.push(btn(anyLocked ? 'unlock' : 'lock', anyLocked ? 'Destravar' : 'Travar posição', () => {
    commit(sel.map((it) => ({ op: 'upd', id: it.id, patch: { locked: !anyLocked } })));
  }, { active: anyLocked }));
  if (!allLocked) parts.push(btn('trash', 'Excluir (Delete)', () => deleteSelection()));
  bar.append(...parts);
}

function toFront(sel) {
  let z = topZ();
  const sorted = [...sel].sort((a, b) => (a.z || 0) - (b.z || 0));
  commit(sorted.map((it) => ({ op: 'upd', id: it.id, patch: { z: ++z } })));
}

function toBack(sel) {
  let z = bottomZ() - sel.length;
  const sorted = [...sel].sort((a, b) => (a.z || 0) - (b.z || 0));
  commit(sorted.map((it) => ({ op: 'upd', id: it.id, patch: { z: z++ } })));
}

/** Organiza post-its selecionados em uma grade, na ordem de leitura. */
function arrange(sel) {
  const list = sel.filter((it) => !it.locked).sort((a, b) => (Math.abs(a.y - b.y) > 60 ? a.y - b.y : a.x - b.x));
  if (!list.length) return;
  const b = unionBox(list);
  const cols = Math.max(1, Math.round(Math.sqrt(list.length * 1.4)));
  const size = Math.max(...list.map((it) => Math.max(it.w, it.h))) || STICKY_SIZE;
  const gap = Math.round(size * 0.12);
  commit(list.map((it, i) => ({
    op: 'upd', id: it.id,
    patch: { x: Math.round(b.x + (i % cols) * (size + gap)), y: Math.round(b.y + Math.floor(i / cols) * (size + gap)) },
  })));
  setSelection(list.map((it) => it.id));
}
