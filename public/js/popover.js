import { h } from './util.js';

let current = null;

export function closePopover() {
  if (current) {
    const c = current;
    current = null;
    c.el.remove();
    document.removeEventListener('pointerdown', c.onDown, true);
    document.removeEventListener('keydown', c.onKey, true);
    if (c.onClose) c.onClose();
  }
}

export const popoverOpenFor = (anchor) => !!current && current.anchor === anchor;

/**
 * Abre um popover ancorado em um elemento.
 * placement: 'bottom' | 'top' | 'right' | 'left'
 */
export function openPopover(anchor, content, { placement = 'bottom', align = 'start', offset = 8, onClose, className = '' } = {}) {
  closePopover();
  const el = h('div', { class: `popover ${className}` }, content);
  document.body.appendChild(el);
  const position = () => {
    const a = anchor.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    let x;
    let y;
    if (placement === 'right' || placement === 'left') {
      x = placement === 'right' ? a.right + offset : a.left - r.width - offset;
      y = align === 'center' ? a.top + a.height / 2 - r.height / 2 : a.top;
    } else {
      y = placement === 'bottom' ? a.bottom + offset : a.top - r.height - offset;
      if (placement === 'bottom' && y + r.height > innerHeight - 8) y = a.top - r.height - offset;
      if (placement === 'top' && y < 8) y = a.bottom + offset;
      x = align === 'end' ? a.right - r.width : align === 'center' ? a.left + a.width / 2 - r.width / 2 : a.left;
    }
    x = Math.max(8, Math.min(innerWidth - r.width - 8, x));
    y = Math.max(8, Math.min(innerHeight - r.height - 8, y));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };
  position();
  const onDown = (e) => {
    if (!el.contains(e.target) && !anchor.contains(e.target)) closePopover();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePopover();
    }
  };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  current = { el, anchor, onDown, onKey, onClose };
  return { el, close: closePopover, reposition: position };
}

/** Menu simples: items = [{ label, icon, onClick, danger } | 'sep' | { heading }] */
export function menuContent(items, iconFn) {
  return h(
    'div',
    { class: 'menu', role: 'menu' },
    items.filter(Boolean).map((it) => {
      if (it === 'sep') return h('div', { class: 'menu-sep' });
      if (it.heading) return h('div', { class: 'menu-label', text: it.heading });
      return h(
        'button',
        {
          class: `menu-item${it.danger ? ' danger' : ''}`,
          type: 'button',
          role: 'menuitem',
          onclick: () => {
            closePopover();
            it.onClick();
          },
        },
        it.icon ? h('span', { html: iconFn(it.icon, 18) }) : null,
        h('span', { text: it.label }),
      );
    }),
  );
}
