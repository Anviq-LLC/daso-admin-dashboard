import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, money, toCents } from '../api.ts';
import type { Me } from '../types.ts';

type CostType = { id: string; name: string; category: string; monthly_cents: number; valid_from: string; valid_to: string | null; doc_url: string; note: string };
type Entry = { id: string; day: string; kind: string; project_id: string; firm: string; subcategory: string; cents: number; doc_url: string; note: string };
const KIND = { sub: 'Sub-Kosten', alex: 'Alex (ext. Bauleitung)', other: 'Sonstiges' } as const;

export function Costs({ me, month, onChange }: { me: Me; month: string; onChange: () => void }) {
  const [types, setTypes] = useState<CostType[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [err, setErr] = useState('');
  const allowed = me.role === 'gf' || me.role === 'buchhaltung';
  const load = useCallback(() => {
    api<CostType[]>('/api/cost-types').then(setTypes).catch((e) => setErr(e.message));
    if (month) api<Entry[]>(`/api/cost-entries?month=${month}`).then(setEntries).catch((e) => setErr(e.message));
  }, [month]);
  useEffect(load, [load]);
  const done = () => { load(); onChange(); };
  const fail = (e: unknown) => setErr((e as Error).message);
  const form = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setErr(''); return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; };

  const saveType = async (e: FormEvent<HTMLFormElement>) => {
    const f = form(e); const monthly = toCents(f.monthly);
    if (Number.isNaN(monthly)) return setErr('Betrag ungültig.');
    try { await api('/api/cost-types', { method: 'POST', json: { name: f.name, category: f.category || 'overhead', monthly, validFrom: f.validFrom, docUrl: f.docUrl, note: f.note, replaces: f.replaces || undefined } }); (e.target as HTMLFormElement).reset(); done(); } catch (x) { fail(x); }
  };
  const saveEntry = async (e: FormEvent<HTMLFormElement>) => {
    const f = form(e); const cents = toCents(f.amount);
    if (Number.isNaN(cents)) return setErr('Betrag ungültig.');
    try { await api('/api/cost-entries', { method: 'POST', json: { day: f.day, kind: f.kind, projectId: f.projectId, firm: f.firm, subcategory: f.subcategory, cents, docUrl: f.docUrl, note: f.note } }); (e.target as HTMLFormElement).reset(); done(); } catch (x) { fail(x); }
  };
  const del = async (id: string) => { try { await api(`/api/cost-entries?id=${id}`, { method: 'DELETE' }); done(); } catch (x) { fail(x); } };
  const active = types.filter((t) => !t.valid_to || t.valid_to >= month + '-01');

  return (
    <>
      {err && <div className="warn err">{err}</div>}
      <section className="card">
        <h2>Monatliche Kostenarten</h2>
        <div className="scroll"><table><thead><tr><th>Name</th><th>Kategorie</th><th>Monatlich</th><th>Gültig ab</th><th>bis</th><th>Beleg</th><th>Notiz</th></tr></thead><tbody>
          {types.map((t) => <tr key={t.id} style={{ opacity: active.includes(t) ? 1 : .55 }}><td>{t.name}</td><td>{t.category}</td><td>{money(t.monthly_cents)}</td><td>{t.valid_from}</td><td>{t.valid_to || '–'}</td><td>{t.doc_url ? <a href={t.doc_url} target="_blank" rel="noreferrer">Beleg</a> : ''}</td><td>{t.note}</td></tr>)}
        </tbody></table></div>
        <small className="muted">Eine Änderung legt eine neue Zeile mit Gültigkeitsdatum an; die alte endet am Vortag. Nichts wird überschrieben. Abgrenzung von Büro, Kfz, AGK und BGK bitte mit dem Kontenmapping abgleichen, damit nichts doppelt zählt.</small>
        {allowed && <form className="row" onSubmit={saveType} style={{ marginTop: 10 }}>
          <label>Name<input name="name" required defaultValue="" list="names" /></label>
          <datalist id="names">{['Büro', 'Kfz', 'AGK', 'BGK'].map((n) => <option key={n} value={n} />)}</datalist>
          <label>Betrag/Monat (EUR)<input name="monthly" required inputMode="decimal" /></label>
          <label>Gültig ab<input name="validFrom" type="date" required defaultValue={month + '-01'} /></label>
          <label>Ersetzt<select name="replaces"><option value="">neue Kostenart</option>{active.map((t) => <option key={t.id} value={t.id}>{t.name} ({money(t.monthly_cents)})</option>)}</select></label>
          <label>Beleg/Excel (https)<input name="docUrl" type="url" /></label>
          <label>Notiz<input name="note" /></label>
          <button className="btn primary">Speichern</button>
        </form>}
      </section>

      <section className="card">
        <h2>Einzelbuchungen im Monat</h2>
        <div className="scroll"><table><thead><tr><th>Datum</th><th>Art</th><th>Projekt</th><th>Firma</th><th>Unterkategorie</th><th>Betrag</th><th>Beleg</th><th>Notiz</th><th></th></tr></thead><tbody>
          {entries.map((x) => <tr key={x.id}><td>{x.day}</td><td>{KIND[x.kind as keyof typeof KIND]}</td><td>{x.project_id || 'übergreifend'}</td><td>{x.firm}</td><td>{x.subcategory}</td><td>{money(x.cents)}</td><td>{x.doc_url ? <a href={x.doc_url} target="_blank" rel="noreferrer">Beleg</a> : ''}</td><td>{x.note}</td><td>{allowed && <button className="btn" onClick={() => del(x.id)}>Löschen</button>}</td></tr>)}
        </tbody></table></div>
        <small className="muted">Übergreifende Posten (ohne Projekt) gehen in die Gemeinkosten und werden proportional verteilt, nie mehreren Projekten voll zugerechnet. Hebebühnen sind keine feste Kostenart: unter Sonstiges mit freier Unterkategorie erfassen.</small>
        {allowed && <form className="row" onSubmit={saveEntry} style={{ marginTop: 10 }}>
          <label>Art<select name="kind">{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Datum<input name="day" type="date" required defaultValue={month + '-01'} /></label>
          <label>Projekt-ID (leer = übergreifend)<input name="projectId" /></label>
          <label>Sub-Firma<input name="firm" /></label>
          <label>Unterkategorie<input name="subcategory" /></label>
          <label>Betrag (EUR)<input name="amount" required inputMode="decimal" /></label>
          <label>Beleg (https)<input name="docUrl" type="url" /></label>
          <label>Notiz<input name="note" /></label>
          <button className="btn primary">Buchen</button>
        </form>}
      </section>
      {me.role === 'gf' && <Wages />}
    </>
  );
}

function Wages() {
  const [rows, setRows] = useState<{ resource_id: string; valid_from: string; hourly_cents: number }[]>([]);
  const [err, setErr] = useState('');
  const load = () => api<typeof rows>('/api/wages').then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const hourly = toCents(f.hourly); if (Number.isNaN(hourly)) return setErr('Betrag ungültig.');
    try { await api('/api/wages', { method: 'POST', json: { resourceId: f.resourceId, validFrom: f.validFrom, hourly } }); load(); } catch (x) { setErr((x as Error).message); }
  };
  return (
    <section className="card">
      <h2>Stundenlöhne für die Personalkosten-Schätzung</h2>
      {err && <div className="err">{err}</div>}
      <table><thead><tr><th>Mitarbeiter-ID</th><th>ab</th><th>Brutto/h</th></tr></thead><tbody>{rows.map((r) => <tr key={r.resource_id + r.valid_from}><td>{r.resource_id}</td><td>{r.valid_from}</td><td>{money(r.hourly_cents)}</td></tr>)}</tbody></table>
      <form className="row" onSubmit={save} style={{ marginTop: 8 }}>
        <label>Mitarbeiter-ID<input name="resourceId" required /></label><label>Gültig ab<input name="validFrom" type="date" required /></label>
        <label>Brutto/h (EUR)<input name="hourly" required inputMode="decimal" /></label><button className="btn primary">Speichern</button>
      </form>
      <small className="muted">Ohne Eintrag gilt der Standardlohn aus den Einstellungen. Personalkosten bleiben eine Schätzung, bis das LohnTool die Ist-Werte liefert.</small>
    </section>
  );
}
