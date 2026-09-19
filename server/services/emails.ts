/**
 * Email records — the common, provider-independent model shared by the Outlook
 * add-in, the Outlook (Graph) and Gmail (API) sync providers and the web app.
 *
 * Uniqueness is (user, provider, providerMessageId). For Outlook the provider
 * message id is the RFC 5322 Internet-Message-ID (available both to Office.js
 * in the add-in and to Microsoft Graph), so an email analysed from the add-in
 * and later synced from Graph is the same record. Gmail uses its stable
 * message id. Bodies are never stored — only a short excerpt inside the
 * analysis result.
 */
import crypto from 'node:crypto';
import { db, nowIso, parseJson } from '../db';
import { LIMITS } from '../config';
import { InvestigationError } from '../agents/orchestrator';
import type { AnalysisStatus, EmailListQuery, EmailListResult, EmailProviderId, EmailRecord, EmailRecordDetail } from '../../shared/accounts';
import type { EngineMode, InvestigationReport, RiskLevel } from '../../shared/investigation';

/** What a provider (or the add-in) knows about a message before analysis. */
export interface NormalizedEmail {
  provider: EmailProviderId;
  providerMessageId: string;
  providerItemId?: string | null;
  internetMessageId?: string | null;
  threadId?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  recipients?: string[];
  subject: string;
  snippet?: string | null;
  receivedAt?: string | null;
  isRead?: boolean | null;
  hasAttachments?: boolean;
  urls?: string[];
  webLink?: string | null;
  source: 'addin' | 'sync' | 'manual';
}

interface EmailRow {
  id: string;
  user_id: string;
  provider: EmailProviderId;
  provider_message_id: string;
  provider_item_id: string | null;
  internet_message_id: string | null;
  thread_id: string | null;
  sender_name: string | null;
  sender_email: string | null;
  recipients: string | null;
  subject: string;
  snippet: string | null;
  received_at: string | null;
  is_read: number | null;
  has_attachments: number;
  urls: string;
  web_link: string | null;
  prefilter_score: number | null;
  risk_score: number | null;
  risk_level: RiskLevel | null;
  threat_category: string | null;
  analysis_status: AnalysisStatus;
  analysis_engine: EngineMode | null;
  analysis_error: string | null;
  analysis_result: string | null;
  analyzed_at: string | null;
  source: EmailRecord['source'];
  created_at: string;
  updated_at: string;
}

const SUMMARY_COLUMNS = 'id, user_id, provider, provider_message_id, provider_item_id, internet_message_id, thread_id, sender_name, sender_email, recipients, subject, snippet, received_at, is_read, has_attachments, urls, web_link, prefilter_score, risk_score, risk_level, threat_category, analysis_status, analysis_engine, analysis_error, analyzed_at, source, created_at, updated_at';

