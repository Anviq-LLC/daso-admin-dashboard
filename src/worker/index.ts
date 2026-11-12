import { can, HttpError, identify, need, readOnly, type Env, type Identity } from './auth.ts';
import { berlinToday, monthReport, yearReport } from './data.ts';
import { checkSettings, loadSettings, saveSettings } from './settings.ts';
import { reconcileAll, refreshChanged, refreshMonth } from './ingest.ts';
import { bucketOf, BUCKETS, DEFAULT_MAPPING, suggest, summarize, type Line } from '../calc/bwa.ts';
import { toCsv } from './export.ts';
import { sha256Hex } from '../api/guard.ts';

const SECURITY = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
};
const reply = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...SECURITY, ...extra } });

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/, DAY = /^\d{4}-\d{2}-\d{2}$/;
const month = (s: string | null) => { if (!s || !MONTH.test(s)) throw new HttpError(400, 'Ungültiger Monat.'); return s; };
const day = (s: unknown) => { if (typeof s !== 'string' || !DAY.test(s)) throw new HttpError(400, 'Ungültiges Datum.'); return s; };
const cents = (v: unknown) => { if (!Number.isSafeInteger(v)) throw new HttpError(400, 'Betrag muss in Cent angegeben werden.'); return v as number; };
const text = (v: unknown, max = 200) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new HttpError(400, 'Ungültiger Text.'); return v.trim(); };
const opt = (v: unknown, max = 500) => { if (v === undefined || v === null || v === '') return ''; if (typeof v !== 'string' || v.length > max) throw new HttpError(400, 'Ungültiger Text.'); return v.trim(); };
const link = (v: unknown) => { const t = opt(v, 500); if (t && !/^https:\/\//i.test(t)) throw new HttpError(400, 'Belegverweis muss mit https:// beginnen.'); return t; };

async function log(env: Env, who: Identity, action: string, detail = '') {
  await env.DB.prepare('INSERT INTO audit (id, at, actor, action, detail) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), new Date().toISOString(), who.email, action, detail).run();
}

async function mappingRows(env: Env) {
  const v = await env.DB.prepare("SELECT value FROM settings WHERE key = 'mappingVersion'").first<{ value: string }>();
  const version = Number(v?.value || 1);
  let rows = (await env.DB.prepare('SELECT pattern, bucket FROM account_mapping WHERE version = ?').bind(version).all<{ pattern: string; bucket: string }>()).results;
  if (!rows.length) {
    await env.DB.batch(DEFAULT_MAPPING.map((m) => env.DB.prepare('INSERT OR IGNORE INTO account_mapping (version, pattern, bucket) VALUES (?,?,?)').bind(version, m.pattern, m.bucket)));
    rows = DEFAULT_MAPPING;
  }
  // longer patterns first so "4530" wins over "4"
  return { version, rows: [...rows].sort((a, b) => b.pattern.length - a.pattern.length) };
}

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const who = await identify(request, env);
  const p = url.pathname, method = request.method;
  const body = async <T = Record<string, unknown>>() => {
    if (!(request.headers.get('content-type') || '').includes('application/json')) throw new HttpError(415, 'JSON erwartet.');
    return (await request.json()) as T;
  };
  if (method !== 'GET') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) throw new HttpError(403, 'Anfrage von fremder Seite.');
  }
  const q = url.searchParams;

  if (p === '/api/me') return reply({ email: who.email, role: who.role, sensitive: who.sensitive, today: berlinToday() });

  if (p === '/api/month' && method === 'GET') return reply(await monthReport(env, who, month(q.get('month'))));
  if (p === '/api/year' && method === 'GET') {
    const y = Number(q.get('year'));
    if (!Number.isInteger(y) || y < 2020 || y > 2100) throw new HttpError(400, 'Ungültiges Jahr.');
    return reply(await yearReport(env, who, y));
  }

  if (p === '/api/trace' && method === 'GET') {
    const d = day(q.get('day'));
    const m = d.slice(0, 7);
    const emp = await env.DB.prepare('SELECT report_id, label, name, customer_cents, binding, estimated FROM fact_emp WHERE month = ? AND day = ? ORDER BY label').bind(m, d).all();
    const sub = await env.DB.prepare('SELECT report_id, label, firm, team, customer_cents, binding, estimated FROM fact_sub WHERE month = ? AND day = ? ORDER BY label').bind(m, d).all();
    return reply({ day: d, own: emp.results, sub: sub.results });
  }
  if (p === '/api/changes' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT at, day, scope, report_id, before_cents, after_cents, reason FROM change_log WHERE month = ? ORDER BY at DESC LIMIT 500').bind(month(q.get('month'))).all();
    return reply(rows.results);
  }

  if (p === '/api/refresh' && method === 'POST') {
    need(can.costs(who));
    const b = await body<{ month?: string; year?: number }>();
    const list = b.year ? Array.from({ length: 12 }, (_, i) => `${b.year}-${String(i + 1).padStart(2, '0')}`) : [month(b.month ?? null)];
    const out = [];
    for (const m of list) out.push(await refreshMonth(env, m, 'Manuell aktualisiert'));
    await log(env, who, 'refresh', list.join(','));
    return reply(out);
  }

  if (p === '/api/settings') {
    if (method === 'GET') return reply(await loadSettings(env));
    need(can.rules(who));
    try {
      const s = checkSettings(await body());
      await saveSettings(env, s);
      await log(env, who, 'settings', JSON.stringify(s));
      return reply(s);
    } catch (e) { throw new HttpError(400, (e as Error).message); }
  }

  if (p === '/api/cost-types') {
    if (method === 'GET') return reply((await env.DB.prepare('SELECT * FROM cost_type ORDER BY name, valid_from').all()).results);
    need(can.costs(who));
    const b = await body();
    const id = crypto.randomUUID();
    const from = day(b.validFrom);
    const replaces = typeof b.replaces === 'string' ? b.replaces : null;
    const stmts = [env.DB.prepare('INSERT INTO cost_type (id, name, category, monthly_cents, valid_from, valid_to, doc_url, note, replaces, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, text(b.name, 80), text(b.category ?? 'overhead', 40), cents(b.monthly), from, b.validTo ? day(b.validTo) : null, link(b.docUrl), opt(b.note), replaces, who.email, new Date().toISOString())];
    // a changed amount ends the old row the day before; nothing is overwritten
    if (replaces) stmts.push(env.DB.prepare('UPDATE cost_type SET valid_to = ? WHERE id = ? AND (valid_to IS NULL OR valid_to >= ?)').bind(new Date(Date.parse(from + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10), replaces, from));
    await env.DB.batch(stmts);
    await log(env, who, 'cost-type', `${b.name} ${b.monthly}`);
    return reply({ id }, 201);
  }
  if (p === '/api/cost-entries') {
    if (method === 'GET') {
      const rows = await env.DB.prepare('SELECT * FROM cost_entry WHERE day >= ? AND day <= ? ORDER BY day DESC').bind(month(q.get('month')) + '-01', q.get('month') + '-31').all();
      return reply(rows.results);
    }
    need(can.costs(who));
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM cost_entry WHERE id = ?').bind(text(q.get('id'), 80)).run();
      await log(env, who, 'cost-entry-delete', q.get('id') || '');
      return reply({ ok: true });
    }
    const b = await body();
    const kind = b.kind;
    if (kind !== 'sub' && kind !== 'alex' && kind !== 'other') throw new HttpError(400, 'Ungültige Kostenart.');
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO cost_entry (id, day, kind, project_id, firm, subcategory, cents, doc_url, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, day(b.day), kind, opt(b.projectId, 80), opt(b.firm, 120), opt(b.subcategory, 80), cents(b.cents), link(b.docUrl), opt(b.note), who.email, new Date().toISOString()).run();
    await log(env, who, 'cost-entry', `${kind} ${b.cents}`);
    return reply({ id }, 201);
  }
  if (p === '/api/wages') {
    need(can.personnel(who) && can.rules(who));
    if (method === 'GET') return reply((await env.DB.prepare('SELECT * FROM wage ORDER BY resource_id, valid_from').all()).results);
    const b = await body();
    await env.DB.prepare('INSERT INTO wage (resource_id, valid_from, hourly_cents) VALUES (?,?,?) ON CONFLICT(resource_id, valid_from) DO UPDATE SET hourly_cents = excluded.hourly_cents').bind(text(b.resourceId, 80), day(b.validFrom), cents(b.hourly)).run();
    await log(env, who, 'wage', String(b.resourceId));
    return reply({ ok: true });
  }
  if (p === '/api/aliases') {
    if (method === 'GET') return reply((await env.DB.prepare('SELECT alias, canonical FROM sub_alias ORDER BY canonical').all()).results);
    need(can.rules(who));
    const b = await body();
    await env.DB.prepare('INSERT INTO sub_alias (alias, canonical) VALUES (?,?) ON CONFLICT(alias) DO UPDATE SET canonical = excluded.canonical').bind(text(b.alias, 120).toLowerCase().replace(/\s+/g, ' '), text(b.canonical, 120)).run();
    return reply({ ok: true });
  }
  if (p === '/api/roles') {
    need(can.rules(who));
    if (method === 'GET') return reply((await env.DB.prepare('SELECT email, role, name, sensitive FROM roles ORDER BY email').all()).results);
    if (method === 'DELETE') { await env.DB.prepare('DELETE FROM roles WHERE email = ?').bind(text(q.get('email'), 200).toLowerCase()).run(); return reply({ ok: true }); }
    const b = await body();
    if (b.role !== 'gf' && b.role !== 'buchhaltung' && b.role !== 'viewer') throw new HttpError(400, 'Ungültige Rolle.');
    await env.DB.prepare('INSERT INTO roles (email, role, name, sensitive) VALUES (?,?,?,?) ON CONFLICT(email) DO UPDATE SET role = excluded.role, name = excluded.name, sensitive = excluded.sensitive')
      .bind(text(b.email, 200).toLowerCase(), b.role, opt(b.name, 120), b.sensitive ? 1 : 0).run();
    await log(env, who, 'role', `${b.email} ${b.role}`);
    return reply({ ok: true });
  }

  // ---- keys for the read-only data API (shown once, only the hash is stored)
  if (p === '/api/api-keys') {
    need(can.rules(who));
    const apiUrl = url.origin.replace('//daso-admin-dashboard.', '//daso-data-api.');
    if (method === 'GET') return reply({ url: apiUrl, spec: apiUrl + '/openapi.json', keys: (await env.DB.prepare('SELECT id, name, created_by, created_at, revoked FROM api_key ORDER BY created_at DESC').all()).results });
    if (method === 'DELETE') {
      await env.DB.prepare('UPDATE api_key SET revoked = 1 WHERE id = ?').bind(text(q.get('id'), 80)).run();
      await log(env, who, 'api-key-revoke', q.get('id') || '');
      return reply({ ok: true });
    }
    const b = await body();
    const key = 'daso_' + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO api_key (id, name, hash, created_by, created_at, revoked) VALUES (?,?,?,?,?,0)').bind(id, text(b.name, 80), await sha256Hex(key), who.email, new Date().toISOString()).run();
    await log(env, who, 'api-key-create', String(b.name));
    return reply({ id, key, note: 'Der Schlüssel wird nur jetzt angezeigt.' }, 201);
  }

  // ---- BWA / SuSa
  if (p === '/api/mapping') {
    const m = await mappingRows(env);
    if (method === 'GET') return reply({ version: m.version, buckets: BUCKETS, rows: m.rows });
    need(can.rules(who));
    const b = await body<{ rows: { pattern: string; bucket: string }[] }>();
    if (!Array.isArray(b.rows) || b.rows.some((r) => !(BUCKETS as readonly string[]).includes(r.bucket) || !r.pattern)) throw new HttpError(400, 'Ungültiges Mapping.');
    const version = m.version + 1;
    await env.DB.batch([
      ...b.rows.map((r) => env.DB.prepare('INSERT OR REPLACE INTO account_mapping (version, pattern, bucket) VALUES (?,?,?)').bind(version, r.pattern, r.bucket)),
      env.DB.prepare("INSERT INTO settings (key, value) VALUES ('mappingVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(version)),
    ]);
    await log(env, who, 'mapping', `Version ${version}`);
    return reply({ version });
  }
  if (p === '/api/bwa' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT id, kind, period, version, filename, source_format, mapping_version, imported_by, imported_at, status, unmapped FROM bwa_import WHERE period = ? ORDER BY kind, version DESC').bind(month(q.get('period'))).all();
    return reply(rows.results);
  }
  if (p === '/api/bwa/import' && method === 'POST') {
    need(can.bwa(who));
    const b = await body<{ kind: string; period: string; filename: string; format: string; lines: Line[]; file?: string }>();
    if (b.kind !== 'bwa' && b.kind !== 'susa') throw new HttpError(400, 'Ungültiger Typ.');
    if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 5000) throw new HttpError(400, 'Keine Zeilen erkannt.');
    const per = month(b.period);
    const map = await mappingRows(env);
    const last = await env.DB.prepare('SELECT MAX(version) AS v FROM bwa_import WHERE kind = ? AND period = ?').bind(b.kind, per).first<{ v: number | null }>();
    const id = crypto.randomUUID(), version = (last?.v ?? 0) + 1;
    let fileKey = '';
    if (b.file && env.BUCKET) {
      if (b.file.length > 14_000_000) throw new HttpError(413, 'Datei zu groß.');
      fileKey = `bwa/${per}/${b.kind}-v${version}-${id}`;
      await env.BUCKET.put(fileKey, Uint8Array.from(atob(b.file), (c) => c.charCodeAt(0)), { customMetadata: { filename: b.filename } });
    }
    const lines = b.lines.map((l) => ({ account: String(l.account || '').slice(0, 12), label: String(l.label || '').slice(0, 200), cents: cents(l.cents) }));
    const mapped = lines.map((l) => ({ ...l, bucket: bucketOf(l, map.rows) }));
    const unmapped = mapped.filter((l) => !l.bucket).length;
    await env.DB.batch([
      env.DB.prepare('INSERT INTO bwa_import (id, kind, period, version, file_key, filename, source_format, mapping_version, imported_by, imported_at, status, unmapped) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id, b.kind, per, version, fileKey, text(b.filename, 200), text(b.format, 20), map.version, who.email, new Date().toISOString(), 'review', unmapped),
      ...mapped.map((l) => env.DB.prepare('INSERT INTO bwa_line VALUES (?,?,?,?,?)').bind(id, l.account, l.label, l.cents, l.bucket)),
    ]);
    await log(env, who, 'bwa-import', `${b.kind} ${per} v${version}`);
    return reply({ id, version, unmapped }, 201);
  }
  const bwaId = p.match(/^\/api\/bwa\/([\w-]+)$/);
  if (bwaId && method === 'GET') {
    const imp = await env.DB.prepare('SELECT * FROM bwa_import WHERE id = ?').bind(bwaId[1]).first();
    if (!imp) throw new HttpError(404, 'Import nicht gefunden.');
    const lines = await env.DB.prepare('SELECT rowid AS n, account, label, cents, bucket FROM bwa_line WHERE import_id = ? ORDER BY rowid').bind(bwaId[1]).all();
    return reply({ import: imp, lines: lines.results, buckets: BUCKETS });
  }
  const bwaAct = p.match(/^\/api\/bwa\/([\w-]+)\/(map|accept)$/);
  if (bwaAct && method === 'POST') {
    need(can.bwa(who));
    const imp = await env.DB.prepare('SELECT * FROM bwa_import WHERE id = ?').bind(bwaAct[1]).first<{ id: string; kind: string; period: string; status: string }>();
    if (!imp) throw new HttpError(404, 'Import nicht gefunden.');
    if (bwaAct[2] === 'map') {
      const b = await body<{ n: number; bucket: string }>();
      if (!(BUCKETS as readonly string[]).includes(b.bucket) || !Number.isInteger(b.n)) throw new HttpError(400, 'Ungültige Zuordnung.');
      await env.DB.batch([
        env.DB.prepare('UPDATE bwa_line SET bucket = ? WHERE import_id = ? AND rowid = ?').bind(b.bucket, imp.id, b.n),
        env.DB.prepare("UPDATE bwa_import SET unmapped = (SELECT COUNT(*) FROM bwa_line WHERE import_id = ? AND bucket = '') WHERE id = ?").bind(imp.id, imp.id),
      ]);
      return reply({ ok: true });
    }
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM bwa_line WHERE import_id = ? AND bucket = ''").bind(imp.id).first<{ n: number }>();
    if (open && open.n > 0) throw new HttpError(409, `${open.n} Konten sind nicht zugeordnet. Bitte vor der Übernahme bestätigen.`);
    await env.DB.batch([
      env.DB.prepare("UPDATE bwa_import SET status = 'ersetzt' WHERE kind = ? AND period = ? AND status = 'accepted'").bind(imp.kind, imp.period),
      env.DB.prepare("UPDATE bwa_import SET status = 'accepted' WHERE id = ?").bind(imp.id),
    ]);
    await log(env, who, 'bwa-accept', imp.id);
    return reply({ ok: true });
  }
  if (p === '/api/bwa-compare' && method === 'GET') {
    const per = month(q.get('period'));
    const acc = await env.DB.prepare("SELECT id, kind, version FROM bwa_import WHERE period = ? AND status = 'accepted'").bind(per).all<{ id: string; kind: string; version: number }>();
    // BWA gives the total result, SuSa the detail; one source is used for the figures, never both added
    const src = acc.results.find((r) => r.kind === 'bwa') || acc.results.find((r) => r.kind === 'susa');
    const rep = await monthReport(env, who, per);
    const s = await loadSettings(env);
    if (!src) return reply({ period: per, source: null, operational: rep.revenue, note: 'Kein übernommener Import für diese Periode.' });
    const lines = (await env.DB.prepare('SELECT account, label, cents, bucket FROM bwa_line WHERE import_id = ?').bind(src.id).all<Line & { bucket: string }>()).results;
    const sum = summarize(lines);
    const costTypes = (await env.DB.prepare("SELECT name, monthly_cents FROM cost_type WHERE valid_to IS NULL OR valid_to >= ?").bind(per + '-01').all<{ name: string; monthly_cents: number }>()).results;
    return reply({
      period: per, source: { kind: src.kind, version: src.version }, bwa: sum,
      operational: rep.revenue, difference: sum.revenue - rep.revenue,
      taxReserve: Math.max(0, Math.round(sum.beforeTax * s.taxReservePct / 100)), taxReservePct: s.taxReservePct,
      suggestion: suggest(sum.by, costTypes.map((c) => ({ name: c.name, monthly: c.monthly_cents }))),
      note: 'Buchhaltung (BWA/SuSa) und leistungsdatierter Umsatz sind getrennte Ebenen. Unterschiede entstehen durch Zeitversatz, fehlende Aufmaße und Kontenmapping. Steuerreserve ist eine Planung.',
    });
  }
  if (p === '/api/suggestion/accept' && method === 'POST') {
    need(can.rules(who));
    const b = await body();
    const old = await env.DB.prepare('SELECT id, category FROM cost_type WHERE name = ? AND valid_to IS NULL').bind(text(b.name, 80)).first<{ id: string; category: string }>();
    const id = crypto.randomUUID(), from = day(b.validFrom);
    const stmts = [env.DB.prepare('INSERT INTO cost_type (id, name, category, monthly_cents, valid_from, valid_to, doc_url, note, replaces, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, b.name, old?.category ?? 'overhead', cents(b.monthly), from, null, '', 'Vorschlag aus BWA übernommen', old?.id ?? null, who.email, new Date().toISOString())];
    if (old) stmts.push(env.DB.prepare('UPDATE cost_type SET valid_to = ? WHERE id = ?').bind(new Date(Date.parse(from + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10), old.id));
    await env.DB.batch(stmts);
    await log(env, who, 'suggestion-accept', `${b.name} ${b.monthly}`);
    return reply({ id });
  }

  // ---- exports
  if (p === '/api/export' && method === 'GET') {
    const m = month(q.get('month'));
    const r = await monthReport(env, who, m);
    const what = q.get('what');
    const eur = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2).replace('.', ','));
    let rows: (string | number)[][];
    if (what === 'employees') rows = [['Mitarbeiter', 'Kuerzel', 'Realer Umsatz 90%', 'Kundenumsatz', 'Fiktiver Ausgleich', 'Bewertungsumsatz', 'Samstag-Kennzahl 40%', 'Stunden', 'Abwesenheitstage'], ...r.employees.map((e) => [e.name, e.code, eur(e.real), eur(e.customer), eur(e.fiction), eur(e.valuation), eur(e.saturdayIndicator), (e.workMinutes / 60).toFixed(2).replace('.', ','), e.absenceDays])];
    else if (what === 'projects') rows = [['Projekt', 'Umsatz', 'Direkte Kosten', 'Gewinn vor Gemeinkosten', 'Gemeinkostenanteil', 'Gewinn nach Gemeinkosten'], ...r.projects.map((x) => [x.label, eur(x.revenue), eur(x.direct), eur(x.before), eur(x.overhead), eur(x.after)])];
    else if (what === 'subs') rows = [['Firma', 'Umsatz', 'Kosten', 'Gewinn', 'Personentage', 'Umsatz je Personentag'], ...r.subs.map((x) => [x.firm, eur(x.revenue), eur(x.cost), eur(x.profit), x.personDays, eur(x.perPersonDay)])];
    else if (what === 'days') rows = [['Tag', 'Mitarbeiter', 'Subs', 'Gesamt', 'Koepfe', 'Umsatz je Kopf'], ...r.daily.map((d) => [d.day, eur(d.own), eur(d.sub), eur(d.total), d.heads, eur(d.perHead)])];
    else throw new HttpError(400, 'Unbekannter Export.');
    return new Response(toCsv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${what}-${m}.csv"`, ...SECURITY } });
  }
  // Interface for the later LohnTool: figures only, versioned, no payroll calculation.
  if (p === '/api/lohn-export' && method === 'GET') {
    need(can.personnel(who));
    const m = month(q.get('month'));
    const r = await monthReport(env, who, m);
    return reply({
      version: 1, month: m, generatedAt: new Date().toISOString(), approval: r.approval,
      employees: r.employees.map((e) => ({ resourceId: e.id, name: e.name, employeeRevenueCents: e.real, customerRevenueCents: e.customer, fictiveCreditCents: e.fiction, saturdayCustomerCents: e.saturdayCustomer, saturdayIndicatorCents: e.saturdayIndicator, workMinutes: e.workMinutes, absenceDays: e.absenceKinds, reviewDays: e.reviewDays })),
    });
  }
  if (p === '/api/audit') { need(can.rules(who)); return reply((await env.DB.prepare('SELECT at, actor, action, detail FROM audit ORDER BY at DESC LIMIT 200').all()).results); }

  throw new HttpError(404, 'Nicht gefunden.');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // The source databases may only be read through the dashboard.
    const wrapped: Env = { ...env, PLAN: readOnly(env.PLAN), AUFMASS: readOnly(env.AUFMASS) };
    try {
      if (!url.pathname.startsWith('/api/')) {
        await identify(request, env);
        return await env.ASSETS.fetch(request);
      }
      return await route(request, wrapped, url);
    }
    catch (e) {
      if (e instanceof HttpError) return reply({ error: e.message }, e.status);
      console.error(e);
      return reply({ error: 'Interner Fehler.' }, 500);
    }
  },
  // Every 15 minutes: pick up changed source records. Around 02:00 Berlin time: full reconcile for deleted reports.
  async scheduled(_e: ScheduledController, env: Env) {
    const wrapped: Env = { ...env, PLAN: readOnly(env.PLAN), AUFMASS: readOnly(env.AUFMASS) };
    await refreshChanged(wrapped, berlinToday());
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    if (hour === 2 && new Date().getUTCMinutes() < 15) await reconcileAll(wrapped);
  },
} satisfies ExportedHandler<Env>;
