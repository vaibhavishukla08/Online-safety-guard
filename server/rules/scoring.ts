/**
 * Transparent risk scoring.
 *
 * The final score is a capped sum of named indicators. Every indicator carries its
 * own evidence and source so the UI can show "+20 Suspicious URL" style breakdowns.
 * Gemini may contribute a bounded calibration indicator, but it cannot dominate.
 */
import type { RiskIndicator, RiskLevel, ScamDna, EvidenceSource } from '../../shared/investigation';

/** Upper bound on how much the LLM's holistic judgement can move the score. */
export const AI_CALIBRATION_MAX = 15;
export const AI_LEGITIMACY_MAX = 20;

export function levelForScore(score: number): RiskLevel {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  return 'LOW';
}

export function clampScore(raw: number): number {
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function sumIndicators(indicators: RiskIndicator[]): number {
  return clampScore(indicators.reduce((acc, i) => acc + i.points, 0));
}

/**
 * Confidence reflects how many *independent* evidence sources agree with the verdict,
 * not how loud any one of them is.
 */
export function computeConfidence(indicators: RiskIndicator[], score: number): {
  confidence: 'low' | 'medium' | 'high';
  note: string;
} {
  const positive = indicators.filter((i) => i.points > 0);
  const sources = new Set<EvidenceSource>(positive.map((i) => i.source));
  const ruleCount = positive.filter((i) => i.source === 'rule').length;

  if (score < 25) {
    if (sources.size === 0) return { confidence: 'medium', note: 'No risk indicators were detected; still verify unexpected requests independently.' };
    return { confidence: 'medium', note: 'Only weak indicators were found. Treat with normal caution.' };
  }
  if (sources.size >= 3 || (sources.size >= 2 && ruleCount >= 3)) {
    return { confidence: 'high', note: `${sources.size} independent evidence sources agree (${Array.from(sources).map(sourceLabel).join(', ')}).` };
  }
  if (sources.size === 2 || ruleCount >= 3) {
    return { confidence: 'medium', note: `Evidence from ${Array.from(sources).map(sourceLabel).join(' and ')}; some checks were unavailable or inconclusive.` };
  }
  return { confidence: 'low', note: 'Verdict rests on a single evidence source. Verify before acting on it.' };
}

function sourceLabel(s: EvidenceSource): string {
  return s === 'rule' ? 'deterministic rules' : s === 'ai' ? 'AI analysis' : 'external intelligence';
}

/**
 * Build the Scam DNA profile (0–10 per dimension) from detected indicators.
 * Each dimension maps to specific indicator ids so the visual is evidence-backed.
 */
export function buildScamDna(indicators: RiskIndicator[]): ScamDna {
  const has = (id: string) => indicators.some((i) => i.id === id && i.points > 0);
  const pts = (id: string) => indicators.find((i) => i.id === id)?.points ?? 0;
  const scale = (value: number, max: number) => Math.max(0, Math.min(10, Math.round((value / max) * 10)));

  return {
    urgency: scale(pts('urgency') + pts('threat') * 0.5, 20),
    impersonation: scale(pts('brand_mismatch') + pts('brand_token_in_host') + pts('sender_anomaly') + (has('authority') ? 5 : 0), 30),
    credentialTheft: scale(pts('credential_request') + pts('credential_request_ai') + pts('personal_data_request') + pts('credential_url') + pts('verification_prompt'), 35),
    paymentRequest: scale(pts('financial_request') + pts('financial_request_ai') + pts('untraceable_payment') + pts('small_fee') + pts('advance_fee_pattern'), 30),
    linkDeception: scale(pts('suspicious_url') + pts('url_shortener') + pts('ip_url') + pts('lookalike_domain') + pts('external_link') + pts('intel_malicious') + pts('intel_new_domain'), 40),
    emotionalManipulation: scale(pts('threat') + pts('trust_building') + pts('secrecy') + pts('curiosity') + pts('ai_manipulation'), 30),
    fakeReward: scale(pts('fake_reward') + pts('advance_fee_pattern'), 20),
    authority: scale(pts('authority') + (has('brand_mismatch') && indicators.some((i) => i.id === 'brand_mismatch' && /government|bank/i.test(i.evidence)) ? 5 : 0), 15),
  };
}
