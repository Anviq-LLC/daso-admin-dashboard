// Copies the numbers of a month from the source databases into the dashboard's own facts and records every change.
import type { Env } from './auth.ts';
import { extract, parseRecords, type SourceRecord } from '../calc/extract.ts';
import { absenceFacts, hoursFacts, type Assignment, type Punch } from '../calc/plan.ts';
import { loadSettings } from './settings.ts';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const chunk = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

type Keyed = { day: string; report: string; cents: number; scope: string };

export async function refreshMonth(env: Env, month: string, reason = 'Neu berechnet') {
  if (!MONTH.test(month)) throw new Error('Ungültiger Monat.');
  const s = await loadSettings(env);
  const first = month + '-01', last = month + '-31';
  const [y, m] = month.split('-').map(Number);
  const lo = addDays(first, -2) + 'T00:00:00Z', hi = new Date(Date.UTC(y, m, 3)).toISOString();

  const [recs, res, ass, pun, aliasRows, oldEmp, oldSub] = await Promise.all([
    env.AUFMASS.prepare("SELECT id, kind, data FROM records WHERE kind = 'project' OR (kind = 'report' AND json_extract(data, '$.date') <= ? AND COALESCE(json_extract(data, '$.endDate'), json_extract(data, '$.date')) >= ?)")
      .bind(addDays(first, 110), addDays(first, -8)).all<SourceRecord>(),
    env.PLAN.prepare('SELECT id, name, role, kind, archived_at FROM resources').all<{ id: string; name: string; role: string; kind: string; archived_at: string | null }>(),
    env.PLAN.prepare('SELECT resource_id, project_id, day, assignment_type FROM assignments WHERE day >= ? AND day <= ?').bind(first, last).all<Assignment>(),
    env.PLAN.prepare('SELECT resource_id, project_id, started, ended, pause FROM punches WHERE started >= ? AND started <= ?').bind(lo, hi).all<Punch>(),
    env.DB.prepare('SELECT alias, canonical FROM sub_alias').all<{ alias: string; canonical: string }>(),
    env.DB.prepare('SELECT day, report_id, resource_id, customer_cents, binding FROM fact_emp WHERE month = ?').bind(month).all<{ day: string; report_id: string; resource_id: string; customer_cents: number; binding: number }>(),
    env.DB.prepare('SELECT day, report_id, team, customer_cents, binding FROM fact_sub WHERE month = ?').bind(month).all<{ day: string; report_id: string; team: string; customer_cents: number; binding: number }>(),
  ]);
  const aliases = Object.fromEntries(aliasRows.results.map((a) => [a.alias, a.canonical]));
  const x = extract(parseRecords(recs.results), month, { mode: s.approval, aliases });
  const hours = hoursFacts(pun.results, month), absence = absenceFacts(ass.results, month);

  // change log: the effective (binding) amount per key before and after
  const eff = (cents: number, binding: number | boolean) => (binding ? cents : 0);
  const before = new Map<string, Keyed>();
  for (const r of oldEmp.results) before.set(`e|${r.day}|${r.report_id}|${r.resource_id}`, { day: r.day, report: r.report_id, cents: eff(r.customer_cents, r.binding), scope: 'Mitarbeiter' });
  for (const r of oldSub.results) before.set(`s|${r.day}|${r.report_id}|${r.team}`, { day: r.day, report: r.report_id, cents: eff(r.customer_cents, r.binding), scope: 'Sub' });
  const after = new Map<string, Keyed>();
  for (const r of x.emp) after.set(`e|${r.day}|${r.reportId}|${r.resourceId}`, { day: r.day, report: r.reportId, cents: eff(r.customer, r.binding), scope: 'Mitarbeiter' });
  for (const r of x.sub) after.set(`s|${r.day}|${r.reportId}|${r.team}`, { day: r.day, report: r.reportId, cents: eff(r.customer, r.binding), scope: 'Sub' });
  const had = await env.DB.prepare('SELECT 1 AS n FROM settings WHERE key = ?').bind('ingested:' + month).first();
  const now = new Date().toISOString();
  const log: D1PreparedStatement[] = [];
  if (had) {
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const b = before.get(key), a = after.get(key);
      if ((b?.cents ?? 0) === (a?.cents ?? 0)) continue;
      const row = (a || b)!;
      log.push(env.DB.prepare('INSERT INTO change_log (id, at, month, day, scope, report_id, before_cents, after_cents, reason) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), now, month, row.day, row.scope, row.report, b?.cents ?? 0, a?.cents ?? 0, reason));
    }
  }

  const db = env.DB;
  const stmts: D1PreparedStatement[] = [
    db.prepare('DELETE FROM fact_emp WHERE month = ?').bind(month), db.prepare('DELETE FROM fact_sub WHERE month = ?').bind(month),
    db.prepare('DELETE FROM fact_hours WHERE month = ?').bind(month), db.prepare('DELETE FROM fact_absence WHERE month = ?').bind(month),
    db.prepare('DELETE FROM ingest_warning WHERE month = ?').bind(month),
    ...x.emp.map((r) => db.prepare('INSERT INTO fact_emp VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(month, r.day, r.resourceId, r.name, r.projectId, r.label, r.reportId, r.customer, r.employee, r.binding ? 1 : 0, r.estimated ? 1 : 0)),
    ...x.sub.map((r) => db.prepare('INSERT INTO fact_sub VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(month, r.day, r.projectId, r.label, r.firm, r.team, r.reportId, r.customer, r.cost, r.heads, r.minutes, r.binding ? 1 : 0, r.estimated ? 1 : 0)),
    ...hours.map((h) => db.prepare('INSERT INTO fact_hours VALUES (?,?,?,?,?,?,?)').bind(month, h.day, h.resourceId, h.projectId, h.minutes, h.travel ? 1 : 0, h.open ? 1 : 0)),
    ...absence.map((a) => db.prepare('INSERT INTO fact_absence VALUES (?,?,?,?,?)').bind(month, a.day, a.resourceId, a.kind, a.review ? 1 : 0)),
    ...x.warnings.map((w) => db.prepare('INSERT INTO ingest_warning VALUES (?,?)').bind(month, w)),
    ...res.results.map((r) => db.prepare('INSERT INTO dim_resource (id, name, role, kind, archived) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, kind = excluded.kind, archived = excluded.archived').bind(r.id, r.name, r.role, r.kind, r.archived_at ? 1 : 0)),
    ...[...new Map(x.emp.map((r) => [r.resourceId, r.code])).entries()].map(([id, code]) => db.prepare('UPDATE dim_resource SET code = ? WHERE id = ?').bind(code, id)),
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind('ingested:' + month, now),
    ...log,
  ];
  for (const part of chunk(stmts, 400)) await db.batch(part);
  return { month, emp: x.emp.length, sub: x.sub.length, hours: hours.length, absence: absence.length, changes: log.length, warnings: x.warnings.length };
}

// Months touched by a source record: report range, line service dates and timesheet days.
function monthsOf(data: string): string[] {
  const out = new Set<string>();
  const re = /"(?:date|endDate|serviceDate|anchorDate)":"(\d{4}-\d{2})-\d{2}/g;
  for (let m; (m = re.exec(data)); ) out.add(m[1]);
  return [...out];
}

// Cron entry: refresh the months touched by source records changed since the last run, and always the running month.
export async function refreshChanged(env: Env, today: string) {
  const cur = await env.DB.prepare("SELECT value FROM settings WHERE key = 'cursor'").first<{ value: string }>();
  const rows = await env.AUFMASS.prepare("SELECT id, kind, project_id, data, updated_at FROM records WHERE kind IN ('report','project') AND updated_at > ? ORDER BY updated_at LIMIT 500")
    .bind(cur?.value || '').all<{ id: string; kind: string; project_id: string; data: string; updated_at: string }>();
  const months = new Set<string>([today.slice(0, 7)]);
  const projects = new Set<string>();
  for (const r of rows.results) {
    if (r.kind === 'project') projects.add(r.id);
    else for (const mo of monthsOf(r.data)) months.add(mo);
  }
  for (const p of projects) {
    const rs = await env.AUFMASS.prepare("SELECT data FROM records WHERE kind = 'report' AND project_id = ?").bind(p).all<{ data: string }>();
    for (const r of rs.results) for (const mo of monthsOf(r.data)) months.add(mo);
  }
  const done = [];
  for (const mo of [...months].sort()) done.push(await refreshMonth(env, mo, 'Quelle geändert'));
  if (rows.results.length) {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(rows.results[rows.results.length - 1].updated_at).run();
  }
  return { months: done, seen: rows.results.length };
}

// Deleted reports leave no trace in the source, so all known months are recomputed from scratch now and then.
export async function reconcileAll(env: Env) {
  const rows = await env.DB.prepare("SELECT key FROM settings WHERE key LIKE 'ingested:%'").all<{ key: string }>();
  const done = [];
  for (const r of rows.results) done.push(await refreshMonth(env, r.key.slice(9), 'Abgleich: Quelle bereinigt'));
  return done;
}
