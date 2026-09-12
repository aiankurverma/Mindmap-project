// markdown.js — markmap-semantics parser, inline renderer, link extraction,
// serializer and pure text-edit operations. See ARCHITECTURE.md (ENGINE exports).
import { escapeHtml, hashString, stripHtml } from '../mindmap/utils.js';

const FM_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const HEADING_RE = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const LIST_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const CHECK_RE = /^\[([ xX])\][ \t]+(.*)$|^\[([ xX])\]$/;
const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^`\s]*)/;
const HR_RE = /^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/;
const TABLE_SEP_RE = /^[ \t]*\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/;
const LINE_MARK_RE = /[ \t]*\{line:[ \t]*(curved|straight|angled)\}[ \t]*$/i;
const TASK_MARK_RE = /[ \t]*\{task:[ \t]*([^}]*)\}[ \t]*$/;
const COLOR_MARK_RE = /[ \t]*(?:<!--[ \t]*color:[ \t]*([#\w(),.\s]+?)[ \t]*-->|\{color:[ \t]*([#\w(),.]+)\})[ \t]*$/;
const TAG_RE = /(^|[\s(\[])#([\p{L}\p{N}_\/-]*[\p{L}_\/-][\p{L}\p{N}_\/-]*)/gu;
const WIKI_RE = /\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g;
const EMBED_RE = /!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g;
const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
// Placeholder sentinel (NUL) used while rendering inline markdown; never appears in user text.
const PH = String.fromCharCode(0);
const PH_RE = new RegExp(PH + '(\\d+)' + PH, 'g');

const LEAF_TYPES = new Set(['paragraph', 'code', 'table']);
const splitLines = c => String(c ?? '').split(/\r?\n/);
const indentWidth = ws => { let w = 0; for (const ch of ws) w += ch === '\t' ? 4 - (w % 4) : 1; return w; };
const linkBase = t => t.trim().split(/[#^]/)[0].trim();

// ───────────────────────────── frontmatter ─────────────────────────────
function yamlScalar(v) {
  v = v.trim();
  if (/^(["']).*\1$/.test(v)) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map(s => yamlScalar(s)).filter(s => s !== '');
  return v;
}

function parseYaml(src) {
  const data = {};
  let key = null;
  for (const raw of src.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const item = /^\s*-\s*(.*)$/.exec(raw);
    if (item && key) {
      if (!Array.isArray(data[key])) data[key] = data[key] === '' || data[key] == null ? [] : [data[key]];
      data[key].push(yamlScalar(item[1]));
      continue;
    }
    const kv = /^([\w.-]+)\s*:\s*(.*)$/.exec(raw);
    if (kv) { key = kv[1]; data[key] = kv[2] === '' ? '' : yamlScalar(kv[2]); }
  }
  return data;
}

export function parseFrontmatter(content) {
  content = String(content ?? '');
  const m = FM_RE.exec(content);
  if (!m) return { data: {}, body: content, raw: '' };
  return { data: parseYaml(m[1]), body: content.slice(m[0].length), raw: m[0] };
}

// ───────────────────────────── inline renderer ─────────────────────────────
function safeUrl(u) {
  u = String(u).trim();
  if (/^[\s -]*(javascript|vbscript|data)\s*:/i.test(u) && !/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(u)) return '#';
  return u;
}

function emph(s) {
  s = s.replace(/==(.+?)==/g, '<mark>$1</mark>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(.+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s](?:[^*]*?[^*\s])?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\s](?:[^_]*?[^_\s])?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  return s;
}

/** Render one line of inline markdown to sanitized HTML. opts.highlight=false → escaped text only. */
export function renderInline(text, opts = {}) {
  if (text == null || text === '') return '';
  if (opts.highlight === false) return escapeHtml(text);
  const ph = [];
  const put = h => PH + (ph.push(h) - 1) + PH;
  let s = escapeHtml(text);
  s = s.replace(/(`+)(.+?)\1(?!`)/g, (m, t, c) => put(`<code>${c.trim()}</code>`));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, alt, src) =>
    put(`<img class="mm-img" src="${safeUrl(src)}" alt="${alt}" loading="lazy">`));
  s = s.replace(/!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, (m, t, a) => {
    t = t.trim();
    const isImg = IMG_EXT_RE.test(t);
    return put(`<span class="mm-embed${isImg ? ' mm-embed-image' : ''}" data-target="${t}" data-base="${linkBase(t)}">${a || t}</span>`);
  });
  s = s.replace(/\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, (m, t, a) => {
    t = t.trim();
    return put(`<a class="internal-link" href="#" data-href="${t}" data-target="${linkBase(t) || t}">${emph(a == null ? t : a)}</a>`);
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, txt, url) =>
    put(`<a class="external-link" href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${emph(txt)}</a>`));
  s = s.replace(/&lt;((?:https?|mailto):[^\s&]+)&gt;/g, (m, url) =>
    put(`<a class="external-link" href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${url}</a>`));
  s = s.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<]*[^\s<.,;:!?)'"])/g, (m, pre, url) =>
    pre + put(`<a class="external-link" href="${url.startsWith('www.') ? 'https://' + url : url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
  s = s.replace(TAG_RE, (m, pre, tag) => pre + put(`<a class="tag" href="#" data-tag="#${tag}">#${tag}</a>`));
  s = emph(s);
  return s.replace(PH_RE, (m, i) => ph[+i]);
}

