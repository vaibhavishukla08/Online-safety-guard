/**
 * Express authentication middleware.
 *
 *   attachUser  – resolves the current user from the session cookie or an
 *                 add-in bearer token (never throws; leaves req.auth undefined)
 *   requireAuth – 401 unless signed in (and account active)
 *   requireAdmin – 403 unless role === 'ADMIN'
 */
import type { NextFunction, Request, Response } from 'express';
import { AUTH, IS_PRODUCTION, RATE_LIMIT, getAppBaseUrl } from '../config';
import { findAddinToken, findSession } from './sessions';
import { findUserById, touchLastActive, type UserRow } from '../services/users';
import { isDbOpen } from '../db';

export interface AuthContext {
  user: UserRow;
  via: 'session' | 'addin';
  sessionToken?: string;
  addinTokenId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function cookieSecure(): boolean {
  return IS_PRODUCTION || getAppBaseUrl().startsWith('https://');
}

export function setSessionCookie(res: Response, token: string, expiresAt: string): void {
  const parts = [`${AUTH.cookieName}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${new Date(expiresAt).toUTCString()}`];
  if (cookieSecure()) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response): void {
  const parts = [`${AUTH.cookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (cookieSecure()) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0])?.trim() || req.ip || 'unknown';
}

const lastActiveStamp = new Map<string, number>();

export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!isDbOpen()) return next();
  try {
    let ctx: AuthContext | undefined;
    const authz = req.headers.authorization;
    if (authz && /^Bearer\s+/i.test(authz)) {
      const token = authz.replace(/^Bearer\s+/i, '').trim();
      const found = await findAddinToken(token);
      if (found) {
        const user = await findUserById(found.userId);
        if (user && user.status === 'active') ctx = { user, via: 'addin', addinTokenId: found.id };
      }
    }
    if (!ctx) {
      const token = parseCookies(req.headers.cookie)[AUTH.cookieName];
      if (token) {
        const session = await findSession(token);
        if (session) {
          const user = await findUserById(session.userId);
          if (user && user.status === 'active') ctx = { user, via: 'session', sessionToken: token };
        }
      }
    }
    if (ctx) {
      req.auth = ctx;
      const last = lastActiveStamp.get(ctx.user.id) || 0;
      if (Date.now() - last > 5 * 60_000) {
        lastActiveStamp.set(ctx.user.id, Date.now());
        touchLastActive(ctx.user.id).catch(() => undefined);
      }
    }
  } catch (err) {
    console.warn('[auth] could not resolve user:', err instanceof Error ? err.message : err);
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'Please sign in to continue.', code: 'unauthenticated' });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'Please sign in to continue.', code: 'unauthenticated' });
    return;
  }
  if (req.auth.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Administrator access is required.', code: 'forbidden' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Auth attempt limiter (per IP, fixed window) — protects login / register / link.
// ---------------------------------------------------------------------------
const attempts = new Map<string, { count: number; resetAt: number }>();

export function authRateLimited(req: Request, res: Response): boolean {
  const key = clientIp(req);
  const now = Date.now();
  const bucket = attempts.get(key);
  if (!bucket || now > bucket.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + RATE_LIMIT.authWindowMs });
    return false;
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT.authMaxAttempts) {
    const retry = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retry));
    res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(retry / 60)} minute${retry > 60 ? 's' : ''}.`, code: 'rate_limited' });
    return true;
  }
  return false;
}
