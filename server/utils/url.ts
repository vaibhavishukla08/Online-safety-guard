/**
 * URL extraction and safe parsing helpers.
 *
 * SAFETY: nothing in this module ever fetches a suspicious URL. We only parse
 * strings locally and hand hostnames to trusted third-party intelligence APIs.
 */
import { LIMITS } from '../config';

/** TLDs disproportionately abused by phishing kits (cheap / free registration). */
export const RISKY_TLDS = new Set([
  'top', 'xyz', 'cc', 'buzz', 'club', 'cam', 'work', 'rest', 'shop', 'live', 'fit',
  'online', 'link', 'info', 'tk', 'ml', 'ga', 'cf', 'gq', 'zip', 'mov', 'icu', 'cfd',
  'sbs', 'cyou', 'monster', 'quest', 'lol', 'click', 'bond', 'wang', 'pw', 'win',
]);

/** Common URL shorteners — hide the true destination. */
export const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy', 'tiny.cc',
  'shorturl.at', 'ow.ly', 'buff.ly', 'rebrand.ly', 't.ly', 's.id', 'bit.do', 'lnkd.in',
]);

/** Multi-label public suffixes we need to handle for registrable-domain extraction. */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in', 'nic.in', 'co.uk', 'org.uk', 'gov.uk',
  'ac.uk', 'com.au', 'net.au', 'org.au', 'gov.au', 'co.nz', 'co.za', 'com.br', 'com.mx',
  'co.jp', 'com.sg', 'com.my', 'com.pk', 'com.bd', 'com.ng', 'co.ke',
]);

const URL_REGEX =
  /\b((?:https?:\/\/|www\.)[^\s<>"'`)\]]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,24})(?:\/[^\s<>"'`)\]]*)?)/gi;

/** Words that are commonly followed by a dot in prose but are not domains. */
const FALSE_POSITIVE_HOSTS = new Set(['e.g', 'i.e', 'etc', 'vs', 'no', 'st', 'dr', 'mr', 'mrs', 'ms', 'a.m', 'p.m', 'rs', 'inc', 'ltd']);

/** Extract candidate URLs / bare domains from free text. */
export function extractUrls(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const matches = text.match(URL_REGEX) || [];
  for (let raw of matches) {
    raw = raw.replace(/[.,;:!?)]+$/g, '');
    const host = hostnameOf(raw);
    if (!host) continue;
    const lowerHost = host.toLowerCase();
    if (FALSE_POSITIVE_HOSTS.has(lowerHost)) continue;
    // Bare-domain matches must have a plausible TLD (2-24 letters) and at least one dot.
    if (!/^https?:\/\//i.test(raw) && !/^www\./i.test(raw)) {
      const tld = lowerHost.split('.').pop() || '';
      if (!/^[a-z]{2,24}$/.test(tld)) continue;
      // Skip things like "4.5" or version numbers, and email-looking domains preceded by '@'.
      const idx = text.indexOf(raw);
      if (idx > 0 && text[idx - 1] === '@') continue;
    }
    found.add(raw);
    if (found.size >= LIMITS.maxUrlsInvestigated * 2) break;
  }
  return Array.from(found).slice(0, LIMITS.maxUrlsInvestigated);
}

/** Normalize to something `new URL()` accepts. Returns null for invalid input. */
export function normalizeUrl(raw: string): string | null {
  if (!raw || raw.length > LIMITS.urlChars) return null;
  let candidate = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = 'https://' + candidate;
  try {
    const u = new URL(candidate);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    if (!u.hostname || u.hostname.length > 253) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function hostnameOf(raw: string): string | null {
  const normalized = normalizeUrl(raw);
  if (!normalized) return null;
  try {
    return new URL(normalized).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

export function isIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\[?[0-9a-f:]+\]?$/i.test(host) && host.includes(':');
}

/** Very small "public suffix" approximation good enough for brand comparison. */
export function registrableDomain(host: string): string {
  if (isIpAddress(host)) return host;
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

export function tldOf(host: string): string {
  if (isIpAddress(host)) return '';
  return host.split('.').pop() || '';
}

/** Validate a hostname before handing it to an external intelligence API. */
export function isSafeHostnameForLookup(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (isIpAddress(host)) {
    // Never look up private / loopback ranges.
    return !/^(10\.|127\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  }
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i.test(host);
}

/** Keywords in a path/subdomain that phishing kits use to look legitimate. */
const CREDENTIAL_PATH_WORDS = ['login', 'signin', 'sign-in', 'verify', 'verification', 'secure', 'security', 'auth', 'account', 'update', 'confirm', 'restore', 'unlock', 'kyc', 'wallet', 'password', 'otp', 'bank', 'redelivery', 'tracking', 'claim', 'reward', 'refund'];

export function hasCredentialKeywords(normalized: string): boolean {
  const lower = normalized.toLowerCase();
  return CREDENTIAL_PATH_WORDS.some((w) => lower.includes(w));
}
