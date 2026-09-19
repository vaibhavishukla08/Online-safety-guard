/**
 * Audit log. Records who did what and when — never message bodies, tokens or
 * secrets. `detail` is a small JSON object of identifiers and counts.
 */
import crypto from 'node:crypto';
import { db, nowIso, parseJson } from '../db';
import type { AuditAction, AuditEntry } from '../../shared/accounts';

const FORBIDDEN_DETAIL_KEYS = /token|secret|password|body|message|access|refresh/i;

export async function audit(action: AuditAction, opts: { userId?: string | null; actorRole?: string | null; detail?: Record<string, unknown>; ip?: string | null } = {}): Promise<void> {
  const detail: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(opts.detail || {})) {
    if (FORBIDDEN_DETAIL_KEYS.test(k)) continue;
    detail[k] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  try {
    await db().run('INSERT INTO audit_logs (id, user_id, actor_role, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), opts.userId || null, opts.actorRole || null, action, JSON.stringify(detail), opts.ip || null, nowIso()]);
  } catch (err) {
    console.warn('[audit] failed to write entry:', err instanceof Error ? err.message : err);
  }
}

export async function listAudit(opts: { limit: number; offset: number; userId?: string; action?: string }): Promise<{ items: AuditEntry[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.userId) {
    where.push('user_id = ?');
    params.push(opts.userId);
  }
  if (opts.action) {
    where.push('action = ?');
    params.push(opts.action);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = await db().get<{ n: number | string }>(`SELECT COUNT(*) AS n FROM audit_logs ${clause}`, params);
  const rows = await db().all<{ id: string; user_id: string | null; actor_role: string | null; action: string; detail: string; ip: string | null; created_at: string }>(`SELECT * FROM audit_logs ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, opts.limit, opts.offset]);
  return {
    total: Number(totalRow?.n || 0),
    items: rows.map((r) => ({ id: r.id, userId: r.user_id, actorRole: r.actor_role, action: r.action, detail: parseJson<Record<string, unknown>>(r.detail, {}), ip: r.ip, createdAt: r.created_at })),
  };
}
