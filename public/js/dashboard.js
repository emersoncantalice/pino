import { api } from './api.js';
import { h, uid, timeAgo, initials, toast, copyText } from './util.js';
import { icon } from './icons.js';
import { TEMPLATES, buildTemplate } from './templates.js';
import { previewSVG } from './preview.js';
import { promptModal, confirmModal } from './modal.js';
import { openPopover, menuContent } from './popover.js';

const grid = document.getElementById('board-grid');
const empty = document.getElementById('empty');
const search = document.getElementById('search');
document.getElementById('search-icon').outerHTML = icon('search', 16);

let boards = [];
let me = null;

const SHARE_LABEL = { off: 'Privado', view: 'Link: visualizar', edit: 'Link: editar' };

async function init() {
  try {
    ({ user: me } = await api('/api/auth/me'));
  } catch {
    location.href = '/login';
    return;
  }
  document.getElementById('user-chip').append(
    h('span', { class: 'avatar', style: { background: me.color }, text: initials(me.name) }),
    h('span', { class: 'name', text: me.name }),
  );
  renderTemplates();
  await loadBoards();
  setInterval(() => {
    if (document.visibilityState === 'visible') loadBoards().catch(() => {});
  }, 20000);
}

function renderTemplates() {
  const row = document.getElementById('tpl-row');
  row.append(
    h(
      'button',
      { class: 'tpl-card blank', type: 'button', onclick: () => createBoard(null, 'Quadro sem título') },
      h('div', { class: 'tpl-thumb', html: icon('plus', 30) }),
      h('span', { class: 'tpl-name', text: 'Quadro em branco' }),
    ),
  );
  for (const t of TEMPLATES) {
    row.append(
      h(
        'button',
        { class: 'tpl-card', type: 'button', title: t.description, onclick: () => createBoard(t.id, t.name) },
        h('div', { class: 'tpl-thumb', html: previewSVG(buildTemplate(t.id, uid), { width: 172, height: 108, bg: '#FFFFFF' }) }),
        h('span', { class: 'tpl-name', text: t.name }),
      ),
    );
  }
}

async function createBoard(template, defaultName) {
  const name = await promptModal({ title: 'Novo quadro', label: 'Nome do quadro', value: defaultName, confirm: 'Criar quadro' });
  if (!name) return;
  try {
    const { board } = await api('/api/boards', { method: 'POST', body: { name, template } });
    location.href = `/b/${board.id}`;
  } catch (err) {
    toast(err.message, { type: 'error' });
  }
}

async function loadBoards() {
  ({ boards } = await api('/api/boards'));
  render();
}

function render() {
  const q = search.value.trim().toLowerCase();
  const list = q ? boards.filter((b) => b.name.toLowerCase().includes(q)) : boards;
  grid.replaceChildren(...list.map(card));
  empty.hidden = boards.length > 0;
  if (boards.length && !list.length) {
    grid.replaceChildren(h('p', { class: 'hint', text: `Nenhum quadro encontrado para “${search.value}”.` }));
  }
}

function card(b) {
  const menuBtn = h('button', { class: 'icon-btn card-menu', type: 'button', 'aria-label': 'Opções do quadro', html: icon('more') });
  menuBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPopover(
      menuBtn,
      menuContent(
        [
          { label: 'Abrir', icon: 'chevronLeft', onClick: () => (location.href = `/b/${b.id}`) },
          b.role !== 'viewer' ? { label: 'Renomear', icon: 'edit', onClick: () => rename(b) } : null,
          { label: 'Copiar link', icon: 'link', onClick: () => copyLink(b) },
          'sep',
          b.isOwner
            ? { label: 'Excluir quadro', icon: 'trash', danger: true, onClick: () => remove(b) }
            : { label: 'Remover da minha lista', icon: 'x', danger: true, onClick: () => remove(b) },
        ],
        icon,
      ),
      { placement: 'bottom', align: 'end' },
    );
  });
  const meta = [
    h('span', { text: `Editado ${timeAgo(b.updatedAt)}` }),
    !b.isOwner ? h('span', { text: `· de ${b.ownerName}` }) : null,
  ];
  return h(
    'a',
    { class: 'board-card', href: `/b/${b.id}` },
    h('div', { class: 'thumb', html: previewSVG(b.preview, { width: 300, height: 150 }) }),
    h(
      'div',
      { class: 'info' },
      h('div', { class: 'title', text: b.name }),
      h('div', { class: 'meta' }, meta),
      h(
        'div',
        { class: 'meta', style: { marginTop: '6px' } },
        h('span', { class: 'badge', text: b.isOwner ? SHARE_LABEL[b.shareMode] : b.role === 'viewer' ? 'Visualização' : 'Edição' }),
        h('span', { class: 'badge', text: `${b.itemCount} ${b.itemCount === 1 ? 'item' : 'itens'}` }),
        b.online ? h('span', { class: 'badge live', text: `${b.online} online` }) : null,
      ),
    ),
    menuBtn,
  );
}

async function rename(b) {
  const name = await promptModal({ title: 'Renomear quadro', label: 'Nome', value: b.name });
  if (!name || name === b.name) return;
  try {
    await api(`/api/boards/${b.id}`, { method: 'PATCH', body: { name } });
    await loadBoards();
  } catch (err) {
    toast(err.message, { type: 'error' });
  }
}

async function copyLink(b) {
  const ok = await copyText(`${location.origin}/b/${b.id}`);
  toast(ok ? 'Link copiado!' : 'Não foi possível copiar o link.', { type: ok ? 'success' : 'error' });
}

async function remove(b) {
  const ok = await confirmModal(
    b.isOwner
      ? { title: 'Excluir quadro?', message: `“${b.name}” será apagado para todos, junto com suas imagens. Não é possível desfazer.`, confirm: 'Excluir', danger: true }
      : { title: 'Remover da sua lista?', message: `Você deixará de ver “${b.name}” na sua lista. Poderá voltar pelo link, se ele ainda estiver compartilhado.`, confirm: 'Remover', danger: true },
  );
  if (!ok) return;
  try {
    await api(`/api/boards/${b.id}`, { method: 'DELETE' });
    await loadBoards();
    toast(b.isOwner ? 'Quadro excluído.' : 'Quadro removido da sua lista.');
  } catch (err) {
    toast(err.message, { type: 'error' });
  }
}

search.addEventListener('input', render);
document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login';
});

init();
