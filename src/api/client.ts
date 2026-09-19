/**
 * Typed API client with timeouts and streaming support.
 * Every call resolves to a discriminated result — callers never need try/catch.
 */
import type {
  CoachProgress,
  CoachScenario,
  DashboardStats,
  IncidentContext,
  IncidentPlan,
  InteractionAction,
  InvestigationReport,
  InvestigationStreamEvent,
  InvestigateMode,
  TraceStep,
} from '../types';
import type {
  AddinTokenInfo,
  AdminOverview,
  AdminUserRow,
  AuditEntry,
  ConnectionStatus,
  EmailListQuery,
  EmailListResult,
  EmailProviderId,
  EmailRecordDetail,
  NotificationItem,
  PublicUser,
  ServiceHealthReport,
  SyncResult,
  ThreatAnalytics,
} from '../../shared/accounts';

/** Bearer token used by the Outlook task pane (cookies are unreliable inside Outlook's iframe). */
let bearerToken: string | null = null;
export function setBearerToken(token: string | null): void {
  bearerToken = token;
}
function authHeaders(): Record<string, string> {
  return bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {};
}

export interface ApiError {
  message: string;
  code: string;
  status: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface HealthInfo {
  status: string;
  hasGeminiKey: boolean;
  model: string;
  intel: Record<string, boolean>;
  oauth?: { microsoft: boolean; google: boolean };
  database?: { ok: boolean; kind: string };
  sync?: { enabled: boolean; intervalMinutes: number };
}

/** Generic JSON request with the same discriminated result as postJson. */
export async function requestJson<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, timeoutMs = DEFAULT_TIMEOUT): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...authHeaders() }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: { message: (data as { error?: string }).error || `Server responded with ${res.status}`, code: (data as { code?: string }).code || 'http_error', status: res.status } };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, error: { message: aborted ? 'The request timed out. Please try again.' : 'Network error — check your connection and try again.', code: aborted ? 'timeout' : 'network', status: 0 } };
  } finally {
    clearTimeout(timer);
  }
}

const DEFAULT_TIMEOUT = 45_000;
const INVESTIGATION_TIMEOUT = 120_000;

async function postJson<T>(path: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body), signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: { message: (data as { error?: string }).error || `Server responded with ${res.status}`, code: (data as { code?: string }).code || 'http_error', status: res.status } };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, error: { message: aborted ? 'The request timed out. Please try again.' : 'Network error — check your connection and try again.', code: aborted ? 'timeout' : 'network', status: 0 } };
  } finally {
    clearTimeout(timer);
  }
}

export async function getHealth(): Promise<HealthInfo | null> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return null;
    return (await res.json()) as HealthInfo;
  } catch {
    return null;
  }
}

export interface InvestigateRequest {
  mode: InvestigateMode;
  message?: string;
  sender?: string;
  platform?: string;
  url?: string;
  conversation?: string;
  imageBase64?: string;
  imageMime?: string;
}

function toBody(req: InvestigateRequest) {
  return {
    inputType: req.mode,
    message: req.message,
    sender: req.sender,
    platform: req.platform,
    url: req.url,
    conversation: req.conversation,
    imageBase64: req.imageBase64,
    imageMime: req.imageMime,
  };
}

/** Non-streaming investigation (fallback). */
export function investigate(req: InvestigateRequest): Promise<ApiResult<InvestigationReport>> {
  return postJson<InvestigationReport>('/api/investigate', toBody(req), INVESTIGATION_TIMEOUT);
}

/**
 * Streaming investigation: trace steps arrive live via `onTrace`; resolves with the
 * final report. Falls back to the JSON endpoint if streaming is unsupported.
 */
export async function investigateStream(req: InvestigateRequest, onTrace: (step: TraceStep) => void): Promise<ApiResult<InvestigationReport>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INVESTIGATION_TIMEOUT);
  try {
    const res = await fetch('/api/investigate/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toBody(req)), signal: controller.signal });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: { message: (data as { error?: string }).error || `Server responded with ${res.status}`, code: (data as { code?: string }).code || 'http_error', status: res.status } };
    }
    if (!res.body) return investigate(req);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let report: InvestigationReport | null = null;
    let streamError: ApiError | null = null;

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let event: InvestigationStreamEvent;
      try {
        event = JSON.parse(line) as InvestigationStreamEvent;
      } catch {
        return;
      }
      if (event.type === 'trace') onTrace(event.step);
      else if (event.type === 'result') report = event.report;
      else if (event.type === 'error') streamError = { message: event.message, code: event.code || 'stream_error', status: 0 };
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    }
    handleLine(buffer);

    if (report) return { ok: true, data: report };
    if (streamError) return { ok: false, error: streamError };
    return { ok: false, error: { message: 'The investigation ended without a result. Please try again.', code: 'incomplete', status: 0 } };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, error: { message: aborted ? 'The investigation timed out. Please try again.' : 'Network error — check your connection and try again.', code: aborted ? 'timeout' : 'network', status: 0 } };
  } finally {
    clearTimeout(timer);
  }
}