function renderCode(info, body) {
  const lang = info ? ` class="language-${escapeHtml(info)}"` : '';
  return `<pre class="mm-pre"><code${lang}>${escapeHtml(body)}</code></pre>`;
}

function renderTable(rows) {
  const cells = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => renderInline(c.trim()));
  const head = cells(rows[0]);
  const body = rows.slice(2).map(r => `<tr>${cells(r).map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table class="mm-table"><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}

// ───────────────────────────── block parser ─────────────────────────────
function makeNode(type, text, line) {
  return { id: '', depth: 0, type, text, html: '', level: 0, line, endLine: line, subtreeEndLine: line,
    children: [], collapsed: false, tags: [], links: [], badges: [], parent: null };
}

function finalizeNode(n, opts) {
  const lm = n.type !== 'code' ? LINE_MARK_RE.exec(n.text) : null;
  if (lm) { n.lineMarker = lm[0].trim(); n.lineStyle = lm[1].toLowerCase(); n.text = n.text.slice(0, lm.index).trimEnd(); }
  const tm = n.type !== 'code' ? TASK_MARK_RE.exec(n.text) : null;
  if (tm) { n.taskMarker = tm[0].trim(); n.task = parseTask(tm[1]); n.text = n.text.slice(0, tm.index).trimEnd(); n.badges.push('task'); }
  const cm = COLOR_MARK_RE.exec(n.text);
  if (cm && n.type !== 'code') { n.color = (cm[1] || cm[2]).trim(); n.colorMarker = cm[0].trim(); n.text = n.text.slice(0, cm.index).trimEnd(); }
  if (n.type === 'code') n.html = renderCode(n.info, n.body);
  else if (n.type === 'table') n.html = renderTable(n.rows);
  else n.html = renderInline(n.text, { highlight: opts.highlight !== false });
  if (n.type !== 'code') {
    const t = n.text;
    n.tags = [...t.replace(/`[^`]*`/g, ' ').matchAll(TAG_RE)].map(m => '#' + m[2]);
    const noEmbeds = t.replace(EMBED_RE, (m, tg) => { n.badges.push(IMG_EXT_RE.test(tg.trim()) ? 'image' : 'embed'); return ' '; });
    n.links = [...noEmbeds.matchAll(WIKI_RE)].map(m => linkBase(m[1])).filter(Boolean);
    if (n.links.length || /\[[^\]]*\]\([^)]+\)|https?:\/\//.test(noEmbeds)) n.badges.push('link');
    if (/!\[[^\]]*\]\([^)]+\)/.test(t)) n.badges.push('image');
    if (/`[^`]+`/.test(t)) n.badges.push('code');
  } else n.badges.push('code');
  if (n.type === 'table') n.badges.push('table');
  if (n.checked === true) n.badges.unshift('done');
  else if (n.checked === false) n.badges.unshift('todo');
  n.badges = [...new Set(n.badges)];
}

/**
 * parseMarkdown(content, {rootText, maxDepth, highlight, promote})
 * markmap semantics: headings nest by level, list items nest by indent under the nearest heading,
 * paragraphs are leaves, fenced code / tables are single nodes.
 */
export function parseMarkdown(content, opts = {}) {
  content = String(content ?? '');
  const lines = splitLines(content);
  const fm = parseFrontmatter(content);
  const start = fm.raw ? fm.raw.split('\n').length - (fm.raw.endsWith('\n') ? 1 : 0) : 0;
  const root = makeNode('root', String(fm.data.title ?? opts.rootText ?? ''), -1);
  root.frontmatter = fm.data;
  const headingStack = [root];
  let listStack = [];
  let last = null;       // node that may receive lazy continuation lines
  let lastKind = '';     // 'list' | 'para' | ''
  let pendingComment = null;

  const parentFor = indent => {
    while (listStack.length && listStack[listStack.length - 1].indent >= indent) listStack.pop();
    if (listStack.length) return listStack[listStack.length - 1].node;
    return headingStack[headingStack.length - 1];
  };
  const attach = (parent, node) => {
    node.parent = parent; parent.children.push(node);
    if (pendingComment) { node.color = pendingComment; pendingComment = null; }
    return node;
  };

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { last = null; lastKind = ''; continue; }
    const cmt = /^\s*<!--\s*color:\s*([#\w(),.\s]+?)\s*-->\s*$/.exec(line);
    if (cmt) { pendingComment = cmt[1].trim(); last = null; lastKind = ''; continue; }
    if (/^\s*(<!--[\s\S]*?-->|%%[\s\S]*?%%)\s*$/.test(line)) continue;

    let m = FENCE_RE.exec(line);
    if (m) {
      const fence = m[2], indent = indentWidth(m[1]);
      let j = i + 1;
      const closeRe = new RegExp(`^[ \\t]*${fence[0]}{${fence.length},}[ \\t]*$`);
      while (j < lines.length && !closeRe.test(lines[j])) j++;
      const end = Math.min(j, lines.length - 1);
      const node = makeNode('code', lines.slice(i, end + 1).join('\n'), i);
      node.info = m[3]; node.body = lines.slice(i + 1, j).join('\n');
      node.endLine = end;
      attach(parentFor(indent), node);
      i = j; last = null; lastKind = '';
      continue;
    }
    if (HR_RE.test(line)) { last = null; lastKind = ''; continue; }

    if (/^#{1,6}[ \t]*$/.test(line)) { last = null; lastKind = ''; continue; }   // empty heading: ignore the line
    // blockquote: consecutive "> " lines form one quote node (badge 'quote'), never merged into a paragraph
    const bq = /^[ \t]*>[ \t]?(.*)$/.exec(line);
    if (bq) {
      if (last && lastKind === 'quote') { last.text += ' ' + bq[1].trim(); last.endLine = i; continue; }
      const node = makeNode('paragraph', bq[1].trim(), i);
      node.badges = [...(node.badges || []), 'quote']; node.quote = true;
      attach(parentFor(0), node);
      last = node; lastKind = 'quote';
      continue;
    }
    m = HEADING_RE.exec(line);
    if (m) {
      const level = m[1].length;
      while (headingStack.length > 1 && headingStack[headingStack.length - 1].level >= level) headingStack.pop();
      const node = makeNode('heading', m[2].trim(), i);
      node.level = level;
      attach(headingStack[headingStack.length - 1], node);
      headingStack.push(node);
      listStack = []; last = null; lastKind = '';
      continue;
    }

    m = LIST_RE.exec(line);
    if (m) {
      const indent = indentWidth(m[1]);
      const text = (m[3] || '').trim();
      const node = makeNode('list', text, i);
      const ck = CHECK_RE.exec(text);
      if (ck) { node.checked = (ck[1] || ck[3]).toLowerCase() === 'x'; node.text = (ck[2] || '').trim(); }
      node.indent = m[1]; node.marker = m[2]; node.indentWidth = indent;
      const parent = parentFor(indent);
      node.level = parent.type === 'list' ? parent.level + 1 : 1;
      attach(parent, node);
      listStack.push({ indent, node });
      last = node; lastKind = 'list';
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('|') && TABLE_SEP_RE.test(lines[i + 1])) {
      let j = i + 1;
      while (j + 1 < lines.length && lines[j + 1].includes('|') && lines[j + 1].trim()) j++;
      const rows = lines.slice(i, j + 1);
      const node = makeNode('table', rows.join('\n'), i);
      node.rows = rows; node.endLine = j;
      attach(parentFor(indentWidth(/^\s*/.exec(line)[0])), node);
      i = j; last = null; lastKind = '';
      continue;
    }

    // paragraph / lazy continuation
    const text = line.trim();
    if (last && (lastKind === 'list' || lastKind === 'para')) {
      last.text += ' ' + text; last.endLine = i; continue;
    }
    if (lastKind === 'quote') { last = null; lastKind = ''; }
    const node = makeNode('paragraph', text, i);
    attach(parentFor(indentWidth(/^\s*/.exec(line)[0])), node);
    last = node; lastKind = 'para';
  }

  // promote a single top-level heading to root (markmap behaviour) when no title was given
  const promote = opts.promote !== undefined ? opts.promote : (fm.data.title == null && opts.rootText == null);
  if (promote && root.children.length === 1 && root.children[0].type === 'heading') {
    const h = root.children[0];
    Object.assign(root, { text: h.text, line: h.line, endLine: h.endLine, level: h.level, children: h.children, promoted: true });
    root.children.forEach(c => { c.parent = root; });
  }
  if (!root.text) root.text = 'Untitled';

  const maxDepth = opts.maxDepth > 0 ? opts.maxDepth : Infinity;
  const walk = (n, depth, path) => {
    n.depth = depth;
    n.id = 'n' + hashString(path);
    finalizeNode(n, opts);
    if (depth >= maxDepth) n.children = [];
    n.children.forEach((c, i) => walk(c, depth + 1, path + '/' + i));
    n.subtreeEndLine = Math.max(n.endLine, ...n.children.map(c => c.subtreeEndLine));
    if (n.type === 'root') n.subtreeEndLine = Math.max(n.subtreeEndLine, lines.length - 1);
  };
  walk(root, 0, '0');
  root.lineCount = lines.length;
  return root;
}

// ───────────────────────────── link extraction ─────────────────────────────
export function extractLinks(content) {
  const fm = parseFrontmatter(content);
  const body = fm.body
    .replace(/(```|~~~)[\s\S]*?\1/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/%%[\s\S]*?%%/g, ' ');
  const links = [], embeds = [], tags = [], aliases = {};
  const noEmbeds = body.replace(EMBED_RE, (m, t) => { const b = linkBase(t); if (b) embeds.push(b); return ' '; });
  noEmbeds.replace(WIKI_RE, (m, t, a) => { const b = linkBase(t); if (b) { links.push(b); if (a != null && a.trim()) aliases[a.trim()] = b; } return ' '; });
  for (const m of noEmbeds.matchAll(TAG_RE)) tags.push('#' + m[2]);
  let fmTags = fm.data.tags ?? fm.data.tag;
  if (typeof fmTags === 'string') fmTags = fmTags.split(/[,\s]+/);
  if (Array.isArray(fmTags)) for (const t of fmTags) if (t != null && String(t).trim()) tags.push('#' + String(t).trim().replace(/^#/, ''));
  const uniq = a => [...new Set(a)];
  return { links: uniq(links), embeds: uniq(embeds), tags: uniq(tags), aliases, frontmatter: fm.data };
}

// ───────────────────────────── tree helpers ─────────────────────────────
export function flattenTree(tree) {
  const out = [];
  const walk = n => { out.push(n); n.children.forEach(walk); };
  if (tree) walk(tree);
  return out;
}

export function findNodeById(tree, id) {
  if (!tree) return null;
  const stack = [tree];
  while (stack.length) {
    const n = stack.pop();
    if (n.id === id) return n;
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }
  return null;
}

export function findNodeAtLine(tree, line) {
  if (!tree) return null;
  let node = tree;
  let found = tree.type === 'root' || (tree.line <= line && line <= tree.subtreeEndLine) ? tree : null;
  while (node) {
    const child = node.children.find(c => c.line <= line && line <= c.subtreeEndLine);
    if (!child) break;
    found = child; node = child;
  }
  return found;
}

export function plainText(node) { return stripHtml(node.html || '') || node.text || ''; }

// ───────────────────────────── serializer ─────────────────────────────
const checkboxPrefix = n => (n.checked === true ? '[x] ' : n.checked === false ? '[ ] ' : '');
const marker = n => (n.colorMarker ? ' ' + n.colorMarker : n.color ? ` {color:${n.color}}` : '') + (n.taskMarker ? ' ' + n.taskMarker : n.task ? ' ' + taskToMarker(n.task) : '') + (n.lineMarker ? ' ' + n.lineMarker : n.lineStyle ? ` {line:${n.lineStyle}}` : '');

/** Set (or remove with null) a per-node line style marker on the node's first line. */
export function setNodeLine(content, node, style) {
  if (!node || node.type === 'root' || node.type === 'code' || node.type === 'table') return content;
  const lines = splitLines(content);
  let line = lines[node.line]; if (line == null) return content;
  line = line.replace(LINE_MARK_RE, '');
  if (style) line = line.replace(/[ \t]+$/, '') + ` {line:${style}}`;
  lines[node.line] = line;
  return join(lines);
}

/** Task strip: deadline | assignee | budget | category | count ("joined/target"). */
export const TASK_FIELDS = ['deadline', 'assignee', 'budget', 'category', 'count'];
export function parseTask(str) {
  const parts = String(str || '').split('|').map(s => s.trim());
  const t = {}; TASK_FIELDS.forEach((k, i) => { t[k] = parts[i] || ''; });
  return t;
}
export function taskToMarker(task) { return `{task: ${TASK_FIELDS.map(k => String(task?.[k] ?? '').replace(/[|{}]/g, ' ').trim()).join(' | ')}}`; }
/** Counter helpers: "joined/target" (or just "target"). Status becomes "joined" once joined >= target. */
export function taskCount(task) { const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(task?.count || ''); if (m) return { joined: +m[1], target: +m[2] }; const n = parseInt(task?.count, 10); return { joined: 0, target: isNaN(n) ? 0 : n }; }
export function taskStatus(task) { const c = taskCount(task); return c.target > 0 && c.joined >= c.target ? 'joined' : 'open'; }
/** Set (or remove with null) the task strip on a node's first line. Returns new content. */
export function setNodeTask(content, node, task) {
  if (!node || node.type === 'root' || node.type === 'code' || node.type === 'table') return content;
  const lines = splitLines(content);
  let line = lines[node.line]; if (line == null) return content;
  line = line.replace(TASK_MARK_RE, '');
  if (task) line = line.replace(/[ \t]+$/, '') + ' ' + taskToMarker(task);
  lines[node.line] = line;
  return join(lines);
}

/** Emit a node + subtree as markdown lines. mode 'heading' keeps headings; 'list' converts everything to bullets. */
function emitNode(node, mode, hLevel, prefix, unit, out) {
  const type = node.type === 'root' ? 'heading' : node.type;
  if (mode === 'heading' && type === 'heading' && hLevel <= 6) {
    if (out.length && out[out.length - 1] !== '') out.push('');
    out.push('#'.repeat(hLevel) + ' ' + node.text + marker(node));
    for (const c of node.children) emitNode(c, c.type === 'list' ? 'list' : 'heading', hLevel + 1, '', unit, out);
    return;
  }
  if (mode === 'heading' && LEAF_TYPES.has(type)) {
    if (out.length && out[out.length - 1] !== '') out.push('');
    out.push(...node.text.split('\n'));
    if (node.type === 'code' || node.type === 'table') out.push('');
    return;
  }
  // list context
  if (type === 'code' || type === 'table') { out.push(...node.text.split('\n').map(l => prefix + l)); return; }
  out.push(prefix + (node.type === 'list' && node.marker ? node.marker : '-') + ' ' + checkboxPrefix(node) + node.text + marker(node));
  for (const c of node.children) emitNode(c, 'list', hLevel, prefix + unit, unit, out);
}

export function treeToMarkdown(tree) {
  if (!tree) return '';
  const out = [];
  if (tree.type === 'root' && !tree.promoted) {
    for (const c of tree.children) emitNode(c, c.type === 'list' ? 'list' : 'heading', 1, '', '  ', out);
  } else emitNode(tree, 'heading', tree.level || 1, '', '  ', out);
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + (out.length ? '\n' : '');
}

// ───────────────────────────── edit operations (pure) ─────────────────────────────
const join = lines => lines.join('\n');
const isBlank = l => l == null || !l.trim();
const isRootSynthetic = n => n.type === 'root' && n.line < 0;
const findLastList = n => { for (let i = n.children.length - 1; i >= 0; i--) if (n.children[i].type === 'list') return n.children[i]; return null; };
const childIndentFor = n => {
  const last = findLastList(n);
  if (last) return last.indent;
  if (n.type === 'list') return n.indent + (n.indent.includes('\t') ? '\t' : '  ');
  return '';
};
const listLine = (indent, mk, node, text) => indent + mk + ' ' + (node ? checkboxPrefix(node) : '') + text;
const nextMarker = mk => { const m = /^(\d+)([.)])$/.exec(mk); return m ? `${+m[1] + 1}${m[2]}` : mk; };

