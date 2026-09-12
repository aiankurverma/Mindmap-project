/** Task strip editor: a small popover anchored to a node with exactly five inputs
 *  (deadline, assignee, budget, category, counter). Saves as a {task: …} marker on the node's line. */
import { el, clear } from '../dom.js';
import { icon } from '../icons.js';

export const CATEGORIES = ['real-estate', 'design', 'development', 'research', 'marketing', 'finance', 'operations', 'content', 'support', 'other'];
export const AGENTS = ['AI agent', 'Claude', 'Research agent', 'Writer agent'];

export function openTaskPopup(app, pane, node) {
  closeTaskPopup();
  const md = pane.md; const view = pane.view; if (!md || !view || !node) return null;
  const t = { ...(node.task || {}) };
  const cnt = md.taskCount(t);
  const host = view.container;
  const pop = el('div', { class: 'mm-task-popup', role: 'dialog', 'aria-label': 'Task' });
  const field = (label, ic, input) => el('label', { class: 'mm-task-field' }, el('span', { class: 'mm-task-field-label' }, icon(ic, { size: 13 }), label), input);
  const deadline = el('input', { type: 'date', value: toISO(t.deadline) });
  const assignee = el('input', { type: 'text', value: t.assignee || '', placeholder: 'Person or AI agent', list: 'mm-task-agents' });
  const dl = el('datalist', { id: 'mm-task-agents' }, ...AGENTS.map((a) => el('option', { value: a })));
  const budget = el('input', { type: 'number', min: '0', step: '1', value: t.budget || '', placeholder: 'Joining fee / budget' });
  const category = el('input', { type: 'text', value: t.category || '', placeholder: 'Category', list: 'mm-task-cats' });
  const cl = el('datalist', { id: 'mm-task-cats' }, ...CATEGORIES.map((c) => el('option', { value: c })));
  const target = el('input', { type: 'number', min: '0', step: '1', value: cnt.target || '', placeholder: 'Needed', style: { width: '64px' } });
  const joined = el('input', { type: 'number', min: '0', step: '1', value: cnt.joined || 0, style: { width: '56px' }, 'aria-label': 'Joined so far' });
  const join = el('button', { type: 'button', class: 'mm-task-join', title: 'One more person joins' }, '+1 join');
  join.addEventListener('click', () => { joined.value = String((parseInt(joined.value, 10) || 0) + 1); updateStatus(); });
  const status = el('span', { class: 'mm-task-status' });
  const updateStatus = () => { const j = parseInt(joined.value, 10) || 0, n = parseInt(target.value, 10) || 0; const done = n > 0 && j >= n; status.textContent = done ? 'joined' : `${j}/${n || '?'} open`; status.classList.toggle('is-joined', done); };
  target.addEventListener('input', updateStatus); joined.addEventListener('input', updateStatus); updateStatus();
  const counter = el('div', { class: 'mm-task-counter' }, joined, el('span', {}, '/'), target, join, status);
  const save = el('button', { type: 'button', class: 'mod-cta' }, 'Save');
  const remove = el('button', { type: 'button' }, 'Remove');
  const cancel = el('button', { type: 'button' }, 'Cancel');
  pop.append(
    el('div', { class: 'mm-task-popup-title' }, icon('clipboard-list', { size: 14 }), el('b', {}, node.text.slice(0, 40) || 'Task')),
    field('Deadline', 'calendar', deadline), field('Assign to', 'user', assignee), dl, field('Budget', 'coins', budget), field('Category', 'tag', category), cl,
    el('div', { class: 'mm-task-field' }, el('span', { class: 'mm-task-field-label' }, icon('users', { size: 13 }), 'People'), counter),
    el('div', { class: 'mm-task-actions' }, node.task ? remove : el('span'), el('span', { style: { flex: '1 1 auto' } }), cancel, save));
  const commit = (task) => { pane.applyOp(task ? 'Set task' : 'Remove task', (c) => md.setNodeTask(c, node, task)); closeTaskPopup(); };
  save.addEventListener('click', () => commit({ deadline: fromISO(deadline.value), assignee: assignee.value.trim(), budget: budget.value.trim(), category: category.value.trim(), count: `${parseInt(joined.value, 10) || 0}/${parseInt(target.value, 10) || 0}` }));
  remove.addEventListener('click', () => commit(null));
  cancel.addEventListener('click', closeTaskPopup);
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeTaskPopup(); } if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save.click(); } });
  host.appendChild(pop);
  // anchor below the node
  const g = view.els.get(node.id)?.g; const hb = host.getBoundingClientRect();
  const b = g ? (g.querySelector('.mm-content') || g).getBoundingClientRect() : { left: hb.left + 20, bottom: hb.top + 20, width: 0 };
  let x = b.left - hb.left, y = b.bottom - hb.top + 8;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  if (x + pw > hb.width - 8) x = Math.max(8, hb.width - pw - 8);
  if (y + ph > hb.height - 8) y = Math.max(8, b.top - hb.top - ph - 8);
  pop.style.left = `${x}px`; pop.style.top = `${y}px`;
  setTimeout(() => { const onDoc = (e) => { if (!pop.contains(e.target)) closeTaskPopup(); }; document.addEventListener('pointerdown', onDoc, true); pop._off = () => document.removeEventListener('pointerdown', onDoc, true); }, 0);
  deadline.focus();
  openTaskPopup.current = pop;
  return pop;
}
export function closeTaskPopup() { const p = openTaskPopup.current; if (p) { p._off?.(); p.remove(); openTaskPopup.current = null; } }
function toISO(d) { // accepts "16-sep-2026", "2026-09-16", "16/09/2026"
  if (!d) return ''; const s = String(d).trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s.replace(/-/g, ' ')); if (!isNaN(t)) { const x = new Date(t); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }
  const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}
function fromISO(v) { // display form "16-sep-2026"
  if (!v) return ''; const [y, m, d] = v.split('-'); const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][+m - 1];
  return mon ? `${+d}-${mon}-${y}` : v;
}