export function requestIncidentPlan(actions: InteractionAction[], context: IncidentContext): Promise<ApiResult<{ plan: IncidentPlan; actions: InteractionAction[] }>> {
  return postJson('/api/incident-response', { actions, context });
}

export function requestCoachScenario(progress: CoachProgress | null, excludeIds: string[]): Promise<ApiResult<{ scenario: CoachScenario }>> {
  return postJson('/api/coach/scenario', { progress, excludeIds });
}

export function requestDashboardSummary(stats: DashboardStats): Promise<ApiResult<{ summary: string; source: 'ai' | 'rule' }>> {
  return postJson('/api/dashboard/summary', { stats });
}

// ---------------------------------------------------------------------------
// Outlook add-in channel — same orchestrator, email-shaped input.
// ---------------------------------------------------------------------------
export interface EmailAnalysisRequest {
  subject: string;
  sender: string;
  senderEmail: string;
  body: string;
  urls: string[];
  recipientCount: number | null;
  attachments: Array<{ name: string; size: number | null; contentType: string | null }>;
  truncated: boolean;
}

/** Extra identifiers the add-in sends so a linked account can save and de-duplicate the analysis. */
export interface EmailAnalysisIdentity {
  internetMessageId?: string | null;
  itemId?: string | null;
  conversationId?: string | null;
  receivedAt?: string | null;
  isRead?: boolean | null;
  force?: boolean;
}

/** Server-side outcome flags for a saved analysis (present when the caller is linked to an account). */
export interface AnalysisMeta {
  saved: boolean;
  cached: boolean;
  recordId: string | null;
  reason?: string;
  notified?: boolean;
}

export interface StreamOutcome {
  report: InvestigationReport;
  meta: AnalysisMeta | null;
}

/** Streams trace steps live, then resolves with the report; falls back to JSON if streaming is unavailable. */
export async function analyzeEmailStream(email: EmailAnalysisRequest & EmailAnalysisIdentity, onTrace: (step: TraceStep) => void): Promise<ApiResult<StreamOutcome>> {
  const streamed = await readNdjsonStream('/api/analyze-email/stream', email, onTrace);
  if (streamed.ok || streamed.error.code !== 'incomplete') return streamed;
  const res = await postJson<InvestigationReport & { meta?: AnalysisMeta }>('/api/analyze-email', email, INVESTIGATION_TIMEOUT);
  if (!res.ok) return res;
  const { meta, ...report } = res.data;
  return { ok: true, data: { report: report as InvestigationReport, meta: meta || null } };
}

/** Analyse (or re-analyse) an email already stored in the signed-in user's history. */
export function analyzeStoredEmailStream(recordId: string, force: boolean, onTrace: (step: TraceStep) => void): Promise<ApiResult<StreamOutcome>> {
  return readNdjsonStream(`/api/mail/messages/${encodeURIComponent(recordId)}/analyze/stream`, { force }, onTrace);
}

async function readNdjsonStream(path: string, body: unknown, onTrace: (step: TraceStep) => void): Promise<ApiResult<StreamOutcome>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INVESTIGATION_TIMEOUT);
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: { message: (data as { error?: string }).error || `Server responded with ${res.status}`, code: (data as { code?: string }).code || 'http_error', status: res.status } };
    }
    if (!res.body) return { ok: false, error: { message: 'Streaming unavailable', code: 'incomplete', status: 0 } };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let report: InvestigationReport | null = null;
    let meta: AnalysisMeta | null = null;
    let streamError: ApiError | null = null;
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line) as InvestigationStreamEvent & { meta?: AnalysisMeta };
        if (event.type === 'trace') onTrace(event.step);
        else if (event.type === 'result') {
          report = event.report;
          meta = event.meta || null;
        } else if (event.type === 'error') streamError = { message: event.message, code: event.code || 'stream_error', status: 0 };
      } catch {
        /* ignore malformed line */
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    }
    handleLine(buffer);
    if (report) return { ok: true, data: { report, meta } };
    if (streamError) return { ok: false, error: streamError };
    return { ok: false, error: { message: 'The investigation ended without a result.', code: 'incomplete', status: 0 } };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, error: { message: aborted ? 'The analysis timed out. Please try again.' : 'Online Safety Guard could not reach the analysis server. Please try again.', code: aborted ? 'timeout' : 'network', status: 0 } };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Accounts, mailbox connections, history, notifications, admin
