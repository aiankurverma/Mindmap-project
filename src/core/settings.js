// Settings — persisted app + Mind Map plugin options (localStorage 'mindmap.settings').
// Schema entries drive the Settings modal (type/name/desc/section).

export const SECTIONS = {
  options: 'Options',
  editor: 'Editor',
  files: 'Files & Links',
  appearance: 'Appearance',
  mindmap: 'Mind Map',
};

/** Keys that are forwarded verbatim to MindMapView.setOptions(). */
export const MINDMAP_OPTION_KEYS = [
  'splitDirection', 'direction', 'nodeMinHeight', 'lineHeight', 'spacingVertical', 'spacingHorizontal', 'paddingX',
  'color1', 'color1Thickness', 'color2', 'color2Thickness', 'color3', 'color3Thickness',
  'defaultColor', 'defaultColorThickness', 'colorFreezeLevel', 'initialExpandLevel', 'animationDuration',
  'fontSize', 'highlight', 'useThemeFont', 'lineStyle', 'nodeShape', 'colorByTag', 'showBadges', 'editable', 'virtualize',
];

export const SETTINGS_SCHEMA = [
  // ── Options (general) ─────────────────────────────────────────────
  { key: 'autoRevealMindMap', default: false, type: 'toggle', section: 'options', name: 'Auto reveal Mind Map',
    desc: 'Open the Mind Map pane automatically when a note is opened. Off by default: open it on demand with the ribbon icon, the pane button, or Mod+M.' },
  { key: 'fileOpenView', default: 'ask', type: 'dropdown', section: 'options', name: 'Open notes as',
    desc: 'What clicking a note in the file explorer opens. "Ask" shows a small menu each time.',
    options: [['ask', 'Ask each time'], ['mindmap', 'Mind map only'], ['markdown', 'Markdown editor only'], ['both', 'Editor + mind map']] },
  { key: 'confirmDelete', default: true, type: 'toggle', section: 'options', name: 'Confirm file deletion',
    desc: 'Ask before deleting a note or folder.' },
  { key: 'showOnboarding', default: true, type: 'toggle', section: 'options', name: 'Show tutorial on first run',
    desc: 'Show the interactive tutorial the first time the app opens.' },
  // ── Editor ────────────────────────────────────────────────────────
  { key: 'showLineNumbers', default: true, type: 'toggle', section: 'editor', name: 'Show line number',
    desc: 'Show line numbers in the editor gutter.' },
  { key: 'readableLineLength', default: false, type: 'toggle', section: 'editor', name: 'Readable line length',
    desc: 'Limit maximum line length to make long notes easier to read.' },
  { key: 'spellcheck', default: true, type: 'toggle', section: 'editor', name: 'Spellcheck',
    desc: 'Underline misspelled words while typing.' },
  { key: 'vimMode', default: false, type: 'toggle', section: 'editor', name: 'Vim key bindings',
    desc: 'Enable Vim-style modal editing (normal / insert modes with h j k l, i, a, o, dd, u, x, gg, G, w, b, 0, $).' },
  { key: 'autoPairBrackets', default: true, type: 'toggle', section: 'editor', name: 'Auto pair brackets',
    desc: 'Automatically insert closing brackets and quotes.' },
  { key: 'smartIndentLists', default: true, type: 'toggle', section: 'editor', name: 'Smart indent lists',
    desc: 'Continue lists and check boxes on Enter; Tab and Shift+Tab indent list items.' },
  { key: 'defaultViewMode', default: 'source', type: 'dropdown', section: 'editor', name: 'Default view for new tabs',
    desc: 'Open notes in editing view or reading view.', options: [['source', 'Editing view'], ['preview', 'Reading view']] },
  // ── Files & Links ─────────────────────────────────────────────────
  { key: 'updateLinksOnRename', default: true, type: 'toggle', section: 'files', name: 'Automatically update internal links',
    desc: 'When a note is renamed or moved, update all [[wikilinks]] that point to it.' },
  { key: 'newNoteLocation', default: 'root', type: 'dropdown', section: 'files', name: 'Default location for new notes',
    desc: 'Where newly created notes are placed.', options: [['root', 'Vault folder'], ['current', 'Same folder as current file']] },
  { key: 'showUnreadBadges', default: true, type: 'toggle', section: 'files', name: 'Mark unread notes',
    desc: 'Show a dot next to notes you have not opened since they were last modified.' },
  { key: 'recentHours', default: 24, type: 'number', section: 'files', name: 'Recent threshold (hours)',
    desc: 'Notes modified within this window are marked as recent in the map and graph.', min: 1, max: 720 },
  { key: 'historyLimit', default: 40, type: 'number', section: 'files', name: 'Version history limit',
    desc: 'Maximum number of snapshots kept per note.', min: 5, max: 200 },
  // ── Appearance ────────────────────────────────────────────────────
  { key: 'theme', default: 'dark', type: 'dropdown', section: 'appearance', name: 'Base color scheme',
    desc: 'Choose the color scheme used by the app.', options: [['dark', 'Dark'], ['light', 'Light'], ['system', 'Adapt to system']] },
  { key: 'accent', default: '#7f6df2', type: 'color', section: 'appearance', name: 'Accent color',
    desc: 'Color used for links, buttons and highlights.' },
  { key: 'baseFontSize', default: 16, type: 'slider', section: 'appearance', name: 'Font size',
    desc: 'Font size in pixels used by the editor and reading view.', min: 10, max: 30, step: 1 },
  { key: 'interfaceFont', default: '', type: 'text', section: 'appearance', name: 'Interface font',
    desc: 'Font used for menus, sidebars and buttons. Leave empty for the system font.', placeholder: 'e.g. Inter' },
  { key: 'textFont', default: '', type: 'text', section: 'appearance', name: 'Text font',
    desc: 'Font used in the editor and reading view. Leave empty for the interface font.', placeholder: 'e.g. Georgia' },
  { key: 'monospaceFont', default: '', type: 'text', section: 'appearance', name: 'Monospace font',
    desc: 'Font used for code blocks and inline code.', placeholder: 'e.g. JetBrains Mono' },
  { key: 'showRibbon', default: true, type: 'toggle', section: 'appearance', name: 'Show ribbon',
    desc: 'Show the vertical icon bar on the left side of the window.' },
  { key: 'translucentSidebars', default: false, type: 'toggle', section: 'appearance', name: 'Translucent sidebars',
    desc: 'Blur the background behind sidebars when they overlay the main pane (small screens).' },
  { key: 'zoomLevel', default: 1, type: 'slider', section: 'appearance', name: 'Zoom level',
    desc: 'Scale the whole interface.', min: 0.8, max: 1.4, step: 0.05 },
  // ── Mind Map plugin ───────────────────────────────────────────────
  { key: 'splitDirection', default: 'horizontal', type: 'dropdown', section: 'mindmap', name: 'Preview split',
    desc: 'Split direction for the Mind Map pane relative to the editor.', options: [['horizontal', 'Horizontal (side by side)'], ['vertical', 'Vertical (stacked)']] },
  { key: 'direction', default: 'right', type: 'dropdown', section: 'mindmap', name: 'Layout direction',
    desc: 'Direction in which branches grow from the root node.', options: [['right', 'Right'], ['left', 'Left'], ['both', 'Both sides'], ['down', 'Down (tree)']] },
  { key: 'titleAsRootNode', default: true, type: 'toggle', section: 'mindmap', name: 'Use title as root node',
    desc: 'Use the note title (or frontmatter title) as the root of the map.' },
  { key: 'nodeMinHeight', default: 16, type: 'number', section: 'mindmap', name: 'Node min height',
    desc: 'Minimum height of a node in pixels.', min: 8, max: 100 },
  { key: 'lineHeight', default: '1em', type: 'text', section: 'mindmap', name: 'Node text line height',
    desc: 'Line height for node text (CSS value, e.g. 1em or 20px).' },
  { key: 'spacingVertical', default: 12, type: 'number', section: 'mindmap', name: 'Vertical spacing',
    desc: 'Vertical spacing between sibling nodes.', min: 0, max: 100 },
  { key: 'spacingHorizontal', default: 80, type: 'number', section: 'mindmap', name: 'Horizontal spacing',
    desc: 'Horizontal distance between a node and its children.', min: 10, max: 400 },
  { key: 'paddingX', default: 8, type: 'number', section: 'mindmap', name: 'Horizontal padding',
    desc: 'Padding inside each node.', min: 0, max: 60 },
  { key: 'color1', default: '#fed766', type: 'color', section: 'mindmap', name: 'Color 1',
    desc: 'Color for the first level of branches.' },
  { key: 'color1Thickness', default: '10', type: 'text', section: 'mindmap', name: 'Color 1 thickness',
    desc: 'Line thickness for the first level (px).' },
  { key: 'color2', default: '#2ab7ca', type: 'color', section: 'mindmap', name: 'Color 2',
    desc: 'Color for the second level of branches.' },
  { key: 'color2Thickness', default: '6', type: 'text', section: 'mindmap', name: 'Color 2 thickness',
    desc: 'Line thickness for the second level (px).' },
  { key: 'color3', default: '#fe4a49', type: 'color', section: 'mindmap', name: 'Color 3',
    desc: 'Color for the third level of branches.' },
  { key: 'color3Thickness', default: '4', type: 'text', section: 'mindmap', name: 'Color 3 thickness',
    desc: 'Line thickness for the third level (px).' },
  { key: 'defaultColor', default: '#000', default_light: '#000', type: 'color', section: 'mindmap', name: 'Default color',
    desc: 'Color for branches deeper than the third level.' },
  { key: 'defaultColorThickness', default: '2', type: 'text', section: 'mindmap', name: 'Default thickness',
    desc: 'Line thickness for deeper levels (px).' },
  { key: 'colorFreezeLevel', default: 0, type: 'number', section: 'mindmap', name: 'Color freeze level',
    desc: 'Freeze branch colors at this depth so children inherit their parent color. 0 disables freezing.', min: 0, max: 10 },
  { key: 'initialExpandLevel', default: -1, type: 'number', section: 'mindmap', name: 'Initial expand level',
    desc: 'Depth to which the map is expanded when opened. -1 expands everything.', min: -1, max: 10 },
  { key: 'animationDuration', default: 320, type: 'number', section: 'mindmap', name: 'Animation duration',
    desc: 'Duration of layout animations in milliseconds. 0 disables animation.', min: 0, max: 3000 },
  { key: 'fontSize', default: 16, type: 'number', section: 'mindmap', name: 'Font size',
    desc: 'Font size of node text in pixels.', min: 8, max: 48 },
  { key: 'highlight', default: true, type: 'toggle', section: 'mindmap', name: 'Highlight inline markdown',
    desc: 'Render bold, italic, code, links and tags inside nodes.' },
  { key: 'useThemeFont', default: false, type: 'toggle', section: 'mindmap', name: 'Use theme font',
    desc: 'Use the interface font for node text instead of the map font.' },
  { key: 'lineStyle', default: 'curved', type: 'dropdown', section: 'mindmap', name: 'Line style',
    desc: 'Shape of the links between nodes.', options: [['curved', 'Curved'], ['straight', 'Straight'], ['angled', 'Angled']] },
  { key: 'nodeShape', default: 'text', type: 'dropdown', section: 'mindmap', name: 'Node shape',
    desc: 'Shape drawn around node text.', options: [['text', 'Text only'], ['box', 'Box'], ['rounded', 'Rounded'], ['pill', 'Pill']] },
  { key: 'showBadges', default: true, type: 'toggle', section: 'mindmap', name: 'Show badges',
    desc: 'Show small badges for tasks, links, embeds, images and code on nodes.' },
  { key: 'editable', default: true, type: 'toggle', section: 'mindmap', name: 'Editable map',
    desc: 'Allow editing nodes directly in the map (Tab child, Enter sibling, F2 rename, drag to re-parent).' },
  { key: 'virtualize', default: true, type: 'toggle', section: 'mindmap', name: 'Virtualize large maps',
    desc: 'Only render nodes inside the viewport for very large maps (1000+ nodes).' },
  { key: 'screenshotBg', default: '#1e1e1e', type: 'color', section: 'mindmap', name: 'Screenshot background color',
    desc: 'Background color used for PNG exports and screenshots.' },
  { key: 'screenshotTextColor', default: '#dadada', type: 'color', section: 'mindmap', name: 'Screenshot text color',
    desc: 'Text color used for PNG exports and screenshots.' },
  { key: 'screenshotTransparent', default: false, type: 'toggle', section: 'mindmap', name: 'Transparent screenshot background',
    desc: 'Ignore the background color and export a transparent PNG.' },
  { key: 'screenshotScale', default: 2, type: 'slider', section: 'mindmap', name: 'Screenshot scale',
    desc: 'Pixel density multiplier for exported PNGs.', min: 1, max: 4, step: 0.5 },
  // hidden (no UI item) ────────────────────────────────────────────
  { key: 'colorByTag', default: {}, type: 'hidden', section: 'mindmap' },
  { key: 'hotkeys', default: {}, type: 'hidden', section: 'options' },
  { key: 'enabledPlugins', default: ['word-count-badge', 'auto-color-by-tag'], type: 'hidden', section: 'options' },
  { key: 'pluginData', default: {}, type: 'hidden', section: 'options' },
  { key: 'bookmarks', default: [], type: 'hidden', section: 'options' },
  { key: 'leftSidebarWidth', default: 300, type: 'hidden', section: 'options' },
  { key: 'rightSidebarWidth', default: 320, type: 'hidden', section: 'options' },
  { key: 'mindmapPaneSize', default: 0.5, type: 'hidden', section: 'options' },
  { key: 'leftSidebarCollapsed', default: false, type: 'hidden', section: 'options' },
  { key: 'rightSidebarCollapsed', default: false, type: 'hidden', section: 'options' },
  { key: 'graphSettings', default: {}, type: 'hidden', section: 'options' },
  { key: 'corePlugins', default: {}, type: 'hidden', section: 'options' },
  { key: 'onboarded', default: false, type: 'hidden', section: 'options' },
];

