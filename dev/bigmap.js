// bigmap.js — deterministic generators for large synthetic maps / graphs (stress tests).
import { seededRandom } from '../src/mindmap/utils.js';

const TOPICS = ['Architecture', 'Rendering', 'Layout', 'Parsing', 'Storage', 'Plugins', 'Themes', 'Keyboard', 'Search', 'Graph',
  'Canvas', 'Export', 'Import', 'Sync', 'Performance', 'Accessibility', 'Testing', 'Release', 'Roadmap', 'Community'];
const WORDS = ['node', 'tree', 'link', 'tag', 'note', 'vault', 'pane', 'split', 'theme', 'accent', 'zoom', 'pan', 'fit', 'badge',
  'toggle', 'depth', 'color', 'thickness', 'font', 'screenshot', 'outline', 'heading', 'bullet', 'checkbox', 'embed', 'image', 'code'];
const TAGS = ['#todo', '#idea', '#bug', '#design', '#urgent', '#docs'];

/**
 * generateBigMap(total=1500, seed=7) → markdown with ~total nodes: H1/H2/H3 headings and nested bullets,
 * sprinkled with tags, wikilinks, checkboxes, inline code, one fenced block and one table.
 */
export function generateBigMap(total = 1500, seed = 7) {
  const rnd = seededRandom(seed);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const phrase = (n = 2 + Math.floor(rnd() * 4)) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
  const lines = ['---', 'title: Big map', 'tags: [stress, demo]', '---'];
  let count = 1;
  const decorate = t => {
    const r = rnd();
    if (r < 0.08) return `${t} ${pick(TAGS)}`;
    if (r < 0.14) return `${t} [[${pick(TOPICS)}]]`;
    if (r < 0.18) return `**${t}**`;
    if (r < 0.21) return `${t} \`${pick(WORDS)}()\``;
    if (r < 0.24) return `==${t}==`;
    return t;
  };
  let h1 = 0;
  while (count < total) {
    h1++;
    lines.push('', `# ${pick(TOPICS)} ${h1}`); count++;
    const h2n = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < h2n && count < total; i++) {
      lines.push('', `## ${decorate(phrase(2))}`); count++;
      if (rnd() < 0.3) { lines.push(`${phrase(6)}.`); count++; }
      const items = 3 + Math.floor(rnd() * 6);
      for (let j = 0; j < items && count < total; j++) {
        const check = rnd() < 0.25 ? (rnd() < 0.5 ? '[ ] ' : '[x] ') : '';
        lines.push(`- ${check}${decorate(phrase())}`); count++;
        const sub = rnd() < 0.6 ? Math.floor(rnd() * 5) : 0;
        for (let k = 0; k < sub && count < total; k++) {
          lines.push(`  - ${decorate(phrase())}`); count++;
          if (rnd() < 0.3 && count < total) { lines.push(`    - ${phrase(3)}`); count++; }
        }
      }
      if (rnd() < 0.15 && count < total) {
        lines.push('', '### ' + phrase(2)); count++;
        for (let j = 0; j < 3 && count < total; j++) { lines.push(`- ${phrase()}`); count++; }
      }
    }
    if (h1 === 2) { lines.push('', '```js', 'export const answer = 42;', 'console.log(answer);', '```'); count++; }
    if (h1 === 3) { lines.push('', '| feature | status |', '|---|---|', '| layout | done |', '| graph | wip |'); count++; }
  }
  return lines.join('\n') + '\n';
}

/** generateGraph(n=1500, seed=3) → {nodes, edges} suitable for GraphView.setData. */
export function generateGraph(n = 1500, seed = 3) {
  const rnd = seededRandom(seed);
  const nodes = [], edges = [];
  const folders = ['Projects', 'Areas', 'Resources', 'Archive', 'Daily'];
  const tagCount = Math.max(4, Math.floor(n / 60));
  for (let i = 0; i < tagCount; i++) nodes.push({ id: 't' + i, name: TAGS[i % TAGS.length] + (i >= TAGS.length ? i : ''), type: 'tag', tags: [], linkCount: 0 });
  for (let i = 0; i < n; i++) {
    const r = rnd();
    const type = r < 0.06 ? 'unresolved' : r < 0.1 ? 'attachment' : 'note';
    const folder = folders[Math.floor(rnd() * folders.length)];
    const name = type === 'attachment' ? `image-${i}.png` : `${WORDS[i % WORDS.length]} ${i}`;
    nodes.push({ id: 'n' + i, path: `${folder}/${name}${type === 'note' ? '.md' : ''}`, name, type,
      tags: rnd() < 0.15 ? [TAGS[Math.floor(rnd() * TAGS.length)]] : [],
      unread: rnd() < 0.08, recent: rnd() < 0.06, important: rnd() < 0.03, linkCount: 0 });
  }
  const seen = new Set();
  const add = (s, t, type) => { if (s === t) return; const k = s + '>' + t; if (seen.has(k)) return; seen.add(k); edges.push({ source: s, target: t, type }); };
  for (let i = 0; i < n; i++) {
    // preferential attachment: link to earlier nodes, biased toward hubs
    const links = 1 + Math.floor(Math.pow(rnd(), 2) * 4);
    for (let j = 0; j < links; j++) {
      const target = Math.floor(Math.pow(rnd(), 1.6) * i);
      if (i > 0) add('n' + i, 'n' + target, 'link');
    }
    if (rnd() < 0.15) add('n' + i, 't' + Math.floor(rnd() * tagCount), 'tag');
  }
  const deg = new Map();
  for (const e of edges) { deg.set(e.source, (deg.get(e.source) || 0) + 1); deg.set(e.target, (deg.get(e.target) || 0) + 1); }
  for (const nd of nodes) nd.linkCount = deg.get(nd.id) || 0;
  return { nodes, edges };
}

/** Small sample canvas for the demo. */
export function sampleCanvas() {
  return {
    nodes: [
      { id: 'g1', type: 'group', x: -40, y: -60, width: 620, height: 340, label: 'Mind Map engine', color: '6' },
      { id: 'a', type: 'text', x: 0, y: 0, width: 260, height: 90, text: '# Parser\nMarkdown → tree with **stable ids** and line ranges', color: '4' },
      { id: 'b', type: 'text', x: 320, y: 0, width: 240, height: 90, text: '# Renderer\nSVG tidy layout, animated transitions', color: '5' },
      { id: 'c', type: 'file', x: 0, y: 160, width: 260, height: 80, file: 'Notes/Architecture.md', color: '3' },
      { id: 'd', type: 'link', x: 320, y: 160, width: 240, height: 80, url: 'https://jsoncanvas.org' },
      { id: 'e', type: 'text', x: 700, y: 60, width: 220, height: 110, text: 'Graph view\n- force simulation\n- Barnes-Hut\n- hover neighbours', color: '1' },
    ],
    edges: [
      { id: 'e1', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left', label: 'tree' },
      { id: 'e2', fromNode: 'a', fromSide: 'bottom', toNode: 'c', toSide: 'top', color: '4' },
      { id: 'e3', fromNode: 'b', fromSide: 'bottom', toNode: 'd', toSide: 'top', toEnd: 'none' },
      { id: 'e4', fromNode: 'b', fromSide: 'right', toNode: 'e', toSide: 'left', label: 'links', color: '1', fromEnd: 'arrow' },
    ],
  };
}
