/**
 * Mailbox connections — one row per (user, provider) holding the encrypted
 * delegated tokens. Every access goes through getAccessToken(), which refreshes
 * silently and marks the connection `expired` when the refresh token is no
 * longer valid (the UI then asks the user to reconnect).
 */
import crypto from 'node:crypto';
import { db, nowIso } from '../db';
import { AUTH, getAppBaseUrl } from '../config';
import { decryptSecret, encryptSecret, pkcePair, randomToken } from '../auth/crypto';
import { outlookProvider } from '../providers/outlook';
import { gmailProvider } from '../providers/gmail';
import { ProviderError, type EmailProvider } from '../providers/types';
import { countEmails } from './emails';
import { InvestigationError } from '../agents/orchestrator';
import type { ConnectionStatus, EmailProviderId } from '../../shared/accounts';

export interface ConnectionRow {
  id: string;
  user_id: string;
  provider: EmailProviderId;
  account_email: string | null;
  account_id: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  scopes: string | null;
  status: 'active' | 'expired' | 'error';
  last_sync_at: string | null;
  last_sync_error: string | null;
  last_sync_summary: string | null;
  created_at: string;
  updated_at: string;
}

export function getProvider(id: string): EmailProvider {
  if (id === 'outlook') return outlookProvider;
  if (id === 'gmail') return gmailProvider;
  throw new InvestigationError(404, 'Unknown mail provider.', 'not_found');
}

export function redirectUriFor(provider: EmailProviderId): string {
  return `${getAppBaseUrl()}/api/connections/${provider}/callback`;
}

export async function getConnection(userId: string, provider: EmailProviderId): Promise<ConnectionRow | undefined> {
  return db().get<ConnectionRow>('SELECT * FROM provider_connections WHERE user_id = ? AND provider = ?', [userId, provider]);
}

export async function listActiveConnections(): Promise<ConnectionRow[]> {
  return db().all<ConnectionRow>("SELECT * FROM provider_connections WHERE status = 'active' ORDER BY last_sync_at ASC");
}

export async function connectionStatus(userId: string, provider: EmailProviderId): Promise<ConnectionStatus> {
  const p = getProvider(provider);
  const row = await getConnection(userId, provider);
  const counts = await countEmails(userId, provider);
  return {
    provider,
    state: !p.configured() && !row ? 'not_configured' : !row ? 'not_connected' : row.status,
    configured: p.configured(),
    accountEmail: row?.account_email || null,
    connectedAt: row?.created_at || null,
    lastSyncAt: row?.last_sync_at || null,
    lastSyncError: row?.last_sync_error || null,
    lastSyncSummary: row?.last_sync_summary || null,
    scopes: row?.scopes ? row.scopes.split(' ').filter(Boolean) : p.scopes,
    messageCount: counts.total,
    analyzedCount: counts.analyzed,
  };
}

/** Step 1 of OAuth: persist state + PKCE verifier bound to this user, return the vendor URL. */
export async function beginOAuth(userId: string, provider: EmailProviderId): Promise<string> {
  const p = getProvider(provider);
  if (!p.configured()) throw new InvestigationError(503, `${p.label} sign-in is not configured on this server (missing OAuth client id/secret).`, 'not_configured');
  const state = randomToken(24);
  const { verifier, challenge } = pkcePair();
  const now = Date.now();
  await db().run('DELETE FROM oauth_states WHERE user_id = ? AND provider = ?', [userId, provider]);
  await db().run('INSERT INTO oauth_states (state, user_id, provider, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', [state, userId, provider, verifier, new Date(now).toISOString(), new Date(now + AUTH.oauthStateTtlMs).toISOString()]);
  return p.authorizationUrl({ state, codeChallenge: challenge, redirectUri: redirectUriFor(provider) });
}

