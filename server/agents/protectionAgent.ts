/**
 * Protection / Incident Response Agent — turns findings into a structured,
 * personalized protection plan.
 *
 * A deterministic base plan is always built from the evidence (so the user gets
 * specific guidance even offline). Gemini then tailors wording to the situation;
 * if it fails, the base plan is returned unchanged and labelled "rule".
 */
import { Type } from '@google/genai';
import { generateJson } from '../gemini/client';
import { beginStep, noteAiFailure, type AgentContext } from './context';
import type { ProtectionPlan, RiskLevel, Verdict } from '../../shared/investigation';

export interface ProtectionOutcome {
  plan: ProtectionPlan;
  recommendedResponse: string;
}

/** Detect an Indian context so reporting guidance points at the right helplines. */
export function isIndianContext(text: string, orgCategoryDomains: string[] = []): boolean {
  return /₹|\brs\.?\s?\d|\binr\b|\bupi\b|paytm|phonepe|aadhaar|\bkyc\b|\bsbi\b|hdfc|icici|\+91|\.in\b/i.test(text) || orgCategoryDomains.some((d) => d.endsWith('.in'));
}

export function buildBasePlan(ctx: AgentContext, verdict: Verdict): ProtectionPlan {
  const level = verdict.level;
  const fin = ctx.financial;
  const ident = ctx.identity;
  const hasUrl = ctx.urls.length > 0;
  const india = isIndianContext(ctx.input.message, ident?.officialDomains || []);
  const org = ident?.claimedOrganization;
  const severe = level === 'HIGH' || level === 'CRITICAL';

  const immediateActions: string[] = [];
  const whatNotToDo: string[] = [];
  const accountProtection: string[] = [];
  const paymentProtection: string[] = [];
  const reporting: string[] = [];
  const evidencePreservation: string[] = [];

  if (severe) {
    immediateActions.push('Stop. Do not reply, click or pay — treat this message as hostile until proven otherwise.');
    if (org) immediateActions.push(`Open the official ${org} app or type its website address yourself to check whether the claim is real.`);
    else immediateActions.push('Contact the organization through a phone number or website you already know — never one from the message.');
    immediateActions.push('Block the sender and delete the message after saving a screenshot.');
  } else if (level === 'MEDIUM') {
    immediateActions.push('Pause before acting; verify the request through the official app or website first.');
    if (org) immediateActions.push(`Confirm with ${org} using a contact method you already trust.`);
    immediateActions.push('Do not use links or numbers in the message to verify it.');
  } else {
    immediateActions.push('No urgent action needed. Continue to verify unexpected requests through official channels.');
    immediateActions.push('If anything about the message feels off later, re-check it here or contact the organization directly.');
  }

  if (hasUrl) whatNotToDo.push('Do not open the link — even "just to look" can trigger downloads or credential capture.');
  if (fin?.credentialRequested) whatNotToDo.push('Never type an OTP, password, PIN or card number into anything that arrived unexpectedly.');
  if (fin?.paymentRequested) whatNotToDo.push('Do not pay any fee to "release", "verify" or "activate" anything — legitimate organizations do not work this way.');
  whatNotToDo.push('Do not reply, even to say "stop" — replies confirm your number is live.');
  if (ctx.indicators.some((i) => i.id === 'external_contact')) whatNotToDo.push('Do not move the conversation to Telegram or WhatsApp as requested.');

  if (fin?.credentialRequested || severe) {
    accountProtection.push(org ? `If you have a ${org} account, review recent activity and sign-in history from inside the official app.` : 'Review recent activity on any account the message refers to.');
    accountProtection.push('Turn on two-factor authentication using an authenticator app where available.');
    accountProtection.push('If you reuse the same password elsewhere, change it on those services too.');
  } else {
    accountProtection.push('No account action needed unless you interacted with the message.');
  }

  if (fin?.paymentRequested || fin?.paymentMethods.length) {
    paymentProtection.push(india ? 'If any payment was made, call your bank or the 1930 cyber-fraud helpline immediately to attempt a freeze.' : 'If any payment was made, call your bank or card issuer immediately to attempt a reversal or chargeback.');
    if (fin.paymentMethods.includes('UPI')) paymentProtection.push('Review your UPI apps for pending "collect" requests and decline any you did not initiate.');
    if (fin.paymentMethods.includes('Gift card') || fin.paymentMethods.includes('Cryptocurrency') || fin.paymentMethods.includes('Wire transfer')) paymentProtection.push('Gift-card, crypto and wire payments are usually unrecoverable — report anyway so patterns can be tracked.');
    paymentProtection.push('Set a low daily transfer limit and enable transaction alerts.');
  } else {
    paymentProtection.push('No payment exposure detected. Keep transaction alerts enabled as a precaution.');
  }

  if (india) {
    reporting.push('Report at cybercrime.gov.in or call the national helpline 1930 (financial fraud).');
    reporting.push('Forward scam SMS to 1909 (TRAI DND) and report the number via the Sanchar Saathi "Chakshu" portal.');
  } else {
    reporting.push('Forward scam texts to 7726 (SPAM) so your carrier can block the number.');
    reporting.push('Report at ReportFraud.ftc.gov (US), IC3.gov (US cyber-crime) or Action Fraud (UK) as applicable.');
  }
  if (org) reporting.push(`Report the impersonation to ${org}'s official fraud/abuse channel so they can warn other customers.`);
  if (ctx.input.platform && /whatsapp|instagram|telegram|linkedin/i.test(ctx.input.platform)) reporting.push(`Use the in-app "Report" option on ${ctx.input.platform} to flag the account.`);

  evidencePreservation.push('Keep a screenshot of the full message including sender ID, date and time.');
  if (hasUrl) evidencePreservation.push(`Copy the exact link text (${ctx.urls[0].hostname}) without opening it.`);
  if (fin?.paymentRequested) evidencePreservation.push('Save any transaction IDs, UPI references, or receipts if money was sent.');
  evidencePreservation.push('Note the phone number, email or handle the message came from.');

  const officialVerificationStep = org
    ? `Open the official ${org} app or type ${ident?.officialDomains[0] ? ident.officialDomains[0] : 'its website address'} manually in your browser, then check for the same alert there.`
    : 'Open the organization’s official app or type its website address yourself; never use links or numbers from the message.';

  return { immediateActions, whatNotToDo, accountProtection, paymentProtection, reporting, evidencePreservation, officialVerificationStep, source: 'rule' };
}

