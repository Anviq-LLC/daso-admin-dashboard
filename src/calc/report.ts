// Builds the month report from stored facts. All money is integer cents.
import { absenceCredit, allocate, overheadShare, perHead, saturdayIndicator, weekdaysInMonth, type Target } from './rules.ts';
import type { AbsenceFact, HoursFact } from './plan.ts';

export type EmpRow = { day: string; resourceId: string; name: string; projectId: string; label: string; reportId: string; customer: number; employee: number; binding: boolean; estimated: boolean };
export type SubRow = { day: string; projectId: string; label: string; firm: string; team: string; reportId: string; customer: number; cost: number | null; heads: number | null; minutes: number | null; binding: boolean; estimated: boolean };
export type CostType = { id: string; name: string; category: string; monthly: number; validFrom: string; validTo: string | null };
export type CostEntry = { id: string; day: string; kind: 'sub' | 'alex' | 'other'; projectId: string; firm: string; subcategory: string; cents: number };
export type Wage = { resourceId: string; validFrom: string; hourly: number };
export type Resource = { id: string; name: string; code: string; archived: boolean };
export type Cfg = { target: Target; employerPct: number; defaultHourly: number; modelSaturdayBonus: boolean };

export type MonthInput = {
  month: string; emp: EmpRow[]; sub: SubRow[]; hours: HoursFact[]; absence: AbsenceFact[]; costTypes: CostType[]; entries: CostEntry[];
  wages: Wage[]; resources: Resource[]; holidays: ReadonlySet<string>; cfg: Cfg; showPersonnel: boolean;
};

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const dow = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay();
export const isWeekday = (d: string) => dow(d) >= 1 && dow(d) <= 5;
export const daysOf = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: new Date(Date.UTC(y, m, 0)).getUTCDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};

export function wageAt(wages: Wage[], id: string, day: string, fallback: number): number {
  let best: Wage | undefined;
  for (const w of wages) if (w.resourceId === id && w.validFrom <= day && (!best || w.validFrom > best.validFrom)) best = w;
  return best ? best.hourly : fallback;
}

export function costActive(c: CostType, month: string): boolean {
  const first = month + '-01', last = month + '-31';
  return c.validFrom <= last && (!c.validTo || c.validTo >= first);
}

