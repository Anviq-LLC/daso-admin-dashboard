import test from 'node:test';
import assert from 'node:assert/strict';
import { guardQuery, safeEqual, sha256Hex } from '../src/api/guard.ts';

const tables = new Set(['fact_emp', 'fact_sub', 'wage', 'roles', 'settings', 'cost_entry']);
const ok = (q: string) => guardQuery(q, tables);
const bad = (q: unknown) => assert.throws(() => guardQuery(q, tables));

test('plain select on a view is wrapped and limited', () => {
  assert.equal(ok('select day, total from v_revenue_day;'), 'SELECT * FROM (select day, total from v_revenue_day) LIMIT 1000');
  ok('SELECT firm, SUM(revenue_eur) FROM v_sub_day GROUP BY firm');
});
test('writes, multiple statements and comments are refused', () => {
  bad('DELETE FROM v_sub_day');
  bad('select 1 from v_sub_day; drop table fact_emp');
  bad('select * from v_sub_day -- x');
  bad('select * from v_sub_day /* x */');
  bad('insert into fact_emp select * from v_sub_day');
  bad('update fact_emp set binding = 1');
  bad('  ');
  bad(42);
});
test('real tables, schema and pragma are refused, even inside subqueries', () => {
  bad('select * from fact_emp');
  bad('select * from wage');
  bad('select * from v_sub_day where firm in (select name from roles)');
  bad('select * from v_sub_day join settings');
  bad('select name from sqlite_master');
  bad('select * from pragma_table_info(\'wage\')');
  bad('with x as (select 1) select * from v_sub_day');
});
test('a query without a view is refused', () => bad('select 1'));
test('key hash compare', async () => {
  const h = await sha256Hex('secret');
  assert.ok(safeEqual(h, await sha256Hex('secret')));
  assert.ok(!safeEqual(h, await sha256Hex('other')));
});
