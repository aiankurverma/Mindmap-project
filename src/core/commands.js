// Commands — registry + hotkey dispatcher (Obsidian semantics; Mod = Cmd on Mac / Ctrl elsewhere).

export const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);

const MOD_ORDER = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'];
const KEY_ALIASES = {
  ' ': 'Space', esc: 'Escape', escape: 'Escape', return: 'Enter', enter: 'Enter', tab: 'Tab', backspace: 'Backspace',
  delete: 'Delete', del: 'Delete', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
  left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', home: 'Home', end: 'End', pageup: 'PageUp',
  pagedown: 'PageDown', ',': ',', '.': '.', '/': '/', '\\': '\\', '[': '[', ']': ']', '-': '-', '=': '=', '`': '`', ';': ';', "'": "'",
};

export function normalizeKey(key) {
  if (!key) return '';
  const lower = String(key).toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (/^f\d{1,2}$/.test(lower)) return lower.toUpperCase();
  if (lower.length === 1) return lower;
  return key.length === 1 ? key.toLowerCase() : key.charAt(0).toUpperCase() + key.slice(1);
}

/** Canonical string form: "Mod+Shift+p". */
export function hotkeyToString(hk) {
  if (!hk) return '';
  const mods = [...new Set((hk.modifiers || []).map(canonMod))].sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b));
  return [...mods, normalizeKey(hk.key)].join('+');
}
function canonMod(m) {
  const l = String(m).toLowerCase();
  if (l === 'mod' || l === 'cmd' && IS_MAC || l === 'command') return IS_MAC ? 'Mod' : (l === 'mod' ? 'Mod' : 'Meta');
  if (l === 'ctrl' || l === 'control') return IS_MAC ? 'Ctrl' : 'Mod';
  if (l === 'meta' || l === 'cmd' || l === 'win' || l === 'super') return IS_MAC ? 'Mod' : 'Meta';
  if (l === 'alt' || l === 'option') return 'Alt';
  if (l === 'shift') return 'Shift';
  return m;
}

/** Human readable: Mac "⌘⇧P", others "Ctrl + Shift + P". */
export function formatHotkey(hk) {
  if (!hk) return '';
  const mods = [...new Set((hk.modifiers || []).map(canonMod))].sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b));
  const key = normalizeKey(hk.key);
  const keyLabel = ({ ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: IS_MAC ? '↵' : 'Enter', Escape: 'Esc', Space: 'Space', Backspace: IS_MAC ? '⌫' : 'Backspace', Delete: IS_MAC ? '⌦' : 'Delete', Tab: IS_MAC ? '⇥' : 'Tab' })[key] || (key.length === 1 ? key.toUpperCase() : key);
  if (IS_MAC) {
    const sym = { Mod: '⌘', Ctrl: '⌃', Meta: '⌘', Alt: '⌥', Shift: '⇧' };
    return mods.map((m) => sym[m]).join('') + keyLabel;
  }
  const names = { Mod: 'Ctrl', Ctrl: 'Ctrl', Meta: 'Win', Alt: 'Alt', Shift: 'Shift' };
  return [...mods.map((m) => names[m]), keyLabel].join(' + ');
}

/** Build a hotkey object from a KeyboardEvent (Mod folds into the platform modifier). */
export function hotkeyFromEvent(e) {
  const modifiers = [];
  if (IS_MAC) { if (e.metaKey) modifiers.push('Mod'); if (e.ctrlKey) modifiers.push('Ctrl'); }
  else { if (e.ctrlKey) modifiers.push('Mod'); if (e.metaKey) modifiers.push('Meta'); }
  if (e.altKey) modifiers.push('Alt');
  if (e.shiftKey) modifiers.push('Shift');
  let key = e.key;
  if (key === 'Dead' || key === 'Unidentified' || key === 'Process') key = e.code.replace(/^Key|^Digit/, '');
  // With Alt/Shift on Mac e.key can become a symbol; prefer physical code for letters/digits.
  if ((e.altKey || (e.shiftKey && (e.metaKey || e.ctrlKey))) && /^(Key|Digit)/.test(e.code)) key = e.code.replace(/^Key|^Digit/, '').toLowerCase();
  return { modifiers, key: normalizeKey(key) };
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'OS']);

export class Commands {
  constructor(settings) {
    this.settings = settings;
    this.commands = new Map();
    this.overrides = settings ? { ...(settings.get('hotkeys') || {}) } : {};
    this._byHotkey = new Map();
    this._listeners = new Set();
    this._keyHandler = (e) => this.handleKey(e);
    this.enabled = true;
    this.scopeCheck = null; // (e) => boolean; return false to skip global handling
    window.addEventListener('keydown', this._keyHandler, true);
  }

