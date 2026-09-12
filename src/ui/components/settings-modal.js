// settings-modal.js — Obsidian's settings layout: left nav (Options / Plugin options) + setting items. Owner: UI.
import { Modal, confirmModal } from './modal.js';
import { el, clear, escapeHtml } from '../dom.js';
import { icon } from '../icons.js';
import { formatHotkey, hotkeyFromEvent, hotkeyToString } from '../../core/commands.js';

const ACCENTS = ['#7f6df2', '#e05252', '#e9973f', '#e0de71', '#44cf6e', '#53dfdd', '#3f9ce0', '#fa99cd'];
export const CORE_PLUGINS = [
  ['file-explorer', 'File explorer', 'Browse, create, rename and move notes and folders.'],
  ['search', 'Search', 'Search across every note in the vault.'],
  ['tags', 'Tag pane', 'List all tags with counts.'],
  ['bookmarks', 'Bookmarks', 'Keep quick access to files and searches.'],
  ['graph', 'Graph view', 'Visualize links between notes.'],
  ['canvas', 'Canvas', 'Infinite canvas with cards, notes and groups (.canvas files).'],
  ['backlinks', 'Backlinks', 'Show notes that link to the current note.'],
  ['outgoing-links', 'Outgoing links', 'Show links from the current note and unresolved targets.'],
  ['outline', 'Outline', 'Heading outline of the current note.'],
  ['history', 'Version history', 'Snapshots and relationship timeline for the current note.'],
  ['command-palette', 'Command palette', 'Run commands by name.'],
  ['quick-switcher', 'Quick switcher', 'Open or create notes quickly.'],
];

