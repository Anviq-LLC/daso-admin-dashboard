import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketOf, DEFAULT_MAPPING, linesFromRows, linesFromText, parseAmount, suggest, summarize } from '../src/calc/bwa.ts';

test('german amounts', () => {
  assert.equal(parseAmount('1.234,56'), 123_456);
  assert.equal(parseAmount('1.234,56-'), -123_456);
  assert.equal(parseAmount('500,00 H'), -50_000);
  assert.equal(parseAmount(12.5), 1_250);
  assert.equal(parseAmount('abc'), null);
});
test('rows and pasted pdf text give the same lines', () => {
  const a = linesFromRows([['4120', 'Gehälter', '', '12.000,00']]);
  const b = linesFromText('4120 Gehälter 12.000,00');
  assert.deepEqual(a, b);
  assert.deepEqual(a[0], { account: '4120', label: 'Gehälter', cents: 1_200_000 });
});
test('mapping, summary and the same period is not added twice', () => {
  const lines = [{ account: '8400', label: 'Erlöse', cents: 10_000_000 }, { account: '4120', label: 'Gehälter', cents: 3_000_000 }, { account: '', label: 'Summe Kosten', cents: 3_000_000 }]
    .map((l) => ({ ...l, bucket: bucketOf(l, DEFAULT_MAPPING) }));
  const s = summarize(lines);
  assert.equal(s.revenue, 10_000_000);
  assert.equal(s.costs, 3_000_000);
  assert.equal(s.operating, 7_000_000);
  assert.equal(summarize(lines).revenue, s.revenue);
});
test('cost suggestion shows deviation to the standard', () => {
  assert.deepEqual(suggest({ buero: 350_000 }, [{ name: 'Büro', monthly: 300_000 }]), [{ name: 'Büro', current: 300_000, proposed: 350_000, deviation: 50_000 }]);
});

test('DATEV style SuSa rows: account, label, soll, haben, saldo', () => {
  const rows = [
    ['Konto', 'Bezeichnung', 'Soll', 'Haben', 'Saldo'],
    ['4120', 'Gehälter', '12.000,00', '0,00', '12.000,00 S'],
    ['8400', 'Erlöse 19 % USt', '0,00', '95.000,00', '95.000,00 H'],
    ['4530', 'Laufende Kfz-Betriebskosten', 1850.5, 0, 1850.5],
  ];
  const lines = linesFromRows(rows);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => l.account), ['4120', '8400', '4530']);
  assert.equal(lines[1].cents, -9_500_000);
  assert.equal(lines[2].cents, 185_050);
  assert.equal(bucketOf(lines[2], DEFAULT_MAPPING), 'kfz');
  assert.equal(bucketOf(lines[0], DEFAULT_MAPPING), 'personal');
});

test('summary uses magnitudes so a SuSa credit counts as positive revenue', () => {
  const lines = linesFromRows([['8400', 'Erlöse', '95.000,00 H'], ['4120', 'Gehälter', '30.000,00 S']]).map((l) => ({ ...l, bucket: bucketOf(l, DEFAULT_MAPPING) }));
  const s = summarize(lines);
  assert.equal(s.revenue, 9_500_000);
  assert.equal(s.costs, 3_000_000);
  assert.equal(s.operating, 6_500_000);
});
