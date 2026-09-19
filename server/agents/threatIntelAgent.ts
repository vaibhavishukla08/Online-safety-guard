/**
 * Threat Intelligence Agent — gathers *external* evidence about the most
 * suspicious domain from configured sources. Results are labelled "external"
 * everywhere in the UI and never fabricated.
 */
import { gatherExternalEvidence } from '../intel';
import { addEvidence, addIndicator, beginStep, type AgentContext } from './context';

export function threatIntelNeeded(ctx: AgentContext): { needed: boolean; reason: string } {
  if (!ctx.urls.length) return { needed: false, reason: 'no URL to look up' };
  return { needed: true, reason: 'link present — checking external sources' };
}

/** Pick the URL most worth spending an external lookup on. */
function primaryTarget(ctx: AgentContext) {
  const ranked = [...ctx.urls].sort((a, b) => b.flags.length - a.flags.length);
  return ranked[0];
}

export async function runThreatIntelAgent(ctx: AgentContext): Promise<void> {
  const target = primaryTarget(ctx);
  const finish = beginStep(ctx, 'threat_intel', 'Threat Intelligence Agent', `Querying external sources for ${target.registrableDomain}…`);

  const evidence = await gatherExternalEvidence(target.registrableDomain, ctx.urls.map((u) => u.normalized));
  ctx.external = evidence;

  const details: string[] = evidence.sources.map((s) => `${s.source}: ${s.summary}`);

  if (evidence.domainAgeDays !== null) {
    if (evidence.domainAgeDays < 30) {
      addIndicator(ctx, { id: 'intel_new_domain', label: 'Very new domain', points: 12, evidence: `Registered ${evidence.domainAgeDays} days ago`, source: 'external', agent: 'threat_intel' });
      addEvidence(ctx, { id: 'ev-intel_new_domain', title: 'Domain registered very recently', description: `RDAP shows "${evidence.domain}" was registered ${evidence.domainAgeDays} day${evidence.domainAgeDays === 1 ? '' : 's'} ago. Phishing domains are typically days old; established organizations have years-old domains.`, source: 'external', agent: 'threat_intel', severity: 'high' });
    } else if (evidence.domainAgeDays < 180) {
      addIndicator(ctx, { id: 'intel_new_domain', label: 'Recently registered domain', points: 6, evidence: `Registered ${evidence.domainAgeDays} days ago`, source: 'external', agent: 'threat_intel' });
      addEvidence(ctx, { id: 'ev-intel_new_domain', title: 'Domain is only months old', description: `RDAP shows "${evidence.domain}" was registered ${evidence.domainAgeDays} days ago.`, source: 'external', agent: 'threat_intel', severity: 'medium' });
    }
  }

  if (evidence.threatReports !== null && evidence.threatReports > 0) {
    addIndicator(ctx, { id: 'intel_malicious', label: 'Flagged by threat intelligence', points: 25, evidence: `${evidence.threatReports} report${evidence.threatReports === 1 ? '' : 's'} across configured sources`, source: 'external', agent: 'threat_intel' });
    addEvidence(ctx, { id: 'ev-intel_malicious', title: 'Known-bad according to external sources', description: evidence.sources.filter((s) => s.status === 'ok' && /flag|malicious|listed/i.test(s.summary)).map((s) => `${s.source}: ${s.summary}`).join(' ') || 'External sources report this domain as malicious.', source: 'external', agent: 'threat_intel', severity: 'high' });
  }

  if (evidence.resolves === false) {
    addEvidence(ctx, { id: 'ev-intel_unresolved', title: 'Domain does not resolve', description: 'The domain currently has no address record. It may already be taken down, not yet activated, or a typo.', source: 'external', agent: 'threat_intel', severity: 'low' });
  }

  const available = evidence.availableSources;
  const configuredMissing = evidence.sources.filter((s) => s.status === 'not_configured').length;
  const parts: string[] = [`${available} source${available === 1 ? '' : 's'} returned data`];
  if (evidence.domainAgeDays !== null) parts.push(`domain age ${evidence.domainAgeDays}d`);
  if (evidence.threatReports !== null) parts.push(`${evidence.threatReports} threat report${evidence.threatReports === 1 ? '' : 's'}`);
  if (configuredMissing) parts.push(`${configuredMissing} not configured`);

  if (available === 0) {
    ctx.notices.push('No external threat-intelligence source returned data (offline or not configured). Verdict relies on rules and AI analysis.');
  }
  finish(available > 0 ? 'completed' : 'unavailable', parts.join(' · '), details);
}
