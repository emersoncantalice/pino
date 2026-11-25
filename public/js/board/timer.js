/** Timer compartilhado (todos veem a mesma contagem) com alerta sonoro no fim. */
import { canEdit, on } from './state.js';
import * as net from './net.js';
import { h, toast } from '../util.js';
import { icon } from '../icons.js';
import { openPopover, closePopover, popoverOpenFor } from '../popover.js';
import { playAlarm, playTick, unlockAudio } from './sound.js';

let timer = null;
let offset = 0; // relógio do servidor - relógio local
let pill;
let button;
let flashEl;
let interval = 0;
let lastTickSecond = null;
let muted = false;
let titleBackup = '';
let titleBlink = 0;

try {
  muted = localStorage.getItem('pino:mute') === '1';
} catch {
  muted = false;
}

const PRESETS = [1, 2, 3, 5, 10, 15, 20, 30, 45];

export function initTimer({ pillEl, buttonEl, flash }) {
  pill = pillEl;
  button = buttonEl;
  flashEl = flash;
  button.innerHTML = icon('timer', 20);
  button.dataset.tip = 'Timer';
  button.dataset.tipSide = 'bottom';
  button.addEventListener('click', () => {
    unlockAudio();
    if (popoverOpenFor(button)) closePopover();
    else openPanel();
  });
  net.onMsg('joined', (msg) => setTimer(msg.timer, msg.now));
  net.onMsg('timer', (msg) => {
    setTimer(msg.timer, msg.now);
    if (popoverOpenFor(button)) openPanel();
  });
  net.onMsg('timer:done', (msg) => onDone(msg.label));
  // Os controles dependem da permissão, que pode chegar depois (ou mudar ao vivo).
  on('role', () => {
    pill.dataset.key = '';
    renderPill();
  });
}

function send(action, extra = {}) {
  net.send({ type: 'timer', action, ...extra });
}

function setTimer(t, serverNow) {
  timer = t;
  if (serverNow) offset = serverNow - Date.now();
  lastTickSecond = null;
  clearInterval(interval);
  if (timer && timer.running) interval = setInterval(renderPill, 250);
  renderPill();
}

function remaining() {
  if (!timer) return 0;
  if (timer.running) return Math.max(0, (timer.endsAt - (Date.now() + offset)) / 1000);
  return Math.max(0, timer.remaining || 0);
}

export function fmt(sec) {
  const s = Math.ceil(sec);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}

