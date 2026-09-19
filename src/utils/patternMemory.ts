/**
 * Scam Pattern Memory — anonymized, on-device.
 *
 * Only indicator ids, tactic names, categories and counts are stored. Message
 * text, senders, URLs and screenshots are never written here.
 */
import type { DashboardStats, InvestigationReport, PatternRecord } from '../types';

const PATTERN_KEY = 'online_safety_guard_patterns_v1';
const MAX_RECORDS = 200;

export function getPatternRecords(): PatternRecord[] {
  try {
    const raw = localStorage.getItem(PATTERN_KEY);
    return raw ? (JSON.parse(raw) as PatternRecord[]) : [];
  } catch {
    return [];
  }
}

export function toPatternRecord(report: InvestigationReport): PatternRecord {
  return {
    id: report.id,
    timestamp: report.timestamp,
    level: report.verdict.level,
    riskScore: report.verdict.riskScore,
    scamType: report.verdict.scamType,
    inputType: report.input.inputType,
    indicatorIds: report.indicators.filter((i) => i.points > 0).map((i) => i.id),
    tactics: [...(report.socialEngineering?.primaryTactics || []), ...(report.socialEngineering?.secondaryTactics || [])],
    organizationCategory: report.identity?.organizationCategory || null,
    hasUrl: report.urls.length > 0,
    suspiciousUrl: report.urls.some((u) => u.flags.length > 0),
    credentialRequested: Boolean(report.financial?.credentialRequested),
    paymentRequested: Boolean(report.financial?.paymentRequested),
  };
}

export function savePatternRecord(record: PatternRecord): void {
  try {
    const existing = getPatternRecords().filter((r) => r.id !== record.id);
    localStorage.setItem(PATTERN_KEY, JSON.stringify([record, ...existing].slice(0, MAX_RECORDS)));
  } catch (e) {
    console.error('Failed to save pattern record', e);
  }
}

export function clearPatternRecords(): void {
  try {
    localStorage.removeItem(PATTERN_KEY);
  } catch {
    /* ignore */
  }
}

/** Human labels for indicator ids used in pattern descriptions. */
const INDICATOR_LABELS: Record<string, string> = {
  urgency: 'urgency',
  threat: 'threats',
  credential_request: 'credential request',
  credential_request_ai: 'credential request',
  verification_prompt: 'verify-via-link',
  financial_request: 'payment request',
  financial_request_ai: 'payment request',
  small_fee: 'small fee',
  untraceable_payment: 'untraceable payment',
  fake_reward: 'fake reward',
  authority: 'authority claim',
  suspicious_url: 'suspicious link',
  lookalike_domain: 'look-alike domain',
  url_shortener: 'shortened link',
  external_link: 'external link',
  brand_mismatch: 'impersonation',
  sender_anomaly: 'sender anomaly',
  external_contact: 'channel shift',
  intel_new_domain: 'new domain',
  intel_malicious: 'known-bad domain',
  conversation_escalation: 'escalation',
  advance_fee_pattern: 'advance fee',
  ai_manipulation: 'manipulation',
};

/** Indicators worth grouping into recurring patterns (coarse buckets). */
const PATTERN_BUCKETS: Array<{ id: string; label: string; match: (ids: string[]) => boolean }> = [
  { id: 'urgency', label: 'Urgency', match: (ids) => ids.includes('urgency') || ids.includes('threat') },
  { id: 'impersonation', label: 'Impersonation', match: (ids) => ids.includes('brand_mismatch') || ids.includes('lookalike_domain') || ids.includes('authority') },
  { id: 'small_payment', label: 'Small payment request', match: (ids) => ids.includes('small_fee') },
  { id: 'payment', label: 'Payment request', match: (ids) => ids.includes('financial_request') || ids.includes('financial_request_ai') || ids.includes('untraceable_payment') },
  { id: 'credential', label: 'Credential request', match: (ids) => ids.includes('credential_request') || ids.includes('credential_request_ai') || ids.includes('verification_prompt') },
  { id: 'link', label: 'External link', match: (ids) => ids.includes('suspicious_url') || ids.includes('external_link') || ids.includes('url_shortener') || ids.includes('ip_url') },
  { id: 'reward', label: 'Fake reward', match: (ids) => ids.includes('fake_reward') || ids.includes('advance_fee_pattern') },
];

