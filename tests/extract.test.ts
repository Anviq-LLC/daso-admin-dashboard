import test from 'node:test';
import assert from 'node:assert/strict';
import { extract, parseRecords } from '../src/calc/extract.ts';

const project = { id: 'p1', planId: 'plan-p1', number: '100', name: 'Halle', factor: 0.9, employees: [{ id: 'e1', planId: 'r1', firstName: 'A', lastName: 'B', code: 'AB' }] };
const line = (q: number, price = 10_000) => ({ id: 'l' + q, positionId: 'x', number: '1', description: 'x', unit: 'm', price, employeePrice: price * 0.9, quantity: q, remark: '' });
const rec = (kind: string, o: object) => ({ id: (o as { id: string }).id, kind, data: JSON.stringify(o) });
const base = { projectId: 'p1', team: 'T', area: '', note: '', createdAt: '', updatedAt: '' };

test('own employee: 100 percent company revenue, 90 percent employee value', () => {
  const data = parseRecords([
    rec('project', project),
    rec('report', { ...base, id: 'r-own', date: '2026-11-12', endDate: '2026-11-12', state: 'ready', lines: [line(1)], employeeMembers: [{ employeeId: 'e1', name: 'A B', code: 'AB', trial: false }] }),
  ]);
  const x = extract(data, '2026-11');
  assert.equal(x.emp.length, 1);
  assert.equal(x.emp[0].customer, 10_000);
  assert.equal(x.emp[0].employee, 9_000);
  assert.equal(x.emp[0].resourceId, 'r1');
  assert.equal(x.emp[0].binding, true);
});

test('draft is pipeline, not binding', () => {
  const data = parseRecords([
    rec('project', project),
    rec('report', { ...base, id: 'r-d', date: '2026-11-12', endDate: '2026-11-12', state: 'draft', lines: [line(1)], employeeMembers: [{ employeeId: 'e1', name: 'A B', code: 'AB', trial: false }] }),
  ]);
  assert.equal(extract(data, '2026-11').emp[0].binding, false);
});

test('sub revenue follows daily cost across a multi-day range and sums exactly', () => {
  const work = { code: 'T1', company: 'Uniq', hourlyRate: 4_000, workers: [
    { name: 'a', hours: 12, dailyHours: { '2026-11-09': 8, '2026-11-10': 4, '2026-11-11': 0 } },
    { name: 'b', hours: 12, dailyHours: { '2026-11-09': 8, '2026-11-10': 4, '2026-11-11': 0 } },
  ] };
  const data = parseRecords([
    rec('project', project),
    rec('report', { ...base, id: 'r-sub', date: '2026-11-09', endDate: '2026-11-11', state: 'ready', lines: [line(3)], teamWork: work, employeeMembers: [] }),
  ]);
  const x = extract(data, '2026-11', { aliases: { uniq: 'UNIQ GmbH' } });
  const by = Object.fromEntries(x.sub.map((r) => [r.day, r]));
  assert.equal(x.sub.reduce((s, r) => s + r.customer, 0), 30_000);
  assert.equal(by['2026-11-09'].customer, 20_000);
  assert.equal(by['2026-11-10'].customer, 10_000);
  assert.equal(by['2026-11-09'].heads, 2);
  assert.equal(by['2026-11-09'].cost, 64_000);
  assert.equal(by['2026-11-09'].firm, 'UNIQ GmbH');
  assert.equal(by['2026-11-09'].estimated, true);
});

test('retroactive: a report dated in the past lands on its service day', () => {
  const data = parseRecords([
    rec('project', project),
    rec('report', { ...base, id: 'r-old', date: '2026-01-14', endDate: '2026-01-14', state: 'ready', lines: [line(1)], employeeMembers: [{ employeeId: 'e1', name: 'A B', code: 'AB', trial: false }] }),
  ]);
  assert.equal(extract(data, '2026-02').emp.length, 0);
  assert.equal(extract(data, '2026-01').emp[0].day, '2026-01-14');
});
