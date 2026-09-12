/** Share dialog: public (anyone with the link) or private (password) link for the current note, like Drive's sharing sheet. */
import { Modal } from './modal.js';
import { el } from '../dom.js';
import { icon } from '../icons.js';
import { createShareLink } from '../../core/share.js';

export function openShareModal(app, { path, name, markdown }) {
  const m = new Modal({ title: `Share "${name}"`, cls: 'mod-share' });
  const c = m.contentEl;
  let mode = 'public';
  const radio = (val, title, desc, ic) => {
    const r = el('label', { class: 'share-option' + (val === mode ? ' is-active' : '') },
      el('input', { type: 'radio', name: 'share-mode', value: val, checked: val === mode ? true : null }),
      el('span', { class: 'share-option-icon' }, icon(ic, { size: 18 })),
      el('span', { class: 'share-option-text' }, el('b', {}, title), el('small', {}, desc)));
    r.querySelector('input').addEventListener('change', () => { mode = val; c.querySelectorAll('.share-option').forEach((x) => x.classList.toggle('is-active', x === r)); pw.hidden = mode !== 'private'; out.hidden = true; });
    return r;
  };
  const pwInput = el('input', { type: 'password', placeholder: 'Password the reader must enter', autocomplete: 'new-password', style: { width: '100%' } });
  const pw = el('div', { class: 'share-password', hidden: true }, el('label', {}, 'Password'), pwInput);
  const ro = el('label', { class: 'share-check' }, el('input', { type: 'checkbox' }), ' Read-only (viewer cannot edit the map)');
  const link = el('input', { type: 'text', readonly: true, style: { width: '100%' }, 'aria-label': 'Share link' });
  const copy = el('button', { type: 'button', class: 'mod-cta' }, icon('copy', { size: 14 }), ' Copy link');
  const out = el('div', { class: 'share-output', hidden: true }, link, el('div', { class: 'modal-button-container' }, copy));
  const create = el('button', { type: 'button', class: 'mod-cta' }, 'Create link');
  const note = el('p', { class: 'share-note' }, 'The note is packed into the link itself and never uploaded anywhere. Private links are encrypted with your password (AES-256); share the password separately.');
  c.append(el('div', { class: 'share-options' }, radio('public', 'Public', 'Anyone with the link can open it', 'globe'), radio('private', 'Private', 'Only people with the password can open it', 'lock')), pw, ro, note, el('div', { class: 'modal-button-container' }, create), out);
  create.addEventListener('click', async () => {
    const password = mode === 'private' ? pwInput.value : '';
    if (mode === 'private' && !password) { pwInput.focus(); app.notice('Enter a password for a private link', 2500); return; }
    try {
      link.value = await createShareLink(markdown, { name, password, readonly: ro.querySelector('input').checked });
      out.hidden = false; link.select();
      if (link.value.length > 30000) app.notice('Long link: very large notes may not paste into some apps', 5000);
    } catch (e) { app.notice('Could not create link: ' + e.message, 5000, { type: 'error' }); }
  });
  copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(link.value); app.notice('Link copied', 1500); } catch { link.select(); document.execCommand('copy'); app.notice('Link copied', 1500); } });
  m.open();
  return m;
}
