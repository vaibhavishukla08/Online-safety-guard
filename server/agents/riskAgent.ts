/**
 * Risk Assessment Agent — evidence fusion.
 *
 * Combines every indicator into a transparent score, applies a *bounded* AI
 * calibration, derives the risk level, confidence, Scam DNA and the plain-language
 * "why this was flagged" list. Fully deterministic given the collected evidence.
 */
import { AI_CALIBRATION_MAX, AI_LEGITIMACY_MAX, buildScamDna, computeConfidence, levelForScore, sumIndicators } from '../rules/scoring';
import { addIndicator, beginStep, type AgentContext } from './context';
import type { RiskLevel, ScamDna, Verdict } from '../../shared/investigation';

export interface RiskOutcome {
  verdict: Verdict;
  scamDna: ScamDna;
  whyFlagged: string[];
}

export async function runRiskAgent(ctx: AgentContext): Promise<RiskOutcome> {
  const finish = beginStep(ctx, 'risk', 'Risk Assessment Agent', 'Fusing evidence into a transparent risk score…');

  const ruleScore = sumIndicators(ctx.indicators.filter((i) => i.source !== 'ai'));
  const ai = ctx.messageAssessment;

  // --- Bounded AI calibration ---------------------------------------------
  if (ai) {
    if (ai.scamConfidence >= 0.7 && ruleScore < 60) {
      // The model sees a threat the rules under-weighted (e.g. novel wording).
      const points = Math.min(AI_CALIBRATION_MAX, Math.round(ai.scamConfidence * AI_CALIBRATION_MAX));
      addIndicator(ctx, { id: 'ai_context', label: 'AI contextual assessment', points, evidence: `Model rates scam likelihood ${Math.round(ai.scamConfidence * 100)}% (${ai.scamType})`, source: 'ai', agent: 'risk' });
    } else if (ai.legitimacyConfidence >= 0.75 && ai.scamConfidence <= 0.25 && ruleScore < 50) {
      // The model is confident this is benign and rules found little — allow a bounded reduction.
      const points = -Math.min(AI_LEGITIMACY_MAX, Math.round(ai.legitimacyConfidence * AI_LEGITIMACY_MAX));
      addIndicator(ctx, { id: 'ai_legitimate', label: 'AI legitimacy assessment', points, evidence: `Model rates legitimacy ${Math.round(ai.legitimacyConfidence * 100)}% (${ai.scamType})`, source: 'ai', agent: 'risk' });
    } else if (ai.legitimacyConfidence >= 0.75 && ruleScore >= 50) {
      ctx.notices.push('AI judged the message likely legitimate, but deterministic evidence was strong; the rule-based score was retained and confidence lowered.');
    }
  }

  const riskScore = sumIndicators(ctx.indicators);
  const level: RiskLevel = levelForScore(riskScore);
  let { confidence, note } = computeConfidence(ctx.indicators, riskScore);
  if (ai && ai.legitimacyConfidence >= 0.75 && ruleScore >= 50) {
    confidence = 'medium';
    note = 'Rules and AI disagree; the rule-based evidence is shown so you can judge for yourself.';
  }
  if (!ai && ctx.aiFailures.length) {
    note += ' AI analysis was unavailable for this scan.';
  }

  const scamDna = buildScamDna(ctx.indicators);
  const whyFlagged = buildWhyFlagged(ctx, level);
  const scamType = resolveScamType(ctx, level);
  const summary = ai?.summary || ctx.conversation?.escalationPattern || fallbackSummary(ctx, level, scamType);

  const verdict: Verdict = { level, riskScore, scamType, summary, confidence, confidenceNote: note };
  const positive = ctx.indicators.filter((i) => i.points > 0).length;
  finish('completed', `Combined ${positive} risk indicator${positive === 1 ? '' : 's'} → ${riskScore}/100 (${level})`, whyFlagged.slice(0, 4));
  return { verdict, scamDna, whyFlagged };
}

