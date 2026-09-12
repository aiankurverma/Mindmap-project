// tooltip.js — hover/focus tooltips for any element with [aria-label] (buttons) or [data-tooltip].
import { el } from '../dom.js';

let tip = null, showTimer = null, current = null;

function targetOf(node) {
  if (!(node instanceof Element)) return null;
  return node.closest('[data-tooltip], button[aria-label], .clickable-icon[aria-label], [role="button"][aria-label], [data-tooltip-always]');
}

function textFor(t) {
  return t.getAttribute('data-tooltip') || t.getAttribute('aria-label') || '';
}

function show(t) {
  const text = textFor(t);
  if (!text) return;
  hide();
  const pos = t.getAttribute('data-tooltip-position') || 'bottom';
  tip = el('div', { class: `tooltip mod-${pos}`, role: 'tooltip' }, text);
  const hk = t.getAttribute('data-tooltip-hotkey');
  if (hk) tip.appendChild(el('span', { class: 'tooltip-hotkey' }, hk));
  tip.appendChild(el('div', { class: 'tooltip-arrow' }));
  document.body.appendChild(tip);
  const r = t.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  let x, y;
  if (pos === 'right') { x = r.right + 8; y = r.top + r.height / 2 - tr.height / 2; }
  else if (pos === 'left') { x = r.left - tr.width - 8; y = r.top + r.height / 2 - tr.height / 2; }
  else if (pos === 'top') { x = r.left + r.width / 2 - tr.width / 2; y = r.top - tr.height - 8; }
  else { x = r.left + r.width / 2 - tr.width / 2; y = r.bottom + 8; }
  x = Math.max(4, Math.min(window.innerWidth - tr.width - 4, x));
  y = Math.max(4, Math.min(window.innerHeight - tr.height - 4, y));
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
  current = t;
}

export function hideTooltip() { hide(); }
function hide() { clearTimeout(showTimer); showTimer = null; if (tip) { tip.remove(); tip = null; } current = null; }

export function installTooltips(root = document) {
  root.addEventListener('pointerover', (e) => {
    const t = targetOf(e.target);
    if (!t || t === current) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(t), 350);
  });
  root.addEventListener('pointerout', (e) => {
    const t = targetOf(e.target);
    if (t && (!e.relatedTarget || !t.contains(e.relatedTarget))) hide();
  });
  root.addEventListener('focusin', (e) => { const t = targetOf(e.target); if (t && t.matches(':focus-visible')) { clearTimeout(showTimer); showTimer = setTimeout(() => show(t), 200); } });
  root.addEventListener('focusout', hide);
  root.addEventListener('pointerdown', hide, true);
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); }, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}

export function setTooltip(node, text, { position, hotkey } = {}) {
  node.setAttribute('aria-label', text);
  if (position) node.setAttribute('data-tooltip-position', position);
  if (hotkey) node.setAttribute('data-tooltip-hotkey', hotkey); else node.removeAttribute('data-tooltip-hotkey');
}
