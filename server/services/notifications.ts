/**
 * In-app security notifications. One notification per (user, email) — the
 * UNIQUE constraint makes re-analysis and repeated syncs idempotent, so users
 * are never spammed. Whether a notification is created at all depends on the
 * user's notify_policy.
 */
import crypto from 'node:crypto';
import { db, nowIso } from '../db';
import type { EmailProviderId, NotificationItem, NotificationStatus, NotifyPolicy } from '../../shared/accounts';
import type { RiskLevel } from '../../shared/investigation';

interface NotificationRow {
  id: string;
  user_id: string;
  email_id: string;
  level: RiskLevel;
  risk_score: number;
  title: string;
  body: string;
  sender: string | null;
  provider: EmailProviderId;
  status: NotificationStatus;
  created_at: string;
  read_at: string | null;
}

function toItem(r: NotificationRow): NotificationItem {
  return { id: r.id, emailId: r.email_id, provider: r.provider, level: r.level, riskScore: Number(r.risk_score), title: r.title, body: r.body, sender: r.sender, status: r.status, createdAt: r.created_at, readAt: r.read_at };
}

/** Does this verdict qualify for a notification under the user's policy? */
export function policyAllows(policy: NotifyPolicy, level: RiskLevel, riskScore: number): boolean {
  switch (policy) {
    case 'off':
      return false;
    case 'high_only':
      return level === 'HIGH' || level === 'CRITICAL';
    case 'suspicious_and_high':
      return level === 'MEDIUM' || level === 'HIGH' || level === 'CRITICAL';
    case 'all':
      return level !== 'LOW' || riskScore >= 15;
    default:
      return false;
  }
}

export function notificationTitle(level: RiskLevel): string {
  if (level === 'CRITICAL') return 'Critical: scam email detected';
  if (level === 'HIGH') return 'Suspicious email detected';
  if (level === 'MEDIUM') return 'Email needs a closer look';
  return 'Low-risk email analysed';
}

/**
 * Create the notification if the policy allows and none exists for this email.
 * Returns true only when a new notification was inserted.
 */
export async function maybeNotify(input: { userId: string; policy: NotifyPolicy; emailId: string; provider: EmailProviderId; level: RiskLevel; riskScore: number; scamType: string; sender: string | null; subject: string }): Promise<boolean> {
  if (!policyAllows(input.policy, input.level, input.riskScore)) return false;
  const existing = await db().get<{ id: string }>('SELECT id FROM notifications WHERE user_id = ? AND email_id = ?', [input.userId, input.emailId]);
  if (existing) return false;
  const subject = input.subject ? `"${input.subject.slice(0, 80)}"` : '(no subject)';
  const body = `${input.scamType} — ${subject}. Risk ${input.level} (${input.riskScore}/100).`;
  await db().run('INSERT INTO notifications (id, user_id, email_id, level, risk_score, title, body, sender, provider, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, email_id) DO NOTHING', [crypto.randomUUID(), input.userId, input.emailId, input.level, input.riskScore, notificationTitle(input.level), body, input.sender, input.provider, 'unread', nowIso()]);
  return true;
}

export async function listNotifications(userId: string, opts: { status?: 'unread' | 'active' | 'all'; limit?: number }): Promise<{ items: NotificationItem[]; unread: number }> {
  const limit = Math.min(100, Math.max(1, opts.limit || 30));
  let clause = 'user_id = ?';
  if (opts.status === 'unread') clause += " AND status = 'unread'";
  else if (opts.status !== 'all') clause += " AND status <> 'dismissed'";
  const rows = await db().all<NotificationRow>(`SELECT * FROM notifications WHERE ${clause} ORDER BY created_at DESC LIMIT ?`, [userId, limit]);
  const unreadRow = await db().get<{ n: number | string }>("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND status = 'unread'", [userId]);
  return { items: rows.map(toItem), unread: Number(unreadRow?.n || 0) };
}

export async function setNotificationStatus(userId: string, id: string, status: NotificationStatus): Promise<boolean> {
  const row = await db().get<{ id: string }>('SELECT id FROM notifications WHERE id = ? AND user_id = ?', [id, userId]);
  if (!row) return false;
  await db().run('UPDATE notifications SET status = ?, read_at = COALESCE(read_at, ?) WHERE id = ?', [status, status === 'unread' ? null : nowIso(), id]);
  return true;
}

export async function markAllRead(userId: string): Promise<void> {
  await db().run("UPDATE notifications SET status = 'read', read_at = COALESCE(read_at, ?) WHERE user_id = ? AND status = 'unread'", [nowIso(), userId]);
}

export async function countNotifications(userId: string): Promise<number> {
  const row = await db().get<{ n: number | string }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', [userId]);
  return Number(row?.n || 0);
}
