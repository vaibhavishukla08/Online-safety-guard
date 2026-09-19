/**
 * PostgreSQL backend (pg). Selected when DATABASE_URL is set.
 * `?` placeholders are rewritten to $1..$n so the services stay dialect-neutral.
 */
import { Pool } from 'pg';
import type { Db } from './index';

function toPgParams(sql: string): string {
  let i = 0;
  // Queries never embed a literal '?' in string constants, so a plain rewrite is safe.
  return sql.replace(/\?/g, () => `$${++i}`);
}

function coerce(params: unknown[] = []): unknown[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    if (typeof p === 'object' && p !== null) return JSON.stringify(p);
    return p;
  });
}

export async function openPostgres(url: string): Promise<Db> {
  const local = /localhost|127\.0\.0\.1/.test(url);
  const ssl = local || process.env.DATABASE_SSL === 'false' ? undefined : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: url, ssl, max: 5 });
  // Fail fast with a clear message if the database is unreachable.
  await pool.query('SELECT 1');
  let host = 'postgres';
  try {
    host = new URL(url).host.replace(/^.*@/, '');
  } catch {
    /* keep generic label */
  }
  return {
    dialect: 'postgres',
    label: `PostgreSQL (${host})`,
    async run(sql, params) {
      await pool.query(toPgParams(sql), coerce(params));
    },
    async get(sql, params) {
      const res = await pool.query(toPgParams(sql), coerce(params));
      return res.rows[0] as never;
    },
    async all(sql, params) {
      const res = await pool.query(toPgParams(sql), coerce(params));
      return res.rows as never;
    },
    async close() {
      await pool.end();
    },
  };
}
