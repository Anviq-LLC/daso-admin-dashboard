// Loads stored facts and assembles month and year reports.
import type { Env, Identity } from './auth.ts';
import { can } from './auth.ts';
import { buildMonth, daysOf, type CostEntry, type CostType, type Wage } from '../calc/report.ts';
import { forecastMonth, forecastYear } from '../calc/forecast.ts';
import { holidaySet, loadSettings, targetFor, type Settings } from './settings.ts';

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');
export const berlinToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());

type Facts = Awaited<ReturnType<typeof loadFacts>>;

export async function loadFacts(env: Env, months: string[]) {
  const q = placeholders(months.length);
  const all = <T>(sql: string, ...extra: unknown[]) => env.DB.prepare(sql).bind(...months, ...extra).all<T>().then((r) => r.results);
  const lo = months[0] + '-01', hi = months[months.length - 1] + '-31';
  const [emp, sub, hours, absence, warn, costTypes, entries, wages, resources] = await Promise.all([
    all<{ month: string; day: string; resource_id: string; name: string; project_id: string; label: string; report_id: string; customer_cents: number; employee_cents: number; binding: number; estimated: number }>(`SELECT * FROM fact_emp WHERE month IN (${q})`),
    all<{ month: string; day: string; project_id: string; label: string; firm: string; team: string; report_id: string; customer_cents: number; cost_cents: number | null; heads: number | null; hours_minutes: number | null; binding: number; estimated: number }>(`SELECT * FROM fact_sub WHERE month IN (${q})`),
    all<{ month: string; day: string; resource_id: string; project_id: string; minutes: number; travel: number; open_shift: number }>(`SELECT * FROM fact_hours WHERE month IN (${q})`),
    all<{ month: string; day: string; resource_id: string; kind: string; review: number }>(`SELECT * FROM fact_absence WHERE month IN (${q})`),
    all<{ month: string; text: string }>(`SELECT * FROM ingest_warning WHERE month IN (${q})`),
    env.DB.prepare('SELECT id, name, category, monthly_cents, valid_from, valid_to FROM cost_type').all<{ id: string; name: string; category: string; monthly_cents: number; valid_from: string; valid_to: string | null }>().then((r) => r.results),
    env.DB.prepare('SELECT id, day, kind, project_id, firm, subcategory, cents FROM cost_entry WHERE day >= ? AND day <= ?').bind(lo, hi).all<{ id: string; day: string; kind: 'sub' | 'alex' | 'other'; project_id: string; firm: string; subcategory: string; cents: number }>().then((r) => r.results),
    env.DB.prepare('SELECT resource_id, valid_from, hourly_cents FROM wage').all<{ resource_id: string; valid_from: string; hourly_cents: number }>().then((r) => r.results),
    env.DB.prepare("SELECT id, name, code, archived FROM dim_resource WHERE kind = 'employee'").all<{ id: string; name: string; code: string; archived: number }>().then((r) => r.results),
  ]);
  return { emp, sub, hours, absence, warn, costTypes, entries, wages, resources };
}

function monthInput(f: Facts, month: string, s: Settings, showPersonnel: boolean) {
  return {
    month,
    emp: f.emp.filter((r) => r.month === month).map((r) => ({ day: r.day, resourceId: r.resource_id, name: r.name, projectId: r.project_id, label: r.label, reportId: r.report_id, customer: r.customer_cents, employee: r.employee_cents, binding: !!r.binding, estimated: !!r.estimated })),
    sub: f.sub.filter((r) => r.month === month).map((r) => ({ day: r.day, projectId: r.project_id, label: r.label, firm: r.firm, team: r.team, reportId: r.report_id, customer: r.customer_cents, cost: r.cost_cents, heads: r.heads, minutes: r.hours_minutes, binding: !!r.binding, estimated: !!r.estimated })),
    hours: f.hours.filter((r) => r.month === month).map((r) => ({ day: r.day, resourceId: r.resource_id, projectId: r.project_id, minutes: r.minutes, travel: !!r.travel, open: !!r.open_shift })),
    absence: f.absence.filter((r) => r.month === month).map((r) => ({ day: r.day, resourceId: r.resource_id, kind: r.kind, review: !!r.review })),
    costTypes: f.costTypes.map((c): CostType => ({ id: c.id, name: c.name, category: c.category, monthly: c.monthly_cents, validFrom: c.valid_from, validTo: c.valid_to })),
    entries: f.entries.filter((e) => e.day.startsWith(month)).map((e): CostEntry => ({ id: e.id, day: e.day, kind: e.kind, projectId: e.project_id, firm: e.firm, subcategory: e.subcategory, cents: e.cents })),
    wages: f.wages.map((w): Wage => ({ resourceId: w.resource_id, validFrom: w.valid_from, hourly: w.hourly_cents })),
    resources: f.resources.map((r) => ({ id: r.id, name: r.name, code: r.code, archived: !!r.archived })),
    holidays: holidaySet(s, Number(month.slice(0, 4))),
    cfg: { target: targetFor(s, month), employerPct: s.employerPct, defaultHourly: s.defaultHourly, modelSaturdayBonus: s.modelSaturdayBonus },
    showPersonnel,
  };
}

