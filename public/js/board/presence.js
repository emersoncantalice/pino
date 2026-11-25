/** Quem está no quadro: avatares, cursores ao vivo e seleções das outras pessoas. */
import { state, on, canEdit } from './state.js';
import * as net from './net.js';
import * as view from './view.js';
import { remoteSel, markOverlay } from './render.js';
import { h, initials, toast } from '../util.js';
import { icon } from '../icons.js';
import { openPopover, closePopover } from '../popover.js';

const peers = new Map(); // sid -> { sid, userId, name, color, role, cursor, el, idle }
let layer;
let avatarsEl;

const ROLE_LABEL = { owner: 'Dono', editor: 'Pode editar', viewer: 'Visualizando' };

const CURSOR_SVG = (color) =>
  `<svg width="20" height="22" viewBox="0 0 20 22" aria-hidden="true"><path d="M2 2l6.5 18 2.9-7.6L19 9.4z" fill="${color}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

export function initPresence(cursorLayer, avatarsContainer) {
  layer = cursorLayer;
  avatarsEl = avatarsContainer;

  net.onMsg('joined', (msg) => {
    for (const p of peers.values()) if (p.el) p.el.remove();
    peers.clear();
    remoteSel.clear();
    setPeers(msg.peers);
  });
  net.onMsg('presence', (msg) => setPeers(msg.peers));
  net.onMsg('leave', (msg) => removePeer(msg.sid));
  net.onMsg('cursor', (msg) => {
    const p = peers.get(msg.sid);
    if (!p) return;
    p.cursor = msg.cursor;
    drawCursor(p);
  });
  net.onMsg('sel', (msg) => {
    const p = peers.get(msg.sid);
    if (!p) return;
    if (msg.ids && msg.ids.length) remoteSel.set(msg.sid, { ids: msg.ids, color: p.color, name: p.name });
    else remoteSel.delete(msg.sid);
    markOverlay();
  });
  net.onMsg('summon', (msg) => {
    toast(`${msg.name} trouxe você para a visão dele(a).`);
    const { w, h: hh } = view.size();
    // mantém o mesmo centro e zoom de quem chamou
    view.animateTo({ s: msg.view.s, x: w / 2 - msg.view.x * msg.view.s, y: hh / 2 - msg.view.y * msg.view.s }, 500);
  });
  on('meta', renderAvatars);

  // Esconde cursores parados há muito tempo.
  setInterval(() => {
    const now = Date.now();
    for (const p of peers.values()) {
      if (p.el && p.lastMove && now - p.lastMove > 30000) p.el.classList.add('hidden');
    }
  }, 5000);
}

function setPeers(list) {
  const seen = new Set();
  for (const info of list || []) {
    if (info.sid === state.sid) continue;
    seen.add(info.sid);
    let p = peers.get(info.sid);
    if (!p) {
      p = { ...info, el: null };
      peers.set(info.sid, p);
    } else Object.assign(p, { name: info.name, color: info.color, role: info.role });
    if (info.cursor !== undefined && !p.el) {
      p.cursor = info.cursor;
      drawCursor(p);
    }
    if (info.sel && info.sel.length) remoteSel.set(info.sid, { ids: info.sel, color: info.color, name: info.name });
  }
  for (const sid of [...peers.keys()]) if (!seen.has(sid)) removePeer(sid, false);
  markOverlay();
  renderAvatars();
}

function removePeer(sid, render = true) {
  const p = peers.get(sid);
  if (p && p.el) p.el.remove();
  peers.delete(sid);
  remoteSel.delete(sid);
  if (render) {
    markOverlay();
    renderAvatars();
  }
}

function drawCursor(p) {
  if (!p.cursor) {
    if (p.el) p.el.classList.add('hidden');
    return;
  }
  if (!p.el) {
    p.el = h('div', { class: 'cursor', html: CURSOR_SVG(p.color) }, h('span', { class: 'label', style: { background: p.color }, text: p.name }));
    layer.appendChild(p.el);
  }
  p.lastMove = Date.now();
  p.el.classList.remove('hidden');
  p.el.style.setProperty('--x', `${p.cursor.x}px`);
  p.el.style.setProperty('--y', `${p.cursor.y}px`);
}

/** Uma entrada por pessoa (várias abas da mesma pessoa contam uma vez). */
function people() {
  const byUser = new Map();
  for (const p of peers.values()) {
    const cur = byUser.get(p.userId);
    if (!cur || (p.cursor && !cur.cursor)) byUser.set(p.userId, p);
  }
  return [...byUser.values()].filter((p) => p.userId !== (state.me && state.me.id));
}

function goTo(p) {
  if (p.cursor) view.centerOn(p.cursor.x, p.cursor.y);
  else toast(`${p.name} ainda não moveu o cursor no quadro.`);
}

function renderAvatars() {
  if (!avatarsEl || !state.me) return;
  avatarsEl.textContent = '';
  const list = people();
  const me = h('span', { class: 'avatar me', style: { background: state.me.color }, title: `${state.me.name} (você)`, text: initials(state.me.name) });
  avatarsEl.appendChild(me);
  const max = 4;
  for (const p of list.slice(0, max)) {
    const a = h('span', { class: 'avatar', style: { background: p.color }, title: `${p.name} — clique para ir até o cursor`, text: initials(p.name) });
    a.addEventListener('click', () => goTo(p));
    avatarsEl.appendChild(a);
  }
  const more = h('span', { class: 'avatar more', title: 'Pessoas no quadro', html: list.length > max ? `+${list.length - max}` : icon('users', 15) });
  more.addEventListener('click', () => openPeople(more));
  avatarsEl.appendChild(more);
}

function openPeople(anchor) {
  const list = people();
  const rows = [
    h('h3', { text: `${list.length + 1} ${list.length ? 'pessoas' : 'pessoa'} no quadro agora` }),
    h('div', { class: 'person', style: { cursor: 'default' } },
      h('span', { class: 'avatar', style: { background: state.me.color }, text: initials(state.me.name) }),
      h('span', { class: 'who', text: `${state.me.name} (você)` }),
      h('span', { class: 'role', text: ROLE_LABEL[state.role] || '' })),
    ...list.map((p) => h('button', { class: 'person', type: 'button', onclick: () => { closePopover(); goTo(p); } },
      h('span', { class: 'avatar', style: { background: p.color }, text: initials(p.name) }),
      h('span', { class: 'who', text: p.name }),
      h('span', { class: 'role', text: ROLE_LABEL[p.role] || '' }))),
  ];
  if (canEdit() && list.length) {
    rows.push(h('div', { class: 'menu-sep' }));
    rows.push(h('button', {
      class: 'menu-item', type: 'button', html: `${icon('target', 18)}<span>Trazer todos para minha visão</span>`,
      onclick: () => {
        closePopover();
        const c = view.centerWorld();
        net.send({ type: 'summon', view: { x: c.x, y: c.y, s: view.view.s } });
        toast('Todos foram trazidos para a sua visão.');
      },
    }));
  }
  openPopover(anchor, h('div', { class: 'people' }, rows), { placement: 'bottom', align: 'end' });
}
