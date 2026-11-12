import test from 'node:test';
import assert from 'node:assert/strict';
import { absenceCredit, DEFAULT_TARGET, employeeValue, isBinding, overheadShare, perHead, saturdayIndicator, weekdaysInMonth } from '../src/calc/rules.ts';

test('90 percent employee value, company revenue unchanged', () => {
  assert.equal(employeeValue(1_000_000), 900_000);
});
test('saturday indicator', () => assert.equal(saturdayIndicator(100_000), 36_000));
test('absence credit: 22 weekdays, 2 days', () => {
  assert.equal(weekdaysInMonth(2026, 3), 22);
  assert.equal(absenceCredit(DEFAULT_TARGET, 2026, 3, 2), 72_727);
});
test('sub head count', () => {
  assert.equal(perHead(200_000, 4), 50_000);
  assert.equal(perHead(200_000, 0), null);
  assert.equal(perHead(200_000, undefined), null);
});
test('overhead share', () => {
  assert.equal(overheadShare(5_000_000, 20_000_000, 2_000_000), 500_000);
  assert.equal(overheadShare(1, 0, 100), null);
});
test('binding depends on the approval mode', () => {
  assert.equal(isBinding({ state: 'draft' }), false);
  assert.equal(isBinding({ state: 'ready' }), true);
  assert.equal(isBinding({ state: 'ready', review: 'pending' }, 'customer'), false);
  assert.equal(isBinding({ state: 'ready', review: 'approved' }, 'customer'), true);
  assert.equal(isBinding({ state: 'ready', stage: 'approved_changes' }, 'customer'), true);
  assert.equal(isBinding({ state: 'ready', stage: 'created', review: 'approved' }, 'customer'), false);
});

import { allocate, employeeDayRevenue, serviceDays, subDayRevenue } from '../src/calc/rules.ts';

test('allocation keeps the total', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.equal(employeeDayRevenue(1001, 3).reduce((a, b) => a + b), 1001);
});
test('sub revenue follows daily cost, falls back to equal', () => {
  assert.deepEqual(subDayRevenue(1000, [300, 100, 100]), [600, 200, 200]);
  assert.deepEqual(subDayRevenue(1000, [0, 0]), [500, 500]);
});
test('service days skip the weekend', () => {
  assert.deepEqual(serviceDays('2026-11-13', '2026-11-16'), ['2026-11-13', '2026-11-16']);
  assert.deepEqual(serviceDays('2026-11-14', '2026-11-15'), ['2026-11-14', '2026-11-15']);
});