export function buildRecommendedResponse(ctx: AgentContext, level: RiskLevel): string {
  if (ctx.conversation?.recommendedResponse) return ctx.conversation.recommendedResponse;
  if (level === 'LOW') return 'No defensive action required. If the message asks you to do something, confirm it through the official app or website first.';
  if (level === 'MEDIUM') return 'Do not respond yet. Verify the claim through official channels; if it cannot be confirmed, block and report the sender.';
  return 'Do not reply. Block the sender, report the message, and verify any account claim directly in the official app.';
}

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    immediateActions: { type: Type.ARRAY, items: { type: Type.STRING } },
    whatNotToDo: { type: Type.ARRAY, items: { type: Type.STRING } },
    accountProtection: { type: Type.ARRAY, items: { type: Type.STRING } },
    paymentProtection: { type: Type.ARRAY, items: { type: Type.STRING } },
    reporting: { type: Type.ARRAY, items: { type: Type.STRING } },
    evidencePreservation: { type: Type.ARRAY, items: { type: Type.STRING } },
    officialVerificationStep: { type: Type.STRING },
    recommendedResponse: { type: Type.STRING, description: 'What to do or say next, 1–2 sentences.' },
  },
  required: ['immediateActions', 'whatNotToDo', 'accountProtection', 'paymentProtection', 'reporting', 'evidencePreservation', 'officialVerificationStep', 'recommendedResponse'],
};

export async function runProtectionAgent(ctx: AgentContext, verdict: Verdict): Promise<ProtectionOutcome> {
  const finish = beginStep(ctx, 'protection', 'Protection Agent', 'Generating a personalized protection plan…');
  const base = buildBasePlan(ctx, verdict);
  const baseResponse = buildRecommendedResponse(ctx, verdict.level);

  // Skip the LLM for clearly benign content — the base plan already says "no action needed".
  if (verdict.level === 'LOW' && verdict.riskScore < 15) {
    finish('completed', 'Low risk — standard verification guidance', base.immediateActions.slice(0, 2));
    return { plan: base, recommendedResponse: baseResponse };
  }

  const result = await generateJson<ProtectionPlan & { recommendedResponse: string }>({
    systemInstruction: 'You are the Protection Agent of a cyber-safety system. Produce specific, safe, practical guidance for an ordinary user. Never tell the user to visit the suspicious link, call numbers from the message, or "test" anything. Keep each item to one sentence. Preserve the reporting channels given in the draft (they are region-appropriate).',
    prompt: `Situation:
- Risk: ${verdict.level} (${verdict.riskScore}/100), type: ${verdict.scamType}
- Claimed organization: ${ctx.identity?.claimedOrganization || 'none'} (${ctx.identity?.mismatch ? 'domain mismatch' : 'no mismatch established'})
- Financial: ${ctx.financial?.summary || 'n/a'}
- Links: ${ctx.urls.map((u) => u.hostname).join(', ') || 'none'}
- Tactics: ${ctx.socialEngineering?.primaryTactics.join(', ') || 'n/a'}
- Platform: ${ctx.input.platform || 'unknown'}
- Message excerpt: """${ctx.input.message.slice(0, 600)}"""

Draft plan (tailor and sharpen it; keep 2–4 items per section; keep reporting channels):
${JSON.stringify({ ...base, recommendedResponse: baseResponse }, null, 0)}`,
    schema: SCHEMA,
    temperature: 0.3,
  });

  if (result.ok) {
    ctx.aiCallsSucceeded += 1;
    const d = result.data;
    const list = (v: unknown, fallback: string[]) => (Array.isArray(v) && v.length ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 5) : fallback);
    const plan: ProtectionPlan = {
      immediateActions: list(d.immediateActions, base.immediateActions),
      whatNotToDo: list(d.whatNotToDo, base.whatNotToDo),
      accountProtection: list(d.accountProtection, base.accountProtection),
      paymentProtection: list(d.paymentProtection, base.paymentProtection),
      reporting: list(d.reporting, base.reporting),
      evidencePreservation: list(d.evidencePreservation, base.evidencePreservation),
      officialVerificationStep: typeof d.officialVerificationStep === 'string' && d.officialVerificationStep.trim() ? d.officialVerificationStep : base.officialVerificationStep,
      source: 'ai',
    };
    finish('completed', `Personalized plan: ${plan.immediateActions.length} immediate actions, ${plan.reporting.length} reporting channels`, plan.immediateActions.slice(0, 3));
    return { plan, recommendedResponse: typeof d.recommendedResponse === 'string' && d.recommendedResponse.trim() ? d.recommendedResponse : baseResponse };
  }

  noteAiFailure(ctx, result.code);
  finish('completed', `Rule-based plan (AI personalization unavailable): ${base.immediateActions.length} immediate actions`, base.immediateActions.slice(0, 3));
  return { plan: base, recommendedResponse: baseResponse };
}
