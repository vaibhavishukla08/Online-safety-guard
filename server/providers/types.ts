/**
 * Provider abstraction — Outlook (Microsoft Graph) and Gmail (Gmail API) both
 * normalise into the same NormalizedEmail / EmailContent shapes so the analysis
 * pipeline, storage, notifications and UI are shared.
 *
 * Providers only ever call the vendor APIs with the user's delegated token.
 * They never fetch links found in emails and never download attachments.
 */
import type { EmailProviderId } from '../../shared/accounts';
import type { NormalizedEmail } from '../services/emails';
import type { EmailContent } from '../services/emailAnalysis';

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_configured' | 'expired' | 'unauthorized' | 'rate_limited' | 'unavailable' | 'not_found' | 'bad_request',
    public readonly status = 502,
  ) {
    super(message);
  }
}

export interface ProviderTokens {
  accessToken: string;
  refreshToken: string | null;
  /** ISO timestamp when the access token expires. */
  expiresAt: string;
  scopes: string[];
  accountEmail: string | null;
  accountId: string | null;
}

export interface ListOptions {
  max: number;
  /** Only messages received after this ISO timestamp (when supported). */
  since?: string | null;
}

export interface EmailProvider {
  id: EmailProviderId;
  label: string;
  configured(): boolean;
  scopes: string[];
  /** Build the vendor authorization URL (PKCE S256). */
  authorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string;
  /** Exchange an authorization code for tokens and resolve the account identity. */
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<ProviderTokens>;
  refresh(refreshToken: string): Promise<ProviderTokens>;
  /** Newest messages (metadata only). */
  listRecent(accessToken: string, opts: ListOptions): Promise<NormalizedEmail[]>;
  /** Body text + link/attachment metadata for one message. */
  fetchContent(accessToken: string, providerItemId: string): Promise<EmailContent>;
}