function insertLines(lines, at, newLines, { blankBefore = false, blankAfter = false } = {}) {
  const block = [...newLines];
  if (blankBefore && at > 0 && !isBlank(lines[at - 1])) block.unshift('');
  if (blankAfter && at < lines.length && !isBlank(lines[at])) block.push('');
  lines.splice(at, 0, ...block);
}

export function setNodeText(content, node, newText) {
  const lines = splitLines(content);
  const multi = node.type === 'code' || node.type === 'table' || node.type === 'paragraph';
  newText = String(newText ?? '').replace(/\r?\n/g, multi ? '\n' : ' ');
  if (isRootSynthetic(node)) {
    const fm = parseFrontmatter(content);
    if (!fm.raw) return content;
    const fmLines = fm.raw.split('\n');
    const idx = fmLines.findIndex(l => /^title\s*:/.test(l));
    if (idx < 0) return content;
    lines[idx] = 'title: ' + newText;
    return join(lines);
  }
  const count = node.endLine - node.line + 1;
  let replacement;
  switch (node.type) {
    case 'root':
    case 'heading': replacement = ['#'.repeat(node.level || 1) + ' ' + newText + marker(node)]; break;
    case 'list': replacement = [listLine(node.indent, node.marker, node, newText) + marker(node)]; break;
    default: replacement = newText.split('\n');
  }
  lines.splice(node.line, count, ...replacement);
  return join(lines);
}

