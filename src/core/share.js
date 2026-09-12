/**
 * Shareable links without a server. The note travels inside the URL fragment (never sent to a server):
 *   public  → #share=v1.<name>.<deflate+base64url(markdown)>          anyone with the link can open it
 *   private → #share=v1e.<name>.<salt>.<iv>.<base64url(AES-GCM(deflate(markdown)))>   needs the password
 * Password → key: PBKDF2-SHA256, 150k iterations. Flags (read-only) are stored in the name segment as name|ro.
 */
const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = { encode: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0)) };
async function pipe(bytes, stream) { const r = new Blob([bytes]).stream().pipeThrough(stream); return new Uint8Array(await new Response(r).arrayBuffer()); }
const deflate = (bytes) => pipe(bytes, new CompressionStream('deflate-raw'));
const inflate = (bytes) => pipe(bytes, new DecompressionStream('deflate-raw'));
async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const seg = (s) => encodeURIComponent(s).replace(/\./g, '%2E');

/** @returns {Promise<string>} full URL */
export async function createShareLink(markdown, { name = 'Shared note', password = '', readonly = false, base = location.origin + location.pathname } = {}) {
  const packed = await deflate(enc.encode(markdown));
  const label = seg(name + (readonly ? '|ro' : ''));
  if (!password) return `${base}#share=v1.${label}.${b64u.encode(packed)}`;
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, packed);
  return `${base}#share=v1e.${label}.${b64u.encode(salt)}.${b64u.encode(iv)}.${b64u.encode(cipher)}`;
}
/** Parse a share fragment. Returns null if not a share link. */
export function parseShareHash(hash = location.hash) {
  const m = /^#share=(v1e?)\.([^.]+)\.(.+)$/.exec(hash || '');
  if (!m) return null;
  const [name, flag] = decodeURIComponent(m[2]).split('|');
  return { version: m[1], encrypted: m[1] === 'v1e', name, readonly: flag === 'ro', rest: m[3] };
}
/** @returns {Promise<{name, markdown, readonly}>} throws on a wrong password */
export async function openShareLink(parsed, password = '') {
  let packed;
  if (!parsed.encrypted) packed = b64u.decode(parsed.rest);
  else {
    const [salt, iv, cipher] = parsed.rest.split('.').map(b64u.decode);
    const key = await deriveKey(password, salt);
    try { packed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)); }
    catch { throw new Error('Wrong password'); }
  }
  return { name: parsed.name, markdown: dec.decode(await inflate(packed)), readonly: parsed.readonly };
}
