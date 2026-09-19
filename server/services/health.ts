/**
 * Service health tracker — in-memory counters and a ring buffer of recent
 * failures for the admin "Service Health" page and /api/health.
 *
 * Records are aggregate only: a service id, a short message and a timestamp.
 * Never pass secrets, tokens or message bodies to recordFailure().
 */
import { GEMINI_MODEL, RATE_LIMIT, SYNC, getIntelKeys, getOAuthConfig, hasGeminiKey } from '../config';
import { isDbOpen, db } from '../db';
import type { ServiceHealthReport, ServiceState, ServiceStatus } from '../../shared/accounts';

export type ServiceId = 'gemini' | 'rdap' | 'dns' | 'virustotal' | 'safebrowsing' | 'urlscan' | 'abuseipdb' | 'microsoft_oauth' | 'microsoft_graph' | 'google_oauth' | 'gmail_api' | 'api';

const LABELS: Record<ServiceId, string> = {
  gemini: 'Gemini',
  rdap: 'RDAP registry lookup',
  dns: 'DNS resolution',
  virustotal: 'VirusTotal',
  safebrowsing: 'Google Safe Browsing',
  urlscan: 'urlscan.io',
  abuseipdb: 'AbuseIPDB',
  microsoft_oauth: 'Microsoft OAuth',
  microsoft_graph: 'Microsoft Graph (Outlook)',
  google_oauth: 'Google OAuth',
  gmail_api: 'Gmail API',
  api: 'Online Safety Guard API',
};

interface Sample {
  at: number;
  ok: boolean;
  message?: string;
}

const WINDOW_MS = 60 * 60_000;
const samples = new Map<ServiceId, Sample[]>();
const recentFailures: Array<{ service: string; message: string; at: string }> = [];
const startedAt = Date.now();
let blockedLastHour: number[] = [];
let lastSyncRun: { at: string; summary: string } | null = null;

function bucket(id: ServiceId): Sample[] {
  let list = samples.get(id);
  if (!list) {
    list = [];
    samples.set(id, list);
  }
  const cutoff = Date.now() - WINDOW_MS;
  while (list.length && list[0].at < cutoff) list.shift();
  if (list.length > 2000) list.splice(0, list.length - 2000);
  return list;
}

export function recordSuccess(id: ServiceId): void {
  bucket(id).push({ at: Date.now(), ok: true });
}

export function recordFailure(id: ServiceId, message: string): void {
  const safe = String(message || 'failure').slice(0, 200);
  bucket(id).push({ at: Date.now(), ok: false, message: safe });
  recentFailures.unshift({ service: LABELS[id], message: safe, at: new Date().toISOString() });
  if (recentFailures.length > 50) recentFailures.length = 50;
}

export function recordRateLimitBlock(): void {
  const cutoff = Date.now() - WINDOW_MS;
  blockedLastHour = blockedLastHour.filter((t) => t > cutoff);
  blockedLastHour.push(Date.now());
}

export function recordSyncRun(summary: string): void {
  lastSyncRun = { at: new Date().toISOString(), summary };
}

function status(id: ServiceId, configured: boolean, configureHint: string): ServiceStatus {
  const list = bucket(id);
  const calls = list.length;
  const failures = list.filter((s) => !s.ok).length;
  const lastFail = [...list].reverse().find((s) => !s.ok) || null;
  let state: ServiceState;
  let detail: string;
  if (!configured) {
    state = 'not_configured';
    detail = configureHint;
  } else if (calls === 0) {
    state = 'unknown';
    detail = 'No calls in the last hour.';
  } else if (failures === 0) {
    state = 'ok';
    detail = `${calls} call${calls === 1 ? '' : 's'} in the last hour, no failures.`;
  } else if (failures >= calls || (failures >= 3 && failures / calls > 0.5)) {
    state = 'down';
    detail = `${failures} of ${calls} calls failed in the last hour.`;
  } else {
    state = 'degraded';
    detail = `${failures} of ${calls} calls failed in the last hour.`;
  }
  return { id, label: LABELS[id], state, detail, calls, failures, lastFailureAt: lastFail ? new Date(lastFail.at).toISOString() : null, lastFailure: lastFail?.message || null };
}

export async function getServiceHealth(activeRateLimitClients: number): Promise<ServiceHealthReport> {
  const keys = getIntelKeys();
  const oauth = getOAuthConfig();
  const services: ServiceStatus[] = [
    status('gemini', hasGeminiKey(), `GEMINI_API_KEY not set — rule-based analysis only (model would be ${GEMINI_MODEL}).`),
    status('rdap', true, ''),
    status('dns', true, ''),
    status('virustotal', Boolean(keys.virusTotal), 'VIRUSTOTAL_API_KEY not set.'),
    status('safebrowsing', Boolean(keys.safeBrowsing), 'GOOGLE_SAFE_BROWSING_API_KEY not set.'),
    status('urlscan', Boolean(keys.urlScan), 'URLSCAN_API_KEY not set.'),
    status('abuseipdb', Boolean(keys.abuseIpDb), 'ABUSEIPDB_API_KEY not set.'),
    status('microsoft_oauth', oauth.microsoft.configured, 'MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET not set — Connect Outlook is disabled.'),
    status('microsoft_graph', oauth.microsoft.configured, 'Requires Microsoft OAuth.'),
    status('google_oauth', oauth.google.configured, 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — Connect Gmail is disabled.'),
    status('gmail_api', oauth.google.configured, 'Requires Google OAuth.'),
    status('api', true, ''),
  ];
  const api = bucket('api');
  const errorRate = api.length ? Math.round((api.filter((s) => !s.ok).length / api.length) * 1000) / 10 : 0;

  let dbOk = false;
  let dbKind = 'not initialised';
  if (isDbOpen()) {
    dbKind = db().label;
    try {
      await db().get('SELECT 1 AS one');
      dbOk = true;
    } catch {
      dbOk = false;
    }
  }
  const cutoff = Date.now() - WINDOW_MS;
  blockedLastHour = blockedLastHour.filter((t) => t > cutoff);

  return {
    generatedAt: new Date().toISOString(),
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    database: { kind: dbKind, ok: dbOk },
    services,
    errorRate,
    recentFailures: recentFailures.slice(0, 20),
    rateLimit: { perMinute: RATE_LIMIT.maxRequests, activeClients: activeRateLimitClients, blockedLastHour: blockedLastHour.length },
    sync: { enabled: SYNC.intervalMinutes > 0, intervalMinutes: SYNC.intervalMinutes, lastRunAt: lastSyncRun?.at || null, lastRunSummary: lastSyncRun?.summary || null },
  };
}
