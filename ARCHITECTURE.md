# Mind Map (Obsidian clone) — architecture & module contract

Standalone web app, **no build step**: plain ES modules + CSS, served statically
(`python3 -m http.server 8090` from this folder, open http://localhost:8090). No npm
dependencies. Works in Chrome/Edge/Safari 16.4+/Firefox 113+ on Windows/Mac/Linux.

The app is a superset of the Obsidian "Mind Map" plugin (lynchjames/obsidian-mind-map,
markmap-based: headings + nested bullets of the *current note* become the map, one pane
to the right of the editor; commands "Preview the current note as Mind Map" and
"Copy screenshot"; settings: preview split, node min height, line height, color 1/2/3 +
thickness, default color/thickness, initial expand level, color freeze level, animation
duration, font size, highlight inline markdown, use theme font, screenshot size/colors)
plus the Obsidian Graph view (wikilinks/tags/backlinks across the vault) and Canvas
(JSON Canvas spec) and editing gestures from Enhancing Mind Map (Tab child, Enter sibling,
Delete, F2/dblclick edit, arrows navigate, drag to re-parent, undo/redo).

## Ownership (two builders, non-overlapping)

| Owner | Files |
|---|---|
| **ENGINE** | `src/core/markdown.js`, `src/mindmap/**` (layout, renderer, graph, canvas, interactions, utils), `src/core/exporters.js`, `src/core/importers.js`, `dev/engine-demo.html`, `dev/bigmap.js` (1000+ node generator), `test/engine.test.html` |
| **UI** | `index.html`, `src/main.js`, `src/core/store.js`, `src/core/links.js`, `src/core/history.js`, `src/core/commands.js`, `src/core/settings.js`, `src/core/plugins.js`, `src/ui/**`, `src/styles/**`, `src/data/sample-vault.js`, `README.md` |

Both sides import ONLY through the paths and signatures below. If something is missing,
add it on your own side and document it here (append, don't rewrite others' sections).

## Data model (shared)

```js
// Note (store)
{ path:'Folder/Note.md', name:'Note', folder:'Folder', content:string, ctime:number, mtime:number,
  unread:boolean, important:boolean /* frontmatter important: true or #important tag */ }

// Tree node (markdown.js output). `text` is raw inline markdown, `html` is sanitized HTML.
{ id:string /* stable: path-independent hash of ancestry+index */, depth:number /* root=0 */,
  type:'root'|'heading'|'list'|'paragraph'|'code'|'table',
  text:string, html:string, level:number /* heading level or list indent, 0 for root */,
  line:number /* 0-based start line in source */, endLine:number /* inclusive last line of the node's own text */,
  subtreeEndLine:number /* inclusive last line of node + descendants */,
  children:TreeNode[], collapsed:boolean, tags:string[] /* '#tag' */, links:string[] /* wikilink targets */,
  color?:string /* from `<!-- color: #hex -->` or `{color:#hex}` trailing marker */,
  badges:string[] /* 'todo','done','link','embed','image','code', … */,
  checked?:boolean /* - [ ] / - [x] */ }
```

## ENGINE exports

### `src/core/markdown.js`
```js
export function parseMarkdown(content, opts?) -> TreeNode              // opts: {rootText?:string, maxDepth?:number}
  // markmap semantics: frontmatter stripped; H1..H6 nest by level; list items (-,*,+,1.) nest by indent
  // under the nearest heading; paragraphs become leaf nodes; fenced code / tables become single nodes
  // (type 'code'/'table'); inline markdown rendered to `html` (bold, italic, code, links, [[wikilinks]],
  // #tags, ![[embeds]], images, strikethrough, highlight ==x==); root text = frontmatter title or opts.rootText.
export function extractLinks(content) -> { links:string[], embeds:string[], tags:string[], aliases:Record<string,string> }
  // wikilinks [[Note]], [[Note|alias]], [[Note#Heading]], [[Note^block]] (target = 'Note'); ![[embed]]; #tag and #nested/tag;
  // frontmatter `tags:` (array or csv) included; code spans/fences ignored.
