/**
 * Email analysis for signed-in users — the one code path shared by the Outlook
 * add-in, the web dashboards and the background sync:
 *
 *   NormalizedEmail + body  →  emailToInvestigationRequest (existing mapper)
 *                           →  investigate() (existing orchestrator, agents, Gemini)
 *                           →  stored on the EmailRecord (excerpt only)
 *                           →  notification (per user policy)  →  audit entry
 *
 * It also holds the deterministic pre-filter used by sync to decide which new
 * messages deserve an automatic (AI-backed) analysis.
 */
import { investigate, validateRequest } from '../agents/orchestrator';
import { scanSignals } from '../rules/signals';
import { analyzeUrl } from '../agents/urlAgent';
import { extractUrls } from '../utils/url';
import { emailToInvestigationRequest } from './email';
import { audit } from './audit';
import { findEmail, markAnalyzing, setPrefilterScore, storeAnalysis, storeAnalysisFailure, upsertEmail, type NormalizedEmail } from './emails';
import { maybeNotify } from './notifications';
import { findUserById } from './users';
import type { EmailRecordDetail } from '../../shared/accounts';
import type { EmailAttachmentMeta, InvestigationReport, TraceStep } from '../../shared/investigation';

export interface EmailContent {
  body: string;
  urls?: string[];
  attachments?: Array<{ name: string; size: number | null; contentType: string | null }>;
  recipientCount?: number | null;
  truncated?: boolean;
}

export interface AnalyzeOptions {
  /** Re-run even if an analysis already exists. */
  force?: boolean;
  onTrace?: (step: TraceStep) => void;
  ip?: string | null;
  trigger: 'addin' | 'web' | 'sync';
}

export interface AnalyzeOutcome {
  record: EmailRecordDetail;
  report: InvestigationReport;
  /** True when an existing analysis was returned instead of running a new one. */
  cached: boolean;
  notified: boolean;
}

/**
 * Cheap, deterministic triage on subject + sender + snippet. 0–100. Used only to
 * decide whether an automatic analysis is worth an AI call — never shown as a verdict.
 */
export function prefilterScore(input: { subject: string; senderEmail?: string | null; senderName?: string | null; snippet?: string | null; hasAttachments?: boolean; urls?: string[] }): number {
  const text = `${input.subject || ''}\n${input.snippet || ''}`;
  const sender = [input.senderName, input.senderEmail].filter(Boolean).join(' ');
  const scan = scanSignals(text, sender || null);
  let score = scan.signals.reduce((acc, s) => acc + Math.max(0, s.points), 0);
  const urls = input.urls && input.urls.length ? input.urls : extractUrls(text);
  for (const u of urls.slice(0, 5)) {
    const f = analyzeUrl(u);
    if (!f) continue;
    if (f.suspiciousTld || f.isIpAddress || f.lookalikeOf) score += 20;
    else if (f.isShortener || f.hasCredentialKeywords) score += 8;
    else score += 3;
  }
  if (input.hasAttachments) score += 5;
  // Display-name / address mismatch hints at impersonation (e.g. "PayPal <x@gmail.com>").
  const domain = (input.senderEmail || '').split('@')[1]?.toLowerCase() || '';
  const name = (input.senderName || '').toLowerCase();
  if (domain && name && /(bank|paypal|amazon|microsoft|apple|google|netflix|dhl|fedex|usps|irs|hmrc|sbi|hdfc|icici)/.test(name) && !domain.includes(name.replace(/[^a-z]/g, '').slice(0, 4))) score += 10;
  return Math.min(100, score);
}

/**
 * Analyse an email for a user and persist the result. If a stored analysis
 * already exists and `force` is false, it is returned as-is (no AI call).
 */
export async function analyzeEmailForUser(userId: string, email: NormalizedEmail, content: EmailContent, opts: AnalyzeOptions): Promise<AnalyzeOutcome> {
  const { record: initial } = await upsertEmail(userId, email);
  const existing = await findEmail(userId, initial.id);
  if (existing?.analysis && existing.analysisStatus === 'analyzed' && !opts.force) {
    return { record: existing, report: existing.analysis, cached: true, notified: false };
  }

  const { request } = emailToInvestigationRequest({
    subject: email.subject,
    sender: email.senderName || '',
    senderEmail: email.senderEmail || '',
    body: content.body,
    urls: content.urls || email.urls || [],
    recipientCount: content.recipientCount ?? (email.recipients ? email.recipients.length : null),
    attachments: content.attachments || [],
    truncated: Boolean(content.truncated),
  });

  await markAnalyzing(userId, initial.id);
  let report: InvestigationReport;
  try {
    report = await investigate(validateRequest(request), opts.onTrace);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analysis failed.';
    await storeAnalysisFailure(userId, initial.id, message);
    throw err;
  }

  const stored = await storeAnalysis(userId, initial.id, report);
  const user = await findUserById(userId);
  const notified = await maybeNotify({
    userId,
    policy: user?.notify_policy || 'high_only',
    emailId: initial.id,
    provider: email.provider,
    level: report.verdict.level,
    riskScore: report.verdict.riskScore,
    scamType: report.verdict.scamType,
    sender: email.senderEmail || email.senderName || null,
    subject: email.subject,
  });
  await audit('email_analyzed', { userId, detail: { emailId: initial.id, provider: email.provider, trigger: opts.trigger, level: report.verdict.level, riskScore: report.verdict.riskScore, engine: report.engine, forced: Boolean(opts.force) }, ip: opts.ip });
  if (notified) await audit('notification_generated', { userId, detail: { emailId: initial.id, provider: email.provider, level: report.verdict.level } });
  return { record: stored as EmailRecordDetail, report, cached: false, notified };
}

/** Attachment metadata shape used by providers (never downloads anything). */
export type ProviderAttachment = Pick<EmailAttachmentMeta, 'name' | 'size' | 'contentType'>;

export { setPrefilterScore };
