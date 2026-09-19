/**
 * New agentic API surface.
 *
 *   GET  /api/health                    – capability report (which AI / intel sources are configured)
 *   POST /api/investigate               – full investigation, JSON response
 *   POST /api/investigate/stream        – same, but NDJSON stream of trace events then the result
 *   POST /api/analyze-email             – Outlook add-in channel: email envelope → same orchestrator (JSON)
 *   POST /api/analyze-email/stream      – same, streamed as NDJSON
 *   POST /api/incident-response         – "I already interacted" plan
 *   POST /api/coach/scenario            – adaptive coaching scenario
 *   POST /api/dashboard/summary         – AI summary of anonymized stats
 */
import { Router, type Request, type Response } from 'express';
import { GEMINI_MODEL, getIntelKeys, hasGeminiKey } from '../config';
import { checkRateLimit } from '../utils/http';
import { investigate, InvestigationError, validateRequest } from '../agents/orchestrator';
import { generateIncidentPlan, INTERACTION_ACTIONS } from '../services/incidentResponse';
import { generateScenario } from '../services/coach';
import { generateDashboardSummary } from '../services/dashboard';
import { emailToInvestigationRequest } from '../services/email';
import type { CoachProgress, DashboardStats, IncidentContext, InteractionAction, InvestigationStreamEvent } from '../../shared/investigation';

export const apiRouter = Router();

function clientId(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0]) || req.ip || 'unknown';
}

function rateLimited(req: Request, res: Response): boolean {
  const { allowed, retryAfterSec } = checkRateLimit(clientId(req));
  if (!allowed) {
    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({ error: `Too many requests. Try again in ${retryAfterSec}s.`, code: 'rate_limited' });
    return true;
  }
  return false;
}

apiRouter.get('/health', (_req, res) => {
  const keys = getIntelKeys();
  res.json({
    status: 'ok',
    hasGeminiKey: hasGeminiKey(),
    model: GEMINI_MODEL,
    intel: {
      rdap: true,
      dns: true,
      virusTotal: Boolean(keys.virusTotal),
      safeBrowsing: Boolean(keys.safeBrowsing),
      urlScan: Boolean(keys.urlScan),
      abuseIpDb: Boolean(keys.abuseIpDb),
    },
    time: new Date().toISOString(),
  });
});

apiRouter.post('/investigate', async (req, res) => {
  if (rateLimited(req, res)) return;
  try {
    const request = validateRequest(req.body);
    const report = await investigate(request);
    res.json(report);
  } catch (error) {
    handleError(error, res);
  }
});

apiRouter.post('/investigate/stream', async (req, res) => {
  if (rateLimited(req, res)) return;
  let request;
  try {
    request = validateRequest(req.body);
  } catch (error) {
    handleError(error, res);
    return;
  }

  await streamInvestigation(request, res);
});

// ---------------------------------------------------------------------------
// Outlook add-in channel. The email is mapped to the existing investigation
// request and handed to the same Safety Orchestrator — no separate detector.
// ---------------------------------------------------------------------------
apiRouter.post('/analyze-email', async (req, res) => {
  if (rateLimited(req, res)) return;
  try {
    const { request } = emailToInvestigationRequest(req.body);
    const report = await investigate(validateRequest(request));
    res.json(report);
  } catch (error) {
    handleError(error, res);
  }
});

apiRouter.post('/analyze-email/stream', async (req, res) => {
  if (rateLimited(req, res)) return;
  let request;
  try {
    request = validateRequest(emailToInvestigationRequest(req.body).request);
  } catch (error) {
    handleError(error, res);
    return;
  }
  await streamInvestigation(request, res);
});

/** Shared NDJSON streaming body for the investigate / analyze-email stream routes. */
async function streamInvestigation(request: ReturnType<typeof validateRequest>, res: Response) {
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event: InvestigationStreamEvent) => {
    if (res.writableEnded) return;
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    const report = await investigate(request, (step) => send({ type: 'trace', step }));
    send({ type: 'result', report });
  } catch (error) {
    const { message, code } = describeError(error);
    send({ type: 'error', message, code });
  } finally {
    res.end();
  }
}

