/**
 * Mailbox synchronisation — polling, not push.
 *
 *   1. Fetch the newest messages (metadata only) from the provider.
 *   2. Upsert them into email_records (idempotent by provider message id).
 *   3. Score never-analysed messages with the deterministic pre-filter.
 *   4. Spend at most SYNC.autoAnalyzeMax full analyses on the highest-scoring
 *      ones above SYNC.autoAnalyzeThreshold (this is where AI calls happen).
 *   5. Notifications are created by the analysis service per user policy.
 *
 * A background loop runs every SYNC.intervalMinutes (0 disables it); the
 * dashboards also expose a manual "Sync now". Users are told explicitly that
 * detection is periodic, never "real-time".
 */
import { SYNC } from '../config';
import { audit } from './audit';
import { getAccessToken, getProvider, listActiveConnections, markConnection, recordSync, type ConnectionRow } from './connections';
import { analyzeEmailForUser, prefilterScore, setPrefilterScore } from './emailAnalysis';
import { listUnanalyzed, upsertEmail } from './emails';
import { recordSyncRun } from './health';
import { purgeExpired } from '../auth/sessions';
import { ProviderError } from '../providers/types';
import { InvestigationError } from '../agents/orchestrator';
import type { EmailProviderId, SyncResult } from '../../shared/accounts';

const inFlight = new Set<string>();

export async function syncConnection(userId: string, provider: EmailProviderId, trigger: 'manual' | 'scheduled', ip?: string | null): Promise<SyncResult> {
  const key = `${userId}:${provider}`;
  if (inFlight.has(key)) throw new InvestigationError(409, 'A sync for this mailbox is already running.', 'busy');
  inFlight.add(key);
  const started = Date.now();
  const result: SyncResult = { provider, fetched: 0, newRecords: 0, autoAnalyzed: 0, notificationsCreated: 0, skippedByPolicy: 0, durationMs: 0, error: null };
  let connection: ConnectionRow | null = null;
  try {
    const p = getProvider(provider);
    const access = await getAccessToken(userId, provider);
    connection = access.connection;

    // Overlap the window slightly so a message that arrived during the last sync is not missed.
    const since = connection.last_sync_at ? new Date(new Date(connection.last_sync_at).getTime() - 6 * 3_600_000).toISOString() : null;
    const messages = await p.listRecent(access.token, { max: SYNC.maxMessages, since });
    result.fetched = messages.length;
    for (const m of messages) {
      const { record, created } = await upsertEmail(userId, m);
      if (created) {
        result.newRecords += 1;
        await setPrefilterScore(userId, record.id, prefilterScore({ subject: m.subject, senderEmail: m.senderEmail, senderName: m.senderName, snippet: m.snippet, hasAttachments: m.hasAttachments, urls: m.urls }));
      }
    }

    // Automatic analysis budget: highest pre-filter scores first, above the threshold only.
    const candidates = (await listUnanalyzed(userId, provider, SYNC.maxMessages))
      .map((r) => ({ r, score: r.prefilterScore ?? prefilterScore({ subject: r.subject, senderEmail: r.senderEmail, senderName: r.senderName, snippet: r.snippet, hasAttachments: r.hasAttachments, urls: r.urls }) }))
      .sort((a, b) => b.score - a.score);
    for (const { r, score } of candidates) {
      if (score < SYNC.autoAnalyzeThreshold) {
        result.skippedByPolicy += 1;
        continue;
      }
      if (result.autoAnalyzed >= SYNC.autoAnalyzeMax) {
        result.skippedByPolicy += 1;
        continue;
      }
      try {
        const content = await p.fetchContent(access.token, r.providerItemId || r.providerMessageId);
        const outcome = await analyzeEmailForUser(userId, { provider, providerMessageId: r.providerMessageId, providerItemId: r.providerItemId, internetMessageId: r.internetMessageId, threadId: r.threadId, senderName: r.senderName, senderEmail: r.senderEmail, recipients: r.recipients, subject: r.subject, snippet: r.snippet, receivedAt: r.receivedAt, isRead: r.isRead, hasAttachments: r.hasAttachments || (content.attachments?.length || 0) > 0, urls: content.urls, webLink: r.webLink, source: 'sync' }, content, { trigger: 'sync', ip });
        result.autoAnalyzed += 1;
        if (outcome.notified) result.notificationsCreated += 1;
      } catch (err) {
        if (err instanceof ProviderError && (err.code === 'expired' || err.code === 'rate_limited')) throw err;
        console.warn(`[sync] analysis failed for ${provider} record ${r.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    const summary = `${result.fetched} fetched, ${result.newRecords} new, ${result.autoAnalyzed} analysed automatically${result.notificationsCreated ? `, ${result.notificationsCreated} alert${result.notificationsCreated === 1 ? '' : 's'}` : ''}`;
    await recordSync(connection.id, summary, null);
    await audit('mailbox_synced', { userId, detail: { provider, trigger, fetched: result.fetched, newRecords: result.newRecords, autoAnalyzed: result.autoAnalyzed }, ip });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed.';
    result.error = message;
    if (connection) {
      if (err instanceof ProviderError && err.code === 'expired') await markConnection(connection.id, 'expired', message);
      else await recordSync(connection.id, 'Sync failed', message);
    }
    if (!(err instanceof ProviderError) && !(err instanceof InvestigationError)) console.error(`[sync] ${provider} sync for user ${userId} failed:`, err);
    if (trigger === 'manual') throw err;
  } finally {
    inFlight.delete(key);
    result.durationMs = Date.now() - started;
  }
  return result;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export async function runScheduledSync(): Promise<void> {
  if (running) return;
  running = true;
  const started = Date.now();
  let ok = 0;
  let failed = 0;
  let analysed = 0;
  try {
    await purgeExpired().catch(() => undefined);
    for (const conn of await listActiveConnections()) {
      const r = await syncConnection(conn.user_id, conn.provider, 'scheduled');
      if (r.error) failed += 1;
      else ok += 1;
      analysed += r.autoAnalyzed;
    }
  } catch (err) {
    console.error('[sync] scheduled run failed:', err);
  } finally {
    running = false;
    recordSyncRun(`${ok} mailbox${ok === 1 ? '' : 'es'} synced, ${failed} failed, ${analysed} analysed in ${Math.round((Date.now() - started) / 1000)}s`);
  }
}

/** Start the polling loop. Returns false when disabled (SYNC_INTERVAL_MINUTES=0). */
export function startSyncScheduler(): boolean {
  if (timer || SYNC.intervalMinutes <= 0) return false;
  const every = SYNC.intervalMinutes * 60_000;
  timer = setInterval(() => void runScheduledSync(), every);
  timer.unref();
  // First pass shortly after boot so freshly deployed instances catch up.
  setTimeout(() => void runScheduledSync(), 30_000).unref();
  return true;
}

export function stopSyncScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
