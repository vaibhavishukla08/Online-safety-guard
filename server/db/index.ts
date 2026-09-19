/**
 * Persistence layer.
 *
 * One small async interface, two backends:
 *   - SQLite (node:sqlite, built into Node >= 22.13) — default for local dev and demos.
 *     File path from DATABASE_FILE (default ./data/online-safety-guard.sqlite).
 *   - PostgreSQL (pg) — used automatically when DATABASE_URL is set (Render production).
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

/** Open (once) the configured database and apply the schema. */
export async function openDb(): Promise<Db> {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  let opened: Db;
  if (url) {
    const { openPostgres } = await import('./postgres');
    opened = await openPostgres(url);
  } else {
    const { openSqlite } = await import('./sqlite');
    const file = process.env.DATABASE_FILE || path.join(process.cwd(), 'data', 'online-safety-guard.sqlite');
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    opened = await openSqlite(file);
  }
  for (const statement of SCHEMA) await opened.run(statement);
  instance = opened;
  return instance;
}

/** The open database. Throws if openDb() has not completed — routes are mounted after it. */
export function db(): Db {
  if (!instance) throw new Error('Database not initialised — call openDb() first.');
  return instance;
}

export function isDbOpen(): boolean {
  return instance !== null;
}

/** Test helper: swap in a fresh in-memory database. */
export async function resetDbForTests(): Promise<Db> {
  if (instance) await instance.close();
  instance = null;
  process.env.DATABASE_FILE = ':memory:';
  delete process.env.DATABASE_URL;
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
