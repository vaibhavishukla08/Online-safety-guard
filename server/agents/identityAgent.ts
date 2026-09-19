/**
 * Identity / Brand Impersonation Agent
 *
 * Compares the organization a message *claims* to be from with what can actually
 * be observed (link domains, sender email domain). A mismatch is presented as an
 * evidence signal — never as proof of fraud on its own.
 *
 * Deterministic path: known-organization registry.
 * AI path (only when the claimed organization is unknown to the registry): Gemini
 * is asked for the organization's official domain and whether the observed domain
 * plausibly belongs to it. That contribution is labelled and weighted lower.
 */
import { Type } from '@google/genai';
import { generateJson } from '../gemini/client';
import { domainBelongsTo, findClaimedOrganizations, findOrganizationByName, type KnownOrganization } from '../rules/brands';
import { hostnameOf, registrableDomain } from '../utils/url';
import { addEvidence, addIndicator, beginStep, noteAiFailure, type AgentContext } from './context';
import type { IdentityFinding } from '../../shared/investigation';

const FREE_WEBMAIL = new Set(['gmail.com', 'yahoo.com', 'yahoo.in', 'outlook.com', 'hotmail.com', 'rediffmail.com', 'protonmail.com', 'proton.me', 'icloud.com', 'aol.com', 'mail.com', 'yandex.com', 'zoho.com']);

function senderDomain(sender: string | null): string | null {
  if (!sender) return null;
  const m = sender.match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  return m ? m[1].toLowerCase() : null;
}

/** Should the orchestrator run this agent at all? */
export function identityCheckNeeded(ctx: AgentContext): { needed: boolean; reason: string } {
  const registryHits = findClaimedOrganizations(ctx.input.message, ctx.input.sender);
  const aiClaim = ctx.messageAssessment?.claimedOrganization;
  const visionClaim = ctx.input.extracted?.claimedOrganization;
  if (registryHits.length || aiClaim || visionClaim) return { needed: true, reason: 'organization claim detected' };
  if (ctx.urls.some((u) => u.lookalikeOf)) return { needed: true, reason: 'look-alike domain detected' };
  return { needed: false, reason: 'no organization claim or brand reference found' };
}

