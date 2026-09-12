// node-dom.js — builds and updates the SVG DOM for one mind-map node and its incoming link.
import { svgEl, setAttrs, icon, escapeHtml, stripHtml, XHTML_NS } from './utils.js';
import { linkAnchors, linkPath } from './layout.js';

const BADGE_ICONS = { task: 'clipboard', link: 'link', embed: 'embed', image: 'image', code: 'code', table: 'table' };

export function nodeFlags(node) {
  const f = node.flags || {};
  return {
    unread: !!(node.unread || f.unread),
    recent: !!(node.recent || f.recent),
    important: !!(node.important || f.important),
  };
}

/** Inner HTML of the node content (checkbox, text, badges, indicators). */
export function contentHtml(node, opts) {
  const flags = nodeFlags(node);
  let s = '';
  if (flags.unread) s += '<span class="mm-unread-dot" title="Unread"></span>';
  if (node.checked === true) s += `<span class="mm-check is-done" role="checkbox" aria-checked="true">${icon('done', 14)}</span>`;
  else if (node.checked === false) s += `<span class="mm-check" role="checkbox" aria-checked="false">${icon('todo', 14)}</span>`;
  s += `<span class="mm-text">${node.html || escapeHtml(node.text)}</span>`;
  if (opts.showBadges !== false && node.type !== 'code' && node.type !== 'table') {
    const badges = (node.badges || []).filter(b => BADGE_ICONS[b]);
    if (badges.length) s += `<span class="mm-badges">${badges.map(b => `<span class="mm-badge mm-badge-${b}" title="${b}">${icon(BADGE_ICONS[b], 12)}</span>`).join('')}</span>`;
  }
  if (flags.important) s += `<span class="mm-important" title="Important">${icon('star', 12)}</span>`;
  if (node.task) s += taskStripHtml(node.task);
  return s;
}

/** Five-chip task strip: deadline · assignee · budget · category · counter (joined/target → "joined"). */
export function taskStripHtml(t) {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(t.count || ''); const joined = m ? +m[1] : 0, target = m ? +m[2] : (parseInt(t.count, 10) || 0);
  const done = target > 0 && joined >= target;
  const chip = (cls, ic, text, title) => `<span class="mm-task-chip mm-task-${cls}" title="${escapeHtml(title)}">${icon(ic, 11)}<span>${escapeHtml(text || '—')}</span></span>`;
  return `<span class="mm-task${done ? ' is-joined' : ''}" role="group" aria-label="Task">` +
    chip('deadline', 'calendar', t.deadline, 'Deadline: open for inputs until this date') +
    chip('assignee', 'user', t.assignee, 'Assigned to (person or AI agent)') +
    chip('budget', 'coins', t.budget, 'Budget / joining fee') +
    chip('category', 'tag', t.category, 'Category (decides the minimum required fields)') +
    chip('count', 'users', done ? 'joined' : (target ? `${joined}/${target}` : t.count), 'People who want to execute this task; becomes "joined" when the count completes') +
    '</span>';
}
export function taskStripWidth(t, fontSize) {
  const text = [t.deadline, t.assignee, t.budget, t.category, t.count].map(v => String(v || '—')).join('');
  return 5 * (fontSize * 1.9) + text.length * fontSize * 0.56;
}

/** Extra width needed by decorations that are not part of the inline html. */
export function decorationWidth(node, opts, fontSize) {
  let w = 0;
  const flags = nodeFlags(node);
  if (flags.unread) w += fontSize * 0.95;
  if (node.task) w += taskStripWidth(node.task, fontSize);
  if (node.checked != null) w += fontSize * 1.45;
  if (opts.showBadges !== false && node.type !== 'code' && node.type !== 'table') {
    const n = (node.badges || []).filter(b => BADGE_ICONS[b]).length;
    if (n) w += 5 + n * 15;
  }
  if (flags.important) w += 16;
  return w;
}

