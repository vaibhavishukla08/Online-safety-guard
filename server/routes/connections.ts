/**
 * Mailbox connection routes (Outlook via Microsoft Graph, Gmail via Gmail API).
 *
 *   GET  /api/connections                      → status of both providers
 *   GET  /api/connections/:provider/start      → 302 to the vendor consent screen (signed-in web session only)
 *   GET  /api/connections/:provider/callback   → vendor redirect target; stores tokens; 302 back to the dashboard
 *   POST /api/connections/:provider/sync       → fetch newest messages + policy-driven auto analysis
 *   DELETE /api/connections/:provider          → disconnect (tokens removed; optional ?history=1 also deletes stored emails)
 */
import { Router } from 'express';
import { handleError } from './errors';
import { clientIp, requireAuth } from '../auth/middleware';
import { beginOAuth, completeOAuth, connectionStatus, disconnect } from '../services/connections';
import { deleteEmailHistory } from '../services/emails';
import { syncConnection } from '../services/sync';
import { audit } from '../services/audit';
import { InvestigationError } from '../agents/orchestrator';
import { EMAIL_PROVIDERS, type EmailProviderId } from '../../shared/accounts';

export const connectionsRouter = Router();

function providerParam(raw: string): EmailProviderId {
  if (!EMAIL_PROVIDERS.includes(raw as EmailProviderId)) throw new InvestigationError(404, 'Unknown mail provider.', 'not_found');
  return raw as EmailProviderId;
}

connectionsRouter.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.auth!.user.id;
    res.json({ connections: await Promise.all(EMAIL_PROVIDERS.map((p) => connectionStatus(userId, p))) });
  } catch (error) {
    handleError(error, res);
  }
});

connectionsRouter.get('/:provider/start', async (req, res) => {
  try {
    if (!req.auth || req.auth.via !== 'session') {
      res.redirect(`/login?next=${encodeURIComponent(`/dashboard/${req.params.provider}`)}`);
      return;
    }
    const provider = providerParam(String(req.params.provider));
    res.redirect(await beginOAuth(req.auth.user.id, provider));
  } catch (error) {
    handleError(error, res);
  }
});

connectionsRouter.get('/:provider/callback', async (req, res) => {
  const providerRaw = String(req.params.provider);
  const back = (params: Record<string, string>) => res.redirect(`/dashboard/${providerRaw}?${new URLSearchParams(params).toString()}`);
  try {
    const provider = providerParam(providerRaw);
    if (typeof req.query.error === 'string') {
      const description = typeof req.query.error_description === 'string' ? req.query.error_description.split('\n')[0].slice(0, 160) : '';
      back({ error: `Connection cancelled or refused (${req.query.error}${description ? `: ${description}` : ''}).` });
      return;
    }
    if (!req.auth || req.auth.via !== 'session') {
      back({ error: 'Your web session ended during sign-in. Please sign in and connect again.' });
      return;
    }
    const conn = await completeOAuth(req.auth.user.id, provider, req.query.code, req.query.state);
    await audit(provider === 'outlook' ? 'outlook_connected' : 'gmail_connected', { userId: req.auth.user.id, actorRole: req.auth.user.role, detail: { accountEmail: conn.account_email }, ip: clientIp(req) });
    back({ connected: '1' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed.';
    back({ error: message.slice(0, 200) });
  }
});

connectionsRouter.post('/:provider/sync', requireAuth, async (req, res) => {
  try {
    const provider = providerParam(String(req.params.provider));
    const result = await syncConnection(req.auth!.user.id, provider, 'manual', clientIp(req));
    res.json({ result, status: await connectionStatus(req.auth!.user.id, provider) });
  } catch (error) {
    handleError(error, res);
  }
});

connectionsRouter.delete('/:provider', requireAuth, async (req, res) => {
  try {
    const provider = providerParam(String(req.params.provider));
    const userId = req.auth!.user.id;
    const removed = await disconnect(userId, provider);
    let deletedHistory = 0;
    if (req.query.history === '1') deletedHistory = await deleteEmailHistory(userId, provider);
    if (removed) await audit(provider === 'outlook' ? 'outlook_disconnected' : 'gmail_disconnected', { userId, actorRole: req.auth!.user.role, detail: { deletedHistory }, ip: clientIp(req) });
    res.json({ ok: true, removed, deletedHistory, status: await connectionStatus(userId, provider) });
  } catch (error) {
    handleError(error, res);
  }
});
