/**
 * Threat Intelligence adapters.
 *
 * Every adapter returns an `IntelSourceResult` with an explicit status:
 *   ok             – data returned from the source
 *   not_configured – API key missing (feature is off, not broken)
 *   unavailable    – network/timeout/HTTP failure
 *   error          – unexpected response shape
 *   skipped        – lookup not applicable (e.g. IP-only source without an IP)
 *
 * Results are never fabricated. Keys come only from environment variables.
 * We NEVER fetch the suspicious URL itself — only trusted intelligence APIs.
 */
import dns from 'node:dns/promises';
import { getIntelKeys, TIMEOUTS } from '../config';
import { fetchJson, cacheGet, cacheSet } from '../utils/http';
import { isSafeHostnameForLookup, isIpAddress } from '../utils/url';
import type { IntelSourceResult, ExternalEvidence } from '../../shared/investigation';

const CACHE_TTL = 5 * 60_000;

function now() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// RDAP (keyless) — registration date → domain age
// ---------------------------------------------------------------------------
/** Resolve the authoritative RDAP base URL for a TLD from the IANA bootstrap file (cached 1h). */
async function rdapBaseForTld(tld: string): Promise<string | null> {
  if (!tld) return null;
  let services = cacheGet<Array<[string[], string[]]>>('rdap:bootstrap');
  if (!services) {
    const res = await fetchJson<{ services?: Array<[string[], string[]]> }>('https://data.iana.org/rdap/dns.json', { timeoutMs: TIMEOUTS.externalIntel });
    services = res.ok && res.data?.services ? res.data.services : [];
    if (services.length) cacheSet('rdap:bootstrap', services, 60 * 60_000);
  }
  const entry = services.find(([tlds]) => tlds.includes(tld.toLowerCase()));
  const base = entry?.[1]?.find((u) => u.startsWith('https://')) || entry?.[1]?.[0];
  return base ? (base.endsWith('/') ? base : base + '/') : null;
}

export async function rdapLookup(domain: string): Promise<IntelSourceResult> {
  const source = 'RDAP (registration data)';
  if (isIpAddress(domain)) return { source, status: 'skipped', summary: 'Not applicable to IP addresses.' };

  const cached = cacheGet<IntelSourceResult>(`rdap:${domain}`);
  if (cached) return cached;

  type RdapDoc = { events?: Array<{ eventAction: string; eventDate: string }>; status?: string[]; entities?: Array<{ roles?: string[]; vcardArray?: unknown }> };
  const headers = { Accept: 'application/rdap+json, application/json' };
  // 1) rdap.org redirector; 2) fall back to the IANA bootstrap registry for the TLD.
  let res = await fetchJson<RdapDoc>(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { timeoutMs: TIMEOUTS.externalIntel, headers });
  if (!res.ok && res.status !== 404) {
    const base = await rdapBaseForTld(domain.split('.').pop() || '');
    if (base) res = await fetchJson<RdapDoc>(`${base}domain/${encodeURIComponent(domain)}`, { timeoutMs: TIMEOUTS.externalIntel, headers });
  }

  let result: IntelSourceResult;
  if (res.status === 404) {
    result = { source, status: 'ok', summary: 'No registration record found (domain may be unregistered or on a registry without RDAP).', data: { registered: false }, fetchedAt: now() };
  } else if (!res.ok || !res.data) {
    result = { source, status: 'unavailable', summary: 'Registration lookup unavailable.', error: res.error, fetchedAt: now() };
  } else {
    const events = res.data.events || [];
    const reg = events.find((e) => /registration/i.test(e.eventAction));
    const registeredAt = reg?.eventDate || null;
    const ageDays = registeredAt ? Math.max(0, Math.floor((Date.now() - new Date(registeredAt).getTime()) / 86_400_000)) : null;
    const registrar = res.data.entities?.find((e) => e.roles?.includes('registrar'));
    let registrarName: string | null = null;
    try {
      const vcard = (registrar?.vcardArray as unknown[] | undefined)?.[1] as unknown[] | undefined;
      const fn = vcard?.find((entry) => Array.isArray(entry) && entry[0] === 'fn') as unknown[] | undefined;
      registrarName = typeof fn?.[3] === 'string' ? (fn[3] as string) : null;
    } catch {
      registrarName = null;
    }
    result = {
      source,
      status: 'ok',
      summary: ageDays !== null ? `Registered ${ageDays} day${ageDays === 1 ? '' : 's'} ago${registrarName ? ` via ${registrarName}` : ''}.` : 'Registration date not exposed by registry.',
      data: { registered: true, registeredAt, ageDays, registrar: registrarName, status: res.data.status || [] },
      fetchedAt: now(),
    };
  }
  cacheSet(`rdap:${domain}`, result, CACHE_TTL);
  return result;
}