export async function runIdentityAgent(ctx: AgentContext): Promise<void> {
  const finish = beginStep(ctx, 'identity', 'Identity Agent', 'Comparing the claimed organization with observed domains…');

  const observedDomains = Array.from(new Set(ctx.urls.map((u) => u.registrableDomain)));
  const senderDom = senderDomain(ctx.input.sender);
  if (senderDom && !observedDomains.includes(senderDom)) observedDomains.push(senderDom);

  // 1. Deterministic: registry match (prefer the org the message text names, then sender/vision/AI claims).
  const registryHits = findClaimedOrganizations(ctx.input.message, ctx.input.sender);
  let org: KnownOrganization | null = registryHits[0]?.organization || null;
  const claimedName = ctx.input.extracted?.claimedOrganization || ctx.messageAssessment?.claimedOrganization || null;
  if (!org && claimedName) org = findOrganizationByName(claimedName);
  if (!org) {
    const lookalike = ctx.urls.find((u) => u.lookalikeOf)?.lookalikeOf;
    if (lookalike) org = findOrganizationByName(lookalike) || null;
  }

  let finding: IdentityFinding;

  if (org) {
    const matching = observedDomains.filter((d) => domainBelongsTo(d, org!));
    const mismatching = observedDomains.filter((d) => !domainBelongsTo(d, org!));
    const webmailSender = senderDom ? FREE_WEBMAIL.has(senderDom) : false;

    if (observedDomains.length === 0) {
      finding = {
        claimedOrganization: org.name,
        organizationCategory: org.category,
        observedDomains: [],
        observedSender: ctx.input.sender,
        officialDomains: org.officialDomains,
        mismatch: false,
        verdict: `Message references ${org.name} but contains no domain to verify against. Official domains: ${org.officialDomains.join(', ')}.`,
        source: 'rule',
      };
      addEvidence(ctx, { id: 'ev-brand_reference', title: `Claims to be ${org.name}`, description: `The message invokes ${org.name} (${org.category}). No link or sender domain was available to verify the claim — confirm through the official app or website.`, source: 'rule', agent: 'identity', severity: 'low' });
    } else if (mismatching.length && !matching.length) {
      finding = {
        claimedOrganization: org.name,
        organizationCategory: org.category,
        observedDomains,
        observedSender: ctx.input.sender,
        officialDomains: org.officialDomains,
        mismatch: true,
        verdict: `Claims to be ${org.name}, but the observed domain${mismatching.length > 1 ? 's' : ''} (${mismatching.join(', ')}) ${mismatching.length > 1 ? 'do' : 'does'} not belong to ${org.name} (official: ${org.officialDomains.slice(0, 3).join(', ')}). Potential brand impersonation.`,
        source: 'rule',
      };
      addIndicator(ctx, { id: 'brand_mismatch', label: 'Brand impersonation', points: 20, evidence: `${org.name} ≠ ${mismatching[0]}`, source: 'rule', agent: 'identity' });
      addEvidence(ctx, { id: 'ev-brand_mismatch', title: 'Claimed organization does not match domain', description: `The message presents itself as ${org.name}, a ${org.category}, yet points to "${mismatching[0]}". ${org.name}'s official domains are ${org.officialDomains.slice(0, 3).join(', ')}.`, source: 'rule', agent: 'identity', severity: 'high' });
    } else {
      finding = {
        claimedOrganization: org.name,
        organizationCategory: org.category,
        observedDomains,
        observedSender: ctx.input.sender,
        officialDomains: org.officialDomains,
        mismatch: false,
        verdict: `Observed domain (${matching[0]}) matches an official ${org.name} domain. This supports — but does not prove — authenticity.`,
        source: 'rule',
      };
      addIndicator(ctx, { id: 'official_domain_match', label: 'Official domain match', points: -10, evidence: matching[0], source: 'rule', agent: 'identity' });
      addEvidence(ctx, { id: 'ev-official_domain_match', title: 'Domain matches official organization', description: `"${matching[0]}" is a verified ${org.name} domain. Still confirm any request inside the official app.`, source: 'rule', agent: 'identity', severity: 'low' });
    }

    if (webmailSender) {
      addIndicator(ctx, { id: 'sender_anomaly', label: 'Free webmail sender for an organization', points: 10, evidence: senderDom || '', source: 'rule', agent: 'identity' });
      addEvidence(ctx, { id: 'ev-sender_anomaly', title: 'Organization using free webmail', description: `A message claiming to be ${org.name} was sent from ${senderDom}. Real organizations send from their own domains.`, source: 'rule', agent: 'identity', severity: 'medium' });
    }

    ctx.identity = finding;
    finish('completed', finding.mismatch ? `Potential impersonation of ${org.name}` : `${org.name} referenced · ${observedDomains.length ? 'domain check done' : 'no domain to verify'}`, [finding.verdict]);
    return;
  }

  // 2. AI-assisted path for organizations not in the registry.
  if (claimedName && observedDomains.length) {
    const result = await generateJson<{ officialDomains: string[]; observedMatches: boolean; assessment: string; category: string }>({
      systemInstruction: 'You are the Identity Verification Agent of a cyber-safety system. Be conservative: if unsure whether a domain is official, say it does not match and explain uncertainty.',
      prompt: `An organization named "${claimedName}" is claimed by a message. Observed domains: ${observedDomains.join(', ')}.
Return JSON: officialDomains (array of the organization's real primary domains, or empty if unknown), observedMatches (boolean — does any observed domain belong to the organization?), category (bank, government, ecommerce, payment, delivery, social, telecom, tech, employer, university, crypto, streaming, other), assessment (one sentence).`,
      schema: {
        type: Type.OBJECT,
        properties: {
          officialDomains: { type: Type.ARRAY, items: { type: Type.STRING } },
          observedMatches: { type: Type.BOOLEAN },
          category: { type: Type.STRING },
          assessment: { type: Type.STRING },
        },
        required: ['officialDomains', 'observedMatches', 'category', 'assessment'],
      },
      temperature: 0.1,
    });

    if (result.ok) {
      ctx.aiCallsSucceeded += 1;
      const official = (result.data.officialDomains || []).map((d) => hostnameOf(d)).filter((d): d is string => Boolean(d)).map(registrableDomain);
      const mismatch = !result.data.observedMatches;
      ctx.identity = {
        claimedOrganization: claimedName,
        organizationCategory: result.data.category || null,
        observedDomains,
        observedSender: ctx.input.sender,
        officialDomains: official,
        mismatch,
        verdict: `${result.data.assessment} (AI-assessed — organization not in local registry.)`,
        source: 'ai',
      };
      if (mismatch) {
        addIndicator(ctx, { id: 'brand_mismatch', label: 'Brand impersonation (AI-assessed)', points: 12, evidence: `${claimedName} ≠ ${observedDomains[0]}`, source: 'ai', agent: 'identity' });
        addEvidence(ctx, { id: 'ev-brand_mismatch', title: 'Claimed organization does not appear to match domain', description: `${result.data.assessment} This comparison was made by the AI model, not by a verified registry.`, source: 'ai', agent: 'identity', severity: 'medium' });
      }
      finish('completed', mismatch ? `Possible impersonation of ${claimedName} (AI-assessed)` : `${claimedName}: observed domain plausibly official (AI-assessed)`, [ctx.identity.verdict]);
      return;
    }
    noteAiFailure(ctx, result.code);
  }

  ctx.identity = {
    claimedOrganization: claimedName,
    organizationCategory: null,
    observedDomains,
    observedSender: ctx.input.sender,
    officialDomains: [],
    mismatch: false,
    verdict: claimedName ? `"${claimedName}" is not in the local registry and AI verification was unavailable — verify the sender through official channels.` : 'No organization claim to verify.',
    source: 'rule',
  };
  finish('completed', claimedName ? `${claimedName} could not be verified (not in registry, AI unavailable)` : 'No verifiable organization claim', [ctx.identity.verdict]);
}
