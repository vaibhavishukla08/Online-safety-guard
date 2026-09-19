/**
 * Message Analysis Agent
 *
 * 1. Deterministic pass: runs every signal detector and records message-level
 *    indicators (urgency, threats, rewards, authority, ...). Credential/payment
 *    signals are stored on the context for the Financial Risk Agent to score.
 * 2. AI pass (Gemini): natural-language understanding — scam type, claimed
 *    organization, legitimacy/scam confidence, highlight phrases.
 *
 * The AI pass enriches; it never replaces the deterministic evidence.
 */
import { Type } from '@google/genai';
import { generateJson } from '../gemini/client';
import { scanSignals } from '../rules/signals';
import { addEvidence, addIndicator, beginStep, noteAiFailure, type AgentContext, type MessageAssessment } from './context';
import type { HighlightPhrase } from '../../shared/investigation';

/** Signals the Financial Risk Agent owns (scored there, not here). */
const FINANCIAL_SIGNAL_IDS = new Set(['credential_request', 'financial_request', 'untraceable_payment', 'small_fee', 'personal_data_request', 'verification_prompt']);

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    scamType: { type: Type.STRING, description: "Category, e.g. 'Bank Phishing', 'Advance-Fee Job Scam', 'Delivery Fee Smishing', 'UPI Payment Scam', 'Government Impersonation', 'Account Takeover Phishing', 'Investment / Crypto Scam', 'Romance Scam', 'Tech Support Scam', or 'Legitimate Notification'." },
    summary: { type: Type.STRING, description: 'Two plain-language sentences explaining what this message is trying to make the recipient do and why that is or is not concerning.' },
    scamConfidence: { type: Type.NUMBER, description: '0 to 1 — confidence this is a scam or malicious.' },
    legitimacyConfidence: { type: Type.NUMBER, description: '0 to 1 — confidence this is a genuine, benign message.' },
    claimedOrganization: { type: Type.STRING, description: 'Organization/brand/authority the sender claims to represent, or empty string.' },
    requestsCredentials: { type: Type.BOOLEAN, description: 'Does it ask for OTP, password, PIN, card or identity details?' },
    requestsPayment: { type: Type.BOOLEAN, description: 'Does it ask for money, a fee, a deposit or a transfer?' },
    highlightPhrases: {
      type: Type.ARRAY,
      description: 'Up to 6 exact excerpts from the message worth highlighting.',
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING, description: 'Exact substring of the message.' },
          category: { type: Type.STRING, description: "'danger', 'warning' or 'suspicious_link'." },
          explanation: { type: Type.STRING, description: 'One concise sentence on why it matters.' },
        },
        required: ['text', 'category', 'explanation'],
      },
    },
    senderNotes: { type: Type.STRING, description: 'One sentence assessing the sender identifier (or "Sender not provided").' },
  },
  required: ['scamType', 'summary', 'scamConfidence', 'legitimacyConfidence', 'claimedOrganization', 'requestsCredentials', 'requestsPayment', 'highlightPhrases', 'senderNotes'],
};

export async function runMessageAgent(ctx: AgentContext): Promise<void> {
  const finish = beginStep(ctx, 'message', 'Message Agent', 'Reading the message for pressure, requests and claims…');
  const { message, sender, platform } = ctx.input;

  // --- Deterministic pass -------------------------------------------------
  const scan = scanSignals(message, sender);
  ctx.signals = scan.signals;
  ctx.highlights.push(...scan.highlights);

  const details: string[] = [];
  for (const signal of scan.signals) {
    if (FINANCIAL_SIGNAL_IDS.has(signal.id)) continue;
    addIndicator(ctx, { id: signal.id, label: signal.label, points: signal.points, evidence: signal.evidence, source: 'rule', agent: 'message' });
    addEvidence(ctx, {
      id: `ev-${signal.id}`,
      title: signal.label,
      description: `${signal.explanation} Detected: "${truncate(signal.evidence, 90)}".`,
      source: 'rule',
      agent: 'message',
      severity: signal.points >= 15 ? 'high' : signal.points > 0 ? 'medium' : 'low',
    });
    details.push(`${signal.label}: "${truncate(signal.evidence, 60)}"`);
  }

  // --- AI pass ------------------------------------------------------------
  const result = await generateJson<MessageAssessment & { claimedOrganization: string }>({
    systemInstruction:
      'You are the Message Analysis Agent of "Online Safety Guard", a cyber-safety investigation system. Analyse messages objectively. Genuine security notices (e.g. an OTP that says "never share this code" with no link) are legitimate. Never fabricate quotes: highlight phrases must be exact substrings.',
    prompt: `Analyse this ${platform || 'message'}.

Sender: ${sender || 'Not provided'}
Message:
"""
${message}
"""

Return the structured assessment described by the schema.`,
    schema: SCHEMA,
    temperature: 0.2,
  });

  if (result.ok) {
    ctx.aiCallsSucceeded += 1;
    ctx.model = result.model;
    const d = result.data;
    const highlights: HighlightPhrase[] = (Array.isArray(d.highlightPhrases) ? d.highlightPhrases : [])
      .filter((h) => h && typeof h.text === 'string' && h.text.trim() && message.toLowerCase().includes(h.text.toLowerCase()))
      .map((h) => ({ text: h.text, category: (['danger', 'warning', 'suspicious_link'].includes(h.category) ? h.category : 'warning') as HighlightPhrase['category'], explanation: String(h.explanation || '') }))
      .slice(0, 6);

    ctx.messageAssessment = {
      scamType: String(d.scamType || 'Unclassified'),
      summary: String(d.summary || ''),
      scamConfidence: clamp01(Number(d.scamConfidence)),
      legitimacyConfidence: clamp01(Number(d.legitimacyConfidence)),
      claimedOrganization: typeof d.claimedOrganization === 'string' && d.claimedOrganization.trim() ? d.claimedOrganization.trim() : null,
      requestsCredentials: Boolean(d.requestsCredentials),
      requestsPayment: Boolean(d.requestsPayment),
      highlightPhrases: highlights,
      senderNotes: String(d.senderNotes || ''),
    };
    // Merge AI highlights that the rules did not already cover.
    for (const h of highlights) {
      if (!ctx.highlights.some((x) => x.text.toLowerCase() === h.text.toLowerCase())) ctx.highlights.push(h);
    }
    const summaryBits = [`${scan.signals.length} rule-based signal${scan.signals.length === 1 ? '' : 's'}`, `AI classification: ${ctx.messageAssessment.scamType}`];
    if (ctx.messageAssessment.claimedOrganization) summaryBits.push(`claims to be ${ctx.messageAssessment.claimedOrganization}`);
    finish('completed', summaryBits.join(' · '), details);
  } else {
    noteAiFailure(ctx, result.code);
    finish('completed', `${scan.signals.length} rule-based signal${scan.signals.length === 1 ? '' : 's'} detected · AI understanding unavailable (${result.code.replace('_', ' ')})`, details);
  }
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
