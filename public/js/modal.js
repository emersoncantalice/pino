import { h } from './util.js';
import { icon } from './icons.js';

/** Abre um modal. Retorna { close, el }. */
export function openModal({ title, body, footer, width = 520, onClose, className = '' }) {
  const root = document.getElementById('modal-root') || document.body;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  };
  const overlay = h(
    'div',
    {
      class: 'modal-overlay',
      onmousedown: (e) => {
        if (e.target === overlay) close();
      },
    },
    h(
      'div',
      { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: { maxWidth: `${width}px` } },
      h('div', { class: 'modal-head' }, h('h2', { text: title }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar', html: icon('x'), onclick: close })),
      h('div', { class: 'modal-body' }, body),
      footer ? h('div', { class: 'modal-foot' }, footer) : null,
    ),
  );
  root.appendChild(overlay);
  document.addEventListener('keydown', onKey, true);
  const focusable = overlay.querySelector('.modal-body input, .modal-body textarea, .modal-body button, .modal-foot .btn.primary');
  if (focusable) setTimeout(() => focusable.focus(), 30);
  return { close, el: overlay };
}

export const isModalOpen = () => !!document.querySelector('.modal-overlay');

/** Pergunta simples com campo de texto. Resolve com o texto ou null. */
export function promptModal({ title, label, value = '', confirm = 'Salvar', placeholder = '' }) {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input', { class: 'input', value, placeholder, maxlength: '120' });
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const form = h(
      'form',
      {
        onsubmit: (e) => {
          e.preventDefault();
          finish(input.value.trim() || null);
        },
      },
      h('div', { class: 'field' }, label ? h('label', { text: label }) : null, input),
    );
    const m = openModal({
      title,
      body: form,
      width: 420,
      footer: [
        h('button', { class: 'btn', type: 'button', text: 'Cancelar', onclick: () => finish(null) }),
        h('button', { class: 'btn primary', type: 'button', text: confirm, onclick: () => finish(input.value.trim() || null) }),
      ],
      onClose: () => finish(null),
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 40);
  });
}

export function confirmModal({ title, message, confirm = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const m = openModal({
      title,
      width: 420,
      body: h('p', { style: { margin: '0', color: 'var(--ink-2)' }, text: message }),
      footer: [
        h('button', { class: 'btn', type: 'button', text: 'Cancelar', onclick: () => finish(false) }),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', text: confirm, onclick: () => finish(true) }),
      ],
      onClose: () => finish(false),
    });
  });
}