export function insertChild(content, node, text = 'New node') {
  const lines = splitLines(content);
  if (isRootSynthetic(node)) {
    while (lines.length && isBlank(lines[lines.length - 1])) lines.pop();
    const asHeading = !node.children.length || node.children.some(c => c.type === 'heading');
    if (asHeading) { if (lines.length) lines.push(''); lines.push('# ' + text); }
    else lines.push(listLine(childIndentFor(node), '-', null, text));
    lines.push('');
    return join(lines);
  }
  const at = node.subtreeEndLine + 1;
  if (node.type === 'heading' || node.type === 'root') {
    const level = node.level || 1;
    if (level < 6) insertLines(lines, at, ['#'.repeat(level + 1) + ' ' + text], { blankBefore: true, blankAfter: true });
    else insertLines(lines, at, [listLine(childIndentFor(node), '-', null, text)]);
    return join(lines);
  }
  if (node.type === 'list') {
    const last = findLastList(node);
    const mk = last ? nextMarker(last.marker) : (/^\d/.test(node.marker) ? '1.' : node.marker);
    insertLines(lines, at, [listLine(childIndentFor(node), mk, null, text)]);
    return join(lines);
  }
  const indent = node.parent && node.parent.type === 'list' ? childIndentFor(node.parent) : '';
  insertLines(lines, at, [listLine(indent, '-', null, text)]);
  return join(lines);
}