/** Small helper API shared with plugin setting tabs. */
export const settingUI = {
  heading(container, text, desc) { const h = el('div', { class: 'setting-item setting-item-heading' }, el('div', { class: 'setting-item-info' }, el('div', { class: 'setting-item-name' }, text), desc ? el('div', { class: 'setting-item-description' }, desc) : null)); container.appendChild(h); return h; },
  setting(container, def) {
    const { name, desc, type, value, options = [], min, max, step, placeholder, onChange } = def;
    const item = el('div', { class: 'setting-item' + (type === 'toggle' ? ' mod-toggle' : '') });
    const info = el('div', { class: 'setting-item-info' }, el('div', { class: 'setting-item-name' }, name), desc ? el('div', { class: 'setting-item-description', html: typeof desc === 'string' ? escapeHtml(desc) : '' }) : null);
    if (desc instanceof Node) info.lastChild.appendChild(desc);
    const control = el('div', { class: 'setting-item-control' });
    let input;
    if (type === 'toggle') {
      input = el('div', { class: 'checkbox-container' + (value ? ' is-enabled' : ''), role: 'switch', 'aria-checked': String(!!value), tabindex: '0', 'aria-label': name }, el('input', { type: 'checkbox', tabindex: '-1', checked: value ? true : null }));
      const flip = () => { const v = !input.classList.contains('is-enabled'); input.classList.toggle('is-enabled', v); input.setAttribute('aria-checked', String(v)); input.querySelector('input').checked = v; onChange?.(v); };
      input.addEventListener('click', (e) => { e.preventDefault(); flip(); });
      input.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
      control.appendChild(input);
    } else if (type === 'dropdown') {
      input = el('select', { class: 'dropdown', 'aria-label': name });
      for (const [v, label] of options) input.appendChild(el('option', { value: v, selected: String(v) === String(value) ? true : null }, label));
      input.addEventListener('change', () => onChange?.(input.value));
      control.appendChild(input);
    } else if (type === 'slider') {
      input = el('input', { type: 'range', class: 'slider', min, max, step, value, 'aria-label': name });
      const val = el('span', { class: 'slider-value' }, String(value));
      input.addEventListener('input', () => { val.textContent = input.value; onChange?.(Number(input.value)); });
      control.append(input, val);
    } else if (type === 'number') {
      input = el('input', { type: 'number', min, max, step: step || 1, value, 'aria-label': name, placeholder });
      input.addEventListener('change', () => { let v = Number(input.value); if (min != null) v = Math.max(min, v); if (max != null) v = Math.min(max, v); input.value = v; onChange?.(v); });
      control.appendChild(input);
    } else if (type === 'color') {
      input = el('input', { type: 'color', value: normalizeHex(value), 'aria-label': name });
      const text = el('input', { type: 'text', value, style: { width: '90px' }, 'aria-label': name + ' hex' });
      input.addEventListener('input', () => { text.value = input.value; onChange?.(input.value); });
      text.addEventListener('change', () => { if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text.value)) { input.value = normalizeHex(text.value); onChange?.(text.value); } });
      control.append(input, text);
    } else if (type === 'button') {
      input = el('button', { type: 'button', class: def.cta ? 'mod-cta' : def.warning ? 'mod-warning' : '' }, def.buttonText || 'Open');
      input.addEventListener('click', () => onChange?.());
      control.appendChild(input);
    } else if (type === 'custom') {
      control.appendChild(def.control);
    } else {
      input = el('input', { type: 'text', value: value ?? '', placeholder: placeholder || '', 'aria-label': name });
      input.addEventListener('change', () => onChange?.(input.value));
      control.appendChild(input);
    }
    if (def.extra) control.appendChild(def.extra);
    item.append(info, control);
    container.appendChild(item);
    return item;
  },
};
function normalizeHex(v) { if (!v) return '#000000'; if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + v.slice(1).split('').map((c) => c + c).join(''); return /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'; }

export class SettingsModal extends Modal {
  constructor(app, tab = 'general') {
    super({ cls: 'mod-settings mod-sidebar-layout' });
    this.app = app;
    this.titleEl.hidden = true;
    this.current = tab;
    this.nav = el('nav', { class: 'vertical-tab-header', 'aria-label': 'Settings sections' });
    this.content = el('div', { class: 'vertical-tab-content', role: 'tabpanel' });
    this.contentEl.className = 'vertical-tab-content-container';
    this.contentEl.appendChild(this.content);
    this.modalEl.insertBefore(this.nav, this.contentEl);
    this.modalEl.setAttribute('aria-label', 'Settings');
    this._unsub = [app.commands.on(() => { if (this.current === 'hotkeys' && !this._recording) this.show('hotkeys'); }), app.plugins.on(() => this.renderNav())];
  }
  onClose() { this._unsub.forEach((f) => f()); }
  onOpen() { this.renderNav(); this.show(this.current); }

  tabs() {
    const s = (id, name, ic) => ({ id, name, icon: ic, group: 'Options' });
    const list = [s('general', 'General', 'settings'), s('editor', 'Editor', 'pencil-line'), s('files', 'Files & Links', 'link'), s('appearance', 'Appearance', 'palette'), s('hotkeys', 'Hotkeys', 'keyboard'), s('core-plugins', 'Core plugins', 'layers'), s('community-plugins', 'Community plugins', 'puzzle'), s('about', 'About', 'info'),
      { id: 'mindmap', name: 'Mind Map', icon: 'mindmap', group: 'Plugin options' }];
    for (const t of this.app.plugins.settingTabs) list.push({ id: 'plugin:' + t.id, name: t.name, icon: 'puzzle', group: 'Plugin options', render: t.render });
    return list;
  }
  renderNav() {
    clear(this.nav);
    const groups = new Map();
    for (const t of this.tabs()) { if (!groups.has(t.group)) groups.set(t.group, []); groups.get(t.group).push(t); }
    for (const [g, tabs] of groups) {
      const box = el('div', { class: 'vertical-tab-header-group' }, el('div', { class: 'vertical-tab-header-group-title' }, g));
      const items = el('div', { class: 'vertical-tab-header-group-items', role: 'tablist' });
      for (const t of tabs) {
        const b = el('button', { class: 'vertical-tab-nav-item' + (t.id === this.current ? ' is-active' : ''), type: 'button', role: 'tab', dataset: { tab: t.id }, 'aria-selected': String(t.id === this.current) }, icon(t.icon, { size: 16 }), t.name);
        b.addEventListener('click', () => this.show(t.id));
        items.appendChild(b);
      }
      box.appendChild(items);
      this.nav.appendChild(box);
    }
  }
  show(id) {
    this.current = id;
    this.nav.querySelectorAll('.vertical-tab-nav-item').forEach((b) => { b.classList.toggle('is-active', b.dataset.tab === id); b.setAttribute('aria-selected', String(b.dataset.tab === id)); });
    clear(this.content);
    const tab = this.tabs().find((t) => t.id === id);
    if (!tab) return;
    if (tab.render) { try { tab.render(this.content, settingUI); } catch (e) { this.content.appendChild(el('div', { class: 'mod-error-text' }, `Plugin settings failed: ${e.message}`)); } return; }
    this['render_' + id.replace(/-/g, '_')]?.(this.content);
    this.content.scrollTop = 0;
  }

  schemaSection(container, section, { title } = {}) {
    if (title) settingUI.heading(container, title);
    for (const entry of this.app.settings.schemaFor(section)) this.schemaItem(container, entry);
  }
  schemaItem(container, entry) {
    const s = this.app.settings;
    const item = settingUI.setting(container, { name: entry.name, desc: entry.desc, type: entry.type, value: s.get(entry.key), options: entry.options, min: entry.min, max: entry.max, step: entry.step, placeholder: entry.placeholder, onChange: (v) => s.set(entry.key, v) });
    if (s.has(entry.key) && JSON.stringify(s.get(entry.key)) !== JSON.stringify(entry.default)) {
      const reset = el('button', { class: 'clickable-icon extra-setting-button', type: 'button', 'aria-label': 'Restore default' }, icon('rotate-ccw', { size: 14 }));
      reset.addEventListener('click', () => { s.reset(entry.key); this.show(this.current); });
      item.querySelector('.setting-item-control').appendChild(reset);
    }
    return item;
  }

  render_general(c) {
    settingUI.heading(c, 'General');
    this.schemaSection(c, 'options');
    settingUI.heading(c, 'Vault');
    const st = this.app.store;
    settingUI.setting(c, { name: 'Current vault', desc: `${st.name} · ${st.listNotes().length} files · ${st.mode === 'local' ? 'stored in this browser (localStorage)' : st.mode === 'fs' ? 'folder on disk (read/write)' : 'folder on disk (read-only import)'}`, type: 'button', buttonText: 'Open folder...', onChange: () => { this.close(); this.app.openFolder(); } });
    settingUI.setting(c, { name: 'Sample vault', desc: 'Replace the current vault with the bundled sample notes.', type: 'button', buttonText: 'Load sample', onChange: () => { this.close(); this.app.loadSampleVault(); } });
    settingUI.setting(c, { name: 'Export vault', desc: 'Download every note as a single JSON file (backup).', type: 'button', buttonText: 'Download JSON', onChange: () => this.app.exportVault() });
    settingUI.setting(c, { name: 'Tutorial', desc: 'Replay the interactive onboarding tour.', type: 'button', buttonText: 'Start tutorial', onChange: () => { this.close(); this.app.startOnboarding(); } });
    settingUI.setting(c, { name: 'Reset all settings', desc: 'Restore every setting, hotkey and plugin toggle to its default.', type: 'button', buttonText: 'Reset', warning: true, onChange: async () => { if (await confirmModal({ title: 'Reset all settings?', cta: 'Reset', warning: true })) { this.app.settings.resetAll(); this.show(this.current); } } });
  }
  render_editor(c) { settingUI.heading(c, 'Editor'); this.schemaSection(c, 'editor'); }
  render_files(c) { settingUI.heading(c, 'Files & Links'); this.schemaSection(c, 'files'); }
  render_appearance(c) {
    settingUI.heading(c, 'Appearance');
    const s = this.app.settings;
    for (const entry of s.schemaFor('appearance')) {
      if (entry.key === 'accent') {
        const sw = el('div', { class: 'settings-accent-swatches', role: 'group', 'aria-label': 'Accent presets' });
        for (const a of ACCENTS) { const b = el('button', { type: 'button', 'aria-label': `Accent ${a}`, class: s.get('accent') === a ? 'is-active' : '', style: { background: a } }); b.addEventListener('click', () => { s.set('accent', a); this.show('appearance'); }); sw.appendChild(b); }
        const item = this.schemaItem(c, entry);
        item.querySelector('.setting-item-control').prepend(sw);
      } else this.schemaItem(c, entry);
    }
  }
  render_hotkeys(c) {
    settingUI.heading(c, 'Hotkeys');
    const search = el('input', { type: 'search', placeholder: 'Filter commands...', 'aria-label': 'Filter commands', value: this._hotkeyFilter || '' });
    const list = el('div', { role: 'list' });
    const restoreAll = el('button', { type: 'button' }, 'Restore defaults');
    restoreAll.addEventListener('click', async () => { if (await confirmModal({ title: 'Restore all default hotkeys?', cta: 'Restore' })) { this.app.commands.overrides = {}; this.app.settings.set('hotkeys', {}); this.app.commands._rebuild(); this.show('hotkeys'); } });
    c.append(el('div', { class: 'hotkey-search-row' }, search, restoreAll), list);
    const render = () => {
      clear(list);
      const q = (this._hotkeyFilter = search.value.trim().toLowerCase());
      const cmds = this.app.commands.list().filter((cmd) => !q || cmd.name.toLowerCase().includes(q) || cmd.hotkeys.some((h) => formatHotkey(h).toLowerCase().includes(q)));
      if (!cmds.length) list.appendChild(el('div', { class: 'search-empty-state' }, 'No commands match.'));
      for (const cmd of cmds) list.appendChild(this.hotkeyRow(cmd));
    };
    search.addEventListener('input', render);
    render();
    requestAnimationFrame(() => search.focus());
  }
  hotkeyRow(cmd) {
    const commands = this.app.commands;
    const control = el('div', { class: 'setting-item-control', style: { flexWrap: 'wrap' } });
    for (const hk of cmd.hotkeys) {
      const conflict = commands.conflict(hk, cmd.id);
      const chip = el('span', { class: 'setting-hotkey' + (conflict ? ' has-conflict' : ''), title: conflict ? `Also used by: ${commands.get(conflict)?.name}` : '' }, formatHotkey(hk));
      const del = el('button', { class: 'clickable-icon', type: 'button', 'aria-label': `Remove hotkey ${formatHotkey(hk)}` }, icon('x'));
      del.addEventListener('click', () => commands.setHotkey(cmd.id, cmd.hotkeys.filter((h) => hotkeyToString(h) !== hotkeyToString(hk))));
      chip.appendChild(del);
      control.appendChild(chip);
    }
    if (!cmd.hotkeys.length) control.appendChild(el('span', { class: 'setting-hotkey mod-empty' }, 'Blank'));
    const add = el('button', { class: 'clickable-icon', type: 'button', 'aria-label': `Customize hotkey for ${cmd.name}` }, icon('plus'));
    add.addEventListener('click', () => this.recordHotkey(cmd, add));
    control.appendChild(add);
    if (cmd.isCustom) { const r = el('button', { class: 'clickable-icon', type: 'button', 'aria-label': 'Restore default hotkey' }, icon('rotate-ccw')); r.addEventListener('click', () => commands.setHotkey(cmd.id, null)); control.appendChild(r); }
    return el('div', { class: 'setting-item', role: 'listitem' }, el('div', { class: 'setting-item-info' }, el('div', { class: 'setting-item-name' }, cmd.name), cmd.source !== 'app' ? el('div', { class: 'setting-item-description' }, `Plugin: ${cmd.source}`) : null), control);
  }
  recordHotkey(cmd, anchor) {
    const chip = el('span', { class: 'setting-hotkey mod-recording', role: 'status' }, 'Press hotkey…');
    anchor.replaceWith(chip);
    this._recording = true;
    const done = () => { this._recording = false; window.removeEventListener('keydown', onKey, true); this.show('hotkeys'); };
    const onKey = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) return done();
      const hk = hotkeyFromEvent(e);
      const existing = this.app.commands.getHotkeys(cmd.id);
      if (!existing.some((h) => hotkeyToString(h) === hotkeyToString(hk))) this.app.commands.setHotkey(cmd.id, [...existing, hk]);
      const other = this.app.commands.conflict(hk, cmd.id);
      if (other) this.app.notice(`${formatHotkey(hk)} is also used by "${this.app.commands.get(other)?.name}"`, 4000);
      done();
    };
    window.addEventListener('keydown', onKey, true);
  }
  render_core_plugins(c) {
    settingUI.heading(c, 'Core plugins', 'Built-in features. Disabled features are hidden from the ribbon and sidebars.');
    const core = this.app.settings.get('corePlugins') || {};
    for (const [id, name, desc] of CORE_PLUGINS) settingUI.setting(c, { name, desc, type: 'toggle', value: core[id] !== false, onChange: (v) => { const cur = this.app.settings.get('corePlugins') || {}; cur[id] = v; this.app.settings.set('corePlugins', cur); } });
  }
  render_community_plugins(c) {
    settingUI.heading(c, 'Community plugins', 'Plugins register through window.MindMap.registerPlugin(). Toggle them here; their settings appear under "Plugin options".');
    const list = el('div');
    const render = () => {
      clear(list);
      for (const p of this.app.plugins.list()) {
        const toggle = el('div', { class: 'checkbox-container' + (p.enabled ? ' is-enabled' : ''), role: 'switch', 'aria-checked': String(p.enabled), tabindex: '0', 'aria-label': `Enable ${p.name}` }, el('input', { type: 'checkbox', tabindex: '-1', checked: p.enabled ? true : null }));
        const flip = () => { this.app.plugins.toggle(p.id); render(); };
        toggle.addEventListener('click', (e) => { e.preventDefault(); flip(); });
        toggle.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
        list.appendChild(el('div', { class: 'plugin-card' }, el('div', { class: 'plugin-card-info' }, el('div', { class: 'plugin-card-name' }, p.name, el('span', { class: 'plugin-card-meta' }, `v${p.version} · ${p.author}`)), el('div', { class: 'plugin-card-desc' }, p.description)), toggle));
      }
    };
    render();
    c.appendChild(list);
    settingUI.heading(c, 'Plugin API');
    c.appendChild(el('pre', { class: 'settings-code' }, `window.MindMap.registerPlugin({
  id: 'hello', name: 'Hello', version: '1.0.0',
  onload(app) {
    app.addRibbonIcon('star', 'Say hello', () => app.notice('Hello!'));
    app.addCommand({ id: 'greet', name: 'Hello: Greet', hotkeys: [{ modifiers: ['Mod','Shift'], key: 'h' }], callback: () => app.notice('Hi') });
    app.addSettingTab({ id: 'hello', name: 'Hello', render(el, ui) { ui.setting(el, { name: 'Loud', type: 'toggle', value: true, onChange(v) {} }); } });
    app.on('file-open', ({ path }) => console.log('opened', path));
  },
  onunload() {},
});`));
  }
  render_about(c) {
    settingUI.heading(c, 'About');
    c.appendChild(el('div', { class: 'settings-about' }, el('p', {}, el('b', {}, 'Mind Map'), ' — a standalone clone of the Obsidian Mind Map plugin (markmap) with Graph view, Canvas and mind-map editing.'), el('p', {}, 'Plain ES modules and CSS, no build step, no dependencies. Notes live in this browser (localStorage) or in a folder you open with the File System Access API.'), el('p', {}, `Engine: ${this.app.engine?.MindMapView ? 'loaded' : 'not loaded'} · Vault: ${this.app.store.name} · ${this.app.store.listNotes().length} files`)));
  }
  render_mindmap(c) {
    settingUI.heading(c, 'Mind Map', 'Options of the Mind Map pane. Changes apply immediately to the open map.');
    this.schemaSection(c, 'mindmap');
    const reset = el('button', { type: 'button' }, 'Restore Mind Map defaults');
    reset.addEventListener('click', () => { for (const e of this.app.settings.schemaFor('mindmap')) this.app.settings.reset(e.key); this.show('mindmap'); });
    c.appendChild(el('div', { class: 'modal-button-container', style: { justifyContent: 'flex-start' } }, reset));
  }
}
