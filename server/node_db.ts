import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DbClient, PreparedStatement, RunResult } from './db_adapter.ts';

function normalizeParam(value: unknown): string | number | bigint | Uint8Array | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return String(value);
}

export function createNodeSqliteDatabase(): DbClient {
  const dataDir = path.resolve(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'meridian.db');
  const nodeDb = new DatabaseSync(dbPath);

  return {
    dialect: 'sqlite',
    prepare(sql: string): PreparedStatement {
      const stmt = nodeDb.prepare(sql);
      return {
        async get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined> {
          return stmt.get(...params.map(normalizeParam)) as T | undefined;
        },
        async all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]> {
          return stmt.all(...params.map(normalizeParam)) as T[];
        },
        async run(...params: unknown[]): Promise<RunResult> {
          const info = stmt.run(...params.map(normalizeParam));
          return {
            changes: Number(info.changes),
            lastInsertRowid: Number(info.lastInsertRowid),
          };
        },
      };
    },
    async exec(sql: string): Promise<void> {
      nodeDb.exec(sql);
    },
  };
}