export interface PatternMatch {
  label: string;
  count: number;
  bucketIds: string[];
}

/**
 * Find recurring combinations across recent risky scans. A "pattern" is a set of
 * two or more buckets that co-occur in at least two scans.
 */
export function findRecurringPatterns(records: PatternRecord[], minCount = 2): PatternMatch[] {
  const risky = records.filter((r) => r.level !== 'LOW');
  const combos = new Map<string, { count: number; labels: string[]; ids: string[] }>();
  for (const r of risky) {
    const buckets = PATTERN_BUCKETS.filter((b) => b.match(r.indicatorIds));
    if (buckets.length < 2) continue;
    // Count every pair and the full combination.
    const sets: Array<typeof buckets> = [buckets];
    for (let i = 0; i < buckets.length; i++) for (let j = i + 1; j < buckets.length; j++) sets.push([buckets[i], buckets[j]]);
    const seenInRecord = new Set<string>();
    for (const set of sets) {
      const key = set.map((b) => b.id).sort().join('+');
      if (seenInRecord.has(key)) continue; // full combo == pair when a scan has exactly two buckets
      seenInRecord.add(key);
      const hit = combos.get(key) || { count: 0, labels: set.map((b) => b.label), ids: set.map((b) => b.id) };
      hit.count += 1;
      combos.set(key, hit);
    }
  }
  return Array.from(combos.values())
    .filter((c) => c.count >= minCount)
    .sort((a, b) => b.ids.length * b.count - a.ids.length * a.count || b.count - a.count)
    .slice(0, 5)
    .map((c) => ({ label: c.labels.join(' + '), count: c.count, bucketIds: c.ids }));
}

/** Which earlier scans share the same coarse pattern as this report? */
export function matchAgainstMemory(report: InvestigationReport, records: PatternRecord[]): { similar: number; sharedLabel: string | null } {
  const ids = report.indicators.filter((i) => i.points > 0).map((i) => i.id);
  const mine = PATTERN_BUCKETS.filter((b) => b.match(ids));
  if (mine.length < 2) return { similar: 0, sharedLabel: null };
  let similar = 0;
  for (const r of records) {
    if (r.id === report.id || r.level === 'LOW') continue;
    const theirs = PATTERN_BUCKETS.filter((b) => b.match(r.indicatorIds)).map((b) => b.id);
    const overlap = mine.filter((b) => theirs.includes(b.id));
    if (overlap.length >= 2) similar += 1;
  }
  return { similar, sharedLabel: similar ? mine.map((b) => b.label).join(' + ') : null };
}

export function describeIndicator(id: string): string {
  return INDICATOR_LABELS[id] || id.replace(/_/g, ' ');
}

export function computeDashboardStats(records: PatternRecord[]): DashboardStats {
  const countBy = (arr: string[]) => {
    const m = new Map<string, number>();
    for (const a of arr) m.set(a, (m.get(a) || 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  };
  const scamTypes = countBy(records.filter((r) => r.level !== 'LOW').map((r) => r.scamType));
  const tactics = countBy(records.flatMap((r) => r.tactics));
  const phishing = records.filter((r) => /phish|smishing|credential|account takeover/i.test(r.scamType) || (r.credentialRequested && r.hasUrl)).length;
  return {
    messagesAnalyzed: records.length,
    highRisk: records.filter((r) => r.level === 'HIGH' || r.level === 'CRITICAL').length,
    suspiciousUrls: records.filter((r) => r.suspiciousUrl).length,
    phishingAttempts: phishing,
    credentialAttacks: records.filter((r) => r.credentialRequested).length,
    financialScams: records.filter((r) => r.paymentRequested && r.level !== 'LOW').length,
    mostCommonScamType: scamTypes[0]?.[0] || null,
    mostCommonTactic: tactics[0]?.[0] || null,
    recurringPatterns: findRecurringPatterns(records).map((p) => ({ label: p.label, count: p.count, indicatorIds: p.bucketIds })),
  };
}
