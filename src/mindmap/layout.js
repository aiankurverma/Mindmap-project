// layout.js — O(n) tidy tree layout for mind maps (markmap-style block layout).
// Each node gets x, y (top-left, world units), w, h, side ('right'|'left'|'down') and
// subtree extents. Subtrees never overlap: a subtree's cross-axis extent is the sum of its
// children's extents (plus gaps), and siblings are stacked without overlap.

/**
 * layoutTree(root, opts) → { minX, minY, maxX, maxY, width, height, nodes:[visible nodes] }
 * opts: { direction, spacingVertical, spacingHorizontal, size(node)→{w,h}, isExpanded(node)→bool }
 */
export function layoutTree(root, opts) {
  const direction = opts.direction || 'right';
  const size = opts.size;
  const isExpanded = opts.isExpanded || (n => !n.collapsed);
  const gap = Math.max(0, +opts.spacingVertical || 0);
  const levelGap = Math.max(0, +opts.spacingHorizontal || 0);
  const visible = [];

  const measure = n => {
    const s = size(n);
    n.w = s.w; n.h = s.h;
    n.expanded = !!(n.children && n.children.length) && isExpanded(n);
    n.hasChildren = !!(n.children && n.children.length);
    visible.push(n);
    if (!n.expanded) { n.sh = n.h; n.sw = n.w; return; }
    let cross = 0, main = 0;
    for (const c of n.children) { measure(c); cross += (direction === 'down' ? c.sw : c.sh); main = Math.max(main, direction === 'down' ? c.sh : c.sw); }
    cross += gap * (n.children.length - 1);
    if (direction === 'down') { n.sw = Math.max(n.w, cross); n.sh = n.h; }
    else { n.sh = Math.max(n.h, cross); n.sw = n.w; }
    n.childrenCross = cross;
  };

  // horizontal placement: x is the edge nearest the parent, top is the subtree's top
  const placeH = (n, x, top, dir) => {
    n.side = dir > 0 ? 'right' : 'left';
    n.x = dir > 0 ? x : x - n.w;
    n.y = top + (n.sh - n.h) / 2;
    if (!n.expanded) return;
    let cy = top + (n.sh - n.childrenCross) / 2;
    const cx = dir > 0 ? n.x + n.w + levelGap : n.x - levelGap;
    for (const c of n.children) { placeH(c, cx, cy, dir); cy += c.sh + gap; }
  };

  const siblingGapDown = Math.max(gap * 2, 12);
  const levelGapDown = Math.max(levelGap * 0.5, 24);
  const measureDown = n => {
    const s = size(n);
    n.w = s.w; n.h = s.h;
    n.expanded = !!(n.children && n.children.length) && isExpanded(n);
    n.hasChildren = !!(n.children && n.children.length);
    visible.push(n);
    if (!n.expanded) { n.sw = n.w; return; }
    let cross = 0;
    for (const c of n.children) { measureDown(c); cross += c.sw; }
    cross += siblingGapDown * (n.children.length - 1);
    n.sw = Math.max(n.w, cross);
    n.childrenCross = cross;
  };
  const placeD = (n, y, left) => {
    n.side = 'down';
    n.y = y;
    n.x = left + (n.sw - n.w) / 2;
    if (!n.expanded) return;
    let cx = left + (n.sw - n.childrenCross) / 2;
    const cy = n.y + n.h + levelGapDown;
    for (const c of n.children) { placeD(c, cy, cx); cx += c.sw + siblingGapDown; }
  };

  if (direction === 'down') {
    measureDown(root);
    placeD(root, 0, 0);
  } else if (direction === 'both') {
    // root's children alternate sides: first half right, second half left
    const s = size(root);
    root.w = s.w; root.h = s.h;
    root.hasChildren = !!(root.children && root.children.length);
    root.expanded = root.hasChildren && isExpanded(root);
    visible.push(root);
    const kids = root.expanded ? root.children : [];
    const half = Math.ceil(kids.length / 2);
    const right = kids.slice(0, half), left = kids.slice(half);
    const total = arr => { let t = 0; for (const c of arr) { measure(c); t += c.sh; } return t + gap * Math.max(0, arr.length - 1); };
    const rightCross = total(right), leftCross = total(left);
    root.sh = Math.max(root.h, rightCross, leftCross);
    root.sw = root.w;
    root.side = 'right';
    root.x = 0; root.y = (root.sh - root.h) / 2;
    let cy = (root.sh - rightCross) / 2;
    for (const c of right) { placeH(c, root.w + levelGap, cy, 1); cy += c.sh + gap; }
    cy = (root.sh - leftCross) / 2;
    for (const c of left) { placeH(c, -levelGap, cy, -1); cy += c.sh + gap; }
  } else {
    measure(root);
    placeH(root, 0, 0, direction === 'left' ? -1 : 1);
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of visible) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.w > maxX) maxX = n.x + n.w;
    if (n.y + n.h > maxY) maxY = n.y + n.h;
  }
  if (!visible.length) minX = minY = maxX = maxY = 0;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, nodes: visible };
}

/** Connection anchors for a link parent→child. shape 'text' anchors at the underline, others at mid-height. */
export function linkAnchors(parent, child, shape) {
  const yOf = n => (shape === 'text' ? n.y + n.h : n.y + n.h / 2);
  if (child.side === 'down') {
    return { x0: parent.x + parent.w / 2, y0: parent.y + parent.h, x1: child.x + child.w / 2, y1: child.y };
  }
  if (child.side === 'left') {
    return { x0: parent.x + (parent.side === 'left' ? 0 : 0), y0: yOf(parent), x1: child.x + child.w, y1: yOf(child) };
  }
  return { x0: parent.x + parent.w, y0: yOf(parent), x1: child.x, y1: yOf(child) };
}

/** SVG path data for a link, honoring lineStyle 'curved' | 'straight' | 'angled'. */
export function linkPath(a, lineStyle, vertical) {
  const { x0, y0, x1, y1 } = a;
  const r = v => Math.round(v * 100) / 100;
  if (lineStyle === 'straight') return `M${r(x0)},${r(y0)}L${r(x1)},${r(y1)}`;
  if (vertical) {
    const my = (y0 + y1) / 2;
    if (lineStyle === 'angled') return `M${r(x0)},${r(y0)}V${r(my)}H${r(x1)}V${r(y1)}`;
    return `M${r(x0)},${r(y0)}C${r(x0)},${r(my)} ${r(x1)},${r(my)} ${r(x1)},${r(y1)}`;
  }
  const mx = (x0 + x1) / 2;
  if (lineStyle === 'angled') return `M${r(x0)},${r(y0)}H${r(mx)}V${r(y1)}H${r(x1)}`;
  return `M${r(x0)},${r(y0)}C${r(mx)},${r(y0)} ${r(mx)},${r(y1)} ${r(x1)},${r(y1)}`;
}
