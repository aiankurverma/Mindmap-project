// Plugin system — window.MindMap.registerPlugin({id,name,version,onload(app),onunload}) with two bundled plugins.
// Enabled plugins persist in settings 'enabledPlugins'; per-plugin data in 'pluginData'.

export class PluginManager {
  constructor(app) {
    this.app = app;
    this.plugins = new Map(); // id -> {def, api, loaded}
    this.settingTabs = [];     // {pluginId, id, name, render}
    this._listeners = new Set();
    window.MindMap = {
      version: '1.0.0',
      registerPlugin: (def) => this.register(def),
      get app() { return app; },
      get plugins() { return [...app.plugins.plugins.keys()]; },
    };
  }

  register(def) {
    if (!def || !def.id) throw new Error('Plugin needs an id');
    if (this.plugins.has(def.id)) this.disable(def.id, { persist: false });
    this.plugins.set(def.id, { def, api: null, loaded: false });
    if (this.isEnabled(def.id)) this._load(def.id);
    this._emit();
    return def.id;
  }

  list() {
    return [...this.plugins.values()].map(({ def, loaded }) => ({
      id: def.id, name: def.name || def.id, version: def.version || '0.0.0', description: def.description || '', author: def.author || '', enabled: loaded,
    }));
  }

  isEnabled(id) { return (this.app.settings.get('enabledPlugins') || []).includes(id); }

  enable(id) {
    const list = new Set(this.app.settings.get('enabledPlugins') || []);
    list.add(id);
    this.app.settings.set('enabledPlugins', [...list]);
    this._load(id);
    this._emit();
  }

  disable(id, { persist = true } = {}) {
    const p = this.plugins.get(id);
    if (p && p.loaded) {
      try { p.def.onunload?.(p.api); } catch (e) { console.error(`Plugin ${id} onunload failed`, e); }
      p.api?._dispose();
      p.api = null; p.loaded = false;
    }
    if (persist) {
      const list = new Set(this.app.settings.get('enabledPlugins') || []);
      list.delete(id);
      this.app.settings.set('enabledPlugins', [...list]);
    }
    this.settingTabs = this.settingTabs.filter((t) => t.pluginId !== id);
    this._emit();
  }

  toggle(id) { this.isEnabled(id) ? this.disable(id) : this.enable(id); }

  _load(id) {
    const p = this.plugins.get(id);
    if (!p || p.loaded) return;
    p.api = createPluginApi(this, id);
    try { p.def.onload?.(p.api); p.loaded = true; }
    catch (e) { console.error(`Plugin ${id} failed to load`, e); p.api._dispose(); p.api = null; this.app.notice?.(`Plugin "${p.def.name || id}" failed to load: ${e.message}`); }
  }

