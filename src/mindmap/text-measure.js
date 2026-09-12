// text-measure.js — canvas-2D text measurement with caching; sizes node content
// (inline HTML with bold/code runs, code blocks, tables) without touching the DOM.

export const DEFAULT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif';
export const MONO_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

let ctx = null;
const widthCache = new Map();
const MAX_CACHE = 20000;

function getCtx() {
  if (ctx) return ctx;
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  ctx = c.getContext('2d');
  return ctx;
}

export function measureText(text, font) {
  if (!text) return 0;
  const key = font + '' + text;
  let w = widthCache.get(key);
  if (w !== undefined) return w;
  const c = getCtx();
  if (c.font !== font) c.font = font;
  w = c.measureText(text).width;
  if (widthCache.size > MAX_CACHE) widthCache.clear();
  widthCache.set(key, w);
  return w;
}

export function clearMeasureCache() { widthCache.clear(); }

const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

/** Split sanitized inline HTML into text runs with style flags. */
export function htmlRuns(html) {
  const runs = [];
  const stack = [];
  const re = /<\/?([a-z0-9]+)[^>]*>|[^<]+/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[0][0] === '<') {
      const tag = m[1].toLowerCase();
      const closing = m[0][1] === '/';
      if (tag === 'img') { runs.push({ text: '', img: true }); continue; }
      if (tag === 'br') { runs.push({ text: '\n' }); continue; }
      if (closing) { const i = stack.lastIndexOf(tag); if (i >= 0) stack.splice(i, 1); }
      else if (!/^(svg|path|rect|circle|polyline|polygon|line)$/.test(tag)) stack.push(tag);
      continue;
    }
    if (stack.includes('svg')) continue;
    runs.push({
      text: decode(m[0]),
      bold: stack.includes('strong') || stack.includes('b') || stack.includes('th'),
      code: stack.includes('code'),
      tag: stack.includes('a') && /class="tag"/.test(html.slice(Math.max(0, m.index - 80), m.index)),
    });
  }
  return runs;
}

/**
 * measureInline(html, cfg) → { w, h, lines }
 * cfg: { fontSize, fontFamily, lineHeight (px), maxWidth, extraWidth }
 */
export function measureInline(html, cfg) {
  const { fontSize, fontFamily = DEFAULT_FONT_FAMILY, lineHeight, maxWidth = Infinity } = cfg;
  const normal = `${fontSize}px ${fontFamily}`;
  const bold = `600 ${fontSize}px ${fontFamily}`;
  const mono = `${Math.round(fontSize * 0.88)}px ${MONO_FONT_FAMILY}`;
  const runs = htmlRuns(html);
  // words with their font, to allow wrapping
  const words = [];
  for (const r of runs) {
    if (r.img) { words.push({ w: fontSize * 2.2, text: '', hard: false }); continue; }
    const font = r.code ? mono : r.bold ? bold : normal;
    const pad = r.code ? 6 : r.tag ? 10 : 0;
    const parts = r.text.split(/(\n)/);
    for (const part of parts) {
      if (part === '\n') { words.push({ br: true }); continue; }
      const tokens = part.split(/(\s+)/);
      for (const tk of tokens) {
        if (!tk) continue;
        words.push({ w: measureText(tk, font) + (/\s/.test(tk) ? 0 : 0), text: tk, space: /^\s+$/.test(tk), pad });
      }
    }
  }
  let total = 0;
  const padTotal = new Set();
  for (const wd of words) { if (!wd.br) { total += wd.w; if (wd.pad) padTotal.add(wd.pad); } }
  total += [...padTotal].reduce((a, b) => a + b, 0) + (runs.filter(r => r.code).length + runs.filter(r => r.tag).length) * 4;
  const hasBr = words.some(w => w.br);
  if (total <= maxWidth && !hasBr) return { w: Math.ceil(total), h: Math.ceil(lineHeight), lines: 1 };
  // greedy wrap
  let lines = 1, cur = 0, widest = 0;
  for (const wd of words) {
    if (wd.br) { widest = Math.max(widest, cur); lines++; cur = 0; continue; }
    if (cur + wd.w > maxWidth && cur > 0 && !wd.space) { widest = Math.max(widest, cur); lines++; cur = 0; }
    cur += wd.w + (wd.pad ? 2 : 0);
    if (cur > maxWidth) { widest = Math.max(widest, maxWidth); }
  }
  widest = Math.max(widest, cur);
  return { w: Math.ceil(Math.min(maxWidth, widest)), h: Math.ceil(lines * lineHeight), lines };
}

/** Size of a fenced code block (monospace, no wrapping). */
export function measureCode(body, cfg) {
  const size = Math.round(cfg.fontSize * 0.85);
  const font = `${size}px ${MONO_FONT_FAMILY}`;
  const lines = (body || '').split('\n');
  let w = 0;
  for (const l of lines) w = Math.max(w, measureText(l.replace(/\t/g, '    '), font));
  const lh = size * 1.45;
  return { w: Math.ceil(w) + 20, h: Math.ceil(lines.length * lh) + 14, lines: lines.length };
}

/** Size of a pipe table (rows as raw strings). */
export function measureTable(rows, cfg) {
  const size = Math.round(cfg.fontSize * 0.9);
  const font = `${size}px ${cfg.fontFamily || DEFAULT_FONT_FAMILY}`;
  const cellsOf = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const cols = [];
  const body = rows.filter((r, i) => i !== 1);
  for (const r of body) cellsOf(r).forEach((c, i) => { cols[i] = Math.max(cols[i] || 0, measureText(c.replace(/[*_`~=]/g, ''), font)); });
  const w = cols.reduce((a, b) => a + b + 18, 0) + 2;
  return { w: Math.ceil(w), h: Math.ceil(body.length * size * 1.7) + 4, lines: body.length };
}
