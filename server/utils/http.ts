/**
 * Networking helpers for tool use: bounded timeouts, small TTL cache, per-IP rate limiting.
 */
import { RATE_LIMIT } from '../config';
import { recordRateLimitBlock } from '../services/health';

export interface FetchJsonResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

/** fetch() with an AbortController-based timeout. Only used against trusted intel APIs. */
export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit & { timeoutMs: number },
): Promise<FetchJsonResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    // Some registries/CDNs bot-block requests without a User-Agent.
    const headers = { 'User-Agent': 'OnlineSafetyGuard/2.0 (+threat-intel lookup)', ...(init.headers as Record<string, string> | undefined) };
    const res = await fetch(url, { ...init, headers, signal: controller.signal, redirect: 'follow' });
    const status = res.status;
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      data = null;
    }
    return { ok: res.ok, status, data, error: res.ok ? undefined : `HTTP ${status}` };
  } catch (error) {
    const message = error instanceof Error ? (error.name === 'AbortError' ? 'timeout' : error.message) : 'network error';
    return { ok: false, status: 0, data: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Tiny TTL cache (keeps intel lookups cheap during demos and avoids hammering APIs)
// ---------------------------------------------------------------------------
const cache = new Map<string, { expires: number; value: unknown }>();

export function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  if (cache.size > 500) cache.clear();
  cache.set(key, { expires: Date.now() + ttlMs, value });
}

// ---------------------------------------------------------------------------
// Fixed-window rate limiter (in-memory; adequate for a single-instance app)
// ---------------------------------------------------------------------------
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(clientId: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(clientId);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(clientId, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (bucket.count >= RATE_LIMIT.maxRequests) {
    recordRateLimitBlock();
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

/** Aggregate view for the admin health page (no client identifiers). */
export function rateLimitStats(): { activeClients: number } {
  const now = Date.now();
  let active = 0;
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
    else active += 1;
  }
  return { activeClients: active };
}
