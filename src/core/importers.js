// importers.js — file importers: Markdown/txt, OPML, FreeMind (.mm), XMind (.xmind zip:
// content.json or legacy content.xml), MindMeister (.mind zip: map.json), JSON Canvas, tab outline.
// Includes a dependency-free ZIP reader (stored + deflate via DecompressionStream('deflate-raw')).

// ───────────────────────────── zip ─────────────────────────────
const SIG_EOCD = 0x06054b50, SIG_CD = 0x02014b50, SIG_LOCAL = 0x04034b50;
const utf8 = new TextDecoder('utf-8');

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream is not supported in this browser');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** readZip(File|Blob|ArrayBuffer|Uint8Array) → Map<name, Uint8Array> (directories skipped). */
export async function readZip(input) {
  let buf;
  if (input instanceof ArrayBuffer) buf = input;
  else if (ArrayBuffer.isView(input)) buf = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  else if (input && typeof input.arrayBuffer === 'function') buf = await input.arrayBuffer();
  else throw new Error('readZip: unsupported input');
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) { if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; } }
  if (eocd < 0) throw new Error('Not a zip file (end of central directory not found)');
  const count = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff) throw new Error('ZIP64 archives are not supported');
  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== SIG_CD) throw new Error('Corrupt zip: bad central directory entry');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & 0x800) ? utf8.decode(nameBytes) : String.fromCharCode(...nameBytes);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (compSize === 0xffffffff || size === 0xffffffff) throw new Error('ZIP64 entries are not supported');
    if (dv.getUint32(localOffset, true) !== SIG_LOCAL) throw new Error('Corrupt zip: bad local header for ' + name);
    const ln = dv.getUint16(localOffset + 26, true), le = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + ln + le;
    const data = bytes.subarray(dataStart, dataStart + compSize);
    if (method === 0) entries.set(name, data.slice());
    else if (method === 8) entries.set(name, await inflateRaw(data.slice()));
    else throw new Error(`Unsupported zip compression method ${method} for ${name}`);
  }
  return entries;
}

const entryText = (entries, name) => {
  const direct = entries.get(name);
  const hit = direct || [...entries.entries()].find(([k]) => k.endsWith('/' + name))?.[1];
  return hit ? utf8.decode(hit) : null;
};

