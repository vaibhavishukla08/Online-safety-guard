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
}

const DEFAULT_TIMEOUT = 45_000;
const INVESTIGATION_TIMEOUT = 120_000;

async function postJson<T>(path: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
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

/** Streams trace steps live, then resolves with the report; falls back to JSON if streaming is unavailable. */
export async function analyzeEmailStream(email: EmailAnalysisRequest, onTrace: (step: TraceStep) => void): Promise<ApiResult<InvestigationReport>> {
  const streamed = await readNdjsonStream('/api/analyze-email/stream', email, onTrace);
  if (streamed.ok || streamed.error.code !== 'incomplete') return streamed;
  return postJson<InvestigationReport>('/api/analyze-email', email, INVESTIGATION_TIMEOUT);
}

async function readNdjsonStream(path: string, body: unknown, onTrace: (step: TraceStep) => void): Promise<ApiResult<InvestigationReport>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INVESTIGATION_TIMEOUT);
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: { message: (data as { error?: string }).error || `Server responded with ${res.status}`, code: (data as { code?: string }).code || 'http_error', status: res.status } };
    }
    if (!res.body) return { ok: false, error: { message: 'Streaming unavailable', code: 'incomplete', status: 0 } };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let report: InvestigationReport | null = null;
    let streamError: ApiError | null = null;
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line) as InvestigationStreamEvent;
        if (event.type === 'trace') onTrace(event.step);
        else if (event.type === 'result') report = event.report;
        else if (event.type === 'error') streamError = { message: event.message, code: event.code || 'stream_error', status: 0 };
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
    if (report) return { ok: true, data: report };
    if (streamError) return { ok: false, error: streamError };
    return { ok: false, error: { message: 'The investigation ended without a result.', code: 'incomplete', status: 0 } };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, error: { message: aborted ? 'The analysis timed out. Please try again.' : 'Online Safety Guard could not reach the analysis server. Please try again.', code: aborted ? 'timeout' : 'network', status: 0 } };
  } finally {
    clearTimeout(timer);
  }
}
