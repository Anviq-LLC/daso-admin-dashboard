// Money is integer cents. Ratios are applied once and rounded once.

export function weekdaysInMonth(year: number, month: number): number {
  let n = 0;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = 1; d <= days; d++) {
    const wd = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

export type Target = { dailyCents: number; referenceDays: number };
export const DEFAULT_TARGET: Target = { dailyCents: 40_000, referenceDays: 20 };

// Fictive credit for excused Mon-Fri days: base x reference days / weekdays of the month, per day.
export function absenceCredit(t: Target, year: number, month: number, days: number): number {
  return Math.round((t.dailyCents * t.referenceDays * days) / weekdaysInMonth(year, month));
}

export const employeeValue = (customerCents: number, factor = 0.9) => Math.round(customerCents * factor);
export const saturdayIndicator = (customerCents: number) => Math.round(customerCents * 0.9 * 0.4);

// Unknown or zero head count yields no figure, never 0.
export function perHead(revenueCents: number, heads: number | null | undefined): number | null {
  return heads && heads > 0 ? Math.round(revenueCents / heads) : null;
}

// Overhead is split by approved revenue share; null means "no total, show a warning".
export function overheadShare(projectRevenue: number, totalRevenue: number, overhead: number): number | null {
  return totalRevenue > 0 ? Math.round((overhead * projectRevenue) / totalRevenue) : null;
}

export type ReportStatus = { state: string; review?: string; stage?: string };
export type ApprovalMode = 'saved' | 'customer';
const APPROVED = new Set(['approved', 'approved_changes', 'paid']);

// 'saved': a finished (non-draft) report is binding, as in the simplified Aufmass tool.
// 'customer': the older flow, where the customer must have approved it (stage, or review as fallback).
export function isBinding(r: ReportStatus, mode: ApprovalMode = 'saved'): boolean {
  if (r.state !== 'ready') return false;
  if (mode === 'saved') return true;
  return APPROVED.has(r.stage || (r.review === 'approved' ? 'approved' : 'created'));
}

// Largest-remainder split so the parts always sum to the total. No usable weights means equal parts.
export function allocate(total: number, weights: readonly number[]): number[] {
  const n = weights.length;
  if (!n) return [];
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  const w = sum > 0 ? weights.map((x) => Math.max(0, x)) : weights.map(() => 1);
  const wSum = sum > 0 ? sum : n;
  const raw = w.map((x) => (total * x) / wSum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) out[order[k % n][1]]++;
  return out;
}

// Service days of a multi-day report: Mon-Fri if any, else the range as is.
export function serviceDays(from: string, to: string): string[] {
  const all: string[] = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86_400_000) {
    all.push(new Date(t).toISOString().slice(0, 10));
  }
  const weekdays = all.filter((d) => ![0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay()));
  return weekdays.length ? weekdays : all;
}

// Sub reports weigh days by cost (hours x rate); own-employee reports split evenly by day.
export const subDayRevenue = (total: number, dayCosts: readonly number[]) => allocate(total, dayCosts);
export const employeeDayRevenue = (total: number, days: number) => allocate(total, Array(days).fill(1));
