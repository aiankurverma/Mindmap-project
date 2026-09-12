// styles.js — CSS for the mind map SVG (injected once at runtime, inlined into SVG exports).
// All colors go through CSS variables with Obsidian-dark defaults so the map works standalone;
// the UI can override the variables from its theme stylesheet.

export const MM_VARS_DARK = {
  '--mm-bg': '#202020',
  '--mm-bg-secondary': '#161616',
  '--mm-text': '#dadada',
  '--mm-text-muted': '#999999',
  '--mm-text-faint': '#666666',
  '--mm-accent': '#7f6df2',
  '--mm-accent-hover': '#8a5cf5',
  '--mm-border': '#333333',
  '--mm-hover': 'rgba(255,255,255,.05)',
  '--mm-code-bg': 'rgba(255,255,255,.08)',
  '--mm-match': 'rgba(255,208,0,.28)',
  '--mm-tag-bg': 'rgba(127,109,242,.18)',
  '--mm-tag-text': '#a99bff',
  '--mm-focus': 'rgba(127,109,242,.55)',
  '--mm-important': '#e0b040',
  '--mm-recent': 'rgba(127,109,242,.12)',
};

export const MM_VARS_LIGHT = {
  '--mm-bg': '#ffffff',
  '--mm-bg-secondary': '#f6f6f6',
  '--mm-text': '#222222',
  '--mm-text-muted': '#5c5c5c',
  '--mm-text-faint': '#999999',
  '--mm-accent': '#7852ee',
  '--mm-accent-hover': '#6c46e5',
  '--mm-border': '#e0e0e0',
  '--mm-hover': 'rgba(0,0,0,.05)',
  '--mm-code-bg': 'rgba(0,0,0,.06)',
  '--mm-match': 'rgba(255,208,0,.45)',
  '--mm-tag-bg': 'rgba(120,82,238,.12)',
  '--mm-tag-text': '#6a48d7',
  '--mm-focus': 'rgba(120,82,238,.5)',
  '--mm-important': '#c78f00',
  '--mm-recent': 'rgba(120,82,238,.08)',
};

const varsBlock = (sel, vars) => `${sel}{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}`;

export const MM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif';
export const MM_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/** Styles that must travel with an exported SVG (everything scoped under .mm-svg). */
export const MM_SVG_CSS = `
.mm-svg{font-family:${MM_FONT};color:var(--mm-text);}
.mm-svg text{fill:var(--mm-text);}
.mm-fo{overflow:visible;}
.mm-fo>div{display:block;font-family:inherit;}
.mm-content{display:inline-block;box-sizing:border-box;white-space:nowrap;color:var(--mm-text);vertical-align:top;}
.mm-content.is-wrapped{white-space:normal;overflow-wrap:anywhere;}
.mm-content a{color:var(--mm-accent);text-decoration:none;cursor:pointer;}
.mm-content a:hover{text-decoration:underline;}
.mm-content a.tag{display:inline-block;background:var(--mm-tag-bg);color:var(--mm-tag-text);border-radius:1em;padding:0 .55em;font-size:.82em;line-height:1.5;vertical-align:middle;margin:0 1px;}
.mm-content code{font-family:${MM_MONO};font-size:.88em;background:var(--mm-code-bg);border-radius:4px;padding:.05em .3em;}
.mm-content mark{background:rgba(255,208,0,.35);color:inherit;border-radius:2px;padding:0 .1em;}
.mm-content strong{font-weight:600;}
.mm-content del{opacity:.6;}
.mm-content img{max-height:1.6em;vertical-align:middle;border-radius:3px;}
.mm-content .mm-embed{display:inline-block;background:var(--mm-code-bg);border:1px dashed var(--mm-text-faint);border-radius:4px;padding:0 .4em;font-size:.9em;color:var(--mm-text-muted);}
.mm-pre{margin:0;font-family:${MM_MONO};font-size:.85em;line-height:1.45;background:var(--mm-bg-secondary);border:1px solid var(--mm-border);border-radius:6px;padding:6px 10px;white-space:pre;color:var(--mm-text);}
.mm-pre code{background:none;padding:0;font-size:inherit;}
.mm-table{border-collapse:collapse;font-size:.9em;line-height:1.7;}
.mm-table th,.mm-table td{border:1px solid var(--mm-border);padding:0 8px;text-align:left;white-space:nowrap;}
.mm-table th{font-weight:600;background:var(--mm-hover);}
.mm-badges{display:inline-flex;align-items:center;gap:3px;margin-left:5px;vertical-align:middle;color:var(--mm-text-muted);}
.mm-badges .mm-icon{display:block;}
.mm-check{display:inline-block;width:1em;height:1em;margin-right:.4em;vertical-align:-.12em;color:var(--mm-text-muted);}
.mm-check.is-done{color:var(--mm-accent);}
.mm-node.is-done .mm-text{opacity:.55;text-decoration:line-through;}
.mm-important{color:var(--mm-important);margin-left:4px;vertical-align:-.1em;}
.mm-unread-dot{display:inline-block;width:.5em;height:.5em;border-radius:50%;background:var(--mm-accent);margin-right:.4em;vertical-align:.15em;}
.mm-node.is-recent .mm-content{background:var(--mm-recent);border-radius:4px;}
.mm-shape{fill:var(--mm-bg-secondary);stroke-width:1.5;}
.mm-node.is-shape-text .mm-shape{fill:transparent;stroke:none;}
.mm-underline{stroke-linecap:round;}
.mm-toggle{stroke-width:1.5;fill:var(--mm-bg);}
.mm-node.is-collapsed .mm-toggle{fill:currentColor;}
.mm-link{fill:none;stroke-linecap:round;}
.mm-node.is-dimmed{opacity:.22;}
.mm-link.is-dimmed{opacity:.15;}
.mm-node.is-match .mm-text{background:var(--mm-match);border-radius:3px;box-shadow:0 0 0 2px var(--mm-match);}
.mm-node.is-selected .mm-shape{stroke:var(--mm-accent)!important;stroke-width:2;}
.mm-node.is-selected.is-shape-text .mm-shape{fill:var(--mm-hover);stroke:var(--mm-accent)!important;}
.mm-node.is-selected .mm-underline{stroke:var(--mm-accent)!important;}
.mm-node.is-drop-target .mm-shape{fill:var(--mm-focus)!important;stroke:var(--mm-accent)!important;stroke-width:2;}
.mm-node.is-dragging{opacity:.4;}
.mm-node.is-drop-before .mm-content{box-shadow:0 -3px 0 0 var(--mm-accent);border-radius:2px;}
.mm-node.is-drop-after .mm-content{box-shadow:0 3px 0 0 var(--mm-accent);border-radius:2px;}
.mm-node.is-editing .mm-content{white-space:pre-wrap;}
`;

