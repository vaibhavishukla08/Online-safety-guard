/**
 * User accounts. Passwords are scrypt-hashed; the ADMIN role is granted to
 * emails listed in ADMIN_EMAILS (re-evaluated on every sign-in so the env var
 * can promote an existing account).
 */
import crypto from 'node:crypto';
import { db, nowIso } from '../db';
import { getAdminEmails } from '../config';
import { hashPassword, verifyPassword } from '../auth/crypto';
import { InvestigationError } from '../agents/orchestrator';
import type { NotifyPolicy, PublicUser, UserRole, UserStatus } from '../../shared/accounts';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  role: UserRole;
  status: UserStatus;
  notify_policy: NotifyPolicy;
  created_at: string;
  updated_at: string;
  last_active_at: string | null;
}

export const NOTIFY_POLICIES: NotifyPolicy[] = ['high_only', 'suspicious_and_high', 'all', 'off'];

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    notifyPolicy: NOTIFY_POLICIES.includes(row.notify_policy) ? row.notify_policy : 'high_only',
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  };
}

export function normalizeEmail(email: unknown): string {
  if (typeof email !== 'string') throw new InvestigationError(400, 'Email is required.', 'bad_request');
  const e = email.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new InvestigationError(400, 'Please enter a valid email address.', 'bad_request');
  return e;
}

export function validatePassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < 8) throw new InvestigationError(400, 'Password must be at least 8 characters.', 'bad_request');
  if (password.length > 200) throw new InvestigationError(400, 'Password is too long.', 'bad_request');
  return password;
}

export async function findUserById(id: string): Promise<UserRow | undefined> {
  return db().get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
}

export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  return db().get<UserRow>('SELECT * FROM users WHERE email = ?', [email]);
}

export async function createUser(input: { email: string; password: string; name?: string }): Promise<UserRow> {
  const email = normalizeEmail(input.email);
  const password = validatePassword(input.password);
  const name = (typeof input.name === 'string' && input.name.trim() ? input.name.trim() : email.split('@')[0]).slice(0, 80);
  if (await findUserByEmail(email)) throw new InvestigationError(409, 'An account with this email already exists. Sign in instead.', 'conflict');
  const now = nowIso();
  const role: UserRole = getAdminEmails().includes(email) ? 'ADMIN' : 'USER';
  const row: UserRow = { id: crypto.randomUUID(), email, name, password_hash: await hashPassword(password), role, status: 'active', notify_policy: 'high_only', created_at: now, updated_at: now, last_active_at: now };
  await db().run('INSERT INTO users (id, email, name, password_hash, role, status, notify_policy, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [row.id, row.email, row.name, row.password_hash, row.role, row.status, row.notify_policy, now, now, now]);
  return row;
}

/** Verify credentials. Returns the user or null; never reveals which part was wrong. */
export async function authenticate(emailRaw: unknown, password: unknown): Promise<UserRow | null> {
  let email: string;
  try {
    email = normalizeEmail(emailRaw);
  } catch {
    return null;
  }
  if (typeof password !== 'string') return null;
  const user = await findUserByEmail(email);
  const ok = await verifyPassword(password, user?.password_hash);
  if (!user || !ok) return null;
  // Promote if the operator added this email to ADMIN_EMAILS after sign-up.
  if (user.role !== 'ADMIN' && getAdminEmails().includes(email)) {
    await db().run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', ['ADMIN', nowIso(), user.id]);
    user.role = 'ADMIN';
  }
  return user;
}

export async function touchLastActive(userId: string): Promise<void> {
  await db().run('UPDATE users SET last_active_at = ? WHERE id = ?', [nowIso(), userId]);
}

export async function updateNotifyPolicy(userId: string, policy: unknown): Promise<NotifyPolicy> {
  if (!NOTIFY_POLICIES.includes(policy as NotifyPolicy)) throw new InvestigationError(400, 'Unknown notification setting.', 'bad_request');
  await db().run('UPDATE users SET notify_policy = ?, updated_at = ? WHERE id = ?', [policy, nowIso(), userId]);
  return policy as NotifyPolicy;
}

export async function updateUserName(userId: string, name: unknown): Promise<string> {
  if (typeof name !== 'string' || !name.trim()) throw new InvestigationError(400, 'Name cannot be empty.', 'bad_request');
  const clean = name.trim().slice(0, 80);
  await db().run('UPDATE users SET name = ?, updated_at = ? WHERE id = ?', [clean, nowIso(), userId]);
  return clean;
}

export async function setUserStatus(userId: string, status: UserStatus): Promise<void> {
  await db().run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', [status, nowIso(), userId]);
  if (status === 'suspended') {
    await db().run('DELETE FROM sessions WHERE user_id = ?', [userId]);
    await db().run('DELETE FROM addin_tokens WHERE user_id = ?', [userId]);
  }
}

export async function setUserRole(userId: string, role: UserRole): Promise<void> {
  await db().run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', [role, nowIso(), userId]);
}
