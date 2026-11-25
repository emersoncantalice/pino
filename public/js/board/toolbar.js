/** Barra de ferramentas lateral e opções de cada ferramenta. */
import { state, on, setTool, canEdit, undo, redo, canUndo, canRedo, emit } from './state.js';
import { icon } from '../icons.js';
import { h } from '../util.js';
import { STICKY_COLORS, INK_COLORS, HIGHLIGHT_COLORS, PEN_WIDTHS } from '../palette.js';
import { openPopover, closePopover, popoverOpenFor } from '../popover.js';

const TOOLS = [
  { id: 'select', icon: 'cursor', label: 'Selecionar', kbd: 'V' },
  { id: 'hand', icon: 'hand', label: 'Mover o quadro', kbd: 'H ou Espaço' },
  'sep',
  { id: 'sticky', icon: 'sticky', label: 'Post-it', kbd: 'N', edit: true, options: true },
  { id: 'text', icon: 'text', label: 'Texto', kbd: 'T', edit: true },
  { id: 'shape', icon: 'shapes', label: 'Forma', kbd: 'S', edit: true, options: true },
  { id: 'frame', icon: 'frame', label: 'Área (frame)', kbd: 'F', edit: true },
  'sep',
  { id: 'pen', icon: 'pen', label: 'Desenhar', kbd: 'P', edit: true, options: true },
  { id: 'arrow', icon: 'arrow', label: 'Seta', kbd: 'L', edit: true, options: true },
  { id: 'eraser', icon: 'eraser', label: 'Borracha (apaga desenhos)', kbd: 'E', edit: true },
  'sep',
  { action: 'structures', icon: 'layout', label: 'Estruturas e modelos', edit: true },
  { action: 'ai', icon: 'sparkles', label: 'Foto → Post-its (IA)', edit: true, accent: true },
  'sep',
  { action: 'undo', icon: 'undo', label: 'Desfazer', kbd: 'Ctrl+Z', edit: true },
  { action: 'redo', icon: 'redo', label: 'Refazer', kbd: 'Ctrl+Shift+Z', edit: true },
];

let root;
const buttons = new Map();

export function initToolbar(el, actions) {
  root = el;
  build(actions);
  on('tool', (tool) => {
    sync();
    const def = TOOLS.find((t) => t.id === tool);
    const btn = buttons.get(tool);
    if (def && def.options && btn && !popoverOpenFor(btn)) showOptions(tool, btn);
    else if (!def || !def.options) closePopover();
  });
  on('history', sync);
  on('role', () => build(actions));
}

function build(actions) {
  root.textContent = '';
  buttons.clear();
  const editable = canEdit();
  let lastSep = true;
  for (const t of TOOLS) {
    if (t === 'sep') {
      if (!lastSep) root.appendChild(h('div', { class: 'tool-sep' }));
      lastSep = true;
      continue;
    }
    if (t.edit && !editable) continue;
    lastSep = false;
    const btn = h('button', {
      class: `tool-btn${t.accent ? ' accent' : ''}`,
      type: 'button',
      'aria-label': t.label,
      dataset: { tip: t.label, ...(t.kbd ? { kbd: t.kbd } : {}) },
      html: icon(t.icon, 20),
    });
    if (t.id) {
      btn.addEventListener('click', () => {
        if (state.tool === t.id && t.options) {
          if (popoverOpenFor(btn)) closePopover();
          else showOptions(t.id, btn);
          return;
        }
        setTool(t.id);
      });
      if (t.id === 'sticky') btn.appendChild(h('span', { class: 'swatch-dot' }));
      buttons.set(t.id, btn);
    } else {
      btn.addEventListener('click', () => {
        if (t.action === 'undo') undo();
        else if (t.action === 'redo') redo();
        else if (actions[t.action]) actions[t.action]();
      });
      buttons.set(`action:${t.action}`, btn);
    }
    root.appendChild(btn);
  }
  const last = root.lastElementChild;
  if (last && last.classList.contains('tool-sep')) last.remove();
  sync();
}