/** Interactive-only styles (container, cursor, focus, live region, ghost). */
export const MM_UI_CSS = `
${varsBlock('.mm-container,.mm-container.theme-dark', MM_VARS_DARK)}
${varsBlock('.mm-container.theme-light', MM_VARS_LIGHT)}
.mm-container{position:relative;width:100%;height:100%;min-height:120px;overflow:hidden;background:var(--mm-bg);color:var(--mm-text);font-family:${MM_FONT};font-size:14px;}
.mm-container.use-theme-font{font-family:inherit;}
.mm-viewport{will-change:transform;}
.mm-svg.is-panning{cursor:grabbing;}
.mm-svg{display:block;width:100%;height:100%;outline:none;cursor:grab;contain:layout paint;user-select:none;-webkit-user-select:none;touch-action:none;}
.mm-svg.is-panning{cursor:grabbing;}
.mm-svg:focus-visible{box-shadow:inset 0 0 0 2px var(--mm-focus);}
.mm-node{cursor:pointer;}
.mm-node .mm-shape:hover{fill:var(--mm-hover);}
.mm-toggle{cursor:pointer;}
.mm-toggle:hover{stroke-width:2.5;}
.mm-content[contenteditable]{outline:2px solid var(--mm-accent);outline-offset:1px;background:var(--mm-bg-secondary);border-radius:4px;min-width:2em;cursor:text;white-space:pre-wrap;}
.mm-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}
.mm-task{display:inline-flex;gap:3px;margin-left:6px;vertical-align:middle;}
.mm-task-chip{display:inline-flex;align-items:center;gap:3px;padding:0 5px;height:16px;border-radius:8px;font-size:10px;line-height:16px;white-space:nowrap;background:color-mix(in srgb,var(--mm-accent) 14%,transparent);color:var(--mm-text);border:1px solid color-mix(in srgb,var(--mm-accent) 35%,transparent);cursor:pointer;}
.mm-task-chip svg{opacity:.8;}
.mm-task.is-joined .mm-task-count{background:rgba(68,207,110,.2);border-color:rgba(68,207,110,.6);}
.mm-band{position:absolute;z-index:5;pointer-events:none;border:1px solid var(--mm-accent);background:color-mix(in srgb,var(--mm-accent) 14%,transparent);border-radius:2px;}
.mm-svg{cursor:default;}
.mm-svg.is-panning{cursor:grabbing!important;}
.mm-container.is-hand-tool .mm-svg{cursor:grab;}
.mm-container.is-select-tool .mm-svg{cursor:default;}
.mm-container.is-select-tool .mm-node,.mm-container.is-select-tool .mm-node .mm-content{cursor:grab;}
.mm-container.is-select-tool .mm-node.is-dragging{cursor:grabbing;}
.mm-container:not(.is-select-tool) .mm-node{cursor:grab;}
.mm-node.is-multi .mm-content{outline:1.5px dashed var(--mm-accent);outline-offset:2px;border-radius:3px;}
.mm-ghost{position:absolute;left:0;top:0;will-change:transform;pointer-events:none;z-index:5;padding:2px 8px;border-radius:6px;background:var(--mm-bg-secondary);border:1px solid var(--mm-accent);color:var(--mm-text);font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.4);opacity:.92;white-space:nowrap;}
.mm-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--mm-text-faint);font-size:13px;pointer-events:none;}
@media (prefers-reduced-motion: reduce){.mm-node,.mm-link{transition:none!important;}}
`;

export function svgVarsStyle(theme) {
  const vars = theme === 'light' ? MM_VARS_LIGHT : MM_VARS_DARK;
  return Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
}
