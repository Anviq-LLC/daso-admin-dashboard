// Turns Aufmass records into revenue facts per service day. Revenue is counted once per report slice;
// the 90 percent employee value is only a second view of the same customer revenue, never added on top.
import { crewReports, employeeShares, normalizeFinancialData, reportCost, reportTotals } from '../vendor/aufmass/business.ts';
import { isTimeReport, reportDays, timePricingComplete } from '../vendor/aufmass/time-reports.ts';
import type { Data, Line, Project, Report } from '../vendor/aufmass/types.ts';
import { allocate, employeeDayRevenue, isBinding, serviceDays, type ApprovalMode } from './rules.ts';

export type SourceRecord = { id: string; kind: string; data: string };
export type EmpFact = {
  day: string; resourceId: string; name: string; code: string; projectId: string; label: string; reportId: string;
  customer: number; employee: number; binding: boolean; estimated: boolean;
};
export type SubFact = {
  day: string; projectId: string; label: string; firm: string; team: string; reportId: string; customer: number;
  cost: number | null; heads: number | null; minutes: number | null; binding: boolean; estimated: boolean;
};
export type Extract = { emp: EmpFact[]; sub: SubFact[]; warnings: string[] };

export function parseRecords(rows: SourceRecord[]): Data {
  const data = { projects: [], positions: [], reports: [], files: [], audit: [] } as unknown as Data;
  for (const r of rows) {
    try {
      if (r.kind === 'project') data.projects.push(JSON.parse(r.data));
      else if (r.kind === 'report') data.reports.push(JSON.parse(r.data));
    } catch { /* a broken record is skipped */ }
  }
  return normalizeFinancialData(data);
}

// Lines with their own service date become single-day reports, the rest keeps the report range.
function dayReports(r: Report): Report[] {
  if (isTimeReport(r)) return reportDays(r);
  if (!r.lines.some((l) => l.serviceDate)) return [r];
  const groups = new Map<string, Line[]>();
  for (const l of r.lines) {
    const d = (l.serviceDate || '').slice(0, 10);
    (groups.get(d) || groups.set(d, []).get(d)!).push(l);
  }
  return [...groups].map(([d, lines]) => (d ? { ...r, date: d, endDate: d, lines } : { ...r, lines }));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function extract(
  data: Data, month: string, opts: { mode?: ApprovalMode; aliases?: Record<string, string> } = {},
): Extract {
  const out: Extract = { emp: [], sub: [], warnings: [] };
  const mode = opts.mode ?? 'saved';
  const projects = new Map<string, Project>(data.projects.map((p) => [p.id, p]));
  const planOf = new Map<string, string>();
  for (const p of data.projects) for (const e of p.employees || []) {
    if (!e.planId) continue;
    planOf.set(e.id, e.planId);
    for (const old of e.legacyIds || []) planOf.set(old, e.planId);
  }
  const firmName = (raw: string) => opts.aliases?.[norm(raw)] || raw.trim();
  const unlinked = new Set<string>();

  for (const report of data.reports) {
    const proj = projects.get(report.projectId);
    if (!proj) continue;
    const factor = proj.factor ?? 0.9;
    const label = `${proj.number} ${proj.name}`.trim();
    const projectId = proj.planId || proj.id;
    const binding = isBinding({ state: report.state, review: (report as never as { review?: string }).review, stage: (report as never as { stage?: string }).stage }, mode);

    for (const dr of dayReports(report)) {
      const days = isTimeReport(report) ? [(dr.date || '').slice(0, 10)] : serviceDays((dr.date || '').slice(0, 10), (dr.endDate || dr.date || '').slice(0, 10));
      if (!days.some((d) => d.startsWith(month))) continue;
      const estimated = days.length > 1;

      for (const slice of crewReports(dr, factor)) {
        const totals = reportTotals([slice], factor);
        const work = slice.teamWork;
        if (work) {
          const rate = work.hourlyRate ?? 0;
          const hoursOn = (d: string) => work.workers.reduce((s, w) => s + (days.length > 1 ? (w.dailyHours?.[d] ?? 0) : (w.hours ?? w.dailyHours?.[d] ?? 0)), 0);
          const weights = days.length > 1 ? days.map((d) => hoursOn(d) * rate) : [1];
          const cost = reportCost(slice);
          const customer = allocate(totals.customer, weights);
          const costs = cost === null ? null : allocate(cost, weights);
          days.forEach((d, i) => {
            if (!d.startsWith(month)) return;
            const heads = work.workers.filter((w) => (days.length > 1 ? (w.dailyHours?.[d] ?? 0) : (w.hours ?? 1)) > 0).length;
            out.sub.push({
              day: d, projectId, label, firm: firmName(work.company), team: work.code, reportId: report.id,
              customer: customer[i], cost: costs ? costs[i] : null, heads: heads || null,
              minutes: Math.round(hoursOn(d) * 60) || null, binding, estimated,
            });
          });
          continue;
        }
        const members = slice.employeeMembers || [];
        if (!members.length) { out.warnings.push(`${label} ${days[0]}: Aufmaß ohne Mitarbeiter, kein Umsatz zugeordnet.`); continue; }
        if (!timePricingComplete(slice)) { out.warnings.push(`${label} ${days[0]}: Preise unvollständig.`); continue; }
        const shares = employeeShares(slice, factor);
        const customer = allocate(totals.customer, shares.map((s) => s.employee));
        shares.forEach((s, i) => {
          const rid = planOf.get(s.employeeId);
          if (!rid) unlinked.add(s.name);
          const emp = employeeDayRevenue(s.employee, days.length), cus = employeeDayRevenue(customer[i], days.length);
          days.forEach((d, k) => {
            if (!d.startsWith(month)) return;
            out.emp.push({
              day: d, resourceId: rid || `aufmass:${s.employeeId}`, name: s.name, code: s.code, projectId, label, reportId: report.id,
              customer: cus[k], employee: emp[k], binding, estimated,
            });
          });
        });
      }
    }
  }
  for (const n of unlinked) out.warnings.push(`${n} ist im Aufmaßtool nicht mit der Montageplanung verknüpft.`);
  return out;
}