function toRecord(r: EmailRow): EmailRecord {
  return {
    id: r.id,
    provider: r.provider,
    providerMessageId: r.provider_message_id,
    providerItemId: r.provider_item_id,
    internetMessageId: r.internet_message_id,
    threadId: r.thread_id,
    senderName: r.sender_name,
    senderEmail: r.sender_email,
    recipients: parseJson<string[]>(r.recipients, []),
    subject: r.subject,
    snippet: r.snippet,
    receivedAt: r.received_at,
    isRead: r.is_read === null || r.is_read === undefined ? null : Number(r.is_read) === 1,
    hasAttachments: Number(r.has_attachments) === 1,
    urls: parseJson<string[]>(r.urls, []),
    webLink: r.web_link,
    prefilterScore: r.prefilter_score === null ? null : Number(r.prefilter_score),
    riskScore: r.risk_score === null ? null : Number(r.risk_score),
    riskLevel: r.risk_level,
    threatCategory: r.threat_category,
    analysisStatus: r.analysis_status,
    analysisEngine: r.analysis_engine,
    analysisError: r.analysis_error,
    analyzedAt: r.analyzed_at,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Normalise an Internet-Message-ID: strip angle brackets / whitespace, lower-case. */
export function normalizeMessageId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().replace(/^<|>$/g, '').trim().toLowerCase();
  return v && v.length <= 500 ? v : null;
}

/**
 * Insert or refresh a record's metadata. Existing analysis results are kept.
 * Returns the record and whether it was newly created.
 */
export async function upsertEmail(userId: string, email: NormalizedEmail): Promise<{ record: EmailRecord; created: boolean }> {
  const providerMessageId = email.providerMessageId.trim();
  if (!providerMessageId) throw new InvestigationError(400, 'providerMessageId is required.', 'bad_request');
  const existing = await db().get<EmailRow>(`SELECT ${SUMMARY_COLUMNS} FROM email_records WHERE user_id = ? AND provider = ? AND provider_message_id = ?`, [userId, email.provider, providerMessageId]);
  const now = nowIso();
  const subject = (email.subject || '').slice(0, 500);
  const snippet = email.snippet ? email.snippet.slice(0, 300) : null;
  const recipients = JSON.stringify((email.recipients || []).slice(0, 50).map((r) => r.slice(0, 200)));
  const urls = JSON.stringify((email.urls || []).slice(0, 10).map((u) => u.slice(0, LIMITS.urlChars)));
  if (existing) {
    await db().run(
      `UPDATE email_records SET provider_item_id = COALESCE(?, provider_item_id), internet_message_id = COALESCE(?, internet_message_id), thread_id = COALESCE(?, thread_id),
         sender_name = COALESCE(?, sender_name), sender_email = COALESCE(?, sender_email), recipients = CASE WHEN ? = '[]' THEN recipients ELSE ? END,
         subject = CASE WHEN ? = '' THEN subject ELSE ? END, snippet = COALESCE(?, snippet), received_at = COALESCE(?, received_at), is_read = COALESCE(?, is_read),
         has_attachments = CASE WHEN ? = 1 THEN 1 ELSE has_attachments END, urls = CASE WHEN ? = '[]' THEN urls ELSE ? END, web_link = COALESCE(?, web_link), updated_at = ?
       WHERE id = ?`,
      [email.providerItemId || null, normalizeMessageId(email.internetMessageId), email.threadId || null, email.senderName || null, email.senderEmail || null, recipients, recipients, subject, subject, snippet, email.receivedAt || null, email.isRead === null || email.isRead === undefined ? null : email.isRead ? 1 : 0, email.hasAttachments ? 1 : 0, urls, urls, email.webLink || null, now, existing.id],
    );
    const refreshed = await db().get<EmailRow>(`SELECT ${SUMMARY_COLUMNS} FROM email_records WHERE id = ?`, [existing.id]);
    return { record: toRecord(refreshed || existing), created: false };
  }
  const id = crypto.randomUUID();
  await db().run(
    `INSERT INTO email_records (id, user_id, provider, provider_message_id, provider_item_id, internet_message_id, thread_id, sender_name, sender_email, recipients, subject, snippet, received_at, is_read, has_attachments, urls, web_link, analysis_status, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_analyzed', ?, ?, ?)`,
    [id, userId, email.provider, providerMessageId, email.providerItemId || null, normalizeMessageId(email.internetMessageId), email.threadId || null, email.senderName || null, email.senderEmail || null, recipients, subject, snippet, email.receivedAt || null, email.isRead === null || email.isRead === undefined ? null : email.isRead ? 1 : 0, email.hasAttachments ? 1 : 0, urls, email.webLink || null, email.source, now, now],
  );
  const row = await db().get<EmailRow>(`SELECT ${SUMMARY_COLUMNS} FROM email_records WHERE id = ?`, [id]);
  return { record: toRecord(row as EmailRow), created: true };
}

export async function findEmail(userId: string, id: string): Promise<EmailRecordDetail | null> {
  const row = await db().get<EmailRow>('SELECT * FROM email_records WHERE id = ? AND user_id = ?', [id, userId]);
  if (!row) return null;
  return { ...toRecord(row), analysis: parseJson<InvestigationReport | null>(row.analysis_result, null) };
}

export async function findEmailByProviderId(userId: string, provider: EmailProviderId, providerMessageId: string): Promise<EmailRecordDetail | null> {
  const row = await db().get<EmailRow>('SELECT * FROM email_records WHERE user_id = ? AND provider = ? AND provider_message_id = ?', [userId, provider, providerMessageId.trim()]);
  if (!row) return null;
  return { ...toRecord(row), analysis: parseJson<InvestigationReport | null>(row.analysis_result, null) };
}

/** Reduce the report for storage: keep everything except the full message body (excerpt only). */
export function reportForStorage(report: InvestigationReport): InvestigationReport {
  const excerpt = (report.input.message || '').slice(0, LIMITS.storedExcerptChars);
  return { ...report, input: { ...report.input, message: excerpt, extracted: null } };
}

export async function markAnalyzing(userId: string, id: string): Promise<void> {
  await db().run("UPDATE email_records SET analysis_status = 'analyzing', analysis_error = NULL, updated_at = ? WHERE id = ? AND user_id = ?", [nowIso(), id, userId]);
}

export async function storeAnalysis(userId: string, id: string, report: InvestigationReport): Promise<EmailRecordDetail | null> {
  const now = nowIso();
  const stored = reportForStorage(report);
  await db().run(
    "UPDATE email_records SET risk_score = ?, risk_level = ?, threat_category = ?, analysis_status = 'analyzed', analysis_engine = ?, analysis_error = NULL, analysis_result = ?, analyzed_at = ?, urls = CASE WHEN ? = '[]' THEN urls ELSE ? END, updated_at = ? WHERE id = ? AND user_id = ?",
    [report.verdict.riskScore, report.verdict.level, report.verdict.scamType, report.engine, JSON.stringify(stored), now, JSON.stringify(report.input.urls), JSON.stringify(report.input.urls), now, id, userId],
  );
  return findEmail(userId, id);
}

export async function storeAnalysisFailure(userId: string, id: string, message: string): Promise<void> {
  await db().run("UPDATE email_records SET analysis_status = CASE WHEN analysis_result IS NULL THEN 'failed' ELSE 'analyzed' END, analysis_error = ?, updated_at = ? WHERE id = ? AND user_id = ?", [message.slice(0, 300), nowIso(), id, userId]);
}

export async function setPrefilterScore(userId: string, id: string, score: number): Promise<void> {
  await db().run('UPDATE email_records SET prefilter_score = ? WHERE id = ? AND user_id = ?', [score, id, userId]);
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function listEmails(userId: string, q: EmailListQuery): Promise<EmailListResult> {
  const where: string[] = ['user_id = ?'];
  const params: unknown[] = [userId];
  if (q.provider && q.provider !== 'all') {
    where.push('provider = ?');
    params.push(q.provider);
  }
  switch (q.filter) {
    case 'safe':
    case 'low':
      where.push("analysis_status = 'analyzed' AND risk_level = 'LOW'");
      break;
    case 'medium':
      where.push("analysis_status = 'analyzed' AND risk_level = 'MEDIUM'");
      break;
    case 'high':
      where.push("analysis_status = 'analyzed' AND risk_level = 'HIGH'");
      break;
    case 'critical':
      where.push("analysis_status = 'analyzed' AND risk_level = 'CRITICAL'");
      break;
    case 'analyzed':
      where.push("analysis_status = 'analyzed'");
      break;
    case 'not_analyzed':
      where.push("analysis_status <> 'analyzed'");
      break;
    default:
      break;
  }
  const search = (q.search || '').trim().toLowerCase().slice(0, 100);
  if (search) {
    const like = `%${escapeLike(search)}%`;
    where.push("(LOWER(subject) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(sender_email, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(sender_name, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(threat_category, '')) LIKE ? ESCAPE '\\')");
    params.push(like, like, like, like);
  }
  const pageSize = Math.min(100, Math.max(5, Number(q.pageSize) || 20));
  const page = Math.max(1, Number(q.page) || 1);
  const clause = `WHERE ${where.join(' AND ')}`;
  const totalRow = await db().get<{ n: number | string }>(`SELECT COUNT(*) AS n FROM email_records ${clause}`, params);
  const total = Number(totalRow?.n || 0);
  const order = q.sort === 'risk' ? 'ORDER BY risk_score DESC, received_at DESC' : 'ORDER BY received_at DESC, created_at DESC';
  const rows = await db().all<EmailRow>(`SELECT ${SUMMARY_COLUMNS} FROM email_records ${clause} ${order} LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
  return { items: rows.map(toRecord), total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Records that have never been analysed, newest first — candidates for automatic analysis after a sync. */
export async function listUnanalyzed(userId: string, provider: EmailProviderId, limit: number): Promise<EmailRecord[]> {
  const rows = await db().all<EmailRow>(`SELECT ${SUMMARY_COLUMNS} FROM email_records WHERE user_id = ? AND provider = ? AND analysis_status = 'not_analyzed' ORDER BY received_at DESC LIMIT ?`, [userId, provider, limit]);
  return rows.map(toRecord);
}

export async function countEmails(userId: string, provider: EmailProviderId): Promise<{ total: number; analyzed: number }> {
  const t = await db().get<{ n: number | string }>('SELECT COUNT(*) AS n FROM email_records WHERE user_id = ? AND provider = ?', [userId, provider]);
  const a = await db().get<{ n: number | string }>("SELECT COUNT(*) AS n FROM email_records WHERE user_id = ? AND provider = ? AND analysis_status = 'analyzed'", [userId, provider]);
  return { total: Number(t?.n || 0), analyzed: Number(a?.n || 0) };
}

export async function deleteEmailHistory(userId: string, provider?: EmailProviderId): Promise<number> {
  const params: unknown[] = [userId];
  let clause = 'user_id = ?';
  if (provider) {
    clause += ' AND provider = ?';
    params.push(provider);
  }
  const row = await db().get<{ n: number | string }>(`SELECT COUNT(*) AS n FROM email_records WHERE ${clause}`, params);
  await db().run(`DELETE FROM notifications WHERE user_id = ? AND email_id IN (SELECT id FROM email_records WHERE ${clause})`, [userId, ...params]);
  await db().run(`DELETE FROM email_records WHERE ${clause}`, params);
  return Number(row?.n || 0);
}

export async function deleteEmail(userId: string, id: string): Promise<boolean> {
  const row = await db().get<{ id: string }>('SELECT id FROM email_records WHERE id = ? AND user_id = ?', [id, userId]);
  if (!row) return false;
  await db().run('DELETE FROM notifications WHERE email_id = ? AND user_id = ?', [id, userId]);
  await db().run('DELETE FROM email_records WHERE id = ?', [id]);
  return true;
}
