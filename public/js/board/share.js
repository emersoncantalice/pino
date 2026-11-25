/** Modal de compartilhamento: link, permissão do link e convites por nome de usuário. */
import { state, emit } from './state.js';
import { api } from '../api.js';
import { h, initials, toast, copyText } from '../util.js';
import { icon } from '../icons.js';
import { openModal } from '../modal.js';

const MODES = [
  { value: 'edit', label: 'Editar', desc: 'Qualquer pessoa logada com o link pode editar.' },
  { value: 'view', label: 'Só visualizar', desc: 'Qualquer pessoa logada com o link pode ver, mas não editar.' },
  { value: 'off', label: 'Ninguém (privado)', desc: 'Só você e as pessoas convidadas abaixo têm acesso.' },
];

const isLocalHost = () => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);

export function openShare() {
  const body = h('div', {}, h('div', { class: 'ai-loading' }, h('div', { class: 'spinner' })));
  const modal = openModal({ title: 'Compartilhar quadro', body, width: 560 });

  async function load() {
    try {
      const { board, role } = await api(`/api/boards/${state.boardId}`);
      state.board = board;
      emit('meta');
      render(board, role);
    } catch (err) {
      body.textContent = '';
      body.append(h('p', { class: 'form-error', text: err.message }));
    }
  }

  async function copy(url) {
    const ok = await copyText(url);
    toast(ok ? 'Link copiado!' : 'Não foi possível copiar. Selecione e copie manualmente.', { type: ok ? 'success' : 'error' });
  }

  function linkRow(url) {
    const input = h('input', { class: 'input', value: url, readOnly: true, onfocus: (e) => e.target.select() });
    return h('div', { class: 'share-link' }, input, h('button', { class: 'btn primary', type: 'button', html: `${icon('link', 16)} Copiar`, onclick: () => copy(url) }));
  }

  function render(board, role) {
    body.textContent = '';
    const path = `/b/${board.id}`;
    body.append(h('div', { class: 'section-title', style: { marginTop: '4px' }, text: 'Link do quadro' }), linkRow(`${location.origin}${path}`));

    const lan = (state.lanUrls || []).filter((u) => !u.includes(location.host));
    if (isLocalHost() && lan.length) {
      body.append(
        h('div', { class: 'callout', style: { marginTop: '12px' } },
          h('b', { text: 'Você está acessando por “localhost”. ' }),
          'Para pessoas em outros computadores da mesma rede, envie este endereço:'),
        ...lan.slice(0, 3).map((u) => linkRow(`${u}${path}`)),
      );
    }
    body.append(h('p', { class: 'hint', text: 'Quem abrir o link precisa entrar ou criar uma conta no Pino. Todos veem as alterações e os cursores em tempo real.' }));

    body.append(h('div', { class: 'section-title', text: 'Quem tem o link pode' }));
    if (role === 'owner') {
      const select = h('select', { class: 'select' }, MODES.map((m) => h('option', { value: m.value, text: m.label, selected: board.shareMode === m.value })));
      const desc = h('p', { class: 'hint', text: MODES.find((m) => m.value === board.shareMode).desc });
      select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          const res = await api(`/api/boards/${board.id}`, { method: 'PATCH', body: { shareMode: select.value } });
          state.board = res.board;
          desc.textContent = MODES.find((m) => m.value === select.value).desc;
          toast('Compartilhamento atualizado.', { type: 'success' });
        } catch (err) {
          toast(err.message, { type: 'error' });
        } finally {
          select.disabled = false;
        }
      });
      body.append(select, desc);

      body.append(h('div', { class: 'section-title', text: 'Convidar pessoa' }));
      const userInput = h('input', { class: 'input', type: 'text', placeholder: 'nome de usuário', autocapitalize: 'none', spellcheck: false, required: true });
      const roleSel = h('select', { class: 'select' }, h('option', { value: 'editor', text: 'Pode editar' }), h('option', { value: 'viewer', text: 'Pode ver' }));
      const form = h('form', {
        class: 'invite-row',
        onsubmit: async (e) => {
          e.preventDefault();
          if (!userInput.value.trim()) return;
          try {
            const res = await api(`/api/boards/${board.id}/members`, { method: 'POST', body: { username: userInput.value.trim(), role: roleSel.value } });
            toast('Pessoa adicionada ao quadro.', { type: 'success' });
            render(res.board, role);
          } catch (err) {
            toast(err.message, { type: 'error', timeout: 5000 });
          }
        },
      }, userInput, roleSel, h('button', { class: 'btn primary', type: 'submit', text: 'Convidar' }));
      body.append(form, h('p', { class: 'hint', text: 'A pessoa precisa ter uma conta no Pino. O quadro aparecerá na lista dela.' }));
    } else {
      body.append(h('p', { class: 'hint', text: MODES.find((m) => m.value === board.shareMode).desc }));
    }

    body.append(h('div', { class: 'section-title', text: 'Pessoas com acesso' }));
    const list = h('div');
    list.append(memberRow({ name: board.ownerName, color: '#5A4BFF', role: 'owner', userId: board.ownerId }, role, board));
    for (const m of board.members) list.append(memberRow(m, role, board));
    body.append(list);
  }

  function memberRow(m, myRole, board) {
    const isMe = state.me && m.userId === state.me.id;
    const label = m.role === 'owner' ? 'Dono' : m.role === 'editor' ? 'Pode editar' : 'Pode ver';
    const canRemove = m.role !== 'owner' && (myRole === 'owner' || isMe);
    return h('div', { class: 'member-row' },
      h('span', { class: 'avatar', style: { background: m.color || '#8B95A1' }, text: initials(m.name) }),
      h('div', { class: 'who' }, h('b', { text: `${m.name}${isMe ? ' (você)' : ''}` }), m.username ? h('span', { text: `@${m.username}` }) : null),
      h('span', { class: 'badge', text: label }),
      canRemove
        ? h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Remover acesso', title: 'Remover acesso', html: icon('x', 16),
          onclick: async () => {
            try {
              const res = await api(`/api/boards/${board.id}/members/${m.userId}`, { method: 'DELETE' });
              if (isMe) {
                modal.close();
                return;
              }
              render(res.board, myRole);
            } catch (err) {
              toast(err.message, { type: 'error' });
            }
          },
        })
        : null);
  }

  load();
}
