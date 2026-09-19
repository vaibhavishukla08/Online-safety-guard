/**
 * Financial Risk Agent — deterministic assessment of money and credential exposure.
 *
 * Owns the scoring of credential/payment signals so the score breakdown attributes
 * them to the agent that assessed them. No LLM involved: these are the highest-
 * impact indicators and must stay fully explainable.
 */
import { extractAmounts, extractCredentialTypes, extractPaymentMethods } from '../rules/signals';
import { addEvidence, addIndicator, beginStep, type AgentContext } from './context';

const OWNED = new Set(['credential_request', 'financial_request', 'untraceable_payment', 'small_fee', 'personal_data_request', 'verification_prompt']);

export function financialCheckNeeded(ctx: AgentContext): { needed: boolean; reason: string } {
  const ruleHit = ctx.signals.some((s) => OWNED.has(s.id));
  const aiHit = Boolean(ctx.messageAssessment?.requestsCredentials || ctx.messageAssessment?.requestsPayment);
  const visionHit = Boolean(ctx.input.extracted?.paymentRequest || ctx.input.extracted?.credentialRequest);
  if (ruleHit || aiHit || visionHit) return { needed: true, reason: 'payment or credential request detected' };
  return { needed: false, reason: 'no payment or credential request found' };
}

export async function runFinancialAgent(ctx: AgentContext): Promise<void> {
  const finish = beginStep(ctx, 'financial', 'Financial Risk Agent', 'Assessing money and credential exposure…');
  const text = ctx.input.message;
  const owned = ctx.signals.filter((s) => OWNED.has(s.id));

  for (const s of owned) {
    addIndicator(ctx, { id: s.id, label: s.label, points: s.points, evidence: s.evidence, source: 'rule', agent: 'financial' });
    addEvidence(ctx, { id: `ev-${s.id}`, title: s.label, description: `${s.explanation} Detected: "${s.evidence.length > 90 ? s.evidence.slice(0, 89) + '…' : s.evidence}".`, source: 'rule', agent: 'financial', severity: s.points >= 15 ? 'high' : 'medium' });
  }

  const amounts = extractAmounts(text);
  const methods = extractPaymentMethods(text);
  const credentialTypes = extractCredentialTypes(text);
  const paymentRequested = owned.some((s) => s.id === 'financial_request' || s.id === 'untraceable_payment' || s.id === 'small_fee') || Boolean(ctx.messageAssessment?.requestsPayment) || Boolean(ctx.input.extracted?.paymentRequest);
  const credentialRequested = owned.some((s) => s.id === 'credential_request' || s.id === 'personal_data_request' || s.id === 'verification_prompt') || Boolean(ctx.messageAssessment?.requestsCredentials) || Boolean(ctx.input.extracted?.credentialRequest);

  // AI-only detections (no rule fired) get a smaller, clearly-labelled contribution.
  if (credentialRequested && !owned.some((s) => s.id === 'credential_request' || s.id === 'personal_data_request' || s.id === 'verification_prompt')) {
    addIndicator(ctx, { id: 'credential_request_ai', label: 'Credential request (AI-detected)', points: 12, evidence: ctx.input.extracted?.credentialRequest || 'Model identified a request for sensitive details', source: 'ai', agent: 'financial' });
  }
  if (paymentRequested && !owned.some((s) => s.id === 'financial_request' || s.id === 'small_fee' || s.id === 'untraceable_payment')) {
    addIndicator(ctx, { id: 'financial_request_ai', label: 'Payment request (AI-detected)', points: 8, evidence: ctx.input.extracted?.paymentRequest || 'Model identified a request for money', source: 'ai', agent: 'financial' });
  }

  // Reward offered first, payment demanded after: the advance-fee signature.
  if (paymentRequested && ctx.signals.some((s) => s.id === 'fake_reward')) {
    addIndicator(ctx, { id: 'advance_fee_pattern', label: 'Reward offered, fee demanded', points: 10, evidence: 'Attractive offer paired with a payment request', source: 'rule', agent: 'financial' });
    addEvidence(ctx, { id: 'ev-advance_fee_pattern', title: 'Advance-fee pattern', description: 'The message dangles a reward, job or prize and then asks you to pay first. Legitimate employers, lotteries and prizes never require an upfront fee.', source: 'rule', agent: 'financial', severity: 'high' });
  }

  // Combination is worse than the sum: credentials + payment in one message is a classic kit.
  if (paymentRequested && credentialRequested) {
    addIndicator(ctx, { id: 'credential_and_payment', label: 'Asks for both money and credentials', points: 5, evidence: 'Payment and credential requests in the same message', source: 'rule', agent: 'financial' });
  }

  const bits: string[] = [];
  if (credentialRequested) bits.push(`credentials requested${credentialTypes.length ? ` (${credentialTypes.join(', ')})` : ''}`);
  if (paymentRequested) bits.push(`payment requested${amounts.length ? ` (${amounts.slice(0, 2).join(', ')})` : ''}${methods.length ? ` via ${methods.join(', ')}` : ''}`);

  ctx.financial = {
    paymentRequested,
    credentialRequested,
    amounts,
    paymentMethods: methods,
    credentialTypes,
    summary: bits.length ? bits.join('; ') + '.' : 'No direct financial or credential request detected.',
    source: 'rule',
  };

  finish('completed', bits.length ? bits.join(' · ') : 'No direct money or credential exposure', [ctx.financial.summary]);
}