const ALIASES = { previewSplit: 'splitDirection' };

export class Settings {
  constructor(storageKey = 'mindmap.settings') {
    this.storageKey = storageKey;
    this.schema = SETTINGS_SCHEMA;
    this.defaults = {};
    for (const s of SETTINGS_SCHEMA) this.defaults[s.key] = clone(s.default);
    this.values = {};
    this._listeners = new Map();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') this.values = parsed;
      }
    } catch { this.values = {}; }
  }

  save() {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.values)); } catch { /* quota / private mode */ }
  }

  has(key) { return Object.prototype.hasOwnProperty.call(this.values, ALIASES[key] || key); }

  get(key) {
    key = ALIASES[key] || key;
    if (this.has(key)) return this.values[key];
    return clone(this.defaults[key]);
  }

  getAll() {
    const out = {};
    for (const k of Object.keys(this.defaults)) out[k] = this.get(k);
    return out;
  }

  set(key, value, { silent = false } = {}) {
    key = ALIASES[key] || key;
    const old = this.get(key);
    if (deepEqual(old, value)) return;
    this.values[key] = clone(value);
    this.save();
    if (!silent) this.emit('change', { key, value: clone(value), old });
  }

  reset(key) {
    key = ALIASES[key] || key;
    if (!this.has(key)) return;
    const old = this.get(key);
    delete this.values[key];
    this.save();
    this.emit('change', { key, value: this.get(key), old });
  }

  resetAll() {
    this.values = {};
    this.save();
    this.emit('change', { key: '*', value: this.getAll(), old: null });
  }

  /** Subset forwarded to MindMapView options. */
  mindmapOptions(theme) {
    const out = {};
    for (const k of MINDMAP_OPTION_KEYS) out[k] = this.get(k);
    if (theme) out.theme = theme;
    return out;
  }

  schemaFor(section) { return this.schema.filter((s) => s.section === section && s.type !== 'hidden'); }
  entry(key) { return this.schema.find((s) => s.key === (ALIASES[key] || key)); }

  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(cb);
    return () => this.off(event, cb);
  }
  off(event, cb) { this._listeners.get(event)?.delete(cb); }
  emit(event, payload) { for (const cb of this._listeners.get(event) || []) { try { cb(payload); } catch (e) { console.error(e); } } }
}

function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
function deepEqual(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return a === b; } }
