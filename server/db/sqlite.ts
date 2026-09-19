/**
 * SQLite backend on node:sqlite (no native build step; ships with Node >= 22.13).
 */
import { DatabaseSync } from 'node:sqlite';
import type { Db } from './index';

type Param = null | number | bigint | string | Uint8Array;

function coerce(params: unknown[] = []): Param[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    if (typeof p === 'object' && p !== null && !(p instanceof Uint8Array)) return JSON.stringify(p);
    return p as Param;
  });
}

export async function openSqlite(file: string): Promise<Db> {
  const conn = new DatabaseSync(file);
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return {
    dialect: 'sqlite',
    label: file === ':memory:' ? 'SQLite (in-memory)' : `SQLite (${file})`,
    async run(sql, params) {
      conn.prepare(sql).run(...coerce(params));
    },
    async get(sql, params) {
      return conn.prepare(sql).get(...coerce(params)) as never;
    },
    async all(sql, params) {
      return conn.prepare(sql).all(...coerce(params)) as never;
    },
    async close() {
      conn.close();
    },
  };
}
