/**
 * Central configuration. All secrets come from environment variables — never hardcode keys.
 */
import crypto from 'node:crypto';

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** Per-call timeouts (ms). Gemini calls are bounded so a slow model never hangs the UI. */
export const TIMEOUTS = {
  gemini: Number(process.env.GEMINI_TIMEOUT_MS) || 25_000,
  geminiVision: Number(process.env.GEMINI_VISION_TIMEOUT_MS) || 35_000,
  externalIntel: Number(process.env.INTEL_TIMEOUT_MS) || 7_000,
  dns: 4_000,
  /** Microsoft Graph / Gmail API calls. */
  provider: Number(process.env.PROVIDER_TIMEOUT_MS) || 15_000,
};

/** Input limits — defensive bounds against malformed or huge payloads. */
export const LIMITS = {
  messageChars: 12_000,
  conversationChars: 25_000,
  senderChars: 200,
  urlChars: 2_048,
  imageBase64Chars: 11_000_000, // ~8MB binary
  maxUrlsInvestigated: 5,
  /** Characters of the analysed message kept in stored history (privacy: excerpt, not the full body). */
  storedExcerptChars: 600,
};

/** Simple in-memory rate limit for investigation endpoints (per client IP). */
export const RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: Number(process.env.RATE_LIMIT_PER_MINUTE) || 30,
  /** Login / registration attempts per IP per 15 minutes. */
  authWindowMs: 15 * 60_000,
  authMaxAttempts: Number(process.env.AUTH_RATE_LIMIT) || 20,
};

/** Session cookie / add-in token lifetimes. */
export const AUTH = {
  cookieName: 'osg_session',
  sessionTtlMs: (Number(process.env.SESSION_TTL_HOURS) || 24 * 7) * 3_600_000,
  addinTokenTtlMs: 180 * 86_400_000,
  linkCodeTtlMs: 10 * 60_000,
  oauthStateTtlMs: 10 * 60_000,
};

/** Mailbox synchronisation policy (polling — there is no push channel). */
export const SYNC = {
  intervalMinutes: process.env.SYNC_INTERVAL_MINUTES === undefined ? 15 : Math.max(0, Number(process.env.SYNC_INTERVAL_MINUTES) || 0),
  maxMessages: Math.min(200, Number(process.env.SYNC_MAX_MESSAGES) || 50),
  /** Full (AI) analyses allowed per sync run — everything else waits for the user or the next run. */
  autoAnalyzeMax: Math.min(20, Number(process.env.SYNC_AUTO_ANALYZE_MAX) || 5),
  /** Deterministic pre-filter score (0-100) an email must reach before an automatic analysis is spent on it. */
  autoAnalyzeThreshold: Number(process.env.SYNC_AUTO_ANALYZE_THRESHOLD) || 20,
};

/**
 * Public base URL of this deployment (no trailing slash). Used for OAuth redirect
 * URIs and links in notifications. On Render, RENDER_EXTERNAL_URL is injected
 * automatically, so APP_BASE_URL only needs to be set elsewhere.
 */
export function getAppBaseUrl(): string {
  const candidates = [process.env.APP_BASE_URL, process.env.APP_URL, process.env.RENDER_EXTERNAL_URL];
  for (const c of candidates) {
    if (c && /^https?:\/\//i.test(c) && !/MY_APP_URL/i.test(c)) return c.replace(/\/+$/, '');
  }
  return `http://localhost:${Number(process.env.PORT) || 3000}`;
}

let ephemeralSecret: string | null = null;
/**
 * Secret used to sign nothing directly but to derive the token-encryption key.
 * Production must set SESSION_SECRET; otherwise a random secret is generated at
 * boot (sessions and stored OAuth tokens then reset on every restart).
 */
export function getSessionSecret(): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) return process.env.SESSION_SECRET;
  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[config] SESSION_SECRET is not set (or shorter than 16 chars) — using an ephemeral secret. Sessions and stored mailbox tokens will not survive a restart.');
  }
  return ephemeralSecret;
}

export function getIntelKeys() {
  return {
    virusTotal: process.env.VIRUSTOTAL_API_KEY || '',
    safeBrowsing: process.env.GOOGLE_SAFE_BROWSING_API_KEY || '',
    urlScan: process.env.URLSCAN_API_KEY || '',
    abuseIpDb: process.env.ABUSEIPDB_API_KEY || '',
  };
}

export function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function getOAuthConfig() {
  return {
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID || '',
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
      tenant: process.env.MICROSOFT_TENANT || 'common',
      configured: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
  };
}

/** Emails (comma-separated) that are granted the ADMIN role on sign-up / sign-in. */
export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
