// tabs.js — main-area tab bar: tabs per leaf, close, new tab, drag reorder, context menu, keyboard.
import { el, clear } from '../dom.js';
import { icon } from '../icons.js';
import { Menu } from './menu.js';

export class TabBar {
  constructor(workspace, container) {
    this.ws = workspace;
    this.container = container;
    container.classList.add('workspace-tab-header-container');
    this.inner = el('div', { class: 'workspace-tab-header-container-inner', role: 'tablist', 'aria-label': 'Open tabs' });
    this.newBtn = el('button', { class: 'clickable-icon', 'aria-label': 'New tab', type: 'button' }, icon('plus'));
    this.listBtn = el('button', { class: 'clickable-icon', 'aria-label': 'Open tabs list', type: 'button' }, icon('chevron-down'));
    this.newBtn.addEventListener('click', () => this.ws.newTab());
    this.listBtn.addEventListener('click', (e) => this.showTabList(e));
    container.append(this.inner, el('div', { class: 'workspace-tab-header-new-tab' }, this.newBtn), el('div', { class: 'workspace-tab-header-tab-list' }, this.listBtn));
    this.inner.addEventListener('wheel', (e) => { if (e.deltaY && !e.deltaX) { this.inner.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    this.inner.addEventListener('keydown', (e) => this.onKey(e));
    this.inner.addEventListener('dblclick', (e) => { if (e.target === this.inner) this.ws.newTab(); });
  }

  render() {
    clear(this.inner);
    for (const leaf of this.ws.leaves) {
      const active = leaf === this.ws.activeLeaf;
      const tab = el('div', { class: 'workspace-tab-header' + (active ? ' is-active' : '') + (leaf.modified ? ' is-modified' : ''), role: 'tab', 'aria-selected': String(active), tabindex: active ? '0' : '-1', dataset: { id: leaf.id }, 'aria-label': leaf.title, draggable: 'false' });
      const close = el('button', { class: 'workspace-tab-header-inner-close-button clickable-icon', 'aria-label': 'Close tab', type: 'button', tabindex: '-1' }, icon('x'));
      close.addEventListener('click', (e) => { e.stopPropagation(); this.ws.closeLeaf(leaf); });
      tab.appendChild(el('div', { class: 'workspace-tab-header-inner' }, el('span', { class: 'workspace-tab-header-inner-icon' }, icon(leaf.icon || 'file-text')), el('span', { class: 'workspace-tab-header-inner-title' }, leaf.title), close));
      tab.addEventListener('click', () => this.ws.activate(leaf));
      tab.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); this.ws.closeLeaf(leaf); } });
      tab.addEventListener('contextmenu', (e) => this.tabMenu(e, leaf));
      tab.addEventListener('pointerdown', (e) => this.onPointerDown(e, tab, leaf));
      this.inner.appendChild(tab);
    }
    const act = this.inner.querySelector('.is-active');
    act?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  onKey(e) {
    const tabs = [...this.inner.children];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; n.focus(); this.ws.activate(this.ws.leaves[tabs.indexOf(n)]); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.ws.activate(this.ws.leaves[i]); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.ws.closeLeaf(this.ws.leaves[i]); }
  }

  onPointerDown(e, tab, leaf) {
    if (e.button !== 0 || e.target.closest('button')) return;
    const startX = e.clientX;
    let dragging = false, dropIndex = -1, dropEl = null, side = '';
    const tabs = () => [...this.inner.querySelectorAll('.workspace-tab-header')];
    const move = (ev) => {
      if (!dragging) { if (Math.abs(ev.clientX - startX) < 6) return; dragging = true; tab.classList.add('is-dragging'); this.inner.setPointerCapture?.(ev.pointerId); }
      tabs().forEach((t) => t.classList.remove('is-drop-before', 'is-drop-after'));
      dropEl = null; dropIndex = -1;
      const list = tabs();
      for (let k = 0; k < list.length; k++) {
        const r = list[k].getBoundingClientRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right) { dropEl = list[k]; side = ev.clientX < r.left + r.width / 2 ? 'before' : 'after'; dropIndex = k + (side === 'after' ? 1 : 0); break; }
      }
      if (!dropEl && list.length) { const last = list[list.length - 1].getBoundingClientRect(); if (ev.clientX > last.right) { dropEl = list[list.length - 1]; side = 'after'; dropIndex = list.length; } }
      if (dropEl && dropEl !== tab) dropEl.classList.add(side === 'before' ? 'is-drop-before' : 'is-drop-after');
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      tab.classList.remove('is-dragging');
      tabs().forEach((t) => t.classList.remove('is-drop-before', 'is-drop-after'));
      if (dragging && dropIndex >= 0) this.ws.moveLeaf(leaf, dropIndex);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  tabMenu(e, leaf) {
    e.preventDefault();
    const menu = new Menu();
    menu.addItem((i) => i.setTitle('Close').setIcon('x').onClick(() => this.ws.closeLeaf(leaf)));
    menu.addItem((i) => i.setTitle('Close others').onClick(() => this.ws.closeOthers(leaf)));
    menu.addItem((i) => i.setTitle('Close all').onClick(() => this.ws.closeAll()));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(leaf.pinned ? 'Unpin' : 'Pin').setIcon('pin').onClick(() => { leaf.pinned = !leaf.pinned; this.render(); }));
    if (leaf.type === 'markdown' && leaf.path) {
      menu.addSeparator();
      menu.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus').onClick(() => this.ws.app.openNote(leaf.path, { newTab: true })));
      menu.addItem((i) => i.setTitle('Open local graph').setIcon('local-graph').onClick(() => this.ws.app.openLocalGraph(leaf.path)));
      menu.addItem((i) => i.setTitle('Reveal in file explorer').setIcon('files').onClick(() => this.ws.revealInExplorer(leaf.path)));
    }
    menu.showAtMouseEvent(e);
  }

  showTabList(e) {
    const menu = new Menu();
    if (!this.ws.leaves.length) menu.addItem((i) => i.setTitle('No open tabs').setDisabled(true));
    for (const leaf of this.ws.leaves) menu.addItem((i) => i.setTitle(leaf.title).setIcon(leaf.icon || 'file-text').setChecked(leaf === this.ws.activeLeaf).onClick(() => this.ws.activate(leaf)));
    const r = e.currentTarget.getBoundingClientRect();
    menu.showAtPosition({ x: r.right - 200, y: r.bottom + 4 });
  }
}
