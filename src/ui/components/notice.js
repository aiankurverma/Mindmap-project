// notice.js — Obsidian-style bottom-right toasts with a polite live region.
import { el } from '../dom.js';

let container = null;
function getContainer() {
  if (!container) {
    container = el('div', { class: 'notice-container', role: 'status', 'aria-live': 'polite', 'aria-relevant': 'additions' });
    document.body.appendChild(container);
  }
  return container;
}

export class Notice {
  constructor(message, timeout = 4000, { type = '' } = {}) {
    this.el = el('div', { class: 'notice' + (type ? ` mod-${type}` : ''), role: 'alert' });
    if (message instanceof Node) this.el.appendChild(message); else this.el.textContent = String(message);
    this.el.addEventListener('click', () => this.hide());
    getContainer().appendChild(this.el);
    if (timeout > 0) this.timer = setTimeout(() => this.hide(), timeout);
    const live = document.getElementById('live-region');
    if (live) { live.textContent = ''; setTimeout(() => { live.textContent = typeof message === 'string' ? message : this.el.textContent; }, 30); }
  }
  setMessage(message) { this.el.textContent = String(message); return this; }
  hide() {
    clearTimeout(this.timer);
    if (!this.el.isConnected) return;
    this.el.classList.add('is-leaving');
    setTimeout(() => this.el.remove(), 200);
  }
}

export function notice(message, timeout, opts) { return new Notice(message, timeout, opts); }
