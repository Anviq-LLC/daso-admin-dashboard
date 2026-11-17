// Read-only data API for outside tools such as a custom GPT. It binds only the dashboard database, never the
// source tools, and returns figures without wages, personnel costs or worker names.
import { guardQuery, safeEqual, sha256Hex } from './guard.ts';
import { monthReport } from '../worker/data.ts';
import { readOnly, type Env, type Identity } from '../worker/auth.ts';

type ApiEnv = { DB: D1Database; PLAN: D1Database; AUFMASS: D1Database; API_KEY_HASH?: string };

// Tables of the planning tool that may be read, with the column used for from/to filters.
const PLAN_TABLES: Record<string, string | null> = { projects: null, resources: null, customers: null, contacts: null, assignments: 'day', punches: 'started', day_entries: 'day', vacation_requests: null };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NOBODY: Identity = { email: 'api', role: 'viewer', sensitive: false };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const eur = (c: number | null) => (c === null ? null : Math.round(c) / 100);

const monthParam = { name: 'month', in: 'query', required: true, schema: { type: 'string', example: '2026-11' }, description: 'YYYY-MM' };
const spec = (origin: string) => ({
  openapi: '3.1.0', info: { title: 'DaSO Kennzahlen', version: '1.0.0', description: 'Nur lesender Zugriff auf Kennzahlen sowie auf die Rohdaten von Aufmaßtool und Montageplanung. Beträge in Euro, netto.' },
  servers: [{ url: origin }],
  components: { securitySchemes: { key: { type: 'http', scheme: 'bearer' } } }, security: [{ key: [] }],
  paths: {
    '/api/summary': { get: { operationId: 'summary', summary: 'Monatsübersicht', parameters: [monthParam], responses: { 200: { description: 'ok' } } } },
    '/api/revenue': { get: { operationId: 'revenue', summary: 'Umsatz je Tag', parameters: [monthParam], responses: { 200: { description: 'ok' } } } },
    '/api/subs': { get: { operationId: 'subs', summary: 'Nachunternehmer mit Umsatz, Kosten und Gewinn', parameters: [monthParam], responses: { 200: { description: 'ok' } } } },
    '/api/sub-teams': { get: { operationId: 'subTeams', summary: 'Nachunternehmer-Teams je Tag und Projekt mit Umsatz, Kosten, Personen und Stunden', parameters: [monthParam], responses: { 200: { description: 'ok' } } } },
    '/api/projects': { get: { operationId: 'projects', summary: 'Projekte mit Umsatz und Gewinn', parameters: [monthParam], responses: { 200: { description: 'ok' } } } },
    '/api/catalog': { get: { operationId: 'catalog', summary: 'Projekte (mit IDs der Einteilung) und Nachunternehmer aus der Montageplanung', responses: { 200: { description: 'ok' } } } },
    '/api/plan': { get: { operationId: 'planData', summary: 'Rohdaten der Montageplanung (Einteilung)', parameters: [
      { name: 'table', in: 'query', required: true, schema: { type: 'string', enum: Object.keys(PLAN_TABLES) } },
      { name: 'from', in: 'query', schema: { type: 'string', example: '2026-11-01' }, description: 'Nur assignments, punches, day_entries' },
      { name: 'to', in: 'query', schema: { type: 'string', example: '2026-11-30' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', default: 1000, maximum: 5000 } }, { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }], responses: { 200: { description: 'ok' } } } },
    '/api/aufmass': { get: { operationId: 'aufmassData', summary: 'Rohdaten des Aufmaßtools: Projekte oder Berichte (mit month nur Berichte dieses Monats)', parameters: [
      { name: 'kind', in: 'query', required: true, schema: { type: 'string', enum: ['project', 'report'] } },
      { name: 'month', in: 'query', schema: { type: 'string', example: '2026-11' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', default: 200, maximum: 1000 } }, { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }], responses: { 200: { description: 'ok' } } } },
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
      const page = (d: number, max: number) => [Math.min(Math.max(Number(url.searchParams.get('limit')) || d, 1), max), Math.max(Number(url.searchParams.get('offset')) || 0, 0)];
      if (url.pathname === '/api/plan') {
        const t = url.searchParams.get('table') || '';
        if (!(t in PLAN_TABLES)) return json({ error: 'table: ' + Object.keys(PLAN_TABLES).join(', ') }, 400);
        const [lim, off] = page(1000, 5000), col = PLAN_TABLES[t], from = url.searchParams.get('from'), to = url.searchParams.get('to');
        if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return json({ error: 'from/to=YYYY-MM-DD' }, 400);
        const where = col && (from || to) ? ` WHERE ${col} >= ? AND ${col} <= ?` : '';
        const args = where ? [from || '0000-01-01', (to || '9999-12-31') + (col === 'started' ? 'T99' : '')] : [];
        const rows = (await readOnly(env.PLAN).prepare(`SELECT * FROM ${t}${where} LIMIT ? OFFSET ?`).bind(...args, lim, off).all<Record<string, unknown>>()).results;
        // GPS positions of punches are personal data and stay out of the API
        return json(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !/location/.test(k)))));
      }
      if (url.pathname === '/api/aufmass') {
        const kind = url.searchParams.get('kind');
        if (kind !== 'project' && kind !== 'report') return json({ error: 'kind=project|report' }, 400);
        const [lim, off] = page(200, 1000);
        let q = 'SELECT id, kind, project_id, data, updated_at FROM records WHERE kind = ?', args: unknown[] = [kind];
        if (kind === 'report' && month) {
          if (!MONTH.test(month)) return json({ error: 'month=YYYY-MM' }, 400);
          q += " AND json_extract(data, '$.date') <= ? AND COALESCE(json_extract(data, '$.endDate'), json_extract(data, '$.date')) >= ?";
          args.push(month + '-31', month + '-01');
        }
        const rows = (await readOnly(env.AUFMASS).prepare(q + ' ORDER BY id LIMIT ? OFFSET ?').bind(...args, lim, off).all<{ id: string; kind: string; project_id: string; data: string; updated_at: string }>()).results;
        return json(rows.map((r) => ({ id: r.id, projectId: r.project_id, updatedAt: r.updated_at, data: JSON.parse(r.data) })));
      }
      if (url.pathname === '/api/catalog') {
        const [projects, contractors] = await Promise.all([
          db.prepare('SELECT id, number, name, address, archived FROM dim_project ORDER BY number, name').all<{ id: string; number: string; name: string; address: string; archived: number }>(),
          db.prepare("SELECT id, name, archived FROM dim_resource WHERE kind = 'contractor' ORDER BY name").all<{ id: string; name: string; archived: number }>(),
        ]);
        return json({ projects: projects.results.map((p) => ({ ...p, archived: !!p.archived })), subcontractors: contractors.results.map((c) => ({ ...c, archived: !!c.archived })) });
      }
      if (!['/api/summary', '/api/revenue', '/api/subs', '/api/sub-teams', '/api/projects'].includes(url.pathname)) return json({ error: 'Nicht gefunden.' }, 404);
      if (!MONTH.test(month)) return json({ error: 'month=YYYY-MM erforderlich.' }, 400);
      const r = await monthReport(full, NOBODY, month);
      if (url.pathname === '/api/summary') {
        return json({
          month, approval: r.approval, dataDate: r.dataDate,
          ownRevenueEur: eur(r.ownRevenue), subRevenueEur: eur(r.subRevenue), sumRevenueEur: eur(r.revenue), ownPipelineEur: eur(r.pipeline.own), subPipelineEur: eur(r.pipeline.sub),
          overheadEur: eur(r.costs.overhead), forecastEur: r.forecast ? eur(r.forecast.forecast) : null,
          note: 'Umsatz = Kundenumsatz netto zum Leistungsdatum. Prognose ist keine BWA.',
        });
      }
      if (url.pathname === '/api/revenue') return json(r.daily.map((d) => ({ day: d.day, ownEur: eur(d.own), subEur: eur(d.sub), totalEur: eur(d.total), ownHeads: d.ownHeads, ownPerHeadEur: eur(d.ownPerHead), subHeads: d.subHeads, subPerHeadEur: eur(d.subPerHead) })));
      if (url.pathname === '/api/subs') return json(r.subs.map((s) => ({ subcontractor: s.firm, revenueEur: eur(s.revenue), costEur: eur(s.cost), profitEur: eur(s.profit), personDays: s.personDays, hours: s.hours, perPersonDayEur: eur(s.perPersonDay) })));
      if (url.pathname === '/api/sub-teams') return json(r.subDays.map((d) => ({ subcontractor: d.firm, team: d.team, projectId: d.projectId, project: d.project, day: d.day, revenueEur: eur(d.revenue), costEur: eur(d.cost), persons: d.heads, hours: d.hours, perPersonEur: eur(d.perHead), estimated: d.estimated })));
      return json(r.projects.map((p) => ({ projectId: p.id, project: p.label, ownRevenueEur: eur(p.ownRevenue), subRevenueEur: eur(p.subRevenue), sumRevenueEur: eur(p.revenue), subCostEur: eur(p.subCost), profitBeforeOverheadEur: eur(p.revenue - p.subCost - p.other), overheadShareEur: eur(p.overhead) })));
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  },
};