export function createNodeEl() {
  const g = svgEl('g', { class: 'mm-node', role: 'treeitem', tabindex: -1 });
  const shape = svgEl('rect', { class: 'mm-shape', x: 0, y: 0 }, g);
  const underline = svgEl('line', { class: 'mm-underline' }, g);
  const toggle = svgEl('circle', { class: 'mm-toggle', r: 6 }, g);
  // foreignObject + content are created lazily (see ensureContent) so low-zoom LOD rendering stays cheap
  return { g, shape, underline, fo: null, content: null, toggle, html: null, cls: '', w: -1, h: -1, style: '' };
}

function ensureContent(el) {
  if (el.fo) return;
  const fo = svgEl('foreignObject', { class: 'mm-fo', x: 0, y: 0, width: el.w > 0 ? el.w : 1, height: el.h > 0 ? el.h : 1 });
  const wrap = document.createElementNS(XHTML_NS, 'div');
  wrap.className = 'mm-fo-wrap';
  wrap.setAttribute('xmlns', XHTML_NS);
  const content = document.createElementNS(XHTML_NS, 'div');
  content.className = 'mm-content';
  wrap.appendChild(content);
  fo.appendChild(wrap);
  el.g.insertBefore(fo, el.toggle);
  el.fo = fo; el.content = content;
}

/**
 * Update a node element to reflect `node` (position is applied separately via setNodePos).
 * view supplies options, selection/highlight state and color info.
 */
export function updateNodeEl(view, node, el, lod = false) {
  const o = view.options;
  const shape = o.nodeShape || 'text';
  const color = node.branchColor;
  const thick = node.thickness;
  const isText = shape === 'text';
  const flags = nodeFlags(node);
  const cls = ['mm-node', `is-shape-${shape}`,
    node.hasChildren ? 'has-children' : '',
    node.hasChildren && !node.expanded ? 'is-collapsed' : '',
    view.selection === node.id ? 'is-selected' : '',
    view.matches ? (view.matches.has(node.id) ? 'is-match' : 'is-dimmed') : '',
    flags.unread ? 'is-unread' : '', flags.recent ? 'is-recent' : '', flags.important ? 'is-important' : '',
    node.checked === true ? 'is-done' : '', node.checked === false ? 'is-todo' : '',
    view.dropTarget === node.id ? 'is-drop-target' : '', view.draggingId === node.id ? 'is-dragging' : '',
    node.type === 'root' ? 'is-root' : `is-${node.type}`,
    ...(node.tags || []).map(t => 'tag-' + t.slice(1).replace(/[^\w-]/g, '_')),
  ].filter(Boolean).join(' ');
  if (el.cls !== cls) { el.g.setAttribute('class', cls); el.cls = cls; }
  const style = `color:${color}`;
  if (el.style !== style) { el.g.setAttribute('style', style); el.style = style; }
  if (el.id !== node.id) { el.g.setAttribute('data-id', node.id); el.id = node.id; }
  if (el.depth !== node.depth) { el.g.setAttribute('data-depth', node.depth); el.g.setAttribute('aria-level', node.depth + 1); el.depth = node.depth; }
  el.g.setAttribute('aria-expanded', node.hasChildren ? String(!!node.expanded) : 'false');
  el.g.setAttribute('aria-selected', String(view.selection === node.id));
  const label = stripHtml(node.html) || node.text;
  if (el.label !== label) { el.g.setAttribute('aria-label', label); el.label = label; }

  const w = node.w, h = node.h;
  if (el.w !== w || el.h !== h || el.shapeName !== shape) {
    const rx = shape === 'rounded' ? 6 : shape === 'pill' ? h / 2 : 0;
    setAttrs(el.shape, { width: w, height: h, rx, ry: rx });
    if (el.fo) setAttrs(el.fo, { width: w, height: h });
    el.w = w; el.h = h; el.shapeName = shape;
  }
  setAttrs(el.shape, { stroke: isText ? null : color, 'stroke-width': isText ? null : Math.max(1, Math.min(3, thick / 2)) });
  if (isText) {
    setAttrs(el.underline, { x1: 0, y1: h, x2: w, y2: h, stroke: color, 'stroke-width': thick, display: null });
  } else if (el.underline.getAttribute('display') !== 'none') el.underline.setAttribute('display', 'none');

  if (lod) {
    // level of detail: text is unreadable at this zoom, keep only shape/underline/toggle
    if (el.fo && !el.foHidden) { el.fo.setAttribute('display', 'none'); el.foHidden = true; }
  } else {
    ensureContent(el);
    if (el.foHidden) { el.fo.removeAttribute('display'); el.foHidden = false; }
    const html = contentHtml(node, o);
    const wrapped = node.wrapped ? ' is-wrapped' : '';
    const contentCls = 'mm-content' + wrapped + (node.type === 'code' ? ' is-code' : '') + (node.type === 'table' ? ' is-table' : '');
    if (el.content.className !== contentCls) el.content.className = contentCls;
    const padY = isText ? 0 : 4;
    const cstyle = `font-size:${o.fontSize}px;line-height:${node.lineHeightPx}px;padding:${padY}px ${o.paddingX}px;width:${w}px;min-height:${h}px;box-sizing:border-box;`;
    if (el.cstyle !== cstyle) { el.content.setAttribute('style', cstyle); el.cstyle = cstyle; }
    if (el.html !== html) { el.content.innerHTML = html; el.html = html; }
  }

  if (node.hasChildren) {
    const side = node.side;
    const cx = side === 'left' ? 0 : side === 'down' ? w / 2 : w;
    const cy = side === 'down' ? h : isText ? h : h / 2;
    setAttrs(el.toggle, { cx, cy, stroke: color, display: null, r: Math.max(4, Math.min(7, 3 + thick / 2)) });
    el.toggle.setAttribute('aria-label', node.expanded ? 'Collapse' : 'Expand');
  } else if (el.toggle.getAttribute('display') !== 'none') el.toggle.setAttribute('display', 'none');
}