/** Step 2 of OAuth: validate state, exchange the code, store encrypted tokens. */
export async function completeOAuth(userId: string, provider: EmailProviderId, code: unknown, state: unknown): Promise<ConnectionRow> {
  const p = getProvider(provider);
  if (typeof code !== 'string' || typeof state !== 'string' || !code || !state) throw new InvestigationError(400, 'The sign-in response was incomplete. Please try connecting again.', 'bad_request');
  const row = await db().get<{ state: string; user_id: string; code_verifier: string; expires_at: string }>('SELECT * FROM oauth_states WHERE state = ? AND provider = ?', [state, provider]);
  await db().run('DELETE FROM oauth_states WHERE state = ?', [state]);
  if (!row || row.user_id !== userId || row.expires_at <= nowIso()) throw new InvestigationError(400, 'The sign-in link has expired or does not belong to this session. Please try connecting again.', 'bad_request');

  const tokens = await p.exchangeCode({ code, codeVerifier: row.code_verifier, redirectUri: redirectUriFor(provider) });
  if (!tokens.refreshToken) throw new InvestigationError(400, `${p.label} did not grant offline access. Remove the app from your ${p.label} account permissions and connect again.`, 'bad_request');
  const now = nowIso();
  const existing = await getConnection(userId, provider);
  const id = existing?.id || crypto.randomUUID();
  await db().run(
    `INSERT INTO provider_connections (id, user_id, provider, account_email, account_id, access_token_enc, refresh_token_enc, token_expires_at, scopes, status, last_sync_at, last_sync_error, last_sync_summary, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, NULL, NULL, ?, ?)
     ON CONFLICT (user_id, provider) DO UPDATE SET account_email = excluded.account_email, account_id = excluded.account_id, access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc, token_expires_at = excluded.token_expires_at, scopes = excluded.scopes, status = 'active', last_sync_error = NULL, updated_at = excluded.updated_at`,
    [id, userId, provider, tokens.accountEmail, tokens.accountId, encryptSecret(tokens.accessToken), encryptSecret(tokens.refreshToken), tokens.expiresAt, tokens.scopes.join(' '), now, now],
  );
  return (await getConnection(userId, provider)) as ConnectionRow;
}

/** Valid access token for the user's connection, refreshing when needed. */
export async function getAccessToken(userId: string, provider: EmailProviderId): Promise<{ token: string; connection: ConnectionRow }> {
  const p = getProvider(provider);
  const conn = await getConnection(userId, provider);
  if (!conn) throw new InvestigationError(404, `${p.label} is not connected. Connect ${p.label} first.`, 'not_connected');
  if (conn.status === 'expired') throw new ProviderError(`${p.label} connection expired. Please reconnect ${p.label}.`, 'expired', 401);
  const access = decryptSecret(conn.access_token_enc);
  const refresh = decryptSecret(conn.refresh_token_enc);
  if (access && conn.token_expires_at && conn.token_expires_at > new Date(Date.now() + 120_000).toISOString()) return { token: access, connection: conn };
  if (!refresh) {
    await markConnection(conn.id, 'expired', 'Stored credentials could not be decrypted (server secret changed). Please reconnect.');
    throw new ProviderError(`${p.label} connection expired. Please reconnect ${p.label}.`, 'expired', 401);
  }
  try {
    const tokens = await p.refresh(refresh);
    await db().run('UPDATE provider_connections SET access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ?, status = ?, updated_at = ? WHERE id = ?', [encryptSecret(tokens.accessToken), encryptSecret(tokens.refreshToken || refresh), tokens.expiresAt, 'active', nowIso(), conn.id]);
    return { token: tokens.accessToken, connection: { ...conn, status: 'active', token_expires_at: tokens.expiresAt } };
  } catch (err) {
    if (err instanceof ProviderError && err.code === 'expired') await markConnection(conn.id, 'expired', err.message);
    throw err;
  }
}

export async function markConnection(id: string, status: ConnectionRow['status'], error: string | null): Promise<void> {
  await db().run('UPDATE provider_connections SET status = ?, last_sync_error = ?, updated_at = ? WHERE id = ?', [status, error ? error.slice(0, 300) : null, nowIso(), id]);
}

export async function recordSync(id: string, summary: string, error: string | null): Promise<void> {
  await db().run('UPDATE provider_connections SET last_sync_at = ?, last_sync_summary = ?, last_sync_error = ?, updated_at = ? WHERE id = ?', [nowIso(), summary.slice(0, 300), error ? error.slice(0, 300) : null, nowIso(), id]);
}

/** Remove the connection and its tokens. Stored email history is kept unless the caller deletes it. */
export async function disconnect(userId: string, provider: EmailProviderId): Promise<boolean> {
  const conn = await getConnection(userId, provider);
  if (!conn) return false;
  if (provider === 'gmail') {
    // Best-effort revocation so the grant disappears from the user's Google account.
    const refresh = decryptSecret(conn.refresh_token_enc);
    if (refresh) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: 'POST' }).catch(() => undefined);
  }
  await db().run('DELETE FROM provider_connections WHERE id = ?', [conn.id]);
  return true;
}
