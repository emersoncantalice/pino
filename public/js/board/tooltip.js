/** Dicas flutuantes para botões com data-tip (e atalho opcional em data-kbd). */
let tip = null;
let timer = null;

function hide() {
  clearTimeout(timer);
  if (tip) {
    tip.remove();
    tip = null;
  }
}

function show(el) {
  hide();
  tip = document.createElement('div');
  tip.className = 'tip';
  tip.textContent = el.dataset.tip;
  if (el.dataset.kbd) {
    const k = document.createElement('kbd');
    k.textContent = el.dataset.kbd;
    tip.appendChild(k);
  }
  document.body.appendChild(tip);
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const side = el.dataset.tipSide || 'right';
  let x;
  let y;
  if (side === 'right') {
    x = r.right + 10;
    y = r.top + r.height / 2 - t.height / 2;
  } else if (side === 'bottom') {
    x = r.left + r.width / 2 - t.width / 2;
    y = r.bottom + 8;
  } else {
    x = r.left + r.width / 2 - t.width / 2;
    y = r.top - t.height - 8;
  }
  if (x + t.width > innerWidth - 8) x = r.left + r.width / 2 - t.width / 2;
  if (y < 8) y = r.bottom + 8;
  tip.style.left = `${Math.max(8, Math.min(innerWidth - t.width - 8, x))}px`;
  tip.style.top = `${Math.max(8, Math.min(innerHeight - t.height - 8, y))}px`;
}

export function initTooltips() {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!el) return hide();
    clearTimeout(timer);
    timer = setTimeout(() => show(el), 350);
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('pointerout', (e) => {
    const el = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el && !el.contains(e.relatedTarget)) hide();
  });
}