  register(def) {
    if (!def || !def.id) throw new Error('Command needs an id');
    const cmd = {
      id: def.id, name: def.name || def.id, icon: def.icon || null, hotkeys: (def.hotkeys || []).map(cloneHk),
      callback: def.callback || null, checkCallback: def.checkCallback || null, editorCallback: def.editorCallback || null,
      source: def.source || 'app',
    };
    this.commands.set(cmd.id, cmd);
    this._rebuild();
    this._emit();
    return () => this.unregister(cmd.id);
  }

  unregister(id) { if (this.commands.delete(id)) { this._rebuild(); this._emit(); } }

  get(id) { return this.commands.get(id) || null; }
  list() { return [...this.commands.values()].map((c) => ({ ...c, hotkeys: this.getHotkeys(c.id), defaultHotkeys: c.hotkeys.map(cloneHk), isCustom: Object.prototype.hasOwnProperty.call(this.overrides, c.id) })).sort((a, b) => a.name.localeCompare(b.name)); }

  getHotkeys(id) {
    if (Object.prototype.hasOwnProperty.call(this.overrides, id)) return (this.overrides[id] || []).map(cloneHk);
    return (this.commands.get(id)?.hotkeys || []).map(cloneHk);
  }

  /** Set custom hotkeys (array or single). null restores the default. */
  setHotkey(id, hotkey) {
    if (hotkey === null || hotkey === undefined) delete this.overrides[id];
    else this.overrides[id] = (Array.isArray(hotkey) ? hotkey : [hotkey]).map(cloneHk);
    this.settings?.set('hotkeys', this.overrides);
    this._rebuild();
    this._emit();
  }

  /** Which command already uses this hotkey (for conflict display). */
  conflict(hotkey, exceptId) {
    const s = hotkeyToString(hotkey);
    const ids = this._byHotkey.get(s) || [];
    return ids.find((x) => x !== exceptId) || null;
  }

  isAvailable(id) {
    const c = this.commands.get(id);
    if (!c) return false;
    if (c.checkCallback) { try { return c.checkCallback(true) !== false; } catch { return false; } }
    return true;
  }

  execute(id, ...args) {
    const c = this.commands.get(id);
    if (!c) return false;
    try {
      if (c.checkCallback) { const r = c.checkCallback(false, ...args); return r !== false; }
      if (c.callback) { c.callback(...args); return true; }
    } catch (err) { console.error(`Command ${id} failed`, err); }
    return false;
  }

  handleKey(e) {
    if (!this.enabled || e.defaultPrevented) return;
    if (MODIFIER_KEYS.has(e.key)) return;
    if (this.scopeCheck && this.scopeCheck(e) === false) return;
    const hk = hotkeyFromEvent(e);
    const s = hotkeyToString(hk);
    const ids = this._byHotkey.get(s);
    if (!ids || !ids.length) return;
    // Inside text inputs, hotkeys without modifiers (except function keys / Escape) are left to the input.
    const inText = isTextTarget(e.target);
    if (inText && hk.modifiers.length === 0 && !/^F\d/.test(hk.key) && hk.key !== 'Escape') return;
    if (inText && hk.modifiers.length === 1 && hk.modifiers[0] === 'Shift') return;
    for (const id of ids) {
      const c = this.commands.get(id);
      if (!c) continue;
      if (c.checkCallback) {
        const ok = c.checkCallback(true);
        if (ok === false) continue;
      }
      e.preventDefault();
      e.stopPropagation();
      this.execute(id);
      return;
    }
  }

  on(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  _emit() { for (const cb of this._listeners) { try { cb(); } catch (err) { console.error(err); } } }

  _rebuild() {
    this._byHotkey = new Map();
    for (const c of this.commands.values()) {
      for (const hk of this.getHotkeys(c.id)) {
        const s = hotkeyToString(hk);
        if (!s) continue;
        if (!this._byHotkey.has(s)) this._byHotkey.set(s, []);
        this._byHotkey.get(s).push(c.id);
      }
    }
  }

  destroy() { window.removeEventListener('keydown', this._keyHandler, true); }
}

export function isTextTarget(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') return !/^(button|checkbox|radio|range|color|file|submit|reset)$/i.test(el.type || 'text');
  return !!el.isContentEditable;
}

function cloneHk(hk) { return { modifiers: [...(hk.modifiers || [])], key: hk.key }; }