export function parseFrontmatter(content) -> { data:object, body:string, raw:string }
export function renderInline(text) -> string   // sanitized HTML for one line of inline markdown
export function treeToMarkdown(tree) -> string  // headings for depth<=6 heading nodes, bullets for lists (round-trip of parseMarkdown output)
// Text-edit operations: pure functions that return the NEW markdown content
export function setNodeText(content, node, newText) -> string
export function insertChild(content, node, text?) -> string     // appends a child (heading→sub-heading if node is heading & level<6, else list item)
export function insertSibling(content, node, text?) -> string   // after `node`'s subtree, same type/level
export function deleteNode(content, node) -> string             // removes node + subtree
export function moveNode(content, node, newParent, index?) -> string // re-parent (adjusts heading levels / indents)
export function toggleCheck(content, node) -> string
export function findNodeById(tree, id) -> TreeNode|null
export function findNodeAtLine(tree, line) -> TreeNode|null
export function flattenTree(tree) -> TreeNode[]
```

### `src/mindmap/renderer.js` — `MindMapView`
```js
export class MindMapView {
  constructor(container:HTMLElement, options?:Partial<MindMapOptions>)
  setData(tree:TreeNode, {keepState?:boolean}={})   // re-layout with animation; keepState keeps collapse/transform by node id
  setOptions(partial)                                // any of MindMapOptions; re-render
  getOptions() -> MindMapOptions
  fit(padding?)  zoomIn()  zoomBy(k, center?)  zoomOut()  resetZoom()  centerNode(id)
  getTransform() -> {x,y,k}   setTransform({x,y,k}, animate?)
  expandAll() collapseAll() expandToLevel(n) toggleNode(id)
  select(id|null)  getSelection() -> id|null
  highlight(query:string|RegExp|null) -> number   // matches count; adds .is-match to nodes, dims others when query set
  navigate('up'|'down'|'left'|'right')             // keyboard navigation of selection
  startEdit(id)  /* inline contenteditable; emits node:edit on commit */  cancelEdit()
  getSVG() -> SVGSVGElement   getStats() -> {nodes, visible, renderMs}
  on(event, cb) -> unsubscribe   off(event, cb)   destroy()
}
// MindMapOptions (defaults match the Obsidian plugin):
{ splitDirection:'horizontal'|'vertical', direction:'right'|'left'|'both'|'down' /* layout */,
  nodeMinHeight:16, lineHeight:'1em', spacingVertical:5, spacingHorizontal:80, paddingX:8,
  color1:'#fed766', color1Thickness:'10', color2:'#2ab7ca', color2Thickness:'6', color3:'#fe4a49', color3Thickness:'4',
  defaultColor:'#000', defaultColorThickness:'2', colorFreezeLevel:0, initialExpandLevel:-1 /* -1 = all */,
  animationDuration:500, fontSize:16, highlight:true, useThemeFont:false,
  lineStyle:'curved'|'straight'|'angled', nodeShape:'text'|'box'|'rounded'|'pill', theme:'dark'|'light',
  colorByTag:Record<string,string> /* '#tag' -> color, links colored by relationship */,
  showBadges:true, editable:true, virtualize:true /* cull off-screen nodes for 1000+ */ }
