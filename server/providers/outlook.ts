/**
 * Outlook provider — Microsoft identity platform (OAuth 2.0 + PKCE) and
 * Microsoft Graph with delegated permissions only:
 *
 *   openid profile email offline_access User.Read Mail.Read
 *
 * Mail.Read is read-only on the signed-in user's own mailbox. No application
 * permissions, no access to other mailboxes. Bodies are requested as text and
 * used only for the analysis that the user (or their sync policy) asked for.
 */
import { LIMITS, getOAuthConfig } from '../config';
import { extractUrls } from '../utils/url';
import { htmlToText, vendorError, vendorFetch } from './http';
import { ProviderError, type EmailProvider, type ListOptions, type ProviderTokens } from './types';
import type { NormalizedEmail } from '../services/emails';
import type { EmailContent } from '../services/emailAnalysis';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = ['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Mail.Read'];

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GraphMessage {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  webLink?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  body?: { contentType?: string; content?: string };
}

function authority(): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(getOAuthConfig().microsoft.tenant)}/oauth2/v2.0`;
}

function tokensFrom(data: TokenResponse, previousRefresh: string | null): ProviderTokens {
  if (!data.access_token) throw new ProviderError('Microsoft did not return an access token.', 'unavailable');
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
  const res = await vendorFetch<{ id?: string; mail?: string; userPrincipalName?: string }>('microsoft_graph', `${GRAPH}/me?$select=id,mail,userPrincipalName`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
  if (res.status >= 400 || !res.data) throw vendorError('Outlook', res);
  return { ...tokens, accountEmail: (res.data.mail || res.data.userPrincipalName || '').toLowerCase() || null, accountId: res.data.id || null };
}

export const outlookProvider: EmailProvider = {
  id: 'outlook',
  label: 'Outlook',
  scopes: SCOPES,
  configured: () => getOAuthConfig().microsoft.configured,

  authorizationUrl({ state, codeChallenge, redirectUri }) {
    const { clientId } = getOAuthConfig().microsoft;
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: SCOPES.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return `${authority()}/authorize?${params.toString()}`;
  },

  async exchangeCode({ code, codeVerifier, redirectUri }) {
    const { clientId, clientSecret } = getOAuthConfig().microsoft;
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier, scope: SCOPES.join(' ') });
    const res = await vendorFetch<TokenResponse>('microsoft_oauth', `${authority()}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (res.status >= 400 || !res.data?.access_token) throw new ProviderError(`Microsoft sign-in failed (${res.data?.error || `HTTP ${res.status}`}).`, 'unauthorized', 400);
    return resolveIdentity(tokensFrom(res.data, null));
  },

  async refresh(refreshToken) {
    const { clientId, clientSecret } = getOAuthConfig().microsoft;
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken, scope: SCOPES.join(' ') });
    const res = await vendorFetch<TokenResponse>('microsoft_oauth', `${authority()}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (res.status >= 400 || !res.data?.access_token) {
      const code = res.data?.error || '';
      if (/invalid_grant|interaction_required|consent_required/i.test(code) || res.status === 400 || res.status === 401) throw new ProviderError('Outlook connection expired. Please reconnect Outlook.', 'expired', 401);
      throw new ProviderError('Microsoft sign-in service is temporarily unavailable.', 'unavailable', 503);
    }
    return tokensFrom(res.data, refreshToken);
  },

  async listRecent(accessToken, opts: ListOptions) {
    const top = Math.min(100, Math.max(1, opts.max));
    const params = new URLSearchParams({
      $select: 'id,internetMessageId,conversationId,subject,bodyPreview,receivedDateTime,isRead,hasAttachments,webLink,from,toRecipients,ccRecipients',
      $orderby: 'receivedDateTime desc',
      $top: String(top),
    });
    if (opts.since) params.set('$filter', `receivedDateTime ge ${new Date(opts.since).toISOString()}`);
    const res = await vendorFetch<{ value?: GraphMessage[] }>('microsoft_graph', `${GRAPH}/me/messages?${params.toString()}`, { headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.body-content-type="text"' } });
    if (res.status >= 400 || !res.data) throw vendorError('Outlook', res);
    return (res.data.value || []).map((m) => normalizeGraphMessage(m)).filter((m): m is NormalizedEmail => m !== null);
  },

  async fetchContent(accessToken, providerItemId) {
    const res = await vendorFetch<GraphMessage>('microsoft_graph', `${GRAPH}/me/messages/${encodeURIComponent(providerItemId)}?$select=id,subject,body,hasAttachments,toRecipients,ccRecipients`, { headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.body-content-type="text"' } });
    if (res.status >= 400 || !res.data) throw vendorError('Outlook', res);
    const raw = res.data.body?.content || '';
    const text = (res.data.body?.contentType || '').toLowerCase() === 'html' ? htmlToText(raw) : raw;
    const truncated = text.length > LIMITS.messageChars;
    const body = truncated ? text.slice(0, LIMITS.messageChars) : text;
    let attachments: EmailContent['attachments'] = [];
    if (res.data.hasAttachments) {
      const att = await vendorFetch<{ value?: Array<{ name?: string; size?: number; contentType?: string; isInline?: boolean }> }>('microsoft_graph', `${GRAPH}/me/messages/${encodeURIComponent(providerItemId)}/attachments?$select=name,size,contentType,isInline`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (att.status < 400 && att.data?.value) {
        attachments = att.data.value.filter((a) => !a.isInline).slice(0, 20).map((a) => ({ name: a.name || 'unnamed', size: typeof a.size === 'number' ? a.size : null, contentType: a.contentType || null }));
      }
    }
    const recipientCount = (res.data.toRecipients?.length || 0) + (res.data.ccRecipients?.length || 0);
    return { body, urls: extractUrls(`${res.data.subject || ''}\n${body}`), attachments, recipientCount, truncated };
  },
};

export function normalizeGraphMessage(m: GraphMessage): NormalizedEmail | null {
  if (!m.id) return null;
  const messageId = (m.internetMessageId || '').trim();
  const recipients = [...(m.toRecipients || []), ...(m.ccRecipients || [])].map((r) => r.emailAddress?.address || '').filter(Boolean);
  return {
    provider: 'outlook',
    // Internet-Message-ID keeps add-in and Graph records unified; fall back to the Graph id for drafts/odd items.
    providerMessageId: messageId ? messageId.replace(/^<|>$/g, '').toLowerCase() : `graph:${m.id}`,
    providerItemId: m.id,
    internetMessageId: messageId || null,
    threadId: m.conversationId || null,
    senderName: m.from?.emailAddress?.name || null,
    senderEmail: (m.from?.emailAddress?.address || '').toLowerCase() || null,
    recipients,
    subject: m.subject || '',
    snippet: m.bodyPreview || null,
    receivedAt: m.receivedDateTime || null,
    isRead: typeof m.isRead === 'boolean' ? m.isRead : null,
    hasAttachments: Boolean(m.hasAttachments),
    urls: extractUrls(`${m.subject || ''}\n${m.bodyPreview || ''}`),
    webLink: m.webLink || null,
    source: 'sync',
  };
}
