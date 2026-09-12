// menu.js — Obsidian-style context menus with keyboard navigation and submenus.
import { el } from '../dom.js';
import { icon } from '../icons.js';

let openMenus = [];
export function closeAllMenus() { for (const m of [...openMenus]) m.hide(); }

export class MenuItem {
  constructor(menu) {
    this.menu = menu;
    this.el = el('div', { class: 'menu-item', role: 'menuitem', tabindex: '-1' });
    this.iconEl = el('div', { class: 'menu-item-icon' });
    this.titleEl = el('div', { class: 'menu-item-title' });
    this.el.append(this.iconEl, this.titleEl);
    this.disabled = false;
    this.submenu = null;
    this.el.addEventListener('click', (e) => { e.stopPropagation(); if (this.disabled) return; if (this.submenu) { this.openSubmenu(); return; } this.menu.hide(); this.callback?.(e); });
    this.el.addEventListener('pointerenter', () => { this.menu.select(this); if (this.submenu) this.openSubmenu(); else this.menu.closeSubmenus(); });
  }
  setTitle(t) { this.titleEl.textContent = t; return this; }
  setIcon(name) { this.iconEl.replaceChildren(name ? icon(name) : ''); return this; }
  setHotkey(text) { if (!this.hotkeyEl) { this.hotkeyEl = el('span', { class: 'menu-item-hotkey' }); this.el.appendChild(this.hotkeyEl); } this.hotkeyEl.textContent = text; return this; }
  setChecked(v) { this.el.classList.toggle('is-checked', !!v); if (v) { if (!this.checkEl) { this.checkEl = el('span', { class: 'menu-item-check' }, icon('check', { size: 14 })); this.el.appendChild(this.checkEl); } } else this.checkEl?.remove(); this.el.setAttribute('aria-checked', String(!!v)); return this; }
  setDisabled(v) { this.disabled = !!v; this.el.classList.toggle('is-disabled', !!v); this.el.setAttribute('aria-disabled', String(!!v)); return this; }
  setWarning(v = true) { this.el.classList.toggle('is-warning', !!v); return this; }
  onClick(cb) { this.callback = cb; return this; }
  setSubmenu() { this.submenu = new Menu(); this.submenu.parent = this.menu; this.el.classList.add('has-submenu'); this.el.setAttribute('aria-haspopup', 'menu'); return this.submenu; }
  openSubmenu() {
    if (!this.submenu || this.submenu.isOpen) return;
    this.menu.closeSubmenus();
    const r = this.el.getBoundingClientRect();
    this.submenu.showAtPosition({ x: r.right - 2, y: r.top - 6 }, { keepParent: true });
    this.menu.activeSubmenu = this.submenu;
  }
}

export class Menu {
  constructor() {
    this.el = el('div', { class: 'menu', role: 'menu', tabindex: '-1' });
    this.items = [];
    this.isOpen = false;
    this.parent = null;
    this.activeSubmenu = null;
    this.selected = -1;
    this._onKey = (e) => this.handleKey(e);
    this._onDown = (e) => { if (!this._contains(e.target)) this.hide(); };
    this._onScroll = () => this.hide();
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  _contains(node) { if (this.el.contains(node)) return true; return !!(this.activeSubmenu && this.activeSubmenu._contains(node)); }
  addItem(cb) { const item = new MenuItem(this); cb(item); this.items.push(item); this.el.appendChild(item.el); return this; }
  addSeparator() { this.el.appendChild(el('div', { class: 'menu-separator', role: 'separator' })); return this; }
  addLabel(text) { this.el.appendChild(el('div', { class: 'menu-item is-label' }, text)); return this; }
  /** Row of color swatches. colors: [{value,label}] */
  addColorRow(colors, current, onPick) {
    const row = el('div', { class: 'menu-color-row', role: 'group', 'aria-label': 'Colors' });
    for (const c of colors) {
      const b = el('button', { class: 'menu-color-swatch' + (c.value === current ? ' is-active' : ''), 'aria-label': c.label || c.value || 'Default', style: { background: c.value || 'var(--background-modifier-border)' } });
      b.addEventListener('click', (e) => { e.stopPropagation(); this.hide(); onPick(c.value); });
      row.appendChild(b);
    }
    this.el.appendChild(row);
    return this;
  }
  showAtMouseEvent(e) { e.preventDefault?.(); return this.showAtPosition({ x: e.clientX, y: e.clientY }); }
  showAtPosition({ x, y }, { keepParent = false } = {}) {
    if (!keepParent) closeAllMenus();
    document.body.appendChild(this.el);
    this.isOpen = true;
    openMenus.push(this);
    const r = this.el.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = Math.max(8, (keepParent ? x - r.width - 4 : window.innerWidth - r.width - 8));
    if (y + r.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - r.height - 8);
    this.el.style.left = x + 'px'; this.el.style.top = y + 'px';
    setTimeout(() => {
      document.addEventListener('pointerdown', this._onDown, true);
      document.addEventListener('keydown', this._onKey, true);
      window.addEventListener('scroll', this._onScroll, true);
      window.addEventListener('resize', this._onScroll);
    }, 0);
    if (!keepParent) { this.restoreFocus = document.activeElement; this.el.focus({ preventScroll: true }); }
    return this;
  }
  hide() {
    if (!this.isOpen) return;
    this.closeSubmenus();
    this.isOpen = false;
    this.el.remove();
    openMenus = openMenus.filter((m) => m !== this);
    document.removeEventListener('pointerdown', this._onDown, true);
    document.removeEventListener('keydown', this._onKey, true);
    window.removeEventListener('scroll', this._onScroll, true);
    window.removeEventListener('resize', this._onScroll);
    if (this.parent) { this.parent.activeSubmenu = null; }
    else if (this.restoreFocus && this.restoreFocus.isConnected) { try { this.restoreFocus.focus({ preventScroll: true }); } catch { /* ignore */ } }
    this.onHide?.();
  }
  closeSubmenus() { if (this.activeSubmenu) { this.activeSubmenu.hide(); this.activeSubmenu = null; } }
  select(item) {
    this.items.forEach((it) => it.el.classList.toggle('selected', it === item));
    this.selected = this.items.indexOf(item);
  }
  handleKey(e) {
    if (this.activeSubmenu) return; // submenu handles its own keys
    const enabled = this.items.filter((i) => !i.disabled);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.hide(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      if (!enabled.length) return;
      const cur = enabled.indexOf(this.items[this.selected]);
      const next = e.key === 'ArrowDown' ? (cur + 1) % enabled.length : (cur - 1 + enabled.length) % enabled.length;
      this.select(enabled[next]);
      enabled[next].el.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'ArrowRight') { const it = this.items[this.selected]; if (it?.submenu) { e.preventDefault(); it.openSubmenu(); it.submenu.handleKey({ key: 'ArrowDown', preventDefault() {}, stopPropagation() {} }); } return; }
    if (e.key === 'ArrowLeft' && this.parent) { e.preventDefault(); e.stopPropagation(); this.hide(); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      const it = this.items[this.selected];
      if (it) { e.preventDefault(); e.stopPropagation(); it.el.click(); }
      return;
    }
    // type-ahead
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      const k = e.key.toLowerCase();
      const found = enabled.find((i) => i.titleEl.textContent.toLowerCase().startsWith(k));
      if (found) { this.select(found); e.preventDefault(); e.stopPropagation(); }
    }
  }
}