function renderPill() {
  button.classList.toggle('running', !!(timer && timer.running));
  if (!timer) {
    pill.hidden = true;
    return;
  }
  const rem = remaining();
  const done = !timer.running && rem <= 0;
  const editable = canEdit();
  pill.hidden = false;
  pill.classList.toggle('paused', !timer.running && !done);
  pill.classList.toggle('warning', timer.running && rem <= 10);
  pill.classList.toggle('done', done);

  if (timer.running && rem <= 5 && rem > 0) {
    const sec = Math.ceil(rem);
    if (sec !== lastTickSecond) {
      lastTickSecond = sec;
      if (!muted) playTick();
    }
  }

  const ratio = timer.duration ? Math.max(0, Math.min(1, rem / timer.duration)) : 0;
  const key = `${timer.running}|${done}|${editable}|${timer.label}|${muted}`;
  if (pill.dataset.key !== key) {
    pill.dataset.key = key;
    pill.textContent = '';
    if (timer.label) pill.appendChild(h('span', { class: 'label', text: timer.label }));
    pill.appendChild(h('span', { class: 'time' }));
    if (editable) {
      if (done) {
        pill.appendChild(h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Reiniciar', title: 'Reiniciar', html: icon('reset', 18), onclick: () => send('reset') }));
      } else {
        pill.appendChild(h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': timer.running ? 'Pausar' : 'Continuar', title: timer.running ? 'Pausar' : 'Continuar',
          html: icon(timer.running ? 'pause' : 'play', 18), onclick: () => send(timer.running ? 'pause' : 'resume'),
        }));
        pill.appendChild(h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Mais 1 minuto', title: '+1 min', html: '<b style="font-size:12px">+1</b>', onclick: () => send('add', { seconds: 60 }) }));
      }
    }
    pill.appendChild(h('button', {
      class: 'icon-btn', type: 'button', 'aria-label': muted ? 'Ativar som' : 'Silenciar', title: muted ? 'Ativar som' : 'Silenciar',
      html: icon(muted ? 'mute' : 'volume', 18), onclick: toggleMute,
    }));
    if (editable) pill.appendChild(h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Encerrar timer', title: 'Encerrar', html: icon('x', 18), onclick: () => send('clear') }));
    pill.appendChild(h('div', { class: 'progress' }, h('span')));
  }
  pill.querySelector('.time').textContent = done ? 'Tempo!' : fmt(rem);
  pill.querySelector('.progress span').style.transform = `scaleX(${ratio})`;
}

function toggleMute() {
  muted = !muted;
  try {
    localStorage.setItem('pino:mute', muted ? '1' : '0');
  } catch {
    /* ignora */
  }
  if (!muted) unlockAudio();
  renderPill();
  if (popoverOpenFor(button)) openPanel();
}

function onDone(label) {
  if (!muted) playAlarm();
  flashEl.classList.remove('on');
  void flashEl.offsetWidth;
  flashEl.classList.add('on');
  toast(label ? `⏰ Tempo esgotado: ${label}` : '⏰ Tempo esgotado!', { timeout: 6000 });
  if (navigator.vibrate) navigator.vibrate([300, 120, 300]);
  // Pisca o título da aba se ela estiver em segundo plano.
  if (document.hidden) {
    clearInterval(titleBlink);
    titleBackup = titleBackup || document.title;
    let on = false;
    titleBlink = setInterval(() => {
      on = !on;
      document.title = on ? '⏰ Tempo esgotado!' : titleBackup;
    }, 900);
    const stop = () => {
      clearInterval(titleBlink);
      document.title = titleBackup;
      titleBackup = '';
      document.removeEventListener('visibilitychange', stop);
    };
    document.addEventListener('visibilitychange', stop);
  }
}

function openPanel() {
  const editable = canEdit();
  const labelInput = h('input', { class: 'input', placeholder: 'Ação (opcional), ex.: Votação', maxlength: '80', value: (timer && timer.label) || '' });
  const minInput = h('input', { class: 'input', type: 'number', min: '1', max: '600', step: '1', placeholder: 'min', style: { width: '80px' } });
  const start = (minutes) => {
    unlockAudio();
    const m = Number(minutes);
    if (!m || m <= 0) {
      toast('Informe os minutos.', { type: 'error' });
      return;
    }
    send('start', { seconds: Math.round(m * 60), label: labelInput.value.trim() });
    closePopover();
  };
  const content = [h('h3', { text: 'Timer da equipe' })];
  if (!editable) {
    content.push(h('p', { class: 'hint', text: 'Só quem pode editar o quadro controla o timer. Você verá e ouvirá o alerta quando ele terminar.' }));
  } else {
    content.push(labelInput);
    content.push(h('div', { class: 'preset-grid' }, PRESETS.map((m) => h('button', { class: 'btn sm', type: 'button', text: `${m} min`, onclick: () => start(m) }))));
    const form = h('form', { class: 'timer-custom', onsubmit: (e) => { e.preventDefault(); start(minInput.value); } },
      minInput, h('span', { class: 'hint', text: 'minutos' }), h('button', { class: 'btn primary sm', type: 'submit', html: `${icon('play', 14)} Iniciar` }));
    content.push(form);
    if (timer) {
      const rem = remaining();
      content.push(h('div', { class: 'timer-controls' },
        timer.running
          ? h('button', { class: 'btn sm', type: 'button', html: `${icon('pause', 14)} Pausar`, onclick: () => send('pause') })
          : rem > 0 ? h('button', { class: 'btn sm', type: 'button', html: `${icon('play', 14)} Continuar`, onclick: () => send('resume') }) : null,
        h('button', { class: 'btn sm', type: 'button', text: '+1 min', onclick: () => send('add', { seconds: 60 }) }),
        h('button', { class: 'btn sm', type: 'button', html: `${icon('reset', 14)} Reiniciar`, onclick: () => send('reset') }),
        h('button', { class: 'btn sm danger', type: 'button', text: 'Encerrar', onclick: () => { send('clear'); closePopover(); } })));
    }
  }
  content.push(h('div', { class: 'timer-controls' },
    h('button', { class: 'btn ghost sm', type: 'button', html: `${icon(muted ? 'mute' : 'volume', 14)} ${muted ? 'Som desativado' : 'Som ativado'}`, onclick: toggleMute }),
    h('button', { class: 'btn ghost sm', type: 'button', html: `${icon('bell', 14)} Testar alerta`, onclick: () => { unlockAudio(); playAlarm(); } })));
  openPopover(button, h('div', { class: 'timer-panel' }, content), { placement: 'bottom', align: 'end' });
}
