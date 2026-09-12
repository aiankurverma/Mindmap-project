// exporters.js — SVG / PNG / PDF / Markdown / OPML / FreeMind exports, clipboard screenshot, download.
import { treeToMarkdown } from './markdown.js';
import { escapeAttr, escapeHtml } from '../mindmap/utils.js';

const isSafari = typeof navigator !== 'undefined' && /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

function viewToSVG(view, opts) {
  if (!view || typeof view.toSVG !== 'function') throw new Error('exportSVG: view does not implement toSVG()');
  return view.toSVG(opts);
}

/** Self-contained SVG markup (styles inlined by the view). */
export async function exportSVG(view, { inlineStyles = true, background, textMode = 'html', theme, foreground, text } = {}) {
  let svg = viewToSVG(view, { background, textMode, theme });
  if (!inlineStyles) svg = svg.replace(/<style>[\s\S]*?<\/style>/, '');
  const overrides = [];
  if (text) overrides.push(`.mm-content{color:${text}!important}.mm-svg text{fill:${text}!important}`);
  if (foreground) overrides.push(`.mm-link,.mm-underline{stroke:${foreground}!important}.mm-toggle{stroke:${foreground}!important}`);
  if (overrides.length) svg = svg.replace(/<\/style>/, `${overrides.join('')}</style>`).replace(/(<svg[^>]*>)(?![\s\S]*<style>)/, `$1<style>${overrides.join('')}</style>`);
  if (!svg.startsWith('<?xml')) svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg;
  return svg;
}

function svgSize(svg) {
  const w = /<svg[^>]*\swidth="([\d.]+)"/.exec(svg), h = /<svg[^>]*\sheight="([\d.]+)"/.exec(svg);
  return { w: w ? +w[1] : 800, h: h ? +h[1] : 600 };
}

function loadImage(svg) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'sync';
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG image failed to load')); };
    img.src = url;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'); } catch (err) { reject(err); }
  });
}

/**
 * exportPNG(view, {scale, background, foreground, text, width, height, transparent}) → Blob
 * Renders the view's SVG into a canvas. Falls back to plain <text> SVG when foreignObject
 * taints the canvas (Safari) or fails to rasterize.
 */
export async function exportPNG(view, { scale = 2, background, foreground, text, width, height, transparent = false, textMode } = {}) {
  const bg = transparent ? 'transparent' : background;
  const attempt = async mode => {
    const svg = await exportSVG(view, { background: bg, textMode: mode, foreground, text });
    const { w, h } = svgSize(svg);
    let cw = w, ch = h, s = scale;
    if (width || height) { s = Math.min(width ? width / w : Infinity, height ? height / h : Infinity); }
    cw = Math.max(1, Math.round(w * s)); ch = Math.max(1, Math.round(h * s));
    const img = await loadImage(svg);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!transparent) { ctx.fillStyle = background || (view.options && view.options.theme === 'light' ? '#ffffff' : '#202020'); ctx.fillRect(0, 0, cw, ch); }
    ctx.drawImage(img, 0, 0, cw, ch);
    return canvasToBlob(canvas);
  };
  const first = textMode || (isSafari ? 'text' : 'html');
  try { return await attempt(first); } catch (err) {
    if (first === 'text') throw err;
    return attempt('text');
  }
}

/** Opens the browser print dialog with the map rendered as an image (cross-platform "PDF"). */
export async function exportPDF(view, { title = 'Mind map', background, transparent } = {}) {
  const blob = await exportPNG(view, { scale: 2, background, transparent });
  const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>@page{size:auto;margin:10mm}html,body{margin:0;background:#fff}img{max-width:100%;max-height:96vh;display:block;margin:0 auto}</style></head>
<body><img src="${dataUrl}" alt="${escapeAttr(title)}"><script>window.onload=function(){var i=document.querySelector('img');function go(){setTimeout(function(){window.focus();window.print();},50);}if(i.complete)go();else i.onload=go;};</script></body></html>`;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(iframe);
  iframe.srcdoc = html;
  await new Promise(res => { iframe.onload = res; setTimeout(res, 3000); });
  const cleanup = () => { setTimeout(() => iframe.remove(), 1000); };
  try { iframe.contentWindow.addEventListener('afterprint', cleanup); } catch { /* ignore */ }
  setTimeout(cleanup, 120000);
  return iframe;
}

export function exportMarkdown(tree) { return treeToMarkdown(tree); }

function outlineText(node) { return node.text || ''; }

export function exportOPML(tree, { title } = {}) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', `  <head><title>${escapeHtml(title || (tree && tree.text) || 'Mind map')}</title></head>`, '  <body>'];
  const walk = (n, ind) => {
    const attrs = [`text="${escapeAttr(outlineText(n))}"`];
    if (n.checked != null) attrs.push(`_status="${n.checked ? 'checked' : 'unchecked'}"`);
    if (n.color) attrs.push(`color="${escapeAttr(n.color)}"`);
    if (n.children && n.children.length) {
      lines.push(`${ind}<outline ${attrs.join(' ')}>`);
      for (const c of n.children) walk(c, ind + '  ');
      lines.push(`${ind}</outline>`);
    } else lines.push(`${ind}<outline ${attrs.join(' ')}/>`);
  };
  if (tree) walk(tree, '    ');
  lines.push('  </body>', '</opml>', '');
  return lines.join('\n');
}

export function exportFreeMind(tree) {
  let id = 0;
  const lines = ['<map version="1.0.1">'];
  const walk = (n, ind, depth, i) => {
    const attrs = [`ID="ID_${++id}"`, `TEXT="${escapeAttr(outlineText(n))}"`];
    if (depth === 1) attrs.push(`POSITION="${i % 2 === 0 ? 'right' : 'left'}"`);
    if (n.color) attrs.push(`COLOR="${escapeAttr(n.color)}"`);
    const kids = n.children || [];
    const icons = n.checked === true ? `${ind}  <icon BUILTIN="button_ok"/>` : n.checked === false ? `${ind}  <icon BUILTIN="button_cancel"/>` : '';
    if (kids.length || icons) {
      lines.push(`${ind}<node ${attrs.join(' ')}>`);
      if (icons) lines.push(icons);
      kids.forEach((c, j) => walk(c, ind + '  ', depth + 1, j));
      lines.push(`${ind}</node>`);
    } else lines.push(`${ind}<node ${attrs.join(' ')}/>`);
  };
  if (tree) walk(tree, '  ', 0, 0);
  lines.push('</map>', '');
  return lines.join('\n');
}

/** Copy a PNG of the view to the clipboard; falls back to downloading the file. */
export async function copyScreenshot(view, opts = {}) {
  const filename = opts.filename || 'mindmap.png';
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    try {
      const png = exportPNG(view, opts);
      const item = new ClipboardItem({ 'image/png': isSafari ? png : await png });
      await navigator.clipboard.write([item]);
      return { method: 'clipboard' };
    } catch (err) {
      console.warn('Clipboard write failed, downloading instead', err);
    }
  }
  download(await exportPNG(view, opts), filename, 'image/png');
  return { method: 'download' };
}

export function download(data, filename, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename || 'download'; a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
}