// ---------------------------------------------------------------------------
// DNS (keyless) — does the domain resolve? has mail records?
// ---------------------------------------------------------------------------
export async function dnsLookup(domain: string): Promise<IntelSourceResult> {
  const source = 'DNS resolution';
  if (isIpAddress(domain)) return { source, status: 'ok', summary: 'Raw IP address (no DNS name).', data: { resolves: true, addresses: [domain] }, fetchedAt: now() };

  const cached = cacheGet<IntelSourceResult>(`dns:${domain}`);
  if (cached) return cached;

  const withTimeout = <T>(p: Promise<T>): Promise<T | null> =>
    Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), TIMEOUTS.dns))]);

  const [a, mx, ns] = await Promise.all([withTimeout(dns.resolve4(domain)), withTimeout(dns.resolveMx(domain)), withTimeout(dns.resolveNs(domain))]);
  const addresses = a || [];
  const resolves = addresses.length > 0;
  const result: IntelSourceResult = {
    source,
    status: 'ok',
    summary: resolves ? `Resolves to ${addresses.length} address${addresses.length === 1 ? '' : 'es'}${mx && mx.length ? ', has mail records' : ', no mail records'}.` : 'Domain does not currently resolve (may be parked, taken down, or not yet live).',
    data: { resolves, addresses: addresses.slice(0, 4), hasMx: Boolean(mx && mx.length), nameservers: (ns || []).slice(0, 4) },
    fetchedAt: now(),
  };
  cacheSet(`dns:${domain}`, result, CACHE_TTL);
  return result;
}

// ---------------------------------------------------------------------------
// VirusTotal — domain reputation
// ---------------------------------------------------------------------------
export async function virusTotalLookup(domain: string): Promise<IntelSourceResult> {
  const source = 'VirusTotal';
  const key = getIntelKeys().virusTotal;
  if (!key) return { source, status: 'not_configured', summary: 'Not configured (set VIRUSTOTAL_API_KEY).' };

  const cached = cacheGet<IntelSourceResult>(`vt:${domain}`);
  if (cached) return cached;

  const endpoint = isIpAddress(domain) ? `ip_addresses/${domain}` : `domains/${encodeURIComponent(domain)}`;
  const res = await fetchJson<{ data?: { attributes?: { last_analysis_stats?: Record<string, number>; reputation?: number; creation_date?: number } } }>(
    `https://www.virustotal.com/api/v3/${endpoint}`,
    { timeoutMs: TIMEOUTS.externalIntel, headers: { 'x-apikey': key } },
  );

  let result: IntelSourceResult;
  if (res.status === 404) {
    result = { source, status: 'ok', summary: 'No VirusTotal record for this domain.', data: { known: false, malicious: 0, suspicious: 0, harmless: 0 }, fetchedAt: now() };
  } else if (!res.ok || !res.data?.data?.attributes) {
    result = { source, status: res.status === 401 || res.status === 403 ? 'error' : 'unavailable', summary: res.status === 401 || res.status === 403 ? 'API key rejected.' : 'Lookup unavailable.', error: res.error, fetchedAt: now() };
  } else {
    const stats = res.data.data.attributes.last_analysis_stats || {};
    const malicious = stats.malicious || 0;
    const suspicious = stats.suspicious || 0;
    const harmless = stats.harmless || 0;
    result = {
      source,
      status: 'ok',
      summary: malicious + suspicious > 0 ? `${malicious} vendors flag malicious, ${suspicious} suspicious.` : `No vendor flags (${harmless} harmless verdicts).`,
      data: { known: true, malicious, suspicious, harmless, reputation: res.data.data.attributes.reputation ?? null },
      fetchedAt: now(),
    };
  }
  cacheSet(`vt:${domain}`, result, CACHE_TTL);
  return result;
}

