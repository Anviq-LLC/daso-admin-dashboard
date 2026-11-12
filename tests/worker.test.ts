import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryD1 } from './d1.ts';
import { refreshMonth, refreshChanged } from '../src/worker/ingest.ts';
import { monthReport } from '../src/worker/data.ts';
import { readOnly, type Env, type Identity } from '../src/worker/auth.ts';

const gf: Identity = { email: 'gf@test', role: 'gf', sensitive: true };
const viewer: Identity = { email: 'v@test', role: 'viewer', sensitive: false };

function setup() {
  const DB = memoryD1(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  const AUFMASS = memoryD1('CREATE TABLE records (id TEXT PRIMARY KEY, kind TEXT, project_id TEXT, data TEXT, updated_at TEXT)');
  const PLAN = memoryD1(`
    CREATE TABLE resources (id TEXT, name TEXT, role TEXT, kind TEXT, archived_at TEXT);
    CREATE TABLE assignments (resource_id TEXT, project_id TEXT, day TEXT, assignment_type TEXT);
    CREATE TABLE punches (resource_id TEXT, project_id TEXT, started TEXT, ended TEXT, pause INTEGER);
    INSERT INTO resources VALUES ('r1','Anna Bau','Monteur','employee',NULL);`);
  const env = { DB, AUFMASS: readOnly(AUFMASS), PLAN: readOnly(PLAN) } as unknown as Env;
  return { env, DB, AUFMASS, PLAN };
}

const project = { id: 'p1', planId: 'plan-p1', number: '100', name: 'Halle', factor: 0.9, employees: [{ id: 'e1', planId: 'r1', firstName: 'Anna', lastName: 'Bau', code: 'AB' }] };
const line = (q: number) => ({ id: 'l', positionId: 'x', number: '1', description: 'x', unit: 'm', price: 100_000, employeePrice: 90_000, quantity: q, remark: '' });
const report = (id: string, date: string, state: string) => ({
  id, projectId: 'p1', date, endDate: date, state, team: 'T', area: '', note: '', createdAt: '', updatedAt: '', lines: [line(2)],
  employeeMembers: [{ employeeId: 'e1', name: 'Anna Bau', code: 'AB', trial: false }],
});
const put = (db: ReturnType<typeof memoryD1>, kind: string, o: { id: string }, at: string) =>
  db.raw.prepare('INSERT OR REPLACE INTO records VALUES (?,?,?,?,?)').run(o.id, kind, 'p1', JSON.stringify(o), at);

test('ingest writes facts and the month report matches the spec numbers', async () => {
  const { env, AUFMASS, PLAN } = setup();
  put(AUFMASS, 'project', project, '2026-03-01T00:00:00Z');
  put(AUFMASS, 'report', report('rep1', '2026-03-10', 'ready'), '2026-03-10T00:00:00Z');
  PLAN.raw.exec("INSERT INTO assignments VALUES ('r1', NULL, '2026-03-02', 'vacation'), ('r1', NULL, '2026-03-03', 'sick')");
  PLAN.raw.exec("INSERT INTO punches VALUES ('r1','plan-p1','2026-03-10T06:00:00Z','2026-03-10T14:30:00Z',30)");
  const res = await refreshMonth(env, '2026-03');
  assert.equal(res.emp, 1);
  const r = await monthReport(env, gf, '2026-03');
  assert.equal(r.ownRevenue, 200_000);
  assert.equal(r.ownEmployeeValue, 180_000);
  assert.equal(r.revenue, 200_000);
  assert.equal(r.employees[0].fiction, 72_727);
  assert.equal(r.employees[0].workMinutes, 480);
  assert.equal(r.employees[0].code, 'AB');
});

test('retroactive approval: a draft becomes ready later and the old month changes with a log entry', async () => {
  const { env, AUFMASS } = setup();
  put(AUFMASS, 'project', project, '2026-01-01T00:00:00Z');
  put(AUFMASS, 'report', report('late', '2026-01-14', 'draft'), '2026-01-14T00:00:00Z');
  await refreshMonth(env, '2026-01');
  assert.equal((await monthReport(env, gf, '2026-01')).revenue, 0);
  assert.equal((await monthReport(env, gf, '2026-01')).pipeline.total, 200_000);

  put(AUFMASS, 'report', report('late', '2026-01-14', 'ready'), '2026-02-20T00:00:00Z');
  const done = await refreshChanged(env, '2026-02-20');
  assert.ok(done.months.some((m) => m.month === '2026-01'));
  const jan = await monthReport(env, gf, '2026-01');
  assert.equal(jan.revenue, 200_000);
  const changes = await env.DB.prepare("SELECT before_cents, after_cents FROM change_log WHERE month = '2026-01'").all<{ before_cents: number; after_cents: number }>();
  assert.deepEqual(changes.results.map((r) => ({ ...r })), [{ before_cents: 0, after_cents: 200_000 }]);
});

test('re-running without source changes adds no log entries', async () => {
  const { env, AUFMASS } = setup();
  put(AUFMASS, 'project', project, '2026-01-01T00:00:00Z');
  put(AUFMASS, 'report', report('a', '2026-03-10', 'ready'), '2026-03-10T00:00:00Z');
  await refreshMonth(env, '2026-03');
  await refreshMonth(env, '2026-03');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM change_log').first<{ n: number }>())!.n, 0);
});

test('a deleted source report disappears at the next reconcile and is logged', async () => {
  const { env, AUFMASS } = setup();
  put(AUFMASS, 'project', project, '2026-01-01T00:00:00Z');
  put(AUFMASS, 'report', report('gone', '2026-03-10', 'ready'), '2026-03-10T00:00:00Z');
  await refreshMonth(env, '2026-03');
  AUFMASS.raw.exec("DELETE FROM records WHERE id = 'gone'");
  await refreshMonth(env, '2026-03', 'Abgleich');
  assert.equal((await monthReport(env, gf, '2026-03')).revenue, 0);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM change_log').first<{ n: number }>())!.n, 1);
});

test('personnel figures are hidden without permission', async () => {
  const { env, AUFMASS } = setup();
  put(AUFMASS, 'project', project, '2026-01-01T00:00:00Z');
  put(AUFMASS, 'report', report('a', '2026-03-10', 'ready'), '2026-03-10T00:00:00Z');
  await refreshMonth(env, '2026-03');
  const r = await monthReport(env, viewer, '2026-03');
  assert.equal(r.profit, null);
  assert.equal(r.costs.personnel, null);
});

test('the source databases cannot be written through the wrapper', () => {
  const { env } = setup();
  assert.throws(() => env.AUFMASS.prepare('DELETE FROM records'));
  assert.throws(() => env.PLAN.prepare('SELECT 1; DROP TABLE resources'));
});