// ---------------------------------------------------------------------------
export const accountApi = {
  me: () => requestJson<{ user: PublicUser; via: 'session' | 'addin' }>('GET', '/api/auth/me'),
  register: (email: string, password: string, name: string) => requestJson<{ user: PublicUser }>('POST', '/api/auth/register', { email, password, name }),
  login: (email: string, password: string) => requestJson<{ user: PublicUser }>('POST', '/api/auth/login', { email, password }),
  logout: () => requestJson<{ ok: true }>('POST', '/api/auth/logout', {}),
  update: (patch: { name?: string; notifyPolicy?: PublicUser['notifyPolicy'] }) => requestJson<{ user: PublicUser }>('PATCH', '/api/auth/me', patch),
  linkCode: () => requestJson<{ code: string; expiresAt: string }>('POST', '/api/auth/link-code', {}),
  redeemLinkCode: (code: string, label: string) => requestJson<{ token: string; expiresAt: string; user: PublicUser }>('POST', '/api/auth/link-code/redeem', { code, label }),
  addinTokens: () => requestJson<{ tokens: AddinTokenInfo[] }>('GET', '/api/auth/addin-tokens'),
  revokeAddinToken: (id: string) => requestJson<{ ok: true }>('DELETE', `/api/auth/addin-tokens/${encodeURIComponent(id)}`),
};

export const connectionsApi = {
  list: () => requestJson<{ connections: ConnectionStatus[] }>('GET', '/api/connections'),
  sync: (provider: EmailProviderId) => requestJson<{ result: SyncResult; status: ConnectionStatus }>('POST', `/api/connections/${provider}/sync`, {}, INVESTIGATION_TIMEOUT * 3),
  disconnect: (provider: EmailProviderId, deleteHistory: boolean) => requestJson<{ ok: true; removed: boolean; deletedHistory: number; status: ConnectionStatus }>('DELETE', `/api/connections/${provider}${deleteHistory ? '?history=1' : ''}`),
  startUrl: (provider: EmailProviderId) => `/api/connections/${provider}/start`,
};

export const mailApi = {
  list: (q: EmailListQuery) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    return requestJson<EmailListResult>('GET', `/api/mail/messages?${params.toString()}`);
  },
  get: (id: string) => requestJson<{ record: EmailRecordDetail }>('GET', `/api/mail/messages/${encodeURIComponent(id)}`),
  remove: (id: string) => requestJson<{ ok: true }>('DELETE', `/api/mail/messages/${encodeURIComponent(id)}`),
  deleteHistory: (provider?: EmailProviderId) => requestJson<{ ok: true; deleted: number }>('DELETE', `/api/mail/history${provider ? `?provider=${provider}` : ''}`),
};

export const notificationsApi = {
  list: (status: 'unread' | 'active' | 'all' = 'active', limit = 30) => requestJson<{ items: NotificationItem[]; unread: number }>('GET', `/api/notifications?status=${status}&limit=${limit}`),
  markRead: (id: string) => requestJson<{ ok: true }>('POST', `/api/notifications/${encodeURIComponent(id)}/read`, {}),
  dismiss: (id: string) => requestJson<{ ok: true }>('POST', `/api/notifications/${encodeURIComponent(id)}/dismiss`, {}),
  readAll: () => requestJson<{ ok: true }>('POST', '/api/notifications/read-all', {}),
};

export const adminApi = {
  overview: () => requestJson<AdminOverview>('GET', '/api/admin/overview'),
  users: () => requestJson<{ users: AdminUserRow[] }>('GET', '/api/admin/users'),
  updateUser: (id: string, patch: { status?: 'active' | 'suspended'; role?: 'USER' | 'ADMIN' }) => requestJson<{ ok: true }>('PATCH', `/api/admin/users/${encodeURIComponent(id)}`, patch),
  threats: () => requestJson<ThreatAnalytics>('GET', '/api/admin/threats'),
  health: () => requestJson<ServiceHealthReport>('GET', '/api/admin/health'),
  audit: (limit = 50, offset = 0) => requestJson<{ items: AuditEntry[]; total: number }>('GET', `/api/admin/audit?limit=${limit}&offset=${offset}`),
};
