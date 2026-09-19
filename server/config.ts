/**
 * Central configuration. All secrets come from environment variables — never hardcode keys.
 */

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

/** Per-call timeouts (ms). Gemini calls are bounded so a slow model never hangs the UI. */
export const TIMEOUTS = {
  gemini: Number(process.env.GEMINI_TIMEOUT_MS) || 25_000,
  geminiVision: Number(process.env.GEMINI_VISION_TIMEOUT_MS) || 35_000,
  externalIntel: Number(process.env.INTEL_TIMEOUT_MS) || 7_000,
  dns: 4_000,
};

/** Input limits — defensive bounds against malformed or huge payloads. */
export const LIMITS = {
  messageChars: 12_000,
  conversationChars: 25_000,
  senderChars: 200,
  urlChars: 2_048,
  imageBase64Chars: 11_000_000, // ~8MB binary
  maxUrlsInvestigated: 5,
};

/** Simple in-memory rate limit for investigation endpoints (per client IP). */
export const RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: Number(process.env.RATE_LIMIT_PER_MINUTE) || 30,
};

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
