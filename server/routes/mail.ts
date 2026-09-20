/**
 * Mail history + on-demand analysis (signed-in users, own records only).
 *
 *   GET    /api/mail/messages?provider=&search=&filter=&page=&pageSize=&sort=
 *   GET    /api/mail/messages/:id                → record + stored investigation
 *   POST   /api/mail/messages/:id/analyze        {force?} → JSON result
 *   POST   /api/mail/messages/:id/analyze/stream {force?} → NDJSON trace + result
 *   DELETE /api/mail/messages/:id
 *   DELETE /api/mail/history?provider=outlook|gmail (omit for all)
 */
import { Router, type Request, type Response } from 'express';
import { handleError, describeError } from './errors';
import { clientIp, requireAuth } from '../auth/middleware';
import { deleteEmail, deleteEmailHistory, findEmail, listEmails } from '../services/emails';
import { getAccessToken, getProvider } from '../services/connections';
import { analyzeEmailForUser, type AnalyzeOutcome } from '../services/emailAnalysis';
import { audit } from '../services/audit';
import { InvestigationError } from '../agents/orchestrator';
import { EMAIL_PROVIDERS, type EmailListQuery, type EmailProviderId, type EmailRecordDetail } from '../../shared/accounts';
import type { InvestigationStreamEvent, TraceStep } from '../../shared/investigation';

export const mailRouter = Router();
mailRouter.use(requireAuth);

function parseQuery(q: Request['query']): EmailListQuery {
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const provider = str(q.provider);
  const filter = str(q.filter);
  const sort = str(q.sort);
  return {
    provider: provider && (provider === 'all' || EMAIL_PROVIDERS.includes(provider as EmailProviderId)) ? (provider as EmailListQuery['provider']) : 'all',
    search: str(q.search),
    filter: filter && ['all', 'safe', 'low', 'medium', 'high', 'critical', 'analyzed', 'not_analyzed'].includes(filter) ? (filter as EmailListQuery['filter']) : 'all',
    page: Number(str(q.page)) || 1,
    pageSize: Number(str(q.pageSize)) || 20,
    sort: sort === 'risk' ? 'risk' : 'received',
  };
}

mailRouter.get('/messages', async (req, res) => {
  try {
    res.json(await listEmails(req.auth!.user.id, parseQuery(req.query)));
  } catch (error) {
    handleError(error, res);
  }
});

mailRouter.get('/messages/:id', async (req, res) => {
  try {
    const record = await findEmail(req.auth!.user.id, String(req.params.id));
    if (!record) throw new InvestigationError(404, 'Email not found.', 'not_found');
    res.json({ record });
  } catch (error) {
    handleError(error, res);
  }
});

/** Fetch the body from the provider and run (or re-run) the analysis for a stored record. */
async function analyzeStored(req: Request, record: EmailRecordDetail, onTrace?: (step: TraceStep) => void): Promise<AnalyzeOutcome> {
  const userId = req.auth!.user.id;
  const force = Boolean((req.body || {}).force);
  if (record.analysis && record.analysisStatus === 'analyzed' && !force) return { record, report: record.analysis, cached: true, notified: false, saved: true, saveError: null };
  const provider = getProvider(record.provider);
  let access;
  try {
    access = await getAccessToken(userId, record.provider);
  } catch (err) {
    if (err instanceof InvestigationError && err.code === 'not_connected') {
      throw new InvestigationError(409, record.provider === 'outlook' ? 'This email was saved from the Outlook add-in. Connect Outlook on this website (or re-run the analysis inside Outlook) to analyse it again.' : 'Connect Gmail to analyse this email.', 'not_connected');
    }
    throw err;
  }
  const content = await provider.fetchContent(access.token, record.providerItemId || record.providerMessageId);
  return analyzeEmailForUser(userId, { provider: record.provider, providerMessageId: record.providerMessageId, providerItemId: record.providerItemId, internetMessageId: record.internetMessageId, threadId: record.threadId, senderName: record.senderName, senderEmail: record.senderEmail, recipients: record.recipients, subject: record.subject, snippet: record.snippet, receivedAt: record.receivedAt, isRead: record.isRead, hasAttachments: record.hasAttachments || (content.attachments?.length || 0) > 0, urls: content.urls, webLink: record.webLink, source: 'manual' }, content, { force, trigger: 'web', ip: clientIp(req), onTrace });
}

mailRouter.post('/messages/:id/analyze', async (req, res) => {
  try {
    const record = await findEmail(req.auth!.user.id, String(req.params.id));
    if (!record) throw new InvestigationError(404, 'Email not found.', 'not_found');
    const outcome = await analyzeStored(req, record);
    res.json({ record: outcome.record ?? record, report: outcome.report, cached: outcome.cached, notified: outcome.notified, saved: outcome.saved, saveError: outcome.saveError });
  } catch (error) {
    handleError(error, res);
  }
});

mailRouter.post('/messages/:id/analyze/stream', async (req, res: Response) => {
  let record: EmailRecordDetail | null;
  try {
    record = await findEmail(req.auth!.user.id, String(req.params.id));
    if (!record) throw new InvestigationError(404, 'Email not found.', 'not_found');
  } catch (error) {
    handleError(error, res);
    return;
  }
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (event: InvestigationStreamEvent & { meta?: Record<string, unknown> }) => {
    if (!res.writableEnded) res.write(JSON.stringify(event) + '\n');
  };
  try {
    const outcome = await analyzeStored(req, record, (step) => send({ type: 'trace', step }));
    send({ type: 'result', report: outcome.report, meta: { recordId: outcome.record?.id ?? record.id, cached: outcome.cached, notified: outcome.notified, saved: outcome.saved, ...(outcome.saved ? {} : { reason: 'save_failed' }) } });
  } catch (error) {
    const { message, code } = describeError(error);
    send({ type: 'error', message, code });
  } finally {
    res.end();
  }
});

mailRouter.delete('/messages/:id', async (req, res) => {
  try {
    const ok = await deleteEmail(req.auth!.user.id, String(req.params.id));
    if (!ok) throw new InvestigationError(404, 'Email not found.', 'not_found');
    res.json({ ok: true });
  } catch (error) {
    handleError(error, res);
  }
});

mailRouter.delete('/history', async (req, res) => {
  try {
    const provider = typeof req.query.provider === 'string' && EMAIL_PROVIDERS.includes(req.query.provider as EmailProviderId) ? (req.query.provider as EmailProviderId) : undefined;
    const deleted = await deleteEmailHistory(req.auth!.user.id, provider);
    await audit('history_deleted', { userId: req.auth!.user.id, actorRole: req.auth!.user.role, detail: { provider: provider || 'all', deleted }, ip: clientIp(req) });
    res.json({ ok: true, deleted });
  } catch (error) {
    handleError(error, res);
  }
});
