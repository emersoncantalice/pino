import crypto from 'node:crypto';
import { promisify } from 'node:util';
import * as store from './store.js';

const scrypt = promisify(crypto.scrypt);

export const COOKIE_NAME = 'pino_sid';
const MAX_AGE = 30 * 24 * 3600;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function getToken(req) {
  return parseCookies(req.headers.cookie)[COOKIE_NAME] || null;
}

export function getUserFromReq(req) {
  const token = getToken(req);
  return token ? store.getSessionUser(token) : null;
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
