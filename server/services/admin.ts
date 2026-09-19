/**
 * Admin analytics — aggregate views only. Subjects/senders appear in the
 * "recent detections" list so an administrator can recognise a campaign, but
 * bodies, excerpts and evidence text are never returned to admin endpoints.
 */
import { db, parseJson } from '../db';
import { getServiceHealth } from './health';
import { rateLimitStats } from '../utils/http';
import { hostnameOf } from '../utils/url';
import type { AdminOverview, AdminUserRow, EmailProviderId, ThreatAnalytics } from '../../shared/accounts';
import type { InvestigationReport, RiskLevel } from '../../shared/investigation';
import { toPublicUser, type UserRow } from './users';

const count = async (sql: string, params: unknown[] = []): Promise<number> => Number((await db().get<{ n: number | string }>(sql, params))?.n || 0);

export async function adminOverview(): Promise<AdminOverview> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  return {
    totalUsers: await count('SELECT COUNT(*) AS n FROM users'),
    activeUsers7d: await count('SELECT COUNT(*) AS n FROM users WHERE last_active_at >= ?', [weekAgo]),
    connectedOutlook: await count("SELECT COUNT(*) AS n FROM provider_connections WHERE provider = 'outlook' AND status = 'active'"),
    connectedGmail: await count("SELECT COUNT(*) AS n FROM provider_connections WHERE provider = 'gmail' AND status = 'active'"),
    emailsStored: await count('SELECT COUNT(*) AS n FROM email_records'),
    emailsAnalyzed: await count("SELECT COUNT(*) AS n FROM email_records WHERE analysis_status = 'analyzed'"),
    highRiskDetections: await count("SELECT COUNT(*) AS n FROM email_records WHERE risk_level IN ('HIGH', 'CRITICAL')"),
    suspiciousDetections: await count("SELECT COUNT(*) AS n FROM email_records WHERE risk_level = 'MEDIUM'"),
    notificationsSent: await count('SELECT COUNT(*) AS n FROM notifications'),
    serviceHealth: await getServiceHealth(rateLimitStats().activeClients),
  };
}

export async function adminUsers(): Promise<AdminUserRow[]> {
  const users = await db().all<UserRow>('SELECT * FROM users ORDER BY created_at DESC LIMIT 500');
  const conns = await db().all<{ user_id: string; provider: EmailProviderId }>("SELECT user_id, provider FROM provider_connections WHERE status = 'active'");
  const analyses = await db().all<{ user_id: string; n: number | string; high: number | string }>("SELECT user_id, COUNT(*) AS n, SUM(CASE WHEN risk_level IN ('HIGH', 'CRITICAL') THEN 1 ELSE 0 END) AS high FROM email_records WHERE analysis_status = 'analyzed' GROUP BY user_id");
  const byUser = new Map(analyses.map((a) => [a.user_id, { n: Number(a.n), high: Number(a.high || 0) }]));
  return users.map((u) => ({
    ...toPublicUser(u),
    providers: conns.filter((c) => c.user_id === u.id).map((c) => c.provider),
    analysisCount: byUser.get(u.id)?.n || 0,
    highRiskCount: byUser.get(u.id)?.high || 0,
  }));
}

export async function threatAnalytics(): Promise<ThreatAnalytics> {
  const rows = await db().all<{ id: string; user_id: string; provider: EmailProviderId; subject: string; sender_email: string | null; risk_score: number; risk_level: RiskLevel; threat_category: string | null; analyzed_at: string; urls: string; analysis_result: string | null }>(
    "SELECT id, user_id, provider, subject, sender_email, risk_score, risk_level, threat_category, analyzed_at, urls, analysis_result FROM email_records WHERE analysis_status = 'analyzed' ORDER BY analyzed_at DESC LIMIT 1000",
  );
  const riskDistribution: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  const categories = new Map<string, number>();
  const signals = new Map<string, number>();
  const domains = new Map<string, { count: number; maxScore: number }>();
  const trendMap = new Map<string, { analyzed: number; threats: number }>();
  for (let i = 13; i >= 0; i--) trendMap.set(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10), { analyzed: 0, threats: 0 });

  let totalThreats = 0;
  for (const r of rows) {
    const level = r.risk_level || 'LOW';
    riskDistribution[level] = (riskDistribution[level] || 0) + 1;
    const threat = level !== 'LOW';
    if (threat) {
      totalThreats += 1;
      const cat = r.threat_category || 'Uncategorised';
      categories.set(cat, (categories.get(cat) || 0) + 1);
      for (const u of parseJson<string[]>(r.urls, [])) {
        const host = hostnameOf(u);
        if (!host) continue;
        const d = domains.get(host) || { count: 0, maxScore: 0 };
        d.count += 1;
        d.maxScore = Math.max(d.maxScore, Number(r.risk_score) || 0);
        domains.set(host, d);
      }
    }
    const report = parseJson<InvestigationReport | null>(r.analysis_result, null);
    for (const ind of report?.indicators || []) {
      if (ind.points > 0) signals.set(ind.label, (signals.get(ind.label) || 0) + 1);
    }
    const day = (r.analyzed_at || '').slice(0, 10);
    const t = trendMap.get(day);
    if (t) {
      t.analyzed += 1;
      if (threat) t.threats += 1;
    }
  }
  const top = <T>(m: Map<string, T>, score: (v: T) => number, n: number) => Array.from(m.entries()).sort((a, b) => score(b[1]) - score(a[1])).slice(0, n);
  return {
    totalAnalyzed: rows.length,
    totalThreats,
    byCategory: top(categories, (v) => v, 8).map(([label, c]) => ({ label, count: c })),
    riskDistribution,
    commonSignals: top(signals, (v) => v, 10).map(([label, c]) => ({ label, count: c })),
    suspiciousDomains: top(domains, (v) => v.count * 1000 + v.maxScore, 10).map(([domain, d]) => ({ domain, count: d.count, maxScore: d.maxScore })),
    recent: rows.filter((r) => r.risk_level !== 'LOW').slice(0, 20).map((r) => ({ id: r.id, userId: r.user_id, provider: r.provider, subject: r.subject.slice(0, 120), senderEmail: r.sender_email, riskScore: Number(r.risk_score), riskLevel: r.risk_level, threatCategory: r.threat_category, analyzedAt: r.analyzed_at })),
    trend: Array.from(trendMap.entries()).map(([day, v]) => ({ day, ...v })),
  };
}