export function insertSibling(content, node, text = 'New node') {
  if (node.type === 'root') return insertChild(content, node, text);
  const lines = splitLines(content);
  const at = node.subtreeEndLine + 1;
  if (node.type === 'heading') insertLines(lines, at, ['#'.repeat(node.level) + ' ' + text], { blankBefore: true, blankAfter: true });
  else if (node.type === 'list') insertLines(lines, at, [listLine(node.indent, nextMarker(node.marker), null, text)]);
  else insertLines(lines, at, [text], { blankBefore: true, blankAfter: true });
  return join(lines);
}

function spliceOut(lines, from, to) {
  let removed = to - from + 1;
  lines.splice(from, removed);
  if (from > 0 && isBlank(lines[from - 1]) && (from >= lines.length || isBlank(lines[from]))) {
    lines.splice(from, 1); removed++;
  }
  return removed;
}

export function deleteNode(content, node) {
  if (node.type === 'root') return content;
  const lines = splitLines(content);
  spliceOut(lines, node.line, node.subtreeEndLine);
  return join(lines);
}

export function toggleCheck(content, node) {
  if (node.type !== 'list') return content;
  const lines = splitLines(content);
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+)(\[([ xX])\](?:\s+|$))?(.*)$/.exec(lines[node.line]);
  if (!m) return content;
  const box = !m[2] ? '[ ] ' : m[3].toLowerCase() === 'x' ? '[ ] ' : '[x] ';
  lines[node.line] = m[1] + box + m[4];
  return join(lines);
}

