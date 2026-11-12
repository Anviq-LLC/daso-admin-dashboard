// Read-only data API for outside tools such as a custom GPT. It binds only the dashboard database, never the
// source tools, and returns figures without wages, personnel costs or worker names.
import { guardQuery, safeEqual, sha256Hex } from './guard.ts';
import { monthReport } from '../worker/data.ts';
import { readOnly, type Env, type Identity } from '../worker/auth.ts';

type ApiEnv = { DB: D1Database; API_KEY_HASH?: string };
const NOBODY: Identity = { email: 'api', role: 'viewer', sensitive: false };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const eur = (c: number | null) => (c === null ? null : Math.round(c) / 100);

const monthParam = { name: 'month', in: 'query', required: true, schema: { type: 'string', example: '2026-11' }, description: 'YYYY-MM' };
const spec = (origin: string) => ({
  openapi: '3.1.0', info: { title: 'DaSO Kennzahlen', version: '1.0.0', description: 'Nur lesender Zugriff auf Umsatz-, Sub- und Projektkennzahlen. Beträge in Euro, netto.' },
  servers: [{ url: origin }],
  components: { securitySchemes: { key: { type: 'http', scheme: 'bearer' } } }, security: [{ key: [] }],
  paths: {
    '/api/summary': { get: { operationId: 'summary', summary: 'Monatsübersicht', parameters: [monthParam], responses: { 200: { description: 'ok' } } } },
    '/api/revenue': { get: { operationId: 'revenue', summary: 'Umsatz je Tag', parameters: [monthParam], responses: { 200: { description: 'ok' } } } },
    '/api/subs': { get: { operationId: 'subs', summary: 'Nachunternehmer je Firma', parameters: [monthParam], responses: { 200: { description: 'ok' } } } },
    '/api/projects': { get: { operationId: 'projects', summary: 'Projekte mit Umsatz und Gewinn', parameters: [monthParam], responses: { 200: { description: 'ok' } } } },
    '/api/query': { post: { operationId: 'query', summary: 'SELECT auf v_revenue_day, v_sub_day, v_project_day', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['sql'], properties: { sql: { type: 'string' } } } } } }, responses: { 200: { description: 'ok' } } } },
  },
});

let tables: Set<string> | undefined;
async function realTables(db: D1Database) {
  if (!tables) tables = new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>()).results.map((r) => r.name.toLowerCase()));
  return tables;
}

export default {
  async fetch(request: Request, env: ApiEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/openapi.json') return json(spec(url.origin));
    const key = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!key) return json({ error: 'Nicht autorisiert.' }, 401);
    // keys are created and revoked in the dashboard (api_key table); the optional secret stays as a fallback
    const hash = await sha256Hex(key);
    const known = (env.API_KEY_HASH && safeEqual(hash, env.API_KEY_HASH)) || !!(await env.DB.prepare('SELECT 1 AS n FROM api_key WHERE hash = ? AND revoked = 0').bind(hash).first());
    if (!known) return json({ error: 'Nicht autorisiert.' }, 401);
    const db = readOnly(env.DB);
    const full = { DB: db } as unknown as Env;
    try {
      const month = url.searchParams.get('month') || '';
      if (url.pathname === '/api/query' && request.method === 'POST') {
        const b = (await request.json()) as { sql?: unknown };
        const sql = guardQuery(b.sql, await realTables(env.DB));
        return json((await db.prepare(sql).all()).results);
      }
      if (request.method !== 'GET') return json({ error: 'Methode nicht erlaubt.' }, 405);
      if (!['/api/summary', '/api/revenue', '/api/subs', '/api/projects'].includes(url.pathname)) return json({ error: 'Nicht gefunden.' }, 404);
      if (!MONTH.test(month)) return json({ error: 'month=YYYY-MM erforderlich.' }, 400);
      const r = await monthReport(full, NOBODY, month);
      if (url.pathname === '/api/summary') {
        return json({
          month, approval: r.approval, dataDate: r.dataDate,
          revenueEur: eur(r.revenue), ownRevenueEur: eur(r.ownRevenue), subRevenueEur: eur(r.subRevenue), pipelineEur: eur(r.pipeline.total),
          overheadEur: eur(r.costs.overhead), forecastEur: r.forecast ? eur(r.forecast.forecast) : null,
          note: 'Umsatz = Kundenumsatz netto zum Leistungsdatum. Prognose ist keine BWA.',
        });
      }
      if (url.pathname === '/api/revenue') return json(r.daily.map((d) => ({ day: d.day, ownEur: eur(d.own), subEur: eur(d.sub), totalEur: eur(d.total), heads: d.heads, perHeadEur: eur(d.perHead) })));
      if (url.pathname === '/api/subs') return json(r.subs.map((s) => ({ firm: s.firm, revenueEur: eur(s.revenue), costEur: eur(s.cost), profitEur: eur(s.profit), personDays: s.personDays, perPersonDayEur: eur(s.perPersonDay) })));
      return json(r.projects.map((p) => ({ project: p.label, revenueEur: eur(p.revenue), subCostEur: eur(p.subCost), profitBeforeOverheadEur: eur(p.revenue - p.subCost - p.other), overheadShareEur: eur(p.overhead) })));
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  },
};