function sync() {
  for (const [id, btn] of buttons) btn.classList.toggle('active', id === state.tool);
  const dot = buttons.get('sticky') && buttons.get('sticky').querySelector('.swatch-dot');
  if (dot) dot.style.background = state.toolOpts.stickyColor;
  const u = buttons.get('action:undo');
  const r = buttons.get('action:redo');
  if (u) u.disabled = !canUndo();
  if (r) r.disabled = !canRedo();
}

function swatches(colors, current, onPick, square = false) {
  return h(
    'div',
    { class: 'row' },
    colors.map((c) =>
      h('button', {
        class: `swatch${square ? ' square' : ''}${c.toLowerCase() === String(current).toLowerCase() ? ' active' : ''}`,
        type: 'button',
        style: { background: c },
        'aria-label': c,
        onclick: onPick.bind(null, c),
      }),
    ),
  );
}

function showOptions(tool, btn) {
  const o = state.toolOpts;
  const rerender = () => showOptions(tool, btn);
  let content;
  if (tool === 'sticky') {
    content = [
      h('div', { class: 'opt-label', text: 'Cor do post-it' }),
      swatches(STICKY_COLORS.map((c) => c.hex), o.stickyColor, (c) => {
        o.stickyColor = c;
        sync();
        rerender();
      }, true),
      h('div', { class: 'hint', text: 'Clique no quadro para colar. Dica: duplo clique no vazio cria um post-it.' }),
    ];
  } else if (tool === 'shape') {
    const kinds = [['rect', 'square', 'Retângulo'], ['round', 'round', 'Arredondado'], ['ellipse', 'circle', 'Elipse'], ['diamond', 'diamond', 'Losango'], ['triangle', 'triangle', 'Triângulo']];
    content = [
      h('div', { class: 'opt-label', text: 'Forma' }),
      h('div', { class: 'row' }, kinds.map(([k, ic, label]) => h('button', {
        class: `opt-btn${o.shape === k ? ' active' : ''}`, type: 'button', 'aria-label': label, title: label, html: icon(ic, 18),
        onclick: () => {
          o.shape = k;
          rerender();
        },
      }))),
      h('div', { class: 'hint', text: 'Clique ou arraste no quadro. Shift mantém proporção.' }),
    ];
  } else if (tool === 'pen' || tool === 'arrow') {
    const isPen = tool === 'pen';
    const hl = isPen && o.penKind === 'highlighter';
    content = [
      isPen
        ? h('div', { class: 'row' },
          h('button', { class: `opt-btn${!hl ? ' active' : ''}`, type: 'button', html: `${icon('pen', 16)}<span>Caneta</span>`, onclick: () => { o.penKind = 'pen'; rerender(); } }),
          h('button', { class: `opt-btn${hl ? ' active' : ''}`, type: 'button', html: `${icon('highlighter', 16)}<span>Marca-texto</span>`, onclick: () => { o.penKind = 'highlighter'; rerender(); } }))
        : null,
      h('div', { class: 'opt-label', text: 'Cor' }),
      hl
        ? swatches(HIGHLIGHT_COLORS, o.hlColor, (c) => { o.hlColor = c; rerender(); })
        : swatches(INK_COLORS, o.penColor, (c) => { o.penColor = c; rerender(); }),
      !hl ? h('div', { class: 'opt-label', text: 'Espessura' }) : null,
      !hl
        ? h('div', { class: 'row' }, PEN_WIDTHS.map((w) => h('button', {
          class: `opt-btn${o.penWidth === w ? ' active' : ''}`, type: 'button', 'aria-label': `${w}px`,
          html: `<span class="width-dot" style="width:${Math.max(3, w)}px;height:${Math.max(3, w)}px"></span>`,
          onclick: () => { o.penWidth = w; rerender(); },
        })))
        : null,
    ];
  } else return;
  openPopover(btn, h('div', { class: 'tool-options' }, content), { placement: innerWidth <= 720 ? 'top' : 'right', align: 'start', offset: 12 });
  emit('tool-options');
}
