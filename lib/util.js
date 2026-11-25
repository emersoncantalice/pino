import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Identificador aleatório (base62). */
export function uid(len = 12) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % 62];
  return out;
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
