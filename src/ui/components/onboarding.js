// onboarding.js — interactive spotlight tutorial (first run + "Help" ribbon icon). Owner: UI.
import { el } from '../dom.js';
import { icon } from '../icons.js';
import { IS_MAC } from '../../core/commands.js';

const MOD = IS_MAC ? '⌘' : 'Ctrl';

export class Onboarding {
  constructor(app) {
    this.app = app;
    this.index = 0;
    this.active = false;
    this.steps = this.buildSteps();
    this._reposition = () => this.position();
    this._onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.finish(); } if (e.key === 'ArrowRight') this.next(); if (e.key === 'ArrowLeft') this.back(); };
  }

  buildSteps() {
    const ws = () => this.app.workspace;
    return [
      { title: 'Welcome to Mind Map', desc: 'This is a clone of Obsidian with the Mind Map plugin built in. Every note becomes an editable mind map. This tour takes about two minutes — use → and ← to move.', target: null },
      { title: 'File explorer', desc: 'Your vault lives here. Click a note to open it, right-click for rename/delete/bookmark, and drag files onto folders to move them. The + buttons create notes and folders.', target: () => document.querySelector('.nav-files-container'), placement: 'right', before: async () => { ws().revealLeftTab('files'); } },
      { title: 'The editor', desc: `Write markdown as usual. Headings and nested bullets become branches. Type <kbd>[[</kbd> to link notes, <kbd>${MOD}</kbd><kbd>B</kbd> for bold, <kbd>${MOD}</kbd><kbd>E</kbd> toggles reading view.`, target: () => document.querySelector('.cm-editor'), placement: 'right', before: async () => { if (this.app.store.exists('Onboarding.md')) this.app.openNote('Onboarding.md', { focus: false }); ws().showMindMap(true); } },
      { title: 'Preview as Mind Map', desc: `The map follows the note you are editing. Move the cursor to a line and its node is selected; click a node to jump to its line. <kbd>${MOD}</kbd><kbd>M</kbd> toggles the pane.`, target: () => document.querySelector('.mm-host'), placement: 'left', before: async () => { ws().showMindMap(true); } },
      { title: 'Collapse a node', desc: 'Click the small circle on a node with children to collapse or expand it, or use these toolbar buttons (expand all, collapse all, expand to level 1-3).', target: () => document.querySelector('.mm-toolbar .mm-toolbar-group:nth-child(2)'), placement: 'bottom', hint: 'Try collapsing "Editing" in the map.' },
      { title: 'Edit in the map', desc: 'Select a node and press <kbd>Enter</kbd> to add a child, <kbd>Tab</kbd> for a sibling, <kbd>F2</kbd> to rename, <kbd>Delete</kbd> to remove. Drag a node onto another to re-parent it. Every change is written back to the note.', target: () => document.querySelector('.mm-host'), placement: 'left', hint: `Undo with ${MOD}+Z.` },
      { title: 'Search in the map', desc: 'Filter nodes as you type; matches are highlighted and the rest is dimmed. Enter jumps to the next match.', target: () => document.querySelector('.mm-search'), placement: 'bottom' },
      { title: 'Graph view', desc: `See how notes connect through links and tags. The settings panel has filters, color groups, display and force sliders. <kbd>${MOD}</kbd><kbd>G</kbd> opens it; a local graph shows only the neighbours of a note.`, target: () => document.querySelector('[data-ribbon="graph"]'), placement: 'right' },
      { title: 'Settings', desc: 'Every Mind Map plugin option (colors, thickness, spacing, expand level, animation...) plus appearance, hotkeys and plugins live in Settings.', target: () => document.querySelector('[data-ribbon="settings"]'), placement: 'right' },
      { title: 'Export & import', desc: 'Export the map as PNG, SVG, PDF, Markdown, OPML or FreeMind, copy a screenshot, or import XMind / MindMeister / OPML / FreeMind / JSON Canvas files.', target: () => document.querySelector('.mm-toolbar .mm-toolbar-group:last-child'), placement: 'bottom' },
      { title: 'You are ready', desc: `Open the command palette with <kbd>${MOD}</kbd><kbd>P</kbd> to discover every command, or the quick switcher with <kbd>${MOD}</kbd><kbd>O</kbd>. Replay this tour any time from the Help icon in the ribbon.`, target: () => document.querySelector('[data-ribbon="help"]'), placement: 'right' },
    ];
  }

  start(index = 0) {
    if (this.active) this.finish();
    this.active = true;
    this.index = index;
    this.overlay = el('div', { class: 'onboarding-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Tutorial' });
    this.spot = el('div', { class: 'onboarding-spotlight' });
    this.card = el('div', { class: 'onboarding-card' });
    this.overlay.append(this.spot, this.card);
    document.body.appendChild(this.overlay);
    window.addEventListener('resize', this._reposition);
    window.addEventListener('keydown', this._onKey, true);
    this.show();
  }

  async show() {
    const step = this.steps[this.index];
    if (!step) return this.finish();
    try { await step.before?.(); } catch (e) { console.warn(e); }
    await new Promise((r) => setTimeout(r, 80));
    if (!this.active) return;
    this.card.replaceChildren();
    const n = this.steps.length;
    const back = el('button', { type: 'button', disabled: this.index === 0 ? true : null }, 'Back');
    const skip = el('button', { type: 'button', class: 'mod-muted' }, 'Skip tour');
    const next = el('button', { type: 'button', class: 'mod-cta' }, this.index === n - 1 ? 'Finish' : 'Next');
    back.addEventListener('click', () => this.back()); skip.addEventListener('click', () => this.finish()); next.addEventListener('click', () => this.next());
    const close = el('button', { class: 'clickable-icon', type: 'button', 'aria-label': 'Close tutorial', style: { width: '22px', height: '22px', minWidth: '22px' } }, icon('x', { size: 14 }));
    close.addEventListener('click', () => this.finish());
    this.card.append(...[
      el('div', { class: 'onboarding-step' }, `Step ${this.index + 1} of ${n}`, close),
      el('div', { class: 'onboarding-title' }, step.title),
      el('div', { class: 'onboarding-desc', html: step.desc }),
      step.hint ? el('div', { class: 'onboarding-hint' }, icon('info'), step.hint) : null,
      el('div', { class: 'onboarding-progress', 'aria-hidden': 'true' }, ...this.steps.map((_, i) => el('i', { class: i <= this.index ? 'is-done' : '' }))),
      el('div', { class: 'onboarding-actions' }, back, skip, next),
    ].filter(Boolean));
    this.position();
    next.focus();
    document.getElementById('live-region')?.replaceChildren(document.createTextNode(`${step.title}. ${this.card.querySelector('.onboarding-desc').textContent}`));
  }

  position() {
    const step = this.steps[this.index];
    if (!step || !this.overlay) return;
    const target = step.target ? step.target() : null;
    const rect = target && target.offsetParent !== null ? target.getBoundingClientRect() : null;
    this.overlay.classList.toggle('mod-no-target', !rect);
    const pad = 6;
    const vw = window.innerWidth, vh = window.innerHeight;
    const cw = this.card.offsetWidth || 360, ch = this.card.offsetHeight || 200;
    let x, y;
    if (rect) {
      Object.assign(this.spot.style, { left: rect.left - pad + 'px', top: rect.top - pad + 'px', width: rect.width + pad * 2 + 'px', height: rect.height + pad * 2 + 'px' });
      const placement = vw < 700 ? 'bottom' : step.placement || 'bottom';
      if (placement === 'right') { x = rect.right + 16; y = rect.top; }
      else if (placement === 'left') { x = rect.left - cw - 16; y = rect.top; }
      else if (placement === 'top') { x = rect.left; y = rect.top - ch - 16; }
      else { x = rect.left; y = rect.bottom + 16; }
      if (x + cw > vw - 12) x = vw - cw - 12;
      if (x < 12) x = 12;
      if (y + ch > vh - 12) y = Math.max(12, vh - ch - 12);
      if (y < 12) y = 12;
    } else {
      Object.assign(this.spot.style, { left: vw / 2 + 'px', top: vh / 2 + 'px', width: '0px', height: '0px' });
      x = (vw - cw) / 2; y = (vh - ch) / 2;
    }
    this.card.style.left = x + 'px'; this.card.style.top = y + 'px';
  }

  next() { if (!this.active) return; if (this.index >= this.steps.length - 1) return this.finish(); this.index++; this.show(); }
  back() { if (!this.active || this.index === 0) return; this.index--; this.show(); }
  finish() {
    if (!this.active) return;
    this.active = false;
    this.overlay?.remove(); this.overlay = null;
    window.removeEventListener('resize', this._reposition);
    window.removeEventListener('keydown', this._onKey, true);
    this.app.settings.set('onboarded', true);
    this.app.workspace.editor?.focus();
  }
}