// ---------------------------------------------------------------------------
// Google Safe Browsing v4 — URL threat matches
// ---------------------------------------------------------------------------
export async function safeBrowsingLookup(urls: string[]): Promise<IntelSourceResult> {
  const source = 'Google Safe Browsing';
  const key = getIntelKeys().safeBrowsing;
  if (!key) return { source, status: 'not_configured', summary: 'Not configured (set GOOGLE_SAFE_BROWSING_API_KEY).' };
  if (!urls.length) return { source, status: 'skipped', summary: 'No URL to check.' };

  const cacheKey = `gsb:${urls.join('|')}`;
  const cached = cacheGet<IntelSourceResult>(cacheKey);
  if (cached) return cached;

  const res = await fetchJson<{ matches?: Array<{ threatType: string; platformType: string }> }>(
    `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      timeoutMs: TIMEOUTS.externalIntel,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'online-safety-guard', clientVersion: '2.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: urls.map((url) => ({ url })),
        },
      }),
    },
  );

  let result: IntelSourceResult;
  if (!res.ok) {
    result = { source, status: res.status === 400 || res.status === 403 ? 'error' : 'unavailable', summary: 'Lookup unavailable.', error: res.error, fetchedAt: now() };
  } else {
    const matches = res.data?.matches || [];
    result = {
      source,
      status: 'ok',
      summary: matches.length ? `Listed as ${Array.from(new Set(matches.map((m) => m.threatType.toLowerCase().replace(/_/g, ' ')))).join(', ')}.` : 'Not on Safe Browsing blocklists (new phishing sites are often not yet listed).',
      data: { matches: matches.length, threatTypes: matches.map((m) => m.threatType) },
      fetchedAt: now(),
    };
  }
  cacheSet(cacheKey, result, CACHE_TTL);
  return result;
}

// ---------------------------------------------------------------------------
// urlscan.io — prior community scans of the domain
// ---------------------------------------------------------------------------
export async function urlScanLookup(domain: string): Promise<IntelSourceResult> {
  const source = 'urlscan.io';
  const key = getIntelKeys().urlScan;
  if (!key) return { source, status: 'not_configured', summary: 'Not configured (set URLSCAN_API_KEY).' };
  if (isIpAddress(domain)) return { source, status: 'skipped', summary: 'Not applicable to IP addresses.' };

  const cached = cacheGet<IntelSourceResult>(`urlscan:${domain}`);
  if (cached) return cached;

  const res = await fetchJson<{ total?: number; results?: Array<{ verdicts?: { overall?: { malicious?: boolean; score?: number } }; task?: { time?: string } }> }>(
    `https://urlscan.io/api/v1/search/?q=domain:${encodeURIComponent(domain)}&size=20`,
    { timeoutMs: TIMEOUTS.externalIntel, headers: { 'API-Key': key } },
  );

  let result: IntelSourceResult;
  if (!res.ok || !res.data) {
    result = { source, status: res.status === 401 ? 'error' : 'unavailable', summary: res.status === 401 ? 'API key rejected.' : 'Lookup unavailable.', error: res.error, fetchedAt: now() };
  } else {
    const results = res.data.results || [];
    const maliciousScans = results.filter((r) => r.verdicts?.overall?.malicious).length;
    const total = res.data.total ?? results.length;
    result = {
      source,
      status: 'ok',
      summary: total ? `${total} prior scan${total === 1 ? '' : 's'}${maliciousScans ? `, ${maliciousScans} flagged malicious` : ''}.` : 'No prior community scans.',
      data: { totalScans: total, maliciousScans },
      fetchedAt: now(),
    };
  }
  cacheSet(`urlscan:${domain}`, result, CACHE_TTL);
  return result;
}

