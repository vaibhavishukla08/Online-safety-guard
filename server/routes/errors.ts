/**
 * One error → HTTP mapping for every route. Users get a specific, actionable
 * message and a machine-readable code; stack traces stay in the server log.
 */
import type { Response } from 'express';
import { InvestigationError } from '../agents/orchestrator';
import { ProviderError } from '../providers/types';
import { recordFailure } from '../services/health';

export function describeError(error: unknown): { status: number; message: string; code: string } {
  if (error instanceof InvestigationError) return { status: error.status, message: error.message, code: error.code };
  if (error instanceof ProviderError) return { status: error.status, message: error.message, code: error.code };
  if (error instanceof SyntaxError) return { status: 400, message: 'Malformed JSON body.', code: 'bad_request' };
  const raw = error instanceof Error ? error.message : String(error);
  console.error('[api] unexpected error:', error);
  recordFailure('api', raw);
  // Common infrastructure failures get a precise explanation instead of "Service error".
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(raw)) return { status: 503, message: 'A required network service could not be reached. Please try again shortly.', code: 'unavailable' };
  if (/timeout|timed out/i.test(raw)) return { status: 504, message: 'The request took too long and was stopped. Please try again.', code: 'timeout' };
  if (/SQLITE|database|relation .* does not exist|connect ETIMEDOUT/i.test(raw)) return { status: 503, message: 'The database is temporarily unavailable. Please try again shortly.', code: 'database_unavailable' };
  return { status: 500, message: 'Something went wrong on the server. The problem has been recorded — please try again.', code: 'internal' };
}

export function handleError(error: unknown, res: Response): void {
  const { status, message, code } = describeError(error);
  if (res.headersSent) return;
  res.status(status).json({ error: message, code });
}
