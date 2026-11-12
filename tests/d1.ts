// Minimal D1 stand-in on node:sqlite so the Worker code can run against real SQL in tests.
import { DatabaseSync } from 'node:sqlite';

class Stmt {
  args: unknown[] = [];
  constructor(private db: DatabaseSync, public sql: string) {}
  bind(...a: unknown[]) { this.args = a; return this; }
  private rows() { return this.db.prepare(this.sql).all(...(this.args as never[])) as Record<string, unknown>[]; }
  async all() { return { results: this.rows(), success: true, meta: {} }; }
  async first(col?: string) { const r = this.rows()[0]; return r ? (col ? r[col] : r) : null; }
  async run() { const r = this.db.prepare(this.sql).run(...(this.args as never[])); return { success: true, meta: { changes: r.changes } }; }
}

export function memoryD1(schema = ''): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  if (schema) db.exec(schema);
  return {
    raw: db,
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(list: Stmt[]) {
      db.exec('BEGIN');
      try { const out = []; for (const s of list) out.push(await s.run()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  } as unknown as D1Database & { raw: DatabaseSync };
}
