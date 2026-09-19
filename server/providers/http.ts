/**
 * Small HTTP helpers for vendor APIs: bounded timeout, JSON parsing, and a
 * uniform ProviderError mapping. Access tokens are passed in headers only and
 * are never logged.
 */
import { TIMEOUTS } from '../config';
import { ProviderError } from './types';
import { recordFailure, recordSuccess, type ServiceId } from '../services/health';

export interface VendorResponse<T> {
  status: number;
  data: T | null;
  text: string;
}

export async function vendorFetch<T = unknown>(service: ServiceId, url: string, init: RequestInit = {}): Promise<VendorResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUTS.provider);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let data: T | null = null;
    try {
      data = text ? (JSON.parse(text) as T) : null;
    } catch {
      data = null;
    }
    if (res.ok) recordSuccess(service);
    else recordFailure(service, `HTTP ${res.status} ${summarizeError(data)}`);
    return { status: res.status, data, text };
  } catch (error) {
    const message = error instanceof Error ? (error.name === 'AbortError' ? 'timeout' : error.message) : 'network error';
    recordFailure(service, message);
    throw new ProviderError(message === 'timeout' ? 'The mail service did not respond in time.' : 'The mail service could not be reached.', 'unavailable', 503);
  } finally {
    clearTimeout(timer);
  }
}

function summarizeError(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;
  const err = d.error;
  if (typeof err === 'string') return `${err} ${typeof d.error_description === 'string' ? d.error_description.split('\n')[0].slice(0, 120) : ''}`.trim();
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return `${typeof e.code === 'string' ? e.code : ''} ${typeof e.message === 'string' ? e.message.slice(0, 120) : ''}`.trim();
  }
  return '';
}

/** Map a non-OK vendor response to a ProviderError with a user-facing message. */
export function vendorError(label: string, res: VendorResponse<unknown>): ProviderError {
  const detail = summarizeError(res.data);
  if (res.status === 401) return new ProviderError(`${label} connection expired. Please reconnect ${label}.`, 'expired', 401);
  if (res.status === 403) return new ProviderError(`${label} denied access (${detail || 'insufficient permissions'}). Reconnect ${label} and accept the requested permissions.`, 'unauthorized', 403);
  if (res.status === 404) return new ProviderError('That message no longer exists in the mailbox.', 'not_found', 404);
  if (res.status === 429) return new ProviderError(`${label} is rate-limiting requests. Please try again in a minute.`, 'rate_limited', 429);
  if (res.status >= 500) return new ProviderError(`${label} is temporarily unavailable.`, 'unavailable', 503);
  return new ProviderError(`${label} rejected the request${detail ? ` (${detail})` : ''}.`, 'bad_request', 502);
}

/** Strip HTML to readable text (used only for bodies without a text/plain part). */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, '').trim();
      return label && !/^https?:/i.test(label) ? `${label} (${href})` : href;
    })
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>|<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
