// D1 shim nad node:sqlite + shema iz PRAVE migracije (migrations/0001_init.sql).
// Obrazac: rodjendaonice/apps/marketplace/worker-tests/harness/d1.ts.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const SCHEMA = readFileSync(here("../../migrations/0001_init.sql"), "utf8");

// D1 ne prima `undefined` i booleane pretvara u 0/1; node:sqlite je stroži.
const norm = (b: unknown[]) =>
  b.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    return v;
  }) as never[];

export interface D1Meta { changes: number; last_row_id: number; duration: number }

class Stmt {
  db: DatabaseSync;
  sql: string;
  binds: unknown[];
  constructor(db: DatabaseSync, sql: string, binds: unknown[] = []) {
    this.db = db;
    this.sql = sql;
    this.binds = binds;
  }
  bind(...b: unknown[]): Stmt { return new Stmt(this.db, this.sql, b); }
  async first<T = Record<string, unknown>>(col?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...norm(this.binds)) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (col ? (row[col] as T) : (row as T));
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: D1Meta }> {
    const results = this.db.prepare(this.sql).all(...norm(this.binds)) as T[];
    return { results, success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
  }
  async run(): Promise<{ success: true; results: never[]; meta: D1Meta }> {
    const r = this.db.prepare(this.sql).run(...norm(this.binds));
    return {
      success: true,
      results: [],
      meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid), duration: 0 },
    };
  }
}

export class D1Shim {
  sqlite: DatabaseSync;
  constructor(sqlite: DatabaseSync) { this.sqlite = sqlite; }
  prepare(sql: string): Stmt { return new Stmt(this.sqlite, sql); }
  async batch<T = unknown>(stmts: Stmt[]): Promise<T[]> {
    this.sqlite.exec("BEGIN");
    try {
      const out: unknown[] = [];
      for (const s of stmts) out.push(await s.run());
      this.sqlite.exec("COMMIT");
      return out as T[];
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    }
  }
  async exec(sql: string) { this.sqlite.exec(sql); return { count: 0, duration: 0 }; }
}

export function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  return db;
}

export const one = <T = Record<string, unknown>>(db: DatabaseSync, sql: string, ...b: unknown[]): T =>
  db.prepare(sql).get(...norm(b)) as T;

export const rows = <T = Record<string, unknown>>(db: DatabaseSync, sql: string, ...b: unknown[]): T[] =>
  db.prepare(sql).all(...norm(b)) as T[];
