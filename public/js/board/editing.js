/** Edição de texto direto no quadro (contenteditable). */
import { state, commit, emit, pushHistory, lastHistory, popHistory, canEdit } from './state.js';
import { itemEl, mark, flush } from './render.js';

let session = null;

export const isEditing = () => !!session;

function readText(el) {
  return el.innerText.replace(/\r/g, '').replace(/\n$/, '');
}

function placeCaret(el, selectAll) {
  const range = document.createRange();
  range.selectNodeContents(el);
  if (!selectAll) range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function onPaste(e) {
  e.preventDefault();
  const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
  document.execCommand('insertText', false, text);
}

/**
 * Começa a editar o texto de um item.
 * isNew: o item acabou de ser criado — a criação e o texto viram um só passo no histórico.
 */
export function startEditing(id, { isNew = false, selectAll = false } = {}) {
  const it = state.items.get(id);
  if (!it || it.locked || !canEdit()) return;
  if (!['sticky', 'text', 'shape', 'frame'].includes(it.type)) return;
  stopEditing();
  flush();
  const el = itemEl(id);
  if (!el) return;
  const field = it.type === 'frame' ? el.querySelector('.frame-title') : el.querySelector('.content');
  const key = it.type === 'frame' ? 'title' : 'text';
  const before = it[key] || '';

  state.editingId = id;
  el.classList.add('editing');
  field.setAttribute('contenteditable', 'true');
  field.spellcheck = true;
  field.textContent = before;
  field.focus({ preventScroll: true });
  placeCaret(field, selectAll);

  const onInput = () => {
    let value = readText(field);
    if (key === 'title') value = value.replace(/\n/g, ' ');
    commit([{ op: 'upd', id, patch: { [key]: value } }], { record: false });
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (key === 'title' || e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      stopEditing();
    }
  };
  const onBlur = () => stopEditing();
  field.addEventListener('input', onInput);
  field.addEventListener('keydown', onKey);
  field.addEventListener('paste', onPaste);
  field.addEventListener('blur', onBlur);

  session = { id, key, before, isNew, field, el, onInput, onKey, onBlur };
  emit('editing', id);
}

export function stopEditing() {
  if (!session) return;
  const s = session;
  session = null;
  s.field.removeEventListener('input', s.onInput);
  s.field.removeEventListener('keydown', s.onKey);
  s.field.removeEventListener('paste', onPaste);
  s.field.removeEventListener('blur', s.onBlur);
  s.field.setAttribute('contenteditable', 'false');
  s.el.classList.remove('editing');
  state.editingId = null;
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();

  const it = state.items.get(s.id);
  if (it) {
    const after = it[s.key] || '';
    if (s.key === 'title' && !after.trim()) {
      commit([{ op: 'upd', id: s.id, patch: { title: s.before || 'Área' } }], { record: false });
    } else if (it.type === 'text' && !after.trim()) {
      // Texto vazio é descartado.
      const snapshot = { ...it, text: s.before };
      commit([{ op: 'del', id: s.id }], { record: false });
      const last = lastHistory();
      if (s.isNew && last && last.redo.length === 1 && last.redo[0].op === 'add' && last.redo[0].item.id === s.id) {
        popHistory();
      } else if (!s.isNew) {
        pushHistory([{ op: 'add', item: snapshot }], [{ op: 'del', id: s.id }]);
      }
    } else if (after !== s.before) {
      const last = lastHistory();
      if (s.isNew && last && last.redo.length === 1 && last.redo[0].op === 'add' && last.redo[0].item.id === s.id) {
        last.redo[0].item[s.key] = after;
      } else {
        pushHistory([{ op: 'upd', id: s.id, patch: { [s.key]: s.before } }], [{ op: 'upd', id: s.id, patch: { [s.key]: after } }]);
      }
    }
    mark(s.id);
  }
  emit('editing', null);
}

/** Chamado quando um item em edição é apagado por outra pessoa. */
export function abortEditingIfRemoved(id) {
  if (session && session.id === id) {
    session.el.classList.remove('editing');
    session = null;
    state.editingId = null;
    emit('editing', null);
  }
}
