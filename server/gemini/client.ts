/**
 * Thin, defensive wrapper around the Gemini SDK.
 *
 * Every agent that needs the LLM goes through `generateJson`, which guarantees:
 *  - a hard timeout (the SDK call is raced against a timer),
 *  - structured JSON output (responseMimeType + optional responseSchema),
 *  - classified errors (not_configured / invalid_key / rate_limited / timeout / unavailable),
 *  - no thrown exceptions — callers always receive a discriminated result.
 */
import { GoogleGenAI } from '@google/genai';
import { GEMINI_MODEL, TIMEOUTS } from '../config';

export type GeminiErrorCode =
  | 'not_configured'
  | 'invalid_key'
  | 'rate_limited'
  | 'timeout'
  | 'bad_response'
  | 'unavailable';

export interface GeminiFailure {
  ok: false;
  code: GeminiErrorCode;
  message: string;
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

/** Map raw SDK/HTTP errors to a small, user-explainable set of codes. */
export function classifyGeminiError(error: unknown): GeminiFailure {
  const raw = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const msg = raw.toLowerCase();

  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) {
    return { ok: false, code: 'timeout', message: 'AI request timed out.' };
  }
  if (msg.includes('api key') || msg.includes('api_key_invalid') || msg.includes('permission_denied') || msg.includes('401') || msg.includes('403')) {
    return { ok: false, code: 'invalid_key', message: 'Gemini API key was rejected. Check GEMINI_API_KEY.' };
  }
  if (msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('quota') || msg.includes('rate')) {
    return { ok: false, code: 'rate_limited', message: 'Gemini rate limit reached. Try again shortly.' };
  }
  if (msg.includes('json') || msg.includes('unexpected token')) {
    return { ok: false, code: 'bad_response', message: 'AI returned a malformed response.' };
  }
  return { ok: false, code: 'unavailable', message: 'AI service temporarily unavailable.' };
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
    return { ok: true, data, model: GEMINI_MODEL };
  } catch (error) {
    const failure = classifyGeminiError(error);
    console.warn(`[gemini] ${failure.code}: ${failure.message}`);
    return failure;
  }
}