apiRouter.post('/incident-response', async (req, res) => {
  if (rateLimited(req, res)) return;
  try {
    const body = (req.body || {}) as { actions?: unknown; context?: unknown };
    const actions = (Array.isArray(body.actions) ? body.actions : []).filter((a): a is InteractionAction => INTERACTION_ACTIONS.includes(a as InteractionAction));
    if (!actions.length) {
      res.status(400).json({ error: 'Select at least one action you took.', code: 'bad_request' });
      return;
    }
    const raw = (body.context && typeof body.context === 'object' ? body.context : {}) as Record<string, unknown>;
    const context: IncidentContext = {
      scamType: typeof raw.scamType === 'string' ? raw.scamType.slice(0, 80) : undefined,
      claimedOrganization: typeof raw.claimedOrganization === 'string' ? raw.claimedOrganization.slice(0, 80) : null,
      organizationCategory: typeof raw.organizationCategory === 'string' ? raw.organizationCategory.slice(0, 40) : null,
      level: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(raw.level)) ? (raw.level as IncidentContext['level']) : undefined,
      paymentMethods: Array.isArray(raw.paymentMethods) ? raw.paymentMethods.filter((x): x is string => typeof x === 'string').slice(0, 5) : [],
      platform: typeof raw.platform === 'string' ? raw.platform.slice(0, 40) : null,
      urls: Array.isArray(raw.urls) ? raw.urls.filter((x): x is string => typeof x === 'string').slice(0, 3) : [],
    };
    const plan = await generateIncidentPlan(actions, context);
    res.json({ plan, actions });
  } catch (error) {
    handleError(error, res);
  }
});

apiRouter.post('/coach/scenario', async (req, res) => {
  if (rateLimited(req, res)) return;
  try {
    const body = (req.body || {}) as { progress?: unknown; excludeIds?: unknown };
    const progress = sanitizeProgress(body.progress);
    const excludeIds = Array.isArray(body.excludeIds) ? body.excludeIds.filter((x): x is string => typeof x === 'string').slice(0, 30) : [];
    const scenario = await generateScenario(progress, excludeIds);
    res.json({ scenario });
  } catch (error) {
    handleError(error, res);
  }
});

apiRouter.post('/dashboard/summary', async (req, res) => {
  if (rateLimited(req, res)) return;
  try {
    const stats = sanitizeStats(req.body?.stats);
    const result = await generateDashboardSummary(stats);
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

// ---------------------------------------------------------------------------

function sanitizeProgress(raw: unknown): CoachProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  const byCategory: CoachProgress['byCategory'] = {};
  if (p.byCategory && typeof p.byCategory === 'object') {
    for (const [k, v] of Object.entries(p.byCategory as Record<string, unknown>).slice(0, 12)) {
      const s = (v || {}) as Record<string, unknown>;
      byCategory[k.slice(0, 40)] = { attempts: num(s.attempts), correct: num(s.correct) };
    }
  }
  const difficulty = [1, 2, 3].includes(Number(p.difficulty)) ? (Number(p.difficulty) as 1 | 2 | 3) : 1;
  return {
    answered: num(p.answered),
    correct: num(p.correct),
    streak: num(p.streak),
    byCategory,
    recentMistakes: Array.isArray(p.recentMistakes) ? (p.recentMistakes.filter((x): x is string => typeof x === 'string').slice(-5) as CoachProgress['recentMistakes']) : [],
    difficulty,
  };
}

function sanitizeStats(raw: unknown): DashboardStats {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.slice(0, 80) : null);
  return {
    messagesAnalyzed: num(s.messagesAnalyzed),
    highRisk: num(s.highRisk),
    suspiciousUrls: num(s.suspiciousUrls),
    phishingAttempts: num(s.phishingAttempts),
    credentialAttacks: num(s.credentialAttacks),
    financialScams: num(s.financialScams),
    mostCommonScamType: str(s.mostCommonScamType),
    mostCommonTactic: str(s.mostCommonTactic),
    recurringPatterns: Array.isArray(s.recurringPatterns)
      ? s.recurringPatterns.slice(0, 5).map((p) => {
          const r = (p || {}) as Record<string, unknown>;
          return { label: str(r.label) || 'pattern', count: num(r.count), indicatorIds: Array.isArray(r.indicatorIds) ? r.indicatorIds.filter((x): x is string => typeof x === 'string').slice(0, 6) : [] };
        })
      : [],
  };
}

function describeError(error: unknown): { status: number; message: string; code: string } {
  if (error instanceof InvestigationError) return { status: error.status, message: error.message, code: error.code };
  if (error instanceof SyntaxError) return { status: 400, message: 'Malformed JSON body.', code: 'bad_request' };
  console.error('[api] unexpected error:', error);
  return { status: 500, message: 'Investigation failed unexpectedly. Please try again.', code: 'internal' };
}

function handleError(error: unknown, res: Response) {
  const { status, message, code } = describeError(error);
  res.status(status).json({ error: message, code });
}