// Events (cb(payload)):
'node:click' {id,node,event}  'node:dblclick'  'node:contextmenu' {id,node,x,y,event}  'node:toggle' {id,collapsed}
'node:edit' {id,node,text}  'node:add-child' {id,node}  'node:add-sibling' {id,node}  'node:delete' {id,node}
'node:move' {id,node,newParentId,index}  'node:check' {id,node}  'link:click' {href,target,event,type:'wikilink'|'url'|'tag'}
'selection:change' {id}  'view:transform' {x,y,k}  'render' {stats}
// Rendering rules: SVG with <g class="mm-node" data-id data-depth> containing foreignObject/HTML text (inline markdown),
// a <circle class="mm-toggle"> when node has children (filled = collapsed), links as <path class="mm-link" data-type>,
// depth-based colors color1/2/3 then defaultColor (freeze at colorFreezeLevel), stroke widths per thickness settings,
// CSS classes: .is-selected .is-match .is-dimmed .is-collapsed .has-children .is-unread .is-recent .is-important .tag-<name>
// Zoom: wheel (ctrl/pinch), drag pan on background, drag node to re-parent (drop on another node), touch: 1-finger pan,
// 2-finger pinch, long-press = contextmenu. Keyboard when svg focused: arrows navigate, Enter child (editing: Enter = next sibling), Tab sibling (editing: Tab = child),
// Delete/Backspace delete, F2 edit, Space toggle, Escape cancel. ARIA: role="tree"/"treeitem", aria-expanded, aria-level,
// aria-selected; a visually hidden live region announces selection.
```

### `src/mindmap/graph.js` — `GraphView`
```js
export class GraphView { constructor(container, options?)
  setData({nodes:[{id,path,name,type:'note'|'tag'|'unresolved'|'attachment',tags:string[],unread,recent,important,linkCount}],
           edges:[{source,target,type:'link'|'backlink'|'tag'|'embed'}]})
  setOptions({showTags,showUnresolved,showAttachments,showArrows,colorGroups:[{query,color}],
              nodeSize,linkThickness,centerForce,repelForce,linkForce,linkDistance,theme})
  highlight(query)  select(id)  fit()  zoomIn() zoomOut() getTransform() setTransform() pause() resume()
  on/off/destroy  // events: 'node:click' 'node:dblclick' 'node:contextmenu' 'node:hover' 'view:transform'
  // Force-directed (own simulation, no d3), canvas 2D rendering for 1000+ nodes with hit testing, hover highlights
  // neighbors, drag nodes, local graph mode: setData(..., {focus:id, depth:n}) }
```

### `src/mindmap/canvas.js` — `CanvasView` (JSON Canvas spec: https://jsoncanvas.org)
```js
export class CanvasView { constructor(container, options?)
  setData(canvasJson /* {nodes:[{id,type:'text'|'file'|'link'|'group',x,y,width,height,color?,text?,file?,url?,label?}],
                          edges:[{id,fromNode,fromSide?,fromEnd?,toNode,toSide?,toEnd?,color?,label?}]} */)
  getData() -> canvasJson   addNode(partial) -> id   addEdge(partial) -> id   remove(ids)  fit() zoomIn() zoomOut()
  on/off/destroy // events: 'change' {data}  'node:open' {node}  'node:contextmenu' {node,x,y}  'selection:change' {ids}
  // drag/resize/multi-select (shift), connect by dragging from a side handle, double-click empty = new text card,
  // colors 1-6 per Obsidian palette, groups contain children, zoom/pan/touch same as MindMapView }
```

### `src/mindmap/interactions.js` — shared gesture helper (used by all three views)
```js
export function attachZoomPan(svgOrCanvas, {onTransform, onTap, onDoubleTap, onLongPress, getTransform, setTransform, minK, maxK})
export function animate(from, to, duration, easing, onFrame) -> cancel
```

### `src/core/exporters.js`
```js
export async function exportSVG(view:MindMapView|GraphView|CanvasView, {inlineStyles:true, background}) -> string
export async function exportPNG(view, {scale:2, background, foreground, text, width, height, transparent}) -> Blob
export async function exportPDF(view, {title}) // renders PNG into a print window (window.print) — cross-platform
export function exportMarkdown(tree) -> string          // == treeToMarkdown
export function exportOPML(tree) -> string   export function exportFreeMind(tree) -> string
export async function copyScreenshot(view, opts) -> void  // clipboard PNG (ClipboardItem), falls back to download
export function download(blob|string, filename, mime)
```

### `src/core/importers.js`
```js
export async function importFile(file:File) -> { name:string, markdown:string, canvas?:object }
// .md/.txt (as-is)  .opml  .mm (FreeMind/Freeplane)  .xmind (zip: content.json (2020+) or content.xml (legacy))
// .mind/.mindmeister (zip: map.json)  .json (JSON Canvas → {canvas})  .txt tab-indented outline
export async function readZip(file|ArrayBuffer) -> Map<string, Uint8Array>  // stored + deflate via DecompressionStream('deflate-raw')
export function opmlToMarkdown(xml)  export function freemindToMarkdown(xml)  export function xmindToMarkdown(zipEntries)  export function mindmeisterToMarkdown(zipEntries)
```

## UI exports (consumed by ENGINE only in dev harness, so ENGINE must not depend on them)

### `src/core/store.js` — `VaultStore` (events: 'change' {type:'create'|'modify'|'delete'|'rename'|'load', path}, 'open' {path})
`listNotes() getNote(path) createNote(path, content) updateNote(path, content) deleteNote(path) renameNote(old,new)
 folders() openFolder() /* File System Access API showDirectoryPicker, falls back to <input webkitdirectory> read-only */
 save() /* localStorage 'mindmap.vault' when no FS handle */ loadSample() markRead(path) recent(n)`

### `src/core/links.js` — `LinkIndex` built from store: `outgoing(path) backlinks(path) tags() notesWithTag(tag) unresolved() graphData() localGraph(path, depth)`
### `src/core/history.js` — `History` per note: `snapshot(path, content, reason) list(path) restore(path, id) diff(a,b)` + relationship timeline `timeline(path)`
### `src/core/commands.js` — `Commands`: `register({id,name,hotkeys:[{modifiers:['Mod'],key:'p'}],callback,checkCallback})`, `execute(id)`, `list()`, `setHotkey(id, hotkey)`; Mod = Cmd on Mac / Ctrl elsewhere
### `src/core/settings.js` — `Settings`: schema (all MindMapOptions + app: theme, accent, baseFontSize, showLineNumbers, readableLineLength, vimMode:false, spellcheck, previewSplit, autoRevealMindMap, hotkeys overrides, enabledPlugins) `get(key) set(key,val) on('change')` persisted to localStorage 'mindmap.settings'
### `src/core/plugins.js` — `window.MindMap` API: `registerPlugin({id,name,version,onload(app),onunload})`, `app` exposes {store, links, settings, commands, workspace, views:{mindmap,graph,canvas}, addRibbonIcon, addCommand, addSettingTab, addStatusBarItem, registerView, on(event)}; plugins listed/toggled in Settings → Community plugins
### `src/ui/workspace.js` — Obsidian layout: ribbon (left icon bar), left sidebar tabs (Files, Search, Tags, Bookmarks), tab bar per pane, editor pane, mind map/graph/canvas panes (split horizontal/vertical, resizable), right sidebar (Backlinks, Outgoing links, Outline, Version history), status bar (word count, backlinks, node count), title bar with breadcrumbs
### `src/ui/components/` — `menu.js` (context menus), `modal.js`, `command-palette.js` (fuzzy), `quick-switcher.js`, `settings-modal.js` (Obsidian's sidebar-tab settings layout), `notice.js`, `tooltip.js`, `search.js`, `onboarding.js` (interactive tutorial w/ spotlight steps)
### `src/ui/editor.js` — markdown editor (textarea with line numbers, gutter, current-line highlight, bracket autocomplete for [[ with suggestion popup, Tab/Shift+Tab indent, live sync: cursor line ↔ selected map node both ways, debounced parse 120 ms)
### `src/styles/obsidian.css` — Obsidian CSS variables for dark (`.theme-dark`) & light (`.theme-light`) + all component styles; `app.css` layout

## Conventions
- ES modules, no globals except `window.MindMap` (plugin API). Files ≤ ~900 lines; split if larger.
- All colors via CSS variables so themes swap; SVG styles set as attributes too (export must be self-contained).
- Performance: measure text with a canvas 2D context (cache by text+font); layout O(n); render only nodes whose
  bbox intersects the viewport when `virtualize` (recompute on transform end, rAF-batched); links as one <path> each.
- Accessibility: every interactive element keyboard reachable, aria labels, focus rings, `prefers-reduced-motion` respected.