function buildWhyFlagged(ctx: AgentContext, level: RiskLevel): string[] {
  const why: string[] = [];
  const has = (id: string) => ctx.indicators.some((i) => i.id === id && i.points > 0);
  if (has('urgency')) why.push('The message creates urgency or a deadline.');
  if (has('threat')) why.push('It threatens a loss (account, legal action or penalty).');
  if (ctx.identity?.claimedOrganization && (ctx.identity.mismatch || level !== 'LOW')) {
    why.push(ctx.identity.mismatch ? `It claims to be ${ctx.identity.claimedOrganization}, but the link/sender domain does not match that organization.` : `It claims to represent ${ctx.identity.claimedOrganization}.`);
  }
  if (has('suspicious_url') || has('ip_url') || has('lookalike_domain') || has('url_shortener')) why.push('The link has structural signs of a deceptive or throwaway domain.');
  if (has('credential_request') || has('credential_request_ai') || has('personal_data_request')) why.push('It asks for sensitive information (codes, passwords, PINs or identity details).');
  if (has('financial_request') || has('financial_request_ai') || has('small_fee') || has('untraceable_payment')) why.push('It asks for money' + (has('untraceable_payment') ? ' through a channel that cannot be reversed.' : '.'));
  if (has('fake_reward')) why.push('It promises a reward or income that is unrealistically generous.');
  if (has('authority')) why.push('It invokes official or legal authority to discourage questions.');
  if (has('external_contact')) why.push('It pushes the conversation to another app where fraud is harder to trace.');
  if (has('intel_malicious')) why.push('External threat intelligence already reports the domain as malicious.');
  if (has('intel_new_domain')) why.push('The domain was registered only recently.');
  if (has('conversation_escalation')) why.push('The conversation follows a hook-then-ask escalation pattern.');
  if (ctx.socialEngineering?.primaryTactics.length) why.push(`It relies on ${ctx.socialEngineering.primaryTactics.join(' and ').toLowerCase()} to push you to act.`);
  if (level === 'LOW') {
    // For low-risk content explain what was checked and found clean, plus any mitigating evidence.
    const clean: string[] = [];
    if (!ctx.urls.length) clean.push('No links were found in the message.');
    if (!ctx.financial?.credentialRequested && !ctx.financial?.paymentRequested) clean.push('It does not ask for codes, passwords or money.');
    if (has('legit_otp_format')) clean.push('It follows the genuine one-time-code format (warns you not to share the code).');
    if (has('official_domain_match')) clean.push('The domain matches the organization’s official website.');
    if (has('ai_legitimate')) clean.push('AI analysis also assessed the wording as consistent with a genuine notification.');
    if (!why.length && !clean.length) clean.push('No scam indicators were found by rules, AI or external checks.');
    return [...clean, ...why].slice(0, 6);
  }
  if (!why.length) why.push('Weak signals only; treat with caution.');
  return Array.from(new Set(why)).slice(0, 8);
}

function resolveScamType(ctx: AgentContext, level: RiskLevel): string {
  if (ctx.conversation && ctx.conversation.source === 'ai') return ctx.conversation.scamType;
  if (ctx.messageAssessment?.scamType) return ctx.messageAssessment.scamType;
  // Rule-derived category.
  const has = (id: string) => ctx.indicators.some((i) => i.id === id && i.points > 0);
  if (level === 'LOW') return 'No scam pattern detected';
  const cat = ctx.identity?.organizationCategory;
  if (has('fake_reward') && (has('financial_request') || has('small_fee'))) return 'Advance-Fee / Job Scam';
  if (cat === 'delivery') return 'Delivery Fee Smishing';
  if (cat === 'government') return 'Government Impersonation';
  if (cat === 'bank') return has('credential_request') || has('verification_prompt') || has('credential_url') ? 'Bank Phishing' : 'Bank Impersonation';
  if (cat === 'payment') return has('credential_request') || has('verification_prompt') ? 'Payment App Phishing' : 'Payment Scam';
  if (cat === 'social' || cat === 'tech') return 'Account Takeover Phishing';
  if (has('untraceable_payment') && has('fake_reward')) return 'Investment / Crypto Scam';
  if (has('credential_request')) return 'Credential Phishing';
  if (has('financial_request')) return 'Payment Scam';
  return 'Suspicious Message';
}

function fallbackSummary(ctx: AgentContext, level: RiskLevel, scamType: string): string {
  const n = ctx.indicators.filter((i) => i.points > 0).length;
  if (level === 'LOW') return 'Rule-based analysis found no strong scam indicators. Verify any unexpected request through official channels before acting.';
  if (level === 'MEDIUM') return `Rule-based analysis found ${n} caution signal${n === 1 ? '' : 's'} consistent with ${scamType.toLowerCase()}. Verify independently before responding.`;
  return `Rule-based analysis found ${n} risk indicator${n === 1 ? '' : 's'} consistent with ${scamType.toLowerCase()}. Do not click, pay or share details; verify through official channels only.`;
}
