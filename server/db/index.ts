/**
 * Persistence layer.
 *
 * One small async interface, two backends:
 *   - SQLite (node:sqlite, built into Node >= 22.13) — default for local dev and demos.
 *     File path from DATABASE_FILE (default ./data/online-safety-guard.sqlite).
 *   - PostgreSQL (pg) — used automatically when DATABASE_URL is set (Render production).
 *     If that database is unreachable (an expired or deleted managed instance,
 *     a network outage) the process does NOT die: it falls back to SQLite so the
 *     service still boots. Investigation, URL checks and the Outlook task pane
 *     need no database at all, and /api/health reports the degradation.
 *
 * All SQL in the services is written in the dialect-neutral subset both engines
 * share: TEXT / INTEGER / REAL columns, ISO-8601 timestamps as TEXT, JSON as TEXT,
 * booleans as 0/1, `?` placeholders (converted to $n for Postgres), and
 * `ON CONFLICT ... DO UPDATE/NOTHING` for upserts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA } from './schema';

export type Dialect = 'sqlite' | 'postgres';

export interface Db {
  dialect: Dialect;
  /** Describes the backend for the health endpoint (never includes credentials). */
  label: string;
  run(sql: string, params?: unknown[]): Promise<void>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

let instance: Db | null = null;
let fallbackReason: string | null = null;

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function openSqliteAt(file: string): Promise<Db> {
  const { openSqlite } = await import('./sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const opened = await openSqlite(file);
  for (const statement of SCHEMA) await opened.run(statement);
  return opened;
}

/** SQLite on disk, or in memory if the disk is unusable (read-only container). */
async function openSqliteWithFallback(): Promise<Db> {
  const file = process.env.DATABASE_FILE || path.join(process.cwd(), 'data', 'online-safety-guard.sqlite');
  if (file === ':memory:') return openSqliteAt(file);
  try {
    return await openSqliteAt(file);
  } catch (err) {
    fallbackReason = `${fallbackReason ? `${fallbackReason}; ` : ''}SQLite file unavailable: ${describe(err)}`;
    console.error(`Could not open ${file} (${describe(err)}) — using an in-memory database. Nothing will persist.`);
    return openSqliteAt(':memory:');
  }
}

/**
 * Open (once) the configured database and apply the schema.
 *
 * Never throws for a storage problem alone: the service must stay up so the
 * parts that need no database keep working and /api/health can explain why.
 */
export async function openDb(): Promise<Db> {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      const { openPostgres } = await import('./postgres');
      const opened = await openPostgres(url);
      for (const statement of SCHEMA) await opened.run(statement);
      instance = opened;
      return instance;
    } catch (err) {
      fallbackReason = `PostgreSQL unavailable: ${describe(err)}`;
      console.error(`PostgreSQL unreachable (${describe(err)}) — falling back to SQLite so the service still starts.`);
      console.error('  Accounts, mailbox connections and history from the Postgres instance are NOT available until DATABASE_URL points at a working database.');
    }
  }
  instance = await openSqliteWithFallback();
  return instance;
}

/**
 * Why the configured database is not in use, or null when all is well.
 * Surfaced by /api/health and the admin service-health page.
 */
export function dbFallbackReason(): string | null {
  return fallbackReason;
}

/** The open database. Throws if openDb() has not completed — routes are mounted after it. */
export function db(): Db {
  if (!instance) throw new Error('Database not initialised — call openDb() first.');
  return instance;
}

export function isDbOpen(): boolean {
  return instance !== null;
}

/**
 * Test helper: swap in a fresh in-memory database.
 * `keepDatabaseUrl` leaves DATABASE_URL in place so a test can exercise the
 * PostgreSQL-unreachable fallback.
 */
export async function resetDbForTests(options: { keepDatabaseUrl?: boolean } = {}): Promise<Db> {
  if (instance) await instance.close();
  instance = null;
  fallbackReason = null;
  process.env.DATABASE_FILE = ':memory:';
  if (!options.keepDatabaseUrl) delete process.env.DATABASE_URL;
  return openDb();
}

export const nowIso = () => new Date().toISOString();

/** Parse a JSON TEXT column defensively. */
export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