// ---------------------------------------------------------------------------
// AbuseIPDB — abuse reports for the resolved IP
// ---------------------------------------------------------------------------
export async function abuseIpDbLookup(ip: string | null): Promise<IntelSourceResult> {
  const source = 'AbuseIPDB';
  const key = getIntelKeys().abuseIpDb;
  if (!key) return { source, status: 'not_configured', summary: 'Not configured (set ABUSEIPDB_API_KEY).' };
  if (!ip) return { source, status: 'skipped', summary: 'No resolved IP address to check.' };

  const cached = cacheGet<IntelSourceResult>(`abuse:${ip}`);
  if (cached) return cached;

  const res = await fetchJson<{ data?: { abuseConfidenceScore?: number; totalReports?: number; countryCode?: string; isp?: string } }>(
    `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`,
    { timeoutMs: TIMEOUTS.externalIntel, headers: { Key: key, Accept: 'application/json' } },
  );

  let result: IntelSourceResult;
  if (!res.ok || !res.data?.data) {
    result = { source, status: res.status === 401 ? 'error' : 'unavailable', summary: res.status === 401 ? 'API key rejected.' : 'Lookup unavailable.', error: res.error, fetchedAt: now() };
  } else {
    const d = res.data.data;
    result = {
      source,
      status: 'ok',
      summary: `Abuse confidence ${d.abuseConfidenceScore ?? 0}% from ${d.totalReports ?? 0} reports${d.countryCode ? ` (${d.countryCode})` : ''}.`,
      data: { abuseConfidenceScore: d.abuseConfidenceScore ?? 0, totalReports: d.totalReports ?? 0, countryCode: d.countryCode ?? null, isp: d.isp ?? null },
      fetchedAt: now(),
    };
  }
  cacheSet(`abuse:${ip}`, result, CACHE_TTL);
  return result;
}

// ---------------------------------------------------------------------------
// Aggregate runner used by the Threat Intelligence Agent
// ---------------------------------------------------------------------------
export async function gatherExternalEvidence(domain: string, urls: string[]): Promise<ExternalEvidence> {
  if (!isSafeHostnameForLookup(domain)) {
    return { domain, domainAgeDays: null, registeredAt: null, threatReports: null, resolves: null, availableSources: 0, sources: [{ source: 'Input validation', status: 'skipped', summary: 'Hostname is not eligible for external lookup.' }] };
  }

  // Keyless sources + keyed sources run in parallel; AbuseIPDB needs the DNS result first.
  const [rdap, dnsRes, vt, gsb, urlscan] = await Promise.all([
    rdapLookup(domain),
    dnsLookup(domain),
    virusTotalLookup(domain),
    safeBrowsingLookup(urls),
    urlScanLookup(domain),
  ]);
  const firstIp = (dnsRes.data?.addresses as string[] | undefined)?.[0] || (isIpAddress(domain) ? domain : null);
  const abuse = await abuseIpDbLookup(firstIp);

  const sources = [rdap, dnsRes, vt, gsb, urlscan, abuse];
  const vtMal = ((vt.data?.malicious as number) || 0) + ((vt.data?.suspicious as number) || 0);
  const gsbMatches = (gsb.data?.matches as number) || 0;
  const usMal = (urlscan.data?.maliciousScans as number) || 0;
  const anyThreatSourceOk = [vt, gsb, urlscan].some((s) => s.status === 'ok');

  return {
    domain,
    domainAgeDays: (rdap.data?.ageDays as number | null) ?? null,
    registeredAt: (rdap.data?.registeredAt as string | null) ?? null,
    threatReports: anyThreatSourceOk ? vtMal + gsbMatches + usMal : null,
    resolves: (dnsRes.data?.resolves as boolean | undefined) ?? null,
    sources,
    availableSources: sources.filter((s) => s.status === 'ok').length,
  };
}
