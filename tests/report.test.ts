import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMonth, type MonthInput } from '../src/calc/report.ts';
import { DEFAULT_TARGET } from '../src/calc/rules.ts';
import { forecastMonth, forecastYear } from '../src/calc/forecast.ts';
import { holidaysRP } from '../src/calc/holidays.ts';

const cfg = { target: DEFAULT_TARGET, employerPct: 0, defaultHourly: 0, modelSaturdayBonus: false };
const base = (o: Partial<MonthInput>): MonthInput => ({
  month: '2026-03', emp: [], sub: [], hours: [], absence: [], costTypes: [], entries: [], wages: [],
  resources: [{ id: 'r1', name: 'A', code: 'A', archived: false }], holidays: new Set(), cfg, showPersonnel: true, ...o,
});
const empRow = (day: string, project: string, customer: number, binding = true) =>
  ({ day, resourceId: 'r1', name: 'A', projectId: project, label: project, reportId: 'x' + day, customer, employee: Math.round(customer * 0.9), binding, estimated: false });

test('two excused days give 727,27 fictive credit and no revenue', () => {
  const r = buildMonth(base({ absence: [
    { day: '2026-03-02', resourceId: 'r1', kind: 'vacation', review: false },
    { day: '2026-03-03', resourceId: 'r1', kind: 'sick', review: false },
  ] }));
  assert.equal(r.employees[0].fiction, 72_727);
  assert.equal(r.revenue, 0);
  assert.equal(r.employees[0].real, 0);
});

test('credit is once per person and day, weekends excluded, revenue day goes to review', () => {
  const r = buildMonth(base({
    holidays: new Set(['2026-03-02']),
    absence: [{ day: '2026-03-02', resourceId: 'r1', kind: 'vacation', review: false }, { day: '2026-03-07', resourceId: 'r1', kind: 'sick', review: false }, { day: '2026-03-04', resourceId: 'r1', kind: 'sick', review: false }],
    emp: [empRow('2026-03-04', 'p', 10_000)],
  }));
  assert.equal(r.employees[0].absenceDays, 1);
  assert.deepEqual(r.employees[0].reviewDays, ['2026-03-04']);
});

test('overhead is split by revenue and subtracted once', () => {
  const r = buildMonth(base({
    emp: [empRow('2026-03-10', 'big', 5_000_000), empRow('2026-03-11', 'small', 15_000_000)],
    costTypes: [{ id: 'c', name: 'Buero', category: 'overhead', monthly: 2_000_000, validFrom: '2026-01-01', validTo: null }],
  }));
  assert.equal(r.projects.find((p) => p.id === 'big')!.overhead, 500_000);
  assert.equal(r.projects.reduce((s, p) => s + (p.overhead ?? 0), 0), 2_000_000);
  assert.equal(r.profit, 20_000_000 - 2_000_000);
});

test('no revenue: overhead is not distributed and a warning is shown', () => {
  const r = buildMonth(base({ costTypes: [{ id: 'c', name: 'Kfz', category: 'overhead', monthly: 1_000_000, validFrom: '2026-01-01', validTo: null }], entries: [{ id: 'e', day: '2026-03-03', kind: 'other', projectId: 'p', firm: '', subcategory: '', cents: 100 }] }));
  assert.equal(r.projects[0].overhead, null);
  assert.ok(r.warnings.some((w) => w.includes('Gesamtumsatz 0')));
});

test('hours of two sites add up per person and day', () => {
  const r = buildMonth(base({ hours: [
    { day: '2026-03-02', resourceId: 'r1', projectId: 'A', minutes: 300, travel: false, open: false },
    { day: '2026-03-02', resourceId: 'r1', projectId: 'B', minutes: 240, travel: false, open: false },
  ] }));
  assert.equal(r.employees[0].workMinutes, 540);
});

test('pipeline stays out of binding revenue', () => {
  const r = buildMonth(base({ emp: [empRow('2026-03-10', 'p', 10_000, false)] }));
  assert.equal(r.revenue, 0);
  assert.equal(r.pipeline.total, 10_000);
});

test('without personnel permission no profit or personnel cost is returned', () => {
  const r = buildMonth(base({ showPersonnel: false, emp: [empRow('2026-03-10', 'p', 10_000)] }));
  assert.equal(r.profit, null);
  assert.equal(r.costs.personnel, null);
});

test('forecast projects the average productive weekday, saturdays separately', () => {
  const f = forecastMonth({ month: '2026-03', asOf: '2026-03-13', revenueByDay: { '2026-03-02': 100, '2026-03-03': 300, '2026-03-14': 999 }, holidays: new Set(), saturdayCents: 50 });
  assert.equal(f.ist, 400);
  assert.equal(f.avgWeekday, 200);
  assert.equal(f.remainingWeekdays, 12);
  assert.equal(f.remainingSaturdays, 3);
  assert.equal(f.forecast, 400 + 200 * 12 + 150);
});

test('year forecast keeps actual and forecast apart', () => {
  const y = forecastYear(2026, '2026-03-10', { '2026-01': 100, '2026-02': 300 }, 500);
  assert.deepEqual(y.points.slice(0, 3).map((p) => p.kind), ['ist', 'ist', 'prognose']);
  assert.equal(y.points[3].kind, 'hochrechnung');
  assert.equal(y.points[3].revenue, 300);
});

test('Rheinland-Pfalz holidays 2026', () => {
  const h = holidaysRP(2026);
  assert.equal(h['2026-04-03'], 'Karfreitag');
  assert.equal(h['2026-05-14'], 'Christi Himmelfahrt');
  assert.equal(h['2026-06-04'], 'Fronleichnam');
  assert.equal(h['2026-11-01'], 'Allerheiligen');
});

test('year forecast mean ignores months without data', () => {
  const y = forecastYear(2026, '2026-03-10', { '2026-02': 300 }, 500, new Set(['2026-02']));
  assert.equal(y.points.find((p) => p.month === '2026-04')!.revenue, 400);
});
