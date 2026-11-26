export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface PreparedStatement {
  get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<RunResult>;
}

export interface DbClient {
  readonly dialect: 'sqlite' | 'd1';
  prepare(sql: string): PreparedStatement;
  exec(sql: string): Promise<void>;
}

export interface AppEnv {
  ADMIN_BOOT_PASSCODE?: string;
  GEMINI_API_KEY?: string;
  SESSION_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  API_ORIGIN?: string;
  DB?: D1DatabaseLike;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number; last_row_id?: number } }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch<T = unknown>(statements: D1PreparedStatementLike[]): Promise<T[]>;
  exec(query: string): Promise<unknown>;
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        current += ch;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && ch === '-' && next === '-') {
      inLineComment = true;
      i++;
      continue;
    }

    if (ch === "'" && !inDoubleQuote) {
      if (inSingleQuote && next === "'") {
        current += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      continue;
    }

    if (ch === ';' && !inSingleQuote && !inDoubleQuote) {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }
  return statements;
}

function normalizeSqlParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  return value;
}

export function createD1DbClient(d1: D1DatabaseLike): DbClient {
  return {
    dialect: 'd1',
    prepare(sql: string): PreparedStatement {
      return {
        async get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined> {
          const bound = params.length
            ? d1.prepare(sql).bind(...params.map(normalizeSqlParam))
            : d1.prepare(sql);
          const row = await bound.first<T>();
          return row === null ? undefined : row;
        },
        async all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]> {
          const bound = params.length
            ? d1.prepare(sql).bind(...params.map(normalizeSqlParam))
            : d1.prepare(sql);
          const res = await bound.all<T>();
          return res.results ?? [];
        },
        async run(...params: unknown[]): Promise<RunResult> {
          const bound = params.length
            ? d1.prepare(sql).bind(...params.map(normalizeSqlParam))
            : d1.prepare(sql);
          const res = await bound.run();
          return {
            changes: Number(res.meta?.changes ?? 0),
            lastInsertRowid: Number(res.meta?.last_row_id ?? 0),
          };
        },
      };
    },
    async exec(sql: string): Promise<void> {
      const statements = splitSqlStatements(sql).filter((stmt) => {
        if (/^(BEGIN|COMMIT|ROLLBACK)(\s+IMMEDIATE|\s+DEFERRED|\s+TRANSACTION)?$/i.test(stmt)) {
          return false;
        }
        if (/^PRAGMA\s+journal_mode\b/i.test(stmt)) {
          return false;
        }
        return true;
      });

      if (statements.length === 0) {
        return;
      }

      const ddlBatch: D1PreparedStatementLike[] = [];
      for (const stmt of statements) {
        if (/^PRAGMA\b/i.test(stmt)) {
          try {
            await d1.prepare(stmt).run();
          } catch {
            // Some PRAGMA directives are unsupported or no-op in D1
          }
          continue;
        }
        ddlBatch.push(d1.prepare(stmt));
      }

      const chunkSize = 40;
      for (let i = 0; i < ddlBatch.length; i += chunkSize) {
        await d1.batch(ddlBatch.slice(i, i + chunkSize));
      }
    },
  };
}
