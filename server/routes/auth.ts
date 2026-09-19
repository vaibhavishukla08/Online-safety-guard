/**
 * Authentication + account routes.
 *
 *   POST /api/auth/register            {email, password, name?}
 *   POST /api/auth/login               {email, password}
 *   POST /api/auth/logout
 *   GET  /api/auth/me                  → {user} | 401
 *   PATCH /api/auth/me                 {name?, notifyPolicy?}
 *   POST /api/auth/link-code           → one-time code for the Outlook add-in (session only)
 *   POST /api/auth/link-code/redeem    {code, label?} → {token, user}  (no auth; rate limited)
 *   GET  /api/auth/addin-tokens        → linked add-ins
 *   DELETE /api/auth/addin-tokens/:id  → revoke
 */
import { Router } from 'express';
import { handleError } from './errors';
import { authRateLimited, clearSessionCookie, clientIp, requireAuth, setSessionCookie } from '../auth/middleware';
import { createLinkCode, createSession, destroySession, listAddinTokens, redeemLinkCode, revokeAddinToken } from '../auth/sessions';
import { authenticate, createUser, findUserById, toPublicUser, updateNotifyPolicy, updateUserName } from '../services/users';
import { audit } from '../services/audit';
import { InvestigationError } from '../agents/orchestrator';

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  if (authRateLimited(req, res)) return;
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const user = await createUser({ email: body.email as string, password: body.password as string, name: typeof body.name === 'string' ? body.name : undefined });
    const session = await createSession(user.id, { ip: clientIp(req), userAgent: req.headers['user-agent'] });
    setSessionCookie(res, session.token, session.expiresAt);
    await audit('user_registered', { userId: user.id, actorRole: user.role, ip: clientIp(req) });
    await audit('login', { userId: user.id, actorRole: user.role, detail: { method: 'password' }, ip: clientIp(req) });
    res.status(201).json({ user: toPublicUser(user) });
  } catch (error) {
    handleError(error, res);
  }
});

authRouter.post('/login', async (req, res) => {
  if (authRateLimited(req, res)) return;
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const user = await authenticate(body.email, body.password);
    if (!user) {
      await audit('login_failed', { detail: { email: typeof body.email === 'string' ? body.email.slice(0, 120).toLowerCase() : 'invalid' }, ip: clientIp(req) });
      res.status(401).json({ error: 'Incorrect email or password.', code: 'invalid_credentials' });
      return;
    }
    if (user.status !== 'active') {
      res.status(403).json({ error: 'This account has been suspended. Contact an administrator.', code: 'suspended' });
      return;
    }
    const session = await createSession(user.id, { ip: clientIp(req), userAgent: req.headers['user-agent'] });
    setSessionCookie(res, session.token, session.expiresAt);
    await audit('login', { userId: user.id, actorRole: user.role, detail: { method: 'password' }, ip: clientIp(req) });
    res.json({ user: toPublicUser(user) });
  } catch (error) {
    handleError(error, res);
  }
});

authRouter.post('/logout', async (req, res) => {
  try {
    if (req.auth?.sessionToken) await destroySession(req.auth.sessionToken);
    if (req.auth) await audit('logout', { userId: req.auth.user.id, actorRole: req.auth.user.role, ip: clientIp(req) });
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (error) {
    handleError(error, res);
  }
});

authRouter.get('/me', (req, res) => {
  if (!req.auth) {
    res.status(401).json({ error: 'Not signed in.', code: 'unauthenticated' });
    return;
  }
  res.json({ user: toPublicUser(req.auth.user), via: req.auth.via });
});

authRouter.patch('/me', requireAuth, async (req, res) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const userId = req.auth!.user.id;
    const changed: string[] = [];
    if (body.name !== undefined) {
      await updateUserName(userId, body.name);
      changed.push('name');
    }
    if (body.notifyPolicy !== undefined) {
      await updateNotifyPolicy(userId, body.notifyPolicy);
      changed.push('notifyPolicy');
    }
    if (changed.length) await audit('settings_changed', { userId, actorRole: req.auth!.user.role, detail: { fields: changed.join(','), notifyPolicy: typeof body.notifyPolicy === 'string' ? body.notifyPolicy : undefined }, ip: clientIp(req) });
    const user = await findUserById(userId);
    res.json({ user: toPublicUser(user!) });
  } catch (error) {
    handleError(error, res);
  }
});

// ---------------------------------------------------------------------------
// Outlook add-in linking
// ---------------------------------------------------------------------------

authRouter.post('/link-code', requireAuth, async (req, res) => {
  try {
    if (req.auth!.via !== 'session') throw new InvestigationError(403, 'Link codes can only be generated from the signed-in web app.', 'forbidden');
    const code = await createLinkCode(req.auth!.user.id);
    res.json(code);
  } catch (error) {
    handleError(error, res);
  }
});

authRouter.post('/link-code/redeem', async (req, res) => {
  if (authRateLimited(req, res)) return;
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : 'Outlook add-in';
    const result = await redeemLinkCode(body.code, label);
    if (!result) {
      res.status(400).json({ error: 'That link code is invalid or has expired. Generate a new one in Settings → Outlook add-in.', code: 'invalid_code' });
      return;
    }
    await audit('addin_linked', { userId: result.user.id, actorRole: result.user.role, detail: { label }, ip: clientIp(req) });
    res.json({ token: result.token, expiresAt: result.expiresAt, user: toPublicUser(result.user) });
  } catch (error) {
    handleError(error, res);
  }
});

authRouter.get('/addin-tokens', requireAuth, async (req, res) => {
  try {
    res.json({ tokens: await listAddinTokens(req.auth!.user.id) });
  } catch (error) {
    handleError(error, res);
  }
});

authRouter.delete('/addin-tokens/:id', requireAuth, async (req, res) => {
  try {
    const ok = await revokeAddinToken(req.auth!.user.id, String(req.params.id));
    if (!ok) throw new InvestigationError(404, 'Add-in link not found.', 'not_found');
    await audit('addin_token_revoked', { userId: req.auth!.user.id, actorRole: req.auth!.user.role, ip: clientIp(req) });
    res.json({ ok: true });
  } catch (error) {
    handleError(error, res);
  }
});
