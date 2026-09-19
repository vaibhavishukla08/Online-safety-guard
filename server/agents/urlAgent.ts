/**
 * URL Investigation Agent — deterministic, offline analysis of every link.
 * Never fetches the link. Produces UrlFinding objects plus scored indicators.
 */
import { KNOWN_ORGANIZATIONS, brandTokenInHost, domainBelongsTo } from '../rules/brands';
import { RISKY_TLDS, SHORTENERS, hasCredentialKeywords, hostnameOf, isIpAddress, normalizeUrl, registrableDomain, tldOf } from '../utils/url';
import { addEvidence, addIndicator, beginStep, type AgentContext } from './context';
import type { UrlFinding } from '../../shared/investigation';

export function analyzeUrl(raw: string): UrlFinding | null {
  const normalized = normalizeUrl(raw);
  const hostname = hostnameOf(raw);
  if (!normalized || !hostname) return null;

  const ip = isIpAddress(hostname);
  const regDomain = registrableDomain(hostname);
  const tld = tldOf(hostname);
  const flags: string[] = [];

  const suspiciousTld = RISKY_TLDS.has(tld);
  if (suspiciousTld) flags.push(`High-abuse top-level domain ".${tld}"`);
  if (ip) flags.push('Raw IP address instead of a domain name');
  const hyphenCount = (hostname.match(/-/g) || []).length;
  if (hyphenCount >= 2) flags.push(`${hyphenCount} hyphens in hostname (typical of look-alike domains)`);
  const isShortener = SHORTENERS.has(regDomain);
  if (isShortener) flags.push('URL shortener hides the real destination');
  const credentialKeywords = hasCredentialKeywords(normalized);
  if (credentialKeywords) flags.push('Login/verify/secure keywords in the address');
  const subdomainDepth = ip ? 0 : Math.max(0, hostname.split('.').length - regDomain.split('.').length);
  if (subdomainDepth >= 2) flags.push(`Deep subdomain nesting (${subdomainDepth} levels)`);
  if (/^https?:\/\/[^/]*@/i.test(normalized)) flags.push('Embedded credentials ("@") in URL');

  // Look-alike check: does the host contain a known brand without being that brand's domain?
  let lookalikeOf: string | null = null;
  for (const org of KNOWN_ORGANIZATIONS) {
    if (domainBelongsTo(regDomain, org)) {
      lookalikeOf = null;
      break;
    }
    const token = brandTokenInHost(hostname, org);
    if (token && !lookalikeOf) {
      lookalikeOf = org.name;
      flags.push(`Contains "${token}" but is not an official ${org.name} domain`);
    }
  }

  return { raw, normalized, hostname, registrableDomain: regDomain, tld, isIpAddress: ip, suspiciousTld, hyphenCount, isShortener, hasCredentialKeywords: credentialKeywords, lookalikeOf, subdomainDepth, flags };
}

export async function runUrlAgent(ctx: AgentContext): Promise<void> {
  const finish = beginStep(ctx, 'url', 'URL Agent', `Inspecting ${ctx.input.urls.length} link${ctx.input.urls.length === 1 ? '' : 's'} offline…`);
  const findings: UrlFinding[] = [];
  for (const raw of ctx.input.urls) {
    const f = analyzeUrl(raw);
    if (f && !findings.some((x) => x.normalized === f.normalized)) findings.push(f);
  }
  ctx.urls = findings;

  if (!findings.length) {
    finish('completed', 'No valid URLs could be parsed.');
    return;
  }

  const details: string[] = [];
  let anyStrong = false;
  for (const f of findings) {
    if (f.suspiciousTld) {
      anyStrong = true;
      addIndicator(ctx, { id: 'suspicious_url', label: 'Suspicious URL', points: 20, evidence: f.hostname, source: 'rule', agent: 'url' });
      addEvidence(ctx, { id: 'ev-suspicious_url', title: 'Suspicious domain', description: `"${f.hostname}" uses ".${f.tld}", a top-level domain heavily abused by phishing kits because it is cheap or free to register.`, source: 'rule', agent: 'url', severity: 'high' });
    }
    if (f.isIpAddress) {
      anyStrong = true;
      addIndicator(ctx, { id: 'ip_url', label: 'Raw IP address link', points: 15, evidence: f.hostname, source: 'rule', agent: 'url' });
      addEvidence(ctx, { id: 'ev-ip_url', title: 'Raw IP address', description: 'Legitimate services use domain names; a raw IP address usually points at a throwaway server.', source: 'rule', agent: 'url', severity: 'high' });
    }
    if (f.isShortener) {
      addIndicator(ctx, { id: 'url_shortener', label: 'Shortened link', points: 10, evidence: f.hostname, source: 'rule', agent: 'url' });
      addEvidence(ctx, { id: 'ev-url_shortener', title: 'Shortened link', description: `"${f.hostname}" hides the true destination, so you cannot judge the site before opening it.`, source: 'rule', agent: 'url', severity: 'medium' });
    }
    if (f.lookalikeOf) {
      anyStrong = true;
      addIndicator(ctx, { id: 'lookalike_domain', label: 'Look-alike domain', points: 15, evidence: `${f.hostname} ≠ ${f.lookalikeOf}`, source: 'rule', agent: 'url' });
      addEvidence(ctx, { id: 'ev-lookalike_domain', title: 'Look-alike domain', description: `"${f.hostname}" contains the ${f.lookalikeOf} name but is not one of its official domains.`, source: 'rule', agent: 'url', severity: 'high' });
    }
    if (f.hasCredentialKeywords) {
      addIndicator(ctx, { id: 'credential_url', label: 'Login/verify keywords in URL', points: 8, evidence: f.normalized.slice(0, 80), source: 'rule', agent: 'url' });
    }
    if (f.hyphenCount >= 2 && !f.suspiciousTld) {
      addIndicator(ctx, { id: 'hyphenated_host', label: 'Hyphen-heavy hostname', points: 6, evidence: f.hostname, source: 'rule', agent: 'url' });
    }
    details.push(`${f.hostname}: ${f.flags.length ? f.flags.join('; ') : 'no structural red flags'}`);
  }

  if (!anyStrong) {
    // A plain external link in an unsolicited message is still a mild signal.
    addIndicator(ctx, { id: 'external_link', label: 'External link in message', points: 5, evidence: findings[0].hostname, source: 'rule', agent: 'url' });
  }

  const flagged = findings.filter((f) => f.flags.length).length;
  finish('completed', flagged ? `${flagged} of ${findings.length} link${findings.length === 1 ? '' : 's'} carry structural red flags` : `${findings.length} link${findings.length === 1 ? '' : 's'} parsed · no structural red flags`, details);
}