const isDescendant = (node, maybe) => { let p = maybe; while (p) { if (p === node || (p.id && p.id === node.id)) return true; p = p.parent; } return false; };

/** Re-parent `node` under `newParent` at `index` (append when omitted). Heading levels / indents are rewritten. */
export function moveNode(content, node, newParent, index) {
  if (!node || !newParent || node.type === 'root' || node === newParent || isDescendant(node, newParent)) return content;
  if (LEAF_TYPES.has(newParent.type) && newParent.parent) {
    const p = newParent.parent;
    index = p.children.indexOf(newParent) + 1;
    newParent = p;
  }
  const lines = splitLines(content);
  const removed = spliceOut(lines, node.line, node.subtreeEndLine);
  let parentLine = newParent.line;
  if (parentLine > node.subtreeEndLine) parentLine -= removed;
  const synthetic = isRootSynthetic(newParent);
  const tree2 = parseMarkdown(join(lines), { promote: !synthetic });
  const parent2 = synthetic ? tree2 : findNodeAtLine(tree2, parentLine);
  if (!parent2) return content;
  if (index != null && node.parent && (node.parent === newParent || node.parent.id === newParent.id)) {
    const oldIdx = node.parent.children.indexOf(node);
    if (oldIdx >= 0 && oldIdx < index) index--;
  }

  const out = [];
  const isHeadingCtx = parent2.type === 'root' || parent2.type === 'heading';
  if (isHeadingCtx) {
    const hLevel = (parent2.type === 'root' && !parent2.promoted ? 0 : parent2.level) + 1;
    // Placed among heading siblings (or after a heading with content) a non-heading node would silently
    // nest under the previous heading, so promote it to a peer heading instead.
    const kids = parent2.children;
    const pos = index == null ? kids.length : Math.min(index, kids.length);
    const nextIsHeading = pos < kids.length && kids[pos].type === 'heading';
    const prevIsHeading = pos > 0 && kids[pos - 1].type === 'heading';
    const mode = hLevel <= 6 && (node.type === 'heading' || nextIsHeading || prevIsHeading) ? 'heading' : 'list';
    const src = mode === 'heading' && (node.type === 'list' || node.type === 'paragraph') ? { ...node, type: 'heading', text: node.text.replace(/\s+/g, ' ').trim() } : node;
    emitNode(src, mode, hLevel, childIndentFor(parent2), '  ', out);
  } else {
    emitNode(node, 'list', 0, childIndentFor(parent2), parent2.indent.includes('\t') ? '\t' : '  ', out);
  }
  while (out.length && out[0] === '') out.shift();

  const children = parent2.children;
  let at;
  if (index == null || index >= children.length) {
    at = isRootSynthetic(parent2) ? lines.length : parent2.subtreeEndLine + 1;
    if (isRootSynthetic(parent2)) while (at > 0 && isBlank(lines[at - 1])) at--;
  } else at = children[index].line;
  const headingBlock = /^#{1,6}\s/.test(out[0]);
  insertLines(lines, at, out, { blankBefore: headingBlock, blankAfter: headingBlock || /^#{1,6}\s/.test(lines[at] || '') });
  return join(lines);
}