export function buildMonth(i: MonthInput) {
  const { month, cfg } = i;
  const [y, m] = month.split('-').map(Number);
  const days = daysOf(month);
  const warnings: string[] = [];

  const ownB = i.emp.filter((r) => r.binding), subB = i.sub.filter((r) => r.binding);
  const ownRev = sum(ownB.map((r) => r.customer)), subRev = sum(subB.map((r) => r.customer));
  const pipelineOwn = sum(i.emp.filter((r) => !r.binding).map((r) => r.customer));
  const pipelineSub = sum(i.sub.filter((r) => !r.binding).map((r) => r.customer));

  // productive people per day: own people with approved revenue or work hours, plus the largest head count per sub team
  const ownHeads = new Map<string, Set<string>>();
  for (const r of ownB) if (r.customer > 0) (ownHeads.get(r.day) || ownHeads.set(r.day, new Set()).get(r.day)!).add(r.resourceId);
  for (const h of i.hours) if (h.minutes > 0 && !h.travel) (ownHeads.get(h.day) || ownHeads.set(h.day, new Set()).get(h.day)!).add(h.resourceId);
  const subHeads = new Map<string, Map<string, number>>();
  for (const r of subB) {
    if (!r.heads) continue;
    const mp = subHeads.get(r.day) || subHeads.set(r.day, new Map()).get(r.day)!;
    const k = `${r.projectId}|${r.firm}|${r.team}`;
    mp.set(k, Math.max(mp.get(k) || 0, r.heads));
  }
  const dayTarget = absenceCredit(cfg.target, y, m, 1);
  const daily = days.map((d) => {
    const own = sum(ownB.filter((r) => r.day === d).map((r) => r.customer));
    const sb = sum(subB.filter((r) => r.day === d).map((r) => r.customer));
    const heads = (ownHeads.get(d)?.size || 0) + sum([...(subHeads.get(d)?.values() || [])]);
    return { day: d, own, sub: sb, total: own + sb, heads, perHead: perHead(own + sb, heads), target: isWeekday(d) ? dayTarget : null };
  });

  // absence credit: one per person and day, Mon-Fri only, holidays count; days with parallel revenue or hours need a decision
  const productiveOn = new Set<string>([
    ...ownB.filter((r) => r.customer > 0).map((r) => r.resourceId + '|' + r.day),
    ...i.hours.filter((h) => h.minutes > 0 && !h.travel).map((h) => h.resourceId + '|' + h.day),
  ]);
  const people = i.resources.filter((r) => !r.archived);
  const credit = new Map<string, { days: number; review: string[]; kinds: Record<string, number> }>();
  const mark = (id: string, day: string, kind: string, review: boolean) => {
    const c = credit.get(id) || credit.set(id, { days: 0, review: [], kinds: {} }).get(id)!;
    if (review || productiveOn.has(id + '|' + day)) { c.review.push(day); return; }
    c.days++; c.kinds[kind] = (c.kinds[kind] || 0) + 1;
  };
  const seen = new Set<string>();
  for (const a of i.absence) {
    if (!isWeekday(a.day)) continue;
    seen.add(a.resourceId + '|' + a.day);
    mark(a.resourceId, a.day, a.kind, a.review);
  }
  for (const d of days) if (i.holidays.has(d) && isWeekday(d)) {
    for (const p of people) if (!seen.has(p.id + '|' + d)) mark(p.id, d, 'holiday', false);
  }

  // employee table
  const ids = new Set<string>([...i.emp.map((r) => r.resourceId), ...i.hours.map((h) => h.resourceId), ...credit.keys()]);
  const named = new Map(i.resources.map((r) => [r.id, r]));
  const empName = new Map(i.emp.map((r) => [r.resourceId, r.name]));
  const employees = [...ids].map((id) => {
    const rows = ownB.filter((r) => r.resourceId === id);
    const real = sum(rows.map((r) => r.employee)), customer = sum(rows.map((r) => r.customer));
    const sat = sum(rows.filter((r) => dow(r.day) === 6).map((r) => r.customer));
    const c = credit.get(id);
    const fiction = c ? absenceCredit(cfg.target, y, m, c.days) : 0;
    const minutes = sum(i.hours.filter((h) => h.resourceId === id && !h.travel).map((h) => h.minutes));
    return {
      id, name: named.get(id)?.name || empName.get(id) || id, code: named.get(id)?.code || '',
      real, customer, fiction, valuation: real + fiction, saturdayCustomer: sat, saturdayIndicator: saturdayIndicator(sat),
      workMinutes: minutes, absenceDays: c?.days || 0, absenceKinds: c?.kinds || {}, reviewDays: c?.review || [],
      pipeline: sum(i.emp.filter((r) => !r.binding && r.resourceId === id).map((r) => r.employee)),
      perDay: Object.fromEntries(days.map((d) => [d as string, {
        real: sum(rows.filter((r) => r.day === d).map((r) => r.employee)),
        minutes: sum(i.hours.filter((h) => h.resourceId === id && h.day === d && !h.travel).map((h) => h.minutes)),
        sites: [...new Set(i.hours.filter((h) => h.resourceId === id && h.day === d && h.projectId).map((h) => h.projectId))].length,
        absence: i.absence.find((a) => a.resourceId === id && a.day === d)?.kind || (i.holidays.has(d) && isWeekday(d) ? 'holiday' : ''),
      }] as const).filter(([, v]) => v.real || v.minutes || v.absence)),
    };
  }).sort((a, b) => b.real - a.real);
  if (employees.some((e) => e.reviewDays.length)) warnings.push('Abwesenheit mit gleichzeitigem Umsatz oder Stunden: nicht bewertet, bitte prüfen.');
  if (i.hours.some((h) => h.open)) warnings.push('Offene Stempelungen sind nicht in den Stunden enthalten.');

  // personnel: hours x wage + surcharge, paid absence at 8 h. Always an estimate.
  const wage = (id: string, d: string) => wageAt(i.wages, id, d, cfg.defaultHourly) * (1 + cfg.employerPct / 100);
  const hoursByProject = new Map<string, number>();
  let personnel = 0;
  for (const h of i.hours) {
    if (h.travel || h.minutes <= 0) continue;
    const cost = Math.round((h.minutes / 60) * wage(h.resourceId, h.day));
    personnel += cost;
    hoursByProject.set(h.projectId, (hoursByProject.get(h.projectId) || 0) + cost);
  }
  for (const [id, c] of credit) personnel += Math.round((c.days - (c.kinds.unpaid || 0)) * 8 * wage(id, month + '-15'));
  const bonusModel = cfg.modelSaturdayBonus ? sum(employees.map((e) => e.saturdayIndicator)) : 0;
  personnel += bonusModel;

  // fixed overhead and central entries
  const fixed = i.costTypes.filter((c) => costActive(c, month));
  const fixedTotal = sum(fixed.map((c) => c.monthly));
  const central = i.entries.filter((e) => !e.projectId && e.kind !== 'sub');
  const centralTotal = sum(central.map((e) => e.cents));
  const subCentral = sum(i.entries.filter((e) => !e.projectId && e.kind === 'sub').map((e) => e.cents));
  const overhead = fixedTotal + centralTotal + subCentral;

  // projects
  const keys = new Map<string, string>();
  for (const r of [...i.emp, ...i.sub]) keys.set(r.projectId, r.label);
  for (const e of i.entries) if (e.projectId && !keys.has(e.projectId)) keys.set(e.projectId, e.projectId);
  const projects = [...keys].map(([id, label]) => {
    const own = sum(ownB.filter((r) => r.projectId === id).map((r) => r.customer));
    const sb = sum(subB.filter((r) => r.projectId === id).map((r) => r.customer));
    const derived = subB.filter((r) => r.projectId === id);
    const derivedCost = sum(derived.map((r) => r.cost ?? 0)), missingCost = derived.some((r) => r.cost === null);
    const manualSub = sum(i.entries.filter((e) => e.projectId === id && e.kind === 'sub').map((e) => e.cents));
    const subCost = manualSub > 0 ? manualSub : derivedCost;
    const other = sum(i.entries.filter((e) => e.projectId === id && e.kind !== 'sub').map((e) => e.cents));
    const people = hoursByProject.get(id) || 0;
    const revenue = own + sb;
    const direct = subCost + other + (i.showPersonnel ? people : 0);
    return { id, label, ownRevenue: own, subRevenue: sb, revenue, subCost, subCostSource: manualSub > 0 ? 'manuell' : 'Aufmaß', subCostMissing: manualSub === 0 && missingCost, other, personnelEstimate: people, direct, before: revenue - direct, overhead: 0 as number | null, after: 0 as number | null };
  }).sort((a, b) => b.revenue - a.revenue);
  const totalRev = sum(projects.map((p) => p.revenue));
  if (totalRev <= 0) {
    for (const p of projects) { p.overhead = null; p.after = null; }
    if (overhead > 0) warnings.push('Gesamtumsatz 0: Gemeinkosten werden nicht auf Projekte verteilt.');
  } else {
    const shares = allocate(overhead, projects.map((p) => p.revenue));
    projects.forEach((p, k) => { p.overhead = shares[k]; p.after = p.before - shares[k]; });
  }
  if (projects.some((p) => p.subCostMissing)) warnings.push('Sub-Kosten unvollständig (Stunden fehlen im Aufmaß): nicht als 0 gerechnet.');

  // subs by firm
  const firms = new Map<string, SubRow[]>();
  for (const r of subB) (firms.get(r.firm) || firms.set(r.firm, []).get(r.firm)!).push(r);
  const subs = [...firms].map(([firm, rows]) => {
    const personDays = sum([...new Set(rows.map((r) => r.day))].map((d) => sum([...rowsHeads(rows.filter((r) => r.day === d)).values()])));
    const revenue = sum(rows.map((r) => r.customer));
    const projs = [...new Set(rows.map((r) => r.projectId))];
    const cost = sum(projs.map((id) => projects.find((p) => p.id === id)?.subCost ?? 0));
    return { firm, revenue, cost, profit: revenue - cost, personDays, perPersonDay: perHead(revenue, personDays), days: new Set(rows.map((r) => r.day)).size, projects: projs.length };
  }).sort((a, b) => b.revenue - a.revenue);

  const subDays = [...new Map(subB.map((r) => [`${r.firm}|${r.projectId}|${r.team}|${r.day}`, r])).keys()].map((k) => {
    const rows = subB.filter((r) => `${r.firm}|${r.projectId}|${r.team}|${r.day}` === k);
    const r0 = rows[0];
    return { firm: r0.firm, projectId: r0.projectId, project: r0.label, team: r0.team, day: r0.day, revenue: sum(rows.map((r) => r.customer)), cost: rows.some((r) => r.cost === null) ? null : sum(rows.map((r) => r.cost ?? 0)), heads: Math.max(...rows.map((r) => r.heads || 0)) || null, perHead: perHead(sum(rows.map((r) => r.customer)), Math.max(...rows.map((r) => r.heads || 0)) || null), estimated: rows.some((r) => r.estimated) };
  }).sort((a, b) => a.firm.localeCompare(b.firm) || a.day.localeCompare(b.day));
  const direct = sum(projects.map((p) => p.subCost + p.other));
  const revenue = ownRev + subRev;
  const personnelShown = i.showPersonnel ? personnel : null;
  const profit = i.showPersonnel ? revenue - direct - overhead - personnel : null;
  return {
    month, revenue, ownRevenue: ownRev, subRevenue: subRev, ownEmployeeValue: sum(ownB.map((r) => r.employee)),
    pipeline: { own: pipelineOwn, sub: pipelineSub, total: pipelineOwn + pipelineSub },
    dayTarget, weekdays: weekdaysInMonth(y, m), daily, employees, projects, subs, subDays,
    costs: { fixed: fixed.map((c) => ({ id: c.id, name: c.name, category: c.category, monthly: c.monthly })), fixedTotal, central: centralTotal + subCentral, directProject: direct, overhead, personnel: personnelShown, saturdayBonusModel: i.showPersonnel ? bonusModel : null },
    profit, estimatePersonnel: true, warnings,
  };
}

function rowsHeads(rows: SubRow[]): Map<string, number> {
  const mp = new Map<string, number>();
  for (const r of rows) mp.set(`${r.projectId}|${r.team}`, Math.max(mp.get(`${r.projectId}|${r.team}`) || 0, r.heads || 0));
  return mp;
}

export type MonthReport = ReturnType<typeof buildMonth>;