  on(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  _emit() { for (const cb of this._listeners) { try { cb(); } catch (e) { console.error(e); } } }

  loadBundled() { for (const def of BUNDLED_PLUGINS) this.register(def); }
}

function createPluginApi(manager, pluginId) {
  const app = manager.app;
  const disposers = [];
  const api = {
    id: pluginId,
    store: app.store, links: app.links, settings: app.settings, commands: app.commands, workspace: app.workspace, history: app.history,
    get views() { return app.workspace?.views || {}; },
    notice: (msg, timeout) => app.notice(msg, timeout),
    addRibbonIcon(icon, title, cb) { const el = app.workspace.addRibbonIcon(icon, title, cb); disposers.push(() => el.remove()); return el; },
    addCommand(def) { const off = app.commands.register({ ...def, id: def.id.includes(':') ? def.id : `${pluginId}:${def.id}`, source: pluginId }); disposers.push(off); return off; },
    addSettingTab(tab) { const entry = { pluginId, id: tab.id || pluginId, name: tab.name || pluginId, render: tab.render }; manager.settingTabs.push(entry); disposers.push(() => { manager.settingTabs = manager.settingTabs.filter((t) => t !== entry); }); manager._emit(); },
    addStatusBarItem() { const el = app.workspace.addStatusBarItem(); disposers.push(() => el.remove()); return el; },
    registerView(type, factory) { const off = app.workspace.registerView(type, factory); disposers.push(off); return off; },
    on(event, cb) { const off = app.workspace.on(event, cb); disposers.push(off); return off; },
    register(disposer) { disposers.push(disposer); },
    getData() { return (app.settings.get('pluginData') || {})[pluginId] || {}; },
    saveData(data) { const all = app.settings.get('pluginData') || {}; all[pluginId] = data; app.settings.set('pluginData', all); },
    _dispose() { while (disposers.length) { try { disposers.pop()(); } catch (e) { console.error(e); } } },
  };
  return api;
}

// ── Bundled example plugins ──────────────────────────────────────────

const PALETTES = {
  obsidian: ['#7f6df2', '#e05252', '#e9973f', '#e0de71', '#5fb24a', '#53dfdd', '#3f9ce0', '#c95cd6', '#fe7e79', '#4fd6a2'],
  pastel: ['#a5b4fc', '#fca5a5', '#fdba74', '#fde68a', '#bef264', '#99f6e4', '#93c5fd', '#f0abfc', '#fda4af', '#a7f3d0'],
  vivid: ['#6366f1', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#d946ef', '#f43f5e', '#10b981'],
};

export const BUNDLED_PLUGINS = [
  {
    id: 'word-count-badge', name: 'Word Count Badge', version: '1.2.0', author: 'Bundled',
    description: 'Shows reading time and word count for the active note in the status bar and as a badge in the Mind Map pane header.',
    onload(app) {
      const data = Object.assign({ wpm: 200, showBadge: true }, app.getData());
      const item = app.addStatusBarItem();
      item.classList.add('plugin-word-count');
      item.setAttribute('aria-label', 'Estimated reading time');
      const badge = document.createElement('span');
      badge.className = 'mm-header-badge plugin-word-count-badge';
      const update = () => {
        const note = app.workspace.getActiveNote?.();
        if (!note || note.ext !== 'md') { item.textContent = ''; badge.textContent = ''; badge.remove(); return; }
        const words = (note.content.match(/\S+/g) || []).length;
        const mins = Math.max(1, Math.round(words / (data.wpm || 200)));
        item.textContent = `~${mins} min read`;
        badge.textContent = `${words} words`;
        const host = app.workspace.getMindMapHeaderSlot?.();
        if (data.showBadge && host && !badge.isConnected) host.appendChild(badge);
        if (!data.showBadge) badge.remove();
      };
      app.on('file-open', update); app.on('file-change', update); app.on('active-leaf-change', update); app.on('layout-change', update);
      app.register(() => badge.remove());
      update();
      app.addSettingTab({
        id: 'word-count-badge', name: 'Word Count Badge',
        render(container, ui) {
          ui.heading(container, 'Word Count Badge');
          ui.setting(container, { name: 'Words per minute', desc: 'Reading speed used to estimate reading time.', type: 'number', value: data.wpm, min: 50, max: 1000,
            onChange: (v) => { data.wpm = Number(v) || 200; app.saveData(data); update(); } });
          ui.setting(container, { name: 'Show badge in Mind Map header', desc: 'Display the word count next to the map title.', type: 'toggle', value: data.showBadge,
            onChange: (v) => { data.showBadge = !!v; app.saveData(data); update(); } });
        },
      });
      app.addCommand({ id: 'show-stats', name: 'Word Count Badge: Show note statistics', callback: () => {
        const note = app.workspace.getActiveNote?.();
        if (!note) return app.notice('No active note');
        const words = (note.content.match(/\S+/g) || []).length;
        app.notice(`${note.name}: ${words} words, ${note.content.length} characters, ${note.content.split('\n').length} lines`);
      } });
    },
  },
  {
    id: 'auto-color-by-tag', name: 'Auto Color by Tag', version: '1.0.3', author: 'Bundled',
    description: 'Assigns a color to every tag in the vault and colors mind map nodes and links by their tags (uses the colorByTag option).',
    onload(app) {
      const data = Object.assign({ palette: 'obsidian', maxTags: 10 }, app.getData());
      const recolor = () => {
        const tags = app.links.tags().filter((t) => !t.tag.includes('/') || true).sort((a, b) => b.count - a.count).slice(0, data.maxTags);
        const palette = PALETTES[data.palette] || PALETTES.obsidian;
        const map = {};
        tags.forEach((t, i) => { map[t.tag] = palette[i % palette.length]; });
        app.settings.set('colorByTag', map);
      };
      const off = app.links.on('rebuild', recolor);
      const off2 = app.links.on('change', recolor);
      app.register(off); app.register(off2);
      app.register(() => app.settings.set('colorByTag', {}));
      recolor();
      app.addCommand({ id: 'recolor', name: 'Auto Color by Tag: Recolor now', callback: () => { recolor(); app.notice('Tag colors refreshed'); } });
      app.addSettingTab({
        id: 'auto-color-by-tag', name: 'Auto Color by Tag',
        render(container, ui) {
          ui.heading(container, 'Auto Color by Tag');
          ui.setting(container, { name: 'Palette', desc: 'Color palette used for tags.', type: 'dropdown', value: data.palette, options: [['obsidian', 'Obsidian'], ['pastel', 'Pastel'], ['vivid', 'Vivid']],
            onChange: (v) => { data.palette = v; app.saveData(data); recolor(); } });
          ui.setting(container, { name: 'Maximum tags', desc: 'Only the most used tags get a color.', type: 'slider', value: data.maxTags, min: 1, max: 30, step: 1,
            onChange: (v) => { data.maxTags = Number(v); app.saveData(data); recolor(); } });
          const map = app.settings.get('colorByTag') || {};
          const list = document.createElement('div');
          list.className = 'plugin-tag-colors';
          for (const [tag, color] of Object.entries(map)) {
            const chip = document.createElement('span');
            chip.className = 'tag-chip';
            chip.innerHTML = `<i style="background:${color}"></i>${tag}`;
            list.appendChild(chip);
          }
          container.appendChild(list);
        },
      });
    },
  },
];