// ───────────────────────────── outline → markdown ─────────────────────────────
/** items: {text, children:[], note?, checked?, link?, tags?} — root rendered as H1, descendants as bullets. */
export function outlineToMarkdown(root, { title } = {}) {
  const lines = [];
  const clean = t => String(t ?? '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const safe = t => (/^([#>]|[-*+]\s|\d+[.)]\s)/.test(t) ? '\\' + t : t);
  const emit = (n, depth) => {
    const prefix = '  '.repeat(depth) + '- ';
    let text = safe(clean(n.text)) || '(untitled)';
    if (n.link) text = `[${text}](${n.link})`;
    if (n.checked === true) text = '[x] ' + text; else if (n.checked === false) text = '[ ] ' + text;
    if (n.tags && n.tags.length) text += ' ' + n.tags.map(t => (String(t).startsWith('#') ? t : '#' + t)).join(' ');
    lines.push(prefix + text);
    if (n.note && clean(n.note)) lines.push('  '.repeat(depth + 1) + '- *' + clean(n.note).slice(0, 500) + '*');
    for (const c of n.children || []) emit(c, depth + 1);
  };
  if (!root) return `# ${title || 'Imported'}\n`;
  const roots = Array.isArray(root) ? root : [root];
  if (roots.length === 1) {
    lines.push(`# ${clean(roots[0].text) || title || 'Imported'}`);
    if (roots[0].note && clean(roots[0].note)) lines.push('', clean(roots[0].note));
    for (const c of roots[0].children || []) emit(c, 0);
  } else {
    lines.push(`# ${title || 'Imported'}`);
    for (const r of roots) emit(r, 0);
  }
  return lines.join('\n') + '\n';
}

function parseXml(xml) {
  const text = typeof xml === 'string' ? xml : utf8.decode(xml);
  const doc = new DOMParser().parseFromString(text.replace(/^﻿/, ''), 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid XML');
  return doc;
}
const childEls = (el, name) => [...el.children].filter(c => c.localName === name);

// ───────────────────────────── OPML ─────────────────────────────
export function opmlToMarkdown(xml) {
  const doc = parseXml(xml);
  const body = doc.getElementsByTagName('body')[0];
  if (!body) throw new Error('OPML: missing <body>');
  const titleEl = doc.getElementsByTagName('title')[0];
  const title = titleEl ? titleEl.textContent.trim() : undefined;
  const conv = el => ({
    text: el.getAttribute('text') || el.getAttribute('title') || '',
    note: el.getAttribute('_note') || undefined,
    link: el.getAttribute('url') || el.getAttribute('htmlUrl') || el.getAttribute('xmlUrl') || undefined,
    checked: el.getAttribute('_status') === 'checked' ? true : el.getAttribute('_status') === 'unchecked' ? false : undefined,
    children: childEls(el, 'outline').map(conv),
  });
  const roots = childEls(body, 'outline').map(conv);
  return outlineToMarkdown(roots.length === 1 ? roots[0] : roots, { title });
}

// ───────────────────────────── FreeMind / Freeplane ─────────────────────────────
export function freemindToMarkdown(xml) {
  const doc = parseXml(xml);
  const map = doc.documentElement;
  if (!map || (map.localName !== 'map' && map.localName !== 'node')) throw new Error('FreeMind: missing <map>');
  const textOf = el => {
    const t = el.getAttribute('TEXT');
    if (t != null && t !== '') return t;
    const rc = childEls(el, 'richcontent').find(r => (r.getAttribute('TYPE') || 'NODE').toUpperCase() === 'NODE');
    return rc ? (rc.textContent || '').replace(/\s+/g, ' ').trim() : '';
  };
  const noteOf = el => { const rc = childEls(el, 'richcontent').find(r => (r.getAttribute('TYPE') || '').toUpperCase() === 'NOTE'); return rc ? rc.textContent.replace(/\s+/g, ' ').trim() : undefined; };
  const conv = el => {
    const icons = childEls(el, 'icon').map(i => i.getAttribute('BUILTIN'));
    return { text: textOf(el), note: noteOf(el), link: el.getAttribute('LINK') || undefined,
      checked: icons.includes('button_ok') ? true : icons.includes('button_cancel') ? false : undefined,
      children: childEls(el, 'node').map(conv) };
  };
  const roots = (map.localName === 'node' ? [map] : childEls(map, 'node')).map(conv);
  if (!roots.length) throw new Error('FreeMind: no <node> elements found');
  return outlineToMarkdown(roots.length === 1 ? roots[0] : roots, { title: 'FreeMind' });
}

// ───────────────────────────── XMind ─────────────────────────────
function xmindTopic(t) {
  if (!t) return { text: '', children: [] };
  const markers = (t.markers || []).map(m => m.markerId || '');
  const attached = (t.children && (t.children.attached || t.children.topics)) || [];
  const detached = (t.children && t.children.detached) || [];
  return {
    text: t.title || '',
    note: (t.notes && ((t.notes.plain && t.notes.plain.content) || (t.notes.realHTML && t.notes.realHTML.content))) || undefined,
    link: t.href && /^https?:/.test(t.href) ? t.href : undefined,
    checked: markers.some(m => /task-done|task-100/.test(m)) ? true : markers.some(m => /^task-/.test(m)) ? false : undefined,
    tags: t.labels && t.labels.length ? t.labels : undefined,
    children: attached.map(xmindTopic).concat(detached.map(xmindTopic)),
  };
}
function xmindLegacyTopic(el) {
  const title = childEls(el, 'title')[0];
  const notes = childEls(el, 'notes')[0];
  const kids = childEls(el, 'children').flatMap(ch => childEls(ch, 'topics').filter(ts => (ts.getAttribute('type') || 'attached') === 'attached').flatMap(ts => childEls(ts, 'topic')));
  const markers = childEls(el, 'marker-refs')[0];
  const markerIds = markers ? childEls(markers, 'marker-ref').map(m => m.getAttribute('marker-id') || '') : [];
  return { text: title ? title.textContent.trim() : '', note: notes ? notes.textContent.replace(/\s+/g, ' ').trim() : undefined,
    link: el.getAttribute('xlink:href') || undefined,
    checked: markerIds.some(m => /task-done/.test(m)) ? true : markerIds.some(m => /^task-/.test(m)) ? false : undefined,
    children: kids.map(xmindLegacyTopic) };
}
export function xmindToMarkdown(entries) {
  const json = entryText(entries, 'content.json');
  if (json) {
    let sheets = JSON.parse(json);
    if (!Array.isArray(sheets)) sheets = sheets && sheets.rootTopic ? [sheets] : [];
    const roots = sheets.filter(s => s && s.rootTopic).map(s => xmindTopic(s.rootTopic));
    if (roots.length === 1) return outlineToMarkdown(roots[0]);
    if (roots.length) return roots.map(r => outlineToMarkdown(r)).join('\n');
  }
  const xml = entryText(entries, 'content.xml');
  if (xml) {
    const doc = parseXml(xml);
    const roots = [...doc.getElementsByTagName('sheet')].map(s => childEls(s, 'topic')[0]).filter(Boolean).map(xmindLegacyTopic);
    if (!roots.length) throw new Error('XMind: no topics found');
    return roots.length === 1 ? outlineToMarkdown(roots[0]) : roots.map(r => outlineToMarkdown(r)).join('\n');
  }
  throw new Error('XMind: content.json / content.xml not found');
}

// ───────────────────────────── MindMeister ─────────────────────────────
export function mindmeisterToMarkdown(entries) {
  const json = typeof entries === 'string' ? entries : entryText(entries, 'map.json');
  if (!json) throw new Error('MindMeister: map.json not found');
  const data = JSON.parse(json);
  const rootSrc = data.root || data.idea || (data.map && data.map.root) || data;
  const conv = raw => {
    const i = raw && raw.idea ? { ...raw.idea, children: raw.idea.children || raw.children } : raw || {};
    return { text: i.title ?? i.text ?? i.name ?? '', note: i.note || undefined, link: i.link || undefined,
      checked: i.task ? !!i.task.done : undefined,
      children: (i.children || i.ideas || []).map(conv) };
  };
  return outlineToMarkdown(conv(rootSrc), { title: data.title || data.name });
}

// ───────────────────────────── JSON Canvas ─────────────────────────────
export function canvasToMarkdown(canvas, name = 'Canvas') {
  const nodes = canvas.nodes || [];
  const groups = nodes.filter(n => n.type === 'group');
  const inGroup = n => groups.find(g => g !== n && n.x >= g.x && n.y >= g.y && n.x + (n.width || 0) <= g.x + g.width && n.y + (n.height || 0) <= g.y + g.height);
  const item = n => {
    if (n.type === 'file') return { text: `[[${n.file}]]`, children: [] };
    if (n.type === 'link') return { text: n.url || '', children: [] };
    const lines = String(n.text || '').split(/\r?\n/).map(l => l.replace(/^#+\s*|^\s*[-*+]\s+/, '').trim()).filter(Boolean);
    return { text: lines[0] || '(empty card)', children: lines.slice(1).map(l => ({ text: l, children: [] })) };
  };
  const roots = [];
  for (const g of groups) roots.push({ text: g.label || 'Group', children: nodes.filter(n => n.type !== 'group' && inGroup(n) === g).map(item) });
  for (const n of nodes) if (n.type !== 'group' && !inGroup(n)) roots.push(item(n));
  return outlineToMarkdown({ text: name, children: roots });
}

// ───────────────────────────── tab outline ─────────────────────────────
export function outlineTextToMarkdown(text, name = 'Outline') {
  const rows = String(text).replace(/\r/g, '').split('\n').filter(l => l.trim());
  const items = rows.map(l => {
    const m = /^([\t ]*)(?:[-*+•]\s+)?(.*)$/.exec(l);
    return { indent: m[1].replace(/\t/g, '    ').length, text: m[2].trim(), children: [] };
  });
  const roots = [], stack = [];
  for (const it of items) {
    while (stack.length && stack[stack.length - 1].indent >= it.indent) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(it); else roots.push(it);
    stack.push(it);
  }
  return outlineToMarkdown(roots.length === 1 ? roots[0] : { text: name, children: roots }, { title: name });
}

// ───────────────────────────── dispatcher ─────────────────────────────
function looksLikeMarkdown(text) { return /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|---)/m.test(text); }

/** importFile(File) → { name, markdown, canvas? } */
export async function importFile(file) {
  const name = (file.name || 'import').replace(/\.[^.]+$/, '') || 'import';
  const ext = (file.name || '').split('.').pop().toLowerCase();
  const text = () => file.text();
  switch (ext) {
    case 'md': case 'markdown': return { name, markdown: await text() };
    case 'txt': { const t = await text(); return { name, markdown: looksLikeMarkdown(t) ? t : outlineTextToMarkdown(t, name) }; }
    case 'opml': return { name, markdown: opmlToMarkdown(await text()) };
    case 'mm': return { name, markdown: freemindToMarkdown(await text()) };
    case 'xmind': return { name, markdown: xmindToMarkdown(await readZip(file)) };
    case 'mind': case 'mindmeister': return { name, markdown: mindmeisterToMarkdown(await readZip(file)) };
    case 'canvas': case 'json': {
      const t = await text();
      const data = JSON.parse(t);
      if (data && Array.isArray(data.nodes) && Array.isArray(data.edges)) return { name, markdown: canvasToMarkdown(data, name), canvas: data };
      if (Array.isArray(data) && data[0] && data[0].rootTopic) return { name, markdown: xmindToMarkdown(new Map([['content.json', new TextEncoder().encode(t)]])) };
      if (data && (data.root || data.idea)) return { name, markdown: mindmeisterToMarkdown(t) };
      throw new Error('Unrecognized JSON structure (expected JSON Canvas, XMind or MindMeister)');
    }
    default: {
      const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
      if (head[0] === 0x50 && head[1] === 0x4b) { const entries = await readZip(file); return { name, markdown: entries.has('map.json') ? mindmeisterToMarkdown(entries) : xmindToMarkdown(entries) }; }
      const t = await text();
      if (t.trimStart().startsWith('<opml')) return { name, markdown: opmlToMarkdown(t) };
      if (t.trimStart().startsWith('<map')) return { name, markdown: freemindToMarkdown(t) };
      return { name, markdown: looksLikeMarkdown(t) ? t : outlineTextToMarkdown(t, name) };
    }
  }
}
