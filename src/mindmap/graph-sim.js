// graph-sim.js — force-directed simulation (d3-style alpha schedule) with a Barnes-Hut
// quadtree for many-body repulsion. Nodes: {x,y,vx,vy,fx,fy}. Links: {source,target} (node refs).

const THETA2 = 0.81;          // Barnes-Hut opening criterion (theta = 0.9)
const DIST_MIN2 = 1;
const DIST_MAX2 = 1e7;

function jiggle() { return (Math.random() - 0.5) * 1e-6; }

/** Build a quadtree; each quad: {x, y, size, mass, cx, cy, node, next, kids} */
function buildQuadtree(nodes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) { if (n.x < x0) x0 = n.x; if (n.x > x1) x1 = n.x; if (n.y < y0) y0 = n.y; if (n.y > y1) y1 = n.y; }
  if (!isFinite(x0)) return null;
  const size = Math.max(x1 - x0, y1 - y0, 1) + 2;
  const root = { x: x0 - 1, y: y0 - 1, size, mass: 0, cx: 0, cy: 0, node: null, next: null, kids: null };
  for (const n of nodes) insert(root, n, 0);
  accumulate(root);
  return root;
}

function insert(q, n, depth) {
  for (;;) {
    if (q.kids) {
      const half = q.size / 2;
      const i = (n.x >= q.x + half ? 1 : 0) + (n.y >= q.y + half ? 2 : 0);
      let k = q.kids[i];
      if (!k) { k = q.kids[i] = { x: q.x + (i & 1 ? half : 0), y: q.y + (i & 2 ? half : 0), size: half, mass: 0, cx: 0, cy: 0, node: null, next: null, kids: null }; }
      q = k; depth++;
      continue;
    }
    if (!q.node) { q.node = n; n._next = null; return; }
    const o = q.node;
    if (depth > 24 || (Math.abs(o.x - n.x) < 1e-3 && Math.abs(o.y - n.y) < 1e-3)) { n._next = o._next; o._next = n; return; }
    // subdivide: push existing chain down, then loop to insert n
    q.kids = [null, null, null, null];
    let c = o;
    q.node = null;
    while (c) { const nx = c._next; c._next = null; insert(q, c, depth); c = nx; }
  }
}

function accumulate(q) {
  let mass = 0, cx = 0, cy = 0;
  if (q.kids) {
    const kids = q.kids;
    for (let i = 0; i < 4; i++) { const k = kids[i]; if (!k) continue; accumulate(k); if (k.mass) { mass += k.mass; cx += k.cx * k.mass; cy += k.cy * k.mass; } }
  } else {
    for (let c = q.node; c; c = c._next) { mass += 1; cx += c.x; cy += c.y; }
  }
  q.mass = mass;
  q.thr = q.size * q.size / THETA2;
  if (mass) { q.cx = cx / mass; q.cy = cy / mass; }
}

export class ForceSimulation {
  constructor() {
    this.nodes = [];
    this.links = [];
    this.alpha = 1;
    this.alphaMin = 0.001;
    this.alphaDecay = 1 - Math.pow(0.001, 1 / 300);
    this.alphaTarget = 0;
    this.velocityDecay = 0.4;
    this.centerForce = 0.3;
    this.repelForce = 10;
    this.linkForce = 1;
    this.linkDistance = 250;
    this._degree = new Map();
  }
  setNodes(nodes) { this.nodes = nodes; this._initPositions(); return this; }
  setLinks(links) {
    this.links = links;
    const deg = this._degree = new Map();
    for (const l of links) { deg.set(l.source, (deg.get(l.source) || 0) + 1); deg.set(l.target, (deg.get(l.target) || 0) + 1); }
    for (const l of links) {
      const ds = deg.get(l.source) || 1, dt = deg.get(l.target) || 1;
      l._strength = 1 / Math.min(ds, dt);
      l._bias = ds / (ds + dt);
    }
    return this;
  }
  _initPositions() {
    const radius = 30, angle = Math.PI * (3 - Math.sqrt(5));
    this.nodes.forEach((n, i) => {
      if (n.x == null || Number.isNaN(n.x)) { const r = radius * Math.sqrt(0.5 + i), a = i * angle; n.x = r * Math.cos(a); n.y = r * Math.sin(a); }
      if (n.vx == null) { n.vx = 0; n.vy = 0; }
    });
  }
  restart(alpha = 1) { this.alpha = Math.max(this.alpha, alpha); return this; }
  active() { return this.alpha >= this.alphaMin; }

