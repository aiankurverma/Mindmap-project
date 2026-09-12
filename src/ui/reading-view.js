// reading-view.js — block-level markdown → HTML for the reading view. Inline rendering is delegated to
// the engine's renderInline() when available, otherwise to the built-in fallback below.
import { escapeHtml } from './dom.js';
import { iconSVG } from './icons.js';

/** Fallback inline renderer (engine missing): bold, italic, strike, highlight, code, links, wikilinks, tags, images. */
export function fallbackInline(text) {
  let s = escapeHtml(text);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(`<code>${c}</code>`); return `@@CODE${codes.length - 1}@@`; });
  s = s.replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (m, t) => `<span class="internal-embed" data-href="${t.trim()}">![[${t.trim()}]]</span>`);
  s = s.replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (m, t, h, alias) => `<a class="internal-link" data-href="${t.trim()}${h || ''}" href="#">${alias ? alias.trim() : t.trim() + (h ? h : '')}</a>`);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => `<img alt="${alt}" src="${src}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, href) => `<a class="external-link" href="${href}" target="_blank" rel="noopener">${t}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => `${pre}<a class="external-link" href="${url}" target="_blank" rel="noopener">${url}</a>`);
  s = s.replace(/(^|[\s(])#([A-Za-z0-9_][\w\-/]*)/g, (m, pre, tag) => `${pre}<a class="tag" href="#${tag}">#${tag}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>').replace(/==([^=]+)==/g, '<mark>$1</mark>');
  s = s.replace(/@@CODE(\d+)@@/g, (m, i) => codes[+i]);
  return s;
}

const CALLOUT_ICONS = { note: 'pencil', info: 'info', tip: 'star', warning: 'alert', caution: 'alert', danger: 'alert', error: 'x', bug: 'x', question: 'help', success: 'check', quote: 'list', example: 'list', abstract: 'list', todo: 'check-square' };

export function renderMarkdown(content, { renderInline = fallbackInline, parseFrontmatter = null } = {}) {
  let body = content || '';
  let fm = null;
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body);
  if (m) {
    body = body.slice(m[0].length);
    if (parseFrontmatter) { try { fm = parseFrontmatter(content).data; } catch { fm = null; } }
    if (!fm) fm = parseYamlLite(m[1]);
  }
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  if (fm && Object.keys(fm).length) out.push(renderProperties(fm, renderInline));
  let i = 0;
  const inline = (t) => { try { return renderInline(t); } catch { return fallbackInline(t); } };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let mm;
    if ((mm = /^(`{3,}|~{3,})\s*(\S*)/.exec(line))) {
      const fence = mm[1][0]; const lang = mm[2];
      const buf = []; i++;
      while (i < lines.length && !new RegExp(`^${fence}{3,}\\s*$`).test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre>${lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : ''}<code class="${lang ? 'language-' + escapeHtml(lang) : ''}">${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if ((mm = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      const level = mm[1].length; const text = mm[2];
      out.push(`<h${level} data-heading="${escapeHtml(text)}" id="${slug(text)}">${inline(text)}</h${level}>`);
      i++; continue;
    }
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      const co = /^\[!(\w+)\]([+-])?\s*(.*)$/.exec(buf[0] || '');
      if (co) {
        const type = co[1].toLowerCase();
        const title = co[3] || type.charAt(0).toUpperCase() + type.slice(1);
        out.push(`<div class="callout" data-callout="${escapeHtml(type)}"><div class="callout-title">${iconSVG(CALLOUT_ICONS[type] || 'info', { size: 16 })}${inline(title)}</div><div class="callout-content">${renderMarkdown(buf.slice(1).join('\n'), { renderInline })}</div></div>`);
      } else out.push(`<blockquote>${renderMarkdown(buf.join('\n'), { renderInline })}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const header = splitRow(line); const aligns = splitRow(lines[i + 1]).map((c) => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '');
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(splitRow(lines[i++]));
      out.push(`<table><thead><tr>${header.map((c, k) => `<th${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => `<td${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const items = [];
      while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s+\S/.test(lines[i]) && items.length))) {
        const lm = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (lm) items.push({ indent: lm[1].replace(/\t/g, '    ').length, ordered: /\d/.test(lm[2]), text: lm[3] });
        else items[items.length - 1].text += '\n' + lines[i].trim();
        i++;
      }
      out.push(renderList(items, inline));
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|~~~|\s*>|\s*([-*+]|\d+[.)])\s+|\s*\|)/.test(lines[i]) && !/^(\s*[-*_]\s*){3,}$/.test(lines[i])) buf.push(lines[i++]);
    if (buf.length) out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    else i++;
  }
  return out.join('\n');
}

function renderList(items, inline) {
  // Build nested structure by indent.
  const root = { children: [] };
  const stack = [{ indent: -1, node: root }];
  for (const it of items) {
    const node = { ...it, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].indent >= it.indent) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ indent: it.indent, node });
  }
  const render = (nodes) => {
    if (!nodes.length) return '';
    const ordered = nodes[0].ordered;
    let html = ordered ? '<ol>' : '<ul>';
    for (const n of nodes) {
      const task = /^\[([ xX])\]\s+(.*)$/.exec(n.text);
      const inner = task ? `<input type="checkbox" class="task-list-item-checkbox" ${task[1] !== ' ' ? 'checked' : ''} tabindex="-1">${inline(task[2])}` : inline(n.text);
      html += `<li${task ? ` class="task-list-item${task[1] !== ' ' ? ' is-checked' : ''}" data-task="${task[1]}"` : ''}>${inner}${render(n.children)}</li>`;
    }
    return html + (ordered ? '</ol>' : '</ul>');
  };
  return render(root.children);
}

function renderProperties(fm, inline) {
  const rows = Object.entries(fm).map(([k, v]) => {
    let val;
    const tagLink = (x) => { const t = escapeHtml(String(x).replace(/^#/, '')); return `<a class="tag" href="#${t}">#${t}</a>`; };
    if (Array.isArray(v)) val = v.map((x) => (k === 'tags' ? tagLink(x) : `<span class="pill">${escapeHtml(String(x))}</span>`)).join('');
    else if (typeof v === 'boolean') val = `<span class="pill ${v ? 'mod-success' : ''}">${v}</span>`;
    else val = k === 'tags' ? String(v).split(/[,\s]+/).filter(Boolean).map(tagLink).join('') : inline(String(v));
    const ic = k === 'tags' ? 'tag' : k === 'aliases' ? 'link' : Array.isArray(v) ? 'list' : typeof v === 'boolean' ? 'check-square' : /date|time/.test(k) ? 'calendar' : 'type';
    return `<div class="metadata-property"><span class="metadata-property-key">${iconSVG(ic, { size: 14 })}${escapeHtml(k)}</span><span class="metadata-property-value">${val}</span></div>`;
  });
  return `<div class="metadata-container">${rows.join('')}</div>`;
}

export function parseYamlLite(yaml) {
  const data = {};
  const lines = yaml.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_\-]+):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const v = m[2].trim();
    if (!v) { const arr = []; while (i + 1 < lines.length && /^\s+-\s*/.test(lines[i + 1])) arr.push(lines[++i].replace(/^\s+-\s*/, '').trim().replace(/^["']|["']$/g, '')); data[m[1]] = arr.length ? arr : ''; continue; }
    if (v.startsWith('[') && v.endsWith(']')) data[m[1]] = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else if (v === 'true' || v === 'false') data[m[1]] = v === 'true';
    else if (/^-?\d+(\.\d+)?$/.test(v)) data[m[1]] = Number(v);
    else data[m[1]] = v.replace(/^["']|["']$/g, '');
  }
  return data;
}

function splitRow(line) { return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()); }
function slug(t) { return String(t).toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-'); }
