/**
 * Gmail provider — Google OAuth 2.0 (PKCE, offline access) and the Gmail REST
 * API with the minimum scope for reading the user's own mailbox:
 *
 *   openid email https://www.googleapis.com/auth/gmail.readonly
 *
 * Listing uses format=metadata (headers + snippet only). Bodies are fetched
 * with format=full only when a message is analysed. Attachments are reported
 * as metadata (name, size, type) and never downloaded.
 */
import { LIMITS, getOAuthConfig } from '../config';
import { extractUrls } from '../utils/url';
import { htmlToText, vendorError, vendorFetch } from './http';
import { ProviderError, type EmailProvider, type ListOptions, type ProviderTokens } from './types';
import type { NormalizedEmail } from '../services/emails';
import type { EmailContent } from '../services/emailAnalysis';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'];
const LIST_CONCURRENCY = 5;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

function tokensFrom(data: TokenResponse, previousRefresh: string | null): ProviderTokens {
  if (!data.access_token) throw new ProviderError('Google did not return an access token.', 'unavailable');
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || previousRefresh,
    expiresAt: new Date(Date.now() + Math.max(60, (data.expires_in || 3600) - 60) * 1000).toISOString(),
    scopes: (data.scope || '').split(' ').filter(Boolean),
    accountEmail: null,
    accountId: null,
  };
}

async function resolveIdentity(tokens: ProviderTokens): Promise<ProviderTokens> {
  const res = await vendorFetch<{ emailAddress?: string }>('gmail_api', `${GMAIL}/profile`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
  if (res.status >= 400 || !res.data) throw vendorError('Gmail', res);
  const email = (res.data.emailAddress || '').toLowerCase() || null;
  return { ...tokens, accountEmail: email, accountId: email };
}

function header(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

/** "Name <addr>" / "addr" → { name, email } */
export function parseAddress(raw: string): { name: string | null; email: string | null } {
  const m = raw.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  if (m) return { name: (m[1] || '').trim() || null, email: m[2].trim().toLowerCase() || null };
  const bare = raw.trim();
  return bare.includes('@') ? { name: null, email: bare.toLowerCase() } : { name: bare || null, email: null };
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function collect(part: GmailPart | undefined, out: { text: string[]; html: string[]; attachments: NonNullable<EmailContent['attachments']> }): void {
  if (!part) return;
  const mime = (part.mimeType || '').toLowerCase();
  if (part.filename) {
    out.attachments.push({ name: part.filename, size: typeof part.body?.size === 'number' ? part.body.size : null, contentType: part.mimeType || null });
  } else if (part.body?.data) {
    if (mime === 'text/plain') out.text.push(decodeBase64Url(part.body.data));
    else if (mime === 'text/html') out.html.push(decodeBase64Url(part.body.data));
  }
  for (const child of part.parts || []) collect(child, out);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R | null>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      const r = await fn(item);
      if (r !== null) results.push(r);
    }
  });
  await Promise.all(workers);
  return results;
}

