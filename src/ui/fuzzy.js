// fuzzy.js — Obsidian-like fuzzy matching with scoring and highlight ranges.

/** Returns {score, ranges:[[start,end]]} or null when the query does not match. */
export function fuzzyMatch(query, text) {
  if (!query) return { score: 0, ranges: [] };
  const q = query.toLowerCase();
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  // exact substring wins
  const idx = t.indexOf(q);
  if (idx >= 0) {
    let score = 100 - idx * 0.5 - (t.length - q.length) * 0.05;
    if (idx === 0) score += 20;
    if (idx > 0 && /[\s\/\-_.]/.test(t[idx - 1])) score += 10;
    return { score, ranges: [[idx, idx + q.length]] };
  }
  // sequential fuzzy
  let ti = 0, score = 0, prev = -2;
  const ranges = [];
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    if (ch === ' ') continue;
    let found = -1;
    // prefer word boundaries
    for (let k = ti; k < t.length; k++) {
      if (t[k] !== ch) continue;
      if (found < 0) found = k;
      if (k === 0 || /[\s\/\-_.]/.test(t[k - 1])) { found = k; break; }
      if (k > found + 8) break;
    }
    if (found < 0) return null;
    let gain = 1;
    if (found === prev + 1) gain += 4;
    if (found === 0 || /[\s\/\-_.]/.test(t[found - 1])) gain += 3;
    score += gain - (found - ti) * 0.1;
    if (ranges.length && ranges[ranges.length - 1][1] === found) ranges[ranges.length - 1][1] = found + 1;
    else ranges.push([found, found + 1]);
    prev = found;
    ti = found + 1;
  }
  return { score: score - t.length * 0.02, ranges };
}

/** Escapes text and wraps matched ranges in <span class="suggestion-highlight">. */
export function highlight(text, ranges, cls = 'suggestion-highlight') {
  const s = String(text ?? '');
  if (!ranges || !ranges.length) return esc(s);
  let out = '', last = 0;
  for (const [a, b] of ranges) {
    out += esc(s.slice(last, a)) + `<span class="${cls}">` + esc(s.slice(a, b)) + '</span>';
    last = b;
  }
  return out + esc(s.slice(last));
}

/** Sort items by fuzzy score. getText(item) -> string | string[] (first = primary). */
export function fuzzySort(query, items, getText, limit = 100) {
  const out = [];
  for (const item of items) {
    const texts = [].concat(getText(item));
    let best = null;
    texts.forEach((t, i) => {
      const m = fuzzyMatch(query, t);
      if (m && (!best || m.score - i * 5 > best.score)) best = { score: m.score - i * 5, ranges: m.ranges, field: i };
    });
    if (best) out.push({ item, ...best });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

function esc(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