export function setNodePos(el, x, y, opacity) {
  const t = `translate(${Math.round(x * 100) / 100},${Math.round(y * 100) / 100})`;
  if (el.t !== t) { el.g.setAttribute('transform', t); el.t = t; }
  if (opacity != null) { if (el.op !== opacity) { el.g.setAttribute('opacity', opacity); el.op = opacity; } }
  else if (el.op != null) { el.g.removeAttribute('opacity'); el.op = null; }
}

export function createLinkEl() {
  return svgEl('path', { class: 'mm-link' });
}

export function updateLinkEl(view, node, path, parentPos, childPos) {
  const o = view.options;
  const p = parentPos ? { ...node.parent, ...parentPos } : node.parent;
  const c = childPos ? { ...node, ...childPos } : node;
  const anchors = linkAnchors(p, c, o.nodeShape || 'text');
  const d = linkPath(anchors, node.lineStyle || o.lineStyle || 'curved', node.side === 'down');
  if (path._d !== d) { path.setAttribute('d', d); path._d = d; }
  const dimmed = view.matches ? !view.matches.has(node.id) : false;
  const cls = 'mm-link' + (dimmed ? ' is-dimmed' : '') + (view.selection === node.id ? ' is-selected' : '');
  if (path._cls !== cls) { path.setAttribute('class', cls); path._cls = cls; }
  const stroke = node.branchColor, sw = node.thickness;
  if (path._stroke !== stroke) { path.setAttribute('stroke', stroke); path._stroke = stroke; }
  if (path._sw !== sw) { path.setAttribute('stroke-width', sw); path._sw = sw; }
  const type = node.colorSource || 'depth';
  if (path._type !== type) { path.setAttribute('data-type', type); path.setAttribute('data-id', node.id); path.setAttribute('data-depth', node.depth); path._type = type; }
}

/** Standalone SVG <text> fallback for exports where foreignObject is undesirable. */
export function plainTextSvg(node, o) {
  const label = escapeHtml(stripHtml(node.html) || node.text);
  const isText = (o.nodeShape || 'text') === 'text';
  const y = isText ? node.h - Math.max(3, node.lineHeightPx * 0.28) : node.h / 2;
  const base = isText ? 'auto' : 'middle';
  return `<text x="${o.paddingX}" y="${y}" font-size="${o.fontSize}" dominant-baseline="${base}" font-family="${o.fontFamily.replace(/"/g, "'")}">${label}</text>`;
}
