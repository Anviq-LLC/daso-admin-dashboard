import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryD1 } from './d1.ts';
import api from '../src/api/index.ts';
import { sha256Hex } from '../src/api/guard.ts';

const schema = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8') + readFileSync(new URL('../migrations/0003_api_keys.sql', import.meta.url), 'utf8');
const call = (env: never, key?: string) => api.fetch(new Request('https://x/api/summary?month=2026-11', { headers: key ? { authorization: 'Bearer ' + key } : {} }), env);

test('keys from the table work, revoked and unknown keys do not', async () => {
  const DB = memoryD1(schema);
  DB.raw.prepare('INSERT INTO api_key VALUES (?,?,?,?,?,0)').run('1', 'david', await sha256Hex('good'), 'gf', '2026-11-12');
  DB.raw.prepare('INSERT INTO api_key VALUES (?,?,?,?,?,1)').run('2', 'old', await sha256Hex('old'), 'gf', '2026-11-12');
  const env = { DB } as never;
  assert.equal((await call(env, 'good')).status, 200);
  assert.equal((await call(env, 'old')).status, 401);
  assert.equal((await call(env, 'nope')).status, 401);
  assert.equal((await call(env)).status, 401);
});
