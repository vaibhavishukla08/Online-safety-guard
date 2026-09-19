/**
 * Sessions (HTTP-only cookie) and add-in bearer tokens.
 *
 * Both are opaque random tokens; only their SHA-256 hash is stored. The Outlook
 * task pane runs in an iframe on outlook.office.com where third-party cookies
 * are unreliable, so it authenticates with a revocable bearer token obtained
 * through a one-time link code generated in the signed-in web app.
 */
import crypto from 'node:crypto';
import { db, nowIso } from '../db';
import { AUTH } from '../config';
import { randomLinkCode, randomToken, sha256 } from './crypto';
import { findUserById, type UserRow } from '../services/users';
import type { AddinTokenInfo } from '../../shared/accounts';

export interface SessionInfo {
  id: string;
  userId: string;
  expiresAt: string;
}

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null }): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + AUTH.sessionTtlMs).toISOString();
  await db().run('INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)', [sha256(token), userId, nowIso(), expiresAt, meta.ip || null, (meta.userAgent || '').slice(0, 200) || null]);
  return { token, expiresAt };
}

export async function findSession(token: string): Promise<SessionInfo | null> {
  const row = await db().get<{ id: string; user_id: string; expires_at: string }>('SELECT id, user_id, expires_at FROM sessions WHERE id = ?', [sha256(token)]);
  if (!row) return null;
  if (row.expires_at <= nowIso()) {
    await db().run('DELETE FROM sessions WHERE id = ?', [row.id]);
    return null;
  }
  return { id: row.id, userId: row.user_id, expiresAt: row.expires_at };
}

export async function destroySession(token: string): Promise<void> {
  await db().run('DELETE FROM sessions WHERE id = ?', [sha256(token)]);
}

export async function destroyAllSessions(userId: string): Promise<void> {
  await db().run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

/** Housekeeping — called opportunistically by the sync scheduler. */
export async function purgeExpired(): Promise<void> {
  const now = nowIso();
  await db().run('DELETE FROM sessions WHERE expires_at <= ?', [now]);
  await db().run('DELETE FROM addin_tokens WHERE expires_at <= ?', [now]);
  await db().run('DELETE FROM link_codes WHERE expires_at <= ? OR consumed = 1', [now]);
  await db().run('DELETE FROM oauth_states WHERE expires_at <= ?', [now]);
}

// ---------------------------------------------------------------------------
// Add-in linking
// ---------------------------------------------------------------------------

export const ADDIN_TOKEN_PREFIX = 'osg_addin_';

export async function createLinkCode(userId: string): Promise<{ code: string; expiresAt: string }> {
  // One outstanding code per user keeps the table tiny and invalidates older codes.
  await db().run('DELETE FROM link_codes WHERE user_id = ?', [userId]);
  const code = randomLinkCode();
  const expiresAt = new Date(Date.now() + AUTH.linkCodeTtlMs).toISOString();
  await db().run('INSERT INTO link_codes (code, user_id, created_at, expires_at, consumed) VALUES (?, ?, ?, ?, 0)', [code, userId, nowIso(), expiresAt]);
  return { code, expiresAt };
}

/** Exchange a link code for a long-lived add-in token. Returns null if invalid/expired/used. */
export async function redeemLinkCode(codeRaw: unknown, label: string): Promise<{ token: string; user: UserRow; expiresAt: string } | null> {
  if (typeof codeRaw !== 'string') return null;
  const code = codeRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 8) return null;
  const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
  const row = await db().get<{ code: string; user_id: string; expires_at: string; consumed: number }>('SELECT * FROM link_codes WHERE code = ?', [formatted]);
  if (!row || Number(row.consumed) === 1 || row.expires_at <= nowIso()) return null;
  const user = await findUserById(row.user_id);
  if (!user || user.status !== 'active') return null;
  await db().run('UPDATE link_codes SET consumed = 1 WHERE code = ?', [formatted]);
  const token = ADDIN_TOKEN_PREFIX + randomToken(32);
  const expiresAt = new Date(Date.now() + AUTH.addinTokenTtlMs).toISOString();
  await db().run('INSERT INTO addin_tokens (id, user_id, label, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)', [sha256(token), user.id, label.slice(0, 120) || 'Outlook add-in', nowIso(), expiresAt, null]);
  return { token, user, expiresAt };
}

export async function findAddinToken(token: string): Promise<{ id: string; userId: string } | null> {
  if (!token.startsWith(ADDIN_TOKEN_PREFIX)) return null;
  const row = await db().get<{ id: string; user_id: string; expires_at: string }>('SELECT id, user_id, expires_at FROM addin_tokens WHERE id = ?', [sha256(token)]);
  if (!row || row.expires_at <= nowIso()) return null;
  // Best-effort usage stamp (once a minute is plenty; avoids a write per request).
  const stamp = crypto.randomInt(0, 20) === 0;
  if (stamp) await db().run('UPDATE addin_tokens SET last_used_at = ? WHERE id = ?', [nowIso(), row.id]);
  return { id: row.id, userId: row.user_id };
}

export async function listAddinTokens(userId: string): Promise<AddinTokenInfo[]> {
  const rows = await db().all<{ id: string; label: string; created_at: string; expires_at: string; last_used_at: string | null }>('SELECT id, label, created_at, expires_at, last_used_at FROM addin_tokens WHERE user_id = ? ORDER BY created_at DESC', [userId]);
  return rows.map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at, expiresAt: r.expires_at, lastUsedAt: r.last_used_at }));
}

export async function revokeAddinToken(userId: string, tokenId: string): Promise<boolean> {
  const row = await db().get<{ id: string }>('SELECT id FROM addin_tokens WHERE id = ? AND user_id = ?', [tokenId, userId]);
  if (!row) return false;
  await db().run('DELETE FROM addin_tokens WHERE id = ?', [tokenId]);
  return true;
}