export const gmailProvider: EmailProvider = {
  id: 'gmail',
  label: 'Gmail',
  scopes: SCOPES,
  configured: () => getOAuthConfig().google.configured,

  authorizationUrl({ state, codeChallenge, redirectUri }) {
    const params = new URLSearchParams({
      client_id: getOAuthConfig().google.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  },

  async exchangeCode({ code, codeVerifier, redirectUri }) {
    const { clientId, clientSecret } = getOAuthConfig().google;
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier });
    const res = await vendorFetch<TokenResponse>('google_oauth', 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (res.status >= 400 || !res.data?.access_token) throw new ProviderError(`Google sign-in failed (${res.data?.error || `HTTP ${res.status}`}).`, 'unauthorized', 400);
    return resolveIdentity(tokensFrom(res.data, null));
  },

  async refresh(refreshToken) {
    const { clientId, clientSecret } = getOAuthConfig().google;
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken });
    const res = await vendorFetch<TokenResponse>('google_oauth', 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (res.status >= 400 || !res.data?.access_token) {
      if (res.status === 400 || res.status === 401 || /invalid_grant/i.test(res.data?.error || '')) throw new ProviderError('Gmail connection expired. Please reconnect Gmail.', 'expired', 401);
      throw new ProviderError('Google sign-in service is temporarily unavailable.', 'unavailable', 503);
    }
    return tokensFrom(res.data, refreshToken);
  },

  async listRecent(accessToken, opts: ListOptions) {
    const params = new URLSearchParams({ maxResults: String(Math.min(100, Math.max(1, opts.max))), labelIds: 'INBOX' });
    if (opts.since) params.set('q', `after:${Math.floor(new Date(opts.since).getTime() / 1000)}`);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const list = await vendorFetch<{ messages?: Array<{ id: string; threadId?: string }> }>('gmail_api', `${GMAIL}/messages?${params.toString()}`, { headers: auth });
    if (list.status >= 400 || !list.data) throw vendorError('Gmail', list);
    const ids = list.data.messages || [];
    const q = new URLSearchParams();
    q.set('format', 'metadata');
    for (const h of ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-ID']) q.append('metadataHeaders', h);
    return mapWithConcurrency(ids, LIST_CONCURRENCY, async ({ id }) => {
      const res = await vendorFetch<GmailMessage>('gmail_api', `${GMAIL}/messages/${encodeURIComponent(id)}?${q.toString()}`, { headers: auth });
      if (res.status >= 400 || !res.data) {
        if (res.status === 401 || res.status === 403 || res.status === 429) throw vendorError('Gmail', res);
        return null;
      }
      return normalizeGmailMessage(res.data);
    });
  },

  async fetchContent(accessToken, providerItemId) {
    const res = await vendorFetch<GmailMessage>('gmail_api', `${GMAIL}/messages/${encodeURIComponent(providerItemId)}?format=full`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status >= 400 || !res.data) throw vendorError('Gmail', res);
    const out = { text: [] as string[], html: [] as string[], attachments: [] as NonNullable<EmailContent['attachments']> };
    collect(res.data.payload, out);
    const text = (out.text.join('\n').trim() || htmlToText(out.html.join('\n'))).replace(/\r\n/g, '\n');
    const truncated = text.length > LIMITS.messageChars;
    const body = truncated ? text.slice(0, LIMITS.messageChars) : text;
    const headers = res.data.payload?.headers;
    const recipientCount = [header(headers, 'To'), header(headers, 'Cc')].filter(Boolean).join(',').split(',').filter((s) => s.trim()).length;
    return { body, urls: extractUrls(`${header(headers, 'Subject')}\n${body}`), attachments: out.attachments.slice(0, 20), recipientCount, truncated };
  },
};

export function normalizeGmailMessage(m: GmailMessage): NormalizedEmail | null {
  if (!m.id) return null;
  const headers = m.payload?.headers;
  const from = parseAddress(header(headers, 'From'));
  const recipients = [header(headers, 'To'), header(headers, 'Cc')]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map((r) => parseAddress(r).email || '')
    .filter(Boolean);
  const messageId = header(headers, 'Message-ID').trim();
  const received = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : header(headers, 'Date') ? new Date(header(headers, 'Date')).toISOString() : null;
  const subject = header(headers, 'Subject');
  return {
    provider: 'gmail',
    providerMessageId: m.id,
    providerItemId: m.id,
    internetMessageId: messageId ? messageId.replace(/^<|>$/g, '').toLowerCase() : null,
    threadId: m.threadId || null,
    senderName: from.name,
    senderEmail: from.email,
    recipients,
    subject,
    snippet: m.snippet || null,
    receivedAt: received && !Number.isNaN(Date.parse(received)) ? received : null,
    isRead: Array.isArray(m.labelIds) ? !m.labelIds.includes('UNREAD') : null,
    hasAttachments: false,
    urls: extractUrls(`${subject}\n${m.snippet || ''}`),
    webLink: `https://mail.google.com/mail/u/0/#inbox/${m.id}`,
    source: 'sync',
  };
}
