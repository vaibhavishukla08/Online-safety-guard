/**
 * Thin, defensive wrapper around the Gemini SDK.
 *
 * Every agent that needs the LLM goes through `generateJson`, which guarantees:
 *  - a hard timeout (the SDK call is raced against a timer),
 *  - structured JSON output (responseMimeType + optional responseSchema),
 *  - classified errors (not_configured / invalid_key / model_not_found / network /
 *    rate_limited / timeout / unavailable), each keeping the whole error chain in
 *    `detail` for the logs,
 *  - no thrown exceptions — callers always receive a discriminated result.
 */
import { GoogleGenAI } from '@google/genai';
import { GEMINI_MODEL, TIMEOUTS } from '../config';
import { recordFailure, recordSuccess } from '../services/health';

export type GeminiErrorCode =
  | 'not_configured'
  | 'invalid_key'
  | 'model_not_found'
  | 'network'
  | 'rate_limited'
  | 'timeout'
  | 'bad_response'
  | 'unavailable';

export interface GeminiFailure {
  ok: false;
  code: GeminiErrorCode;
  message: string;
  /** Upstream error text, for logs and the admin health page. Never shown to end users. */
  detail?: string;
}

export interface GeminiSuccess<T> {
  ok: true;
  data: T;
  model: string;
}

export type GeminiResult<T> = GeminiSuccess<T> | GeminiFailure;

let client: GoogleGenAI | null = null;

export function getGenAI(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!client) {
    client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: { 'User-Agent': 'online-safety-guard' },
        // Optional override for proxies / local testing. Leave unset for the public API.
        ...(process.env.GEMINI_BASE_URL ? { baseUrl: process.env.GEMINI_BASE_URL } : {}),
      },
    });
  }
  return client;
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Flatten an error chain into one searchable string.
 *
 * Node's fetch reports transport problems as a bare "fetch failed" and hides the
 * real reason (ENOTFOUND, ECONNREFUSED, certificate errors) in `cause`, and the
 * SDK carries HTTP status on the error object. Reading only `.message` turned
 * all of those into an unexplained 'unavailable'.
 */
function flattenError(error: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let current: unknown = error;
  while (current && !seen.has(current) && parts.length < 6) {
    seen.add(current);
    if (current instanceof Error) {
      parts.push(current.message);
      const withCode = current as Error & { status?: unknown; code?: unknown };
      if (withCode.status !== undefined) parts.push(`status=${String(withCode.status)}`);
      if (withCode.code !== undefined) parts.push(`code=${String(withCode.code)}`);
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.filter(Boolean).join(' | ') || 'Unknown error';
}

/** Map raw SDK/HTTP errors to a small, user-explainable set of codes. */
export function classifyGeminiError(error: unknown): GeminiFailure {
  const raw = flattenError(error);
  const msg = raw.toLowerCase();
  // Keep the upstream wording: 'unavailable' on its own tells nobody what broke.
  const detail = raw.slice(0, 300);

  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) {
    return { ok: false, code: 'timeout', message: 'AI request timed out.', detail };
  }
  if (msg.includes('api key') || msg.includes('api_key_invalid') || msg.includes('permission_denied') || msg.includes('401') || msg.includes('403')) {
    return { ok: false, code: 'invalid_key', message: 'Gemini API key was rejected. Check GEMINI_API_KEY.', detail };
  }
  // A model the key cannot use (wrong id, not released, no access) answers 404 NOT_FOUND.
  // Without its own code this looked identical to an outage.
  if (msg.includes('404') || msg.includes('not_found') || msg.includes('is not found') || msg.includes('not supported')) {
    return { ok: false, code: 'model_not_found', message: `Gemini model "${GEMINI_MODEL}" is unavailable for this API key. Set GEMINI_MODEL to a model the key can use.`, detail };
  }
  // Not a bare 'rate': "generateContent" contains it, so every 404 and 500
  // mentioning the endpoint used to be reported as a rate limit.
  if (msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('rate_limit')) {
    return { ok: false, code: 'rate_limited', message: 'Gemini rate limit reached. Try again shortly.', detail };
  }
  if (msg.includes('unexpected token') || msg.includes('not valid json') || msg.includes('json input') || msg.includes('json parse') || msg.includes('malformed')) {
    return { ok: false, code: 'bad_response', message: 'AI returned a malformed response.', detail };
  }
  // Transport-level: the host never reached Google at all.
  if (msg.includes('enotfound') || msg.includes('econnrefused') || msg.includes('eai_again') || msg.includes('econnreset') || msg.includes('certificate') || msg.includes('fetch failed')) {
    return { ok: false, code: 'network', message: 'Could not reach the Gemini API from this host.', detail };
  }
  return { ok: false, code: 'unavailable', message: 'AI service temporarily unavailable.', detail };
}

export interface GenerateJsonOptions {
  /** Prompt text. Combined with optional inline image parts. */
  prompt: string;
  /** Optional system instruction describing the agent's role. */
  systemInstruction?: string;
  /** Optional Gemini responseSchema (built with `Type` from @google/genai). */
  schema?: Record<string, unknown>;
  /** Optional base64 image for multimodal calls. */
  image?: { base64: string; mimeType: string } | null;
  timeoutMs?: number;
  temperature?: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** Strip a data-URL header and any whitespace from a base64 payload. */
export function cleanBase64(input: string): string {
  return input.replace(/^data:[a-z]+\/[a-z0-9.+-]+;base64,/i, '').replace(/\s/g, '');
}

/**
 * Run a structured-output Gemini call. Never throws.
 */
export async function generateJson<T>(opts: GenerateJsonOptions): Promise<GeminiResult<T>> {
  const ai = getGenAI();
  if (!ai) {
    return { ok: false, code: 'not_configured', message: 'GEMINI_API_KEY is not configured.' };
  }

  const parts: Array<Record<string, unknown>> = [];
  if (opts.image) {
    parts.push({ inlineData: { mimeType: opts.image.mimeType, data: cleanBase64(opts.image.base64) } });
  }
  parts.push({ text: opts.prompt });

  const timeoutMs = opts.timeoutMs ?? TIMEOUTS.gemini;

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          ...(opts.schema ? { responseSchema: opts.schema } : {}),
          ...(opts.systemInstruction ? { systemInstruction: opts.systemInstruction } : {}),
          temperature: opts.temperature ?? 0.2,
          httpOptions: { timeout: timeoutMs },
        },
      }),
      timeoutMs + 500,
    );

    const text = response.text;
    if (!text) {
      return { ok: false, code: 'bad_response', message: 'AI returned an empty response.' };
    }
    const data = JSON.parse(text) as T;
    recordSuccess('gemini');
    return { ok: true, data, model: GEMINI_MODEL };
  } catch (error) {
    const failure = classifyGeminiError(error);
    // Log the upstream text too — this is the only place the real cause survives.
    console.warn(`[gemini] ${failure.code} (model=${GEMINI_MODEL}): ${failure.detail || failure.message}`);
    recordFailure('gemini', `${failure.code}: ${failure.message}`, failure.detail);
    return failure;
  }
}