  tick(iterations = 1) {
    for (let it = 0; it < iterations; it++) {
      this.alpha += (this.alphaTarget - this.alpha) * this.alphaDecay;
      const alpha = this.alpha;
      this._applyLinks(alpha);
      this._applyRepulsion(alpha);
      this._applyCenter(alpha);
      const decay = 1 - this.velocityDecay;
      for (const n of this.nodes) {
        if (n.fx != null) { n.x = n.fx; n.vx = 0; } else { n.vx *= decay; n.x += n.vx; }
        if (n.fy != null) { n.y = n.fy; n.vy = 0; } else { n.vy *= decay; n.y += n.vy; }
      }
    }
    return this.alpha;
  }

  _applyLinks(alpha) {
    const dist = this.linkDistance, strengthScale = this.linkForce;
    const links = this.links;
    for (let i = 0, n = links.length; i < n; i++) {
      const l = links[i], s = l.source, t = l.target;
      let dx = t.x + t.vx - s.x - s.vx || jiggle();
      let dy = t.y + t.vy - s.y - s.vy || jiggle();
      let len = Math.sqrt(dx * dx + dy * dy);
      len = (len - dist) / len * alpha * strengthScale * l._strength;
      dx *= len; dy *= len;
      const bias = l._bias;
      t.vx -= dx * bias; t.vy -= dy * bias;
      s.vx += dx * (1 - bias); s.vy += dy * (1 - bias);
    }
  }

  _applyRepulsion(alpha) {
    const tree = buildQuadtree(this.nodes);
    if (!tree) return;
    const strength = -30 * this.repelForce;
    const stack = new Array(64);
    const nodes = this.nodes;
    for (let ni = 0, nn = nodes.length; ni < nn; ni++) {
      const node = nodes[ni];
      let sp = 0; stack[sp++] = tree;
      while (sp) {
        const q = stack[--sp];
        if (!q.mass) continue;
        let dx = q.cx - node.x, dy = q.cy - node.y;
        let l = dx * dx + dy * dy;
        if (q.thr < l) {
          if (l < DIST_MAX2) {
            if (dx === 0) { dx = jiggle(); l += dx * dx; }
            if (dy === 0) { dy = jiggle(); l += dy * dy; }
            if (l < DIST_MIN2) l = Math.sqrt(DIST_MIN2 * l);
            const v = strength * q.mass * alpha / l;
            node.vx += dx * v; node.vy += dy * v;
          }
          continue;
        }
        if (q.kids) { const kids = q.kids; for (let i = 0; i < 4; i++) if (kids[i]) stack[sp++] = kids[i]; continue; }
        for (let c = q.node; c; c = c._next) {
          if (c === node) continue;
          let ddx = c.x - node.x, ddy = c.y - node.y;
          let ll = ddx * ddx + ddy * ddy;
          if (ddx === 0) { ddx = jiggle(); ll += ddx * ddx; }
          if (ddy === 0) { ddy = jiggle(); ll += ddy * ddy; }
          if (ll < DIST_MIN2) ll = Math.sqrt(DIST_MIN2 * ll);
          if (ll >= DIST_MAX2) continue;
          const v = strength * alpha / ll;
          node.vx += ddx * v; node.vy += ddy * v;
        }
      }
    }
  }

  _applyCenter(alpha) {
    const k = this.centerForce * 0.12 * alpha;
    if (!k) return;
    for (const n of this.nodes) { n.vx -= n.x * k; n.vy -= n.y * k; }
  }
}