// asOf = last day that counts as actual for the forecast of this month.
function asOfFor(month: string, today: string): string | null {
  const cur = today.slice(0, 7);
  if (month < cur) return daysOf(month).at(-1)!;
  if (month === cur) return today;
  return null;
}

export async function monthReport(env: Env, who: Identity, month: string) {
  const s = await loadSettings(env);
  const f = await loadFacts(env, [month]);
  const report = buildMonth(monthInput(f, month, s, can.personnel(who)));
  const today = berlinToday();
  const asOf = asOfFor(month, today);
  const byDay = Object.fromEntries(report.daily.map((d) => [d.day, d.total]));
  const forecast = asOf ? forecastMonth({ month, asOf, revenueByDay: byDay, holidays: holidaySet(s, Number(month.slice(0, 4))), saturdayCents: s.saturdayForecastCents }) : null;
  let costForecast: number | null = null;
  if (forecast && report.revenue > 0 && report.profit !== null) {
    const variable = report.costs.directProject + (report.costs.personnel ?? 0);
    costForecast = report.costs.fixedTotal + report.costs.central + Math.round((variable / report.revenue) * forecast.forecast);
  }
  const ingested = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('ingested:' + month).first<{ value: string }>();
  return {
    ...report, forecast, costForecast, ingestWarnings: f.warn.map((w) => w.text), lastIngest: ingested?.value || null,
    approval: s.approval, dataDate: berlinToday(),
  };
}

export async function yearReport(env: Env, who: Identity, year: number) {
  const s = await loadSettings(env);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const f = await loadFacts(env, months);
  const show = can.personnel(who);
  const reports = months.map((m) => buildMonth(monthInput(f, m, s, show)));
  const today = berlinToday();
  const revenue = Object.fromEntries(reports.map((r) => [r.month, r.revenue]));
  const cur = today.slice(0, 7);
  const idx = months.indexOf(cur);
  let running = 0;
  if (idx >= 0) {
    const fc = forecastMonth({ month: cur, asOf: today, revenueByDay: Object.fromEntries(reports[idx].daily.map((d) => [d.day, d.total])), holidays: holidaySet(s, year), saturdayCents: s.saturdayForecastCents });
    running = fc.forecast;
  }
  const hasData = new Set(months.filter((m) => f.emp.some((r) => r.month === m) || f.sub.some((r) => r.month === m) || f.hours.some((r) => r.month === m)));
  const fy = forecastYear(year, today, revenue, running, hasData);

  const empMap = new Map<string, { id: string; name: string; real: number; fiction: number; valuation: number }>();
  const projMap = new Map<string, { id: string; label: string; revenue: number; before: number; after: number | null }>();
  const subMap = new Map<string, { firm: string; revenue: number; cost: number; profit: number; personDays: number }>();
  for (const r of reports) {
    for (const e of r.employees) {
      const o = empMap.get(e.id) || { id: e.id, name: e.name, real: 0, fiction: 0, valuation: 0 };
      o.real += e.real; o.fiction += e.fiction; o.valuation += e.valuation; empMap.set(e.id, o);
    }
    for (const p of r.projects) {
      const o = projMap.get(p.id) || { id: p.id, label: p.label, revenue: 0, before: 0, after: 0 as number | null };
      o.revenue += p.revenue; o.before += p.before; o.after = o.after === null || p.after === null ? null : o.after + p.after; projMap.set(p.id, o);
    }
    for (const sb of r.subs) {
      const o = subMap.get(sb.firm) || { firm: sb.firm, revenue: 0, cost: 0, profit: 0, personDays: 0 };
      o.revenue += sb.revenue; o.cost += sb.cost; o.profit += sb.profit; o.personDays += sb.personDays; subMap.set(sb.firm, o);
    }
  }
  const projects = [...projMap.values()].sort((a, b) => b.before - a.before);
  return {
    year, months: reports.map((r) => {
      const d = hasData.has(r.month);
      return { month: r.month, hasData: d, revenue: r.revenue, own: r.ownRevenue, sub: r.subRevenue, pipeline: r.pipeline.total, overhead: d ? r.costs.overhead : null, directProject: d ? r.costs.directProject : null, personnel: d ? r.costs.personnel : null, profit: d ? r.profit : null };
    }),
    forecast: fy,
    employees: [...empMap.values()].sort((a, b) => b.real - a.real),
    subs: [...subMap.values()].sort((a, b) => b.revenue - a.revenue),
    projectsTop: projects.slice(0, 5), projectsFlop: projects.slice(-5).reverse(),
    totals: { revenue: reports.reduce((a, r) => a + r.revenue, 0), profit: show ? reports.filter((r) => hasData.has(r.month)).reduce((a, r) => a + (r.profit ?? 0), 0) : null },
  };
}
