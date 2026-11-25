/** Ponto de entrada da página do quadro. */
import { state, on, emit, canEdit, resetItems, applyRemote, setTool } from './state.js';
import * as net from './net.js';
import * as view from './view.js';
import { initRender } from './render.js';
import { initInput, fitAll } from './input.js';
import { abortEditingIfRemoved, stopEditing } from './editing.js';
import { initToolbar } from './toolbar.js';
import { initCtxBar } from './ctxbar.js';
import { initPresence } from './presence.js';
import { initTimer } from './timer.js';
import { initTooltips } from './tooltip.js';
import { initMenu } from './menu.js';
import { openShare } from './share.js';
import { openStructures } from './structures.js';
import { openAI } from './ai.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { h, debounce, throttle, toast } from '../util.js';

const $ = (id) => document.getElementById(id);
state.boardId = location.pathname.split('/')[2];
const VIEW_KEY = `pino:view:${state.boardId}`;

async function boot() {
  let me;
  try {
    me = await api('/api/auth/me');
  } catch (err) {
    if (err.status === 401) {
      location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
      return;
    }
    showError('Não foi possível conectar ao servidor', 'Verifique se o Pino está rodando e recarregue a página.');
    return;
  }
  state.me = me.user;
  state.ai = me.ai || { enabled: false };
  state.lanUrls = me.lanUrls || [];

  view.initView($('viewport'), $('world'));
  initRender($('items-layer'), $('overlay-layer'));
  initInput({ viewport: $('viewport'), draft: $('draft-layer'), marquee: $('marquee'), drop: $('drop-hint') });
  initToolbar($('toolbar'), { structures: openStructures, ai: openAI });
  initCtxBar($('ctxbar'));
  initPresence($('cursor-layer'), $('avatars'));
  initTimer({ pillEl: $('timer-pill'), buttonEl: $('timer-btn'), flash: $('flash') });
  initMenu($('menu-btn'));
  initTooltips();
  initTopbar();
  initZoombar();
  wireNetwork();

  // Ctrl + roda fora do quadro não deve dar zoom na página inteira.
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });

  net.connect(state.boardId);
}

/* ---------------- rede ---------------- */

let firstJoin = true;

function wireNetwork() {
  net.onMsg('joined', (msg) => {
    state.sid = msg.you.sid;
    const pending = net.pendingOps();
    setRole(msg.role);
    const { items, ...meta } = msg.board;
    setMeta(meta);
    resetItems(items);
    if (pending.length) applyRemote(pending);
    if (firstJoin) {
      firstJoin = false;
      restoreView();
      $('loading').hidden = true;
      if (!state.items.size && canEdit()) {
        toast('Dica: dê um duplo clique no quadro para criar um post-it, ou use “Estruturas” na barra lateral.', { timeout: 6000 });
      }
    }
  });
  net.onMsg('ops', (msg) => {
    for (const op of msg.ops) if (op.op === 'del') abortEditingIfRemoved(op.id);
    applyRemote(msg.ops);
  });
  net.onMsg('meta', (msg) => setMeta(msg.board));
  net.onMsg('role', (msg) => {
    setRole(msg.role);
    toast(canEdit() ? 'Agora você pode editar este quadro.' : 'Agora você só pode visualizar este quadro.');
  });
  net.onMsg('error', (msg) => {
    stopEditing();
    showError(msg.code === 'deleted' ? 'Quadro excluído' : msg.code === 'not-found' ? 'Quadro não encontrado' : 'Sem acesso', msg.message);
  });
  net.onMsg('status', async (msg) => {
    const chip = $('conn-status');
    if (msg.status === 'online') {
      chip.hidden = true;
      return;
    }
    if (msg.status === 'offline') {
      chip.hidden = false;
      chip.className = 'chip warn';
      chip.textContent = 'Sem conexão — reconectando…';
      if (msg.attempts === 3) {
        try {
          await api('/api/auth/me');
        } catch (err) {
          if (err.status === 401) location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
        }
      }
    }
  });

  const sendSel = throttle(() => net.send({ type: 'sel', ids: [...state.selection].slice(0, 500) }), 120);
  on('selection', sendSel);

  const saveView = debounce(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view.view));
    } catch {
      /* armazenamento indisponível */
    }
  }, 400);
  on('view', saveView);
}

function restoreView() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
  } catch {
    saved = null;
  }
  if (saved && [saved.x, saved.y, saved.s].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    view.setView(saved);
  } else if (state.items.size) {
    const { w, h: hh } = view.size();
    view.setView({ x: w / 2, y: hh / 2, s: 1 });
    fitAll();
  } else {
    const { w, h: hh } = view.size();
    view.setView({ x: w / 2, y: hh / 2, s: 1 });
  }
}

function setRole(role) {
  state.role = role;
  if (!canEdit()) {
    setTool('select');
    stopEditing();
  }
  $('role-badge').hidden = canEdit();
  $('board-name').readOnly = !canEdit();
  emit('role');
}

function setMeta(meta) {
  state.board = { ...(state.board || {}), ...meta };
  const input = $('board-name');
  if (document.activeElement !== input) input.value = state.board.name || '';
  document.title = `${state.board.name || 'Quadro'} · Pino`;
  emit('meta');
}

/* ---------------- barra superior e zoom ---------------- */

function initTopbar() {
  const input = $('board-name');
  const commitName = () => {
    const name = input.value.trim();
    if (!name) {
      input.value = (state.board && state.board.name) || '';
      return;
    }
    if (state.board && name !== state.board.name && canEdit()) {
      net.send({ type: 'meta', name });
      state.board.name = name;
      document.title = `${name} · Pino`;
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.value = (state.board && state.board.name) || '';
      input.blur();
    }
  });
  input.addEventListener('blur', commitName);

  const share = $('share-btn');
  share.innerHTML = `${icon('share', 16)}<span class="label">Compartilhar</span>`;
  share.addEventListener('click', openShare);
}

function initZoombar() {
  const bar = $('zoombar');
  const value = h('button', { class: 'zoom-value', type: 'button', dataset: { tip: 'Voltar para 100%', tipSide: 'top' }, onclick: () => view.zoomTo(1) });
  bar.append(
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Diminuir zoom', dataset: { tip: 'Diminuir zoom', tipSide: 'top' }, html: icon('minus', 18), onclick: () => view.zoomBy(1 / 1.25) }),
    value,
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Aumentar zoom', dataset: { tip: 'Aumentar zoom', tipSide: 'top' }, html: icon('plus', 18), onclick: () => view.zoomBy(1.25) }),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Ajustar à tela', dataset: { tip: 'Ajustar à tela', kbd: 'Shift+1', tipSide: 'top' }, html: icon('fit', 18), onclick: fitAll }),
  );
  const update = () => (value.textContent = `${Math.round(view.view.s * 100)}%`);
  on('view', update);
  update();
}

function showError(title, message) {
  $('loading').hidden = true;
  const box = $('board-error');
  box.textContent = '';
  box.append(
    h('img', { src: '/img/logo.svg', alt: '', width: 56, height: 56 }),
    h('h2', { text: title }),
    h('p', { style: { margin: '0', maxWidth: '440px' }, text: message }),
    h('a', { class: 'btn primary', href: '/', text: 'Ir para meus quadros' }),
  );
  box.hidden = false;
}

boot();
