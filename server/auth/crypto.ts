/**
 * Cryptographic helpers — all built on node:crypto, no extra dependencies.
 *
 *   - scrypt password hashing (per-user salt, constant-time compare)
 *   - opaque random tokens stored only as SHA-256 hashes
 *   - AES-256-GCM encryption for OAuth tokens at rest
 */
import crypto from 'node:crypto';
import { getSessionSecret } from '../config';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(password, salt, 64, SCRYPT_PARAMS, (err, key) => (err ? reject(err) : resolve(key))),
  );
  return `scrypt$${SCRYPT_PARAMS.N}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, nStr, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(hashB64, 'base64url');
  const derived = await new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(password, salt, expected.length, { ...SCRYPT_PARAMS, N: Number(nStr) || SCRYPT_PARAMS.N }, (err, key) => (err ? reject(err) : resolve(key))),
  );
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

/** Random opaque token (URL-safe). */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Short human-typable code for add-in linking (no ambiguous characters). */
export function randomLinkCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** PKCE code verifier + S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function encryptionKey(): Buffer {
  const material = process.env.TOKEN_ENCRYPTION_KEY || getSessionSecret();
  return crypto.createHash('sha256').update(`osg-token-key:${material}`).digest();
}

/** Encrypt a secret for storage. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

/** Decrypt a stored secret. Returns null (never throws) if the key changed or data is corrupt. */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    const [v, ivB64, tagB64, dataB64] = stored.split('.');
    if (v !== 'v1') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
