import { useEffect, useState, type FormEvent } from 'react';
import { api, money, toCents } from '../api.ts';
import type { Me } from '../types.ts';

type S = { approval: 'saved' | 'customer'; targets: { from: string; dailyCents: number; referenceDays: number }[]; employerPct: number; defaultHourly: number; modelSaturdayBonus: boolean; saturdayForecastCents: number; taxReservePct: number; extraHolidays: string[] };

export function Settings({ me, month }: { me: Me; month: string }) {
  const gf = me.role === 'gf';
  const [s, setS] = useState<S | null>(null);
  const [roles, setRoles] = useState<any[]>([]);
  const [aliases, setAliases] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [keys, setKeys] = useState<{ url: string; spec: string; keys: any[] } | null>(null);
  const [fresh, setFresh] = useState('');
  const load = () => {
    api<S>('/api/settings').then(setS).catch((e) => setMsg(e.message));
    api('/api/aliases').then(setAliases).catch(() => {});
    if (gf) { api('/api/roles').then(setRoles).catch(() => {}); api('/api/audit').then(setAudit).catch(() => {}); api('/api/api-keys').then(setKeys).catch(() => {}); }
  };
  useEffect(load, []);
  if (!s) return <div className="card">{msg || 'Lade…'}</div>;
  const t = s.targets[s.targets.length - 1];
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const daily = toCents(f.daily), sat = toCents(f.sat), hourly = toCents(f.hourly);
    if ([daily, sat, hourly].some(Number.isNaN)) return setMsg('Betrag ungültig.');
    const targets = f.from === t.from ? [...s.targets.slice(0, -1), { from: f.from, dailyCents: daily, referenceDays: Number(f.ref) }] : [...s.targets, { from: f.from, dailyCents: daily, referenceDays: Number(f.ref) }];
    try {
      setS(await api<S>('/api/settings', { method: 'POST', json: { approval: f.approval, targets, employerPct: Number(f.employer), defaultHourly: hourly, modelSaturdayBonus: f.bonus === 'on', saturdayForecastCents: sat, taxReservePct: Number(f.tax), extraHolidays: f.holidays.split(/[\s,]+/).filter(Boolean) } }));
      setMsg('Gespeichert. Bitte Monat aktualisieren, damit die Freigaberegel neu angewendet wird.');
    } catch (x) { setMsg((x as Error).message); }
  };
  const addRole = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try { await api('/api/roles', { method: 'POST', json: { email: f.email, role: f.role, name: f.name, sensitive: f.sensitive === 'on' } }); (e.target as HTMLFormElement).reset(); load(); } catch (x) { setMsg((x as Error).message); }
  };
  const newKey = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try { const r = await api<{ key: string }>('/api/api-keys', { method: 'POST', json: { name: f.name } }); setFresh(r.key); (e.target as HTMLFormElement).reset(); load(); } catch (x) { setMsg((x as Error).message); }
  };
  const addAlias = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try { await api('/api/aliases', { method: 'POST', json: f }); (e.target as HTMLFormElement).reset(); load(); } catch (x) { setMsg((x as Error).message); }
  };
  return (
    <>
      {msg && <div className="warn">{msg}</div>}
      <section className="card">
        <h2>Regeln</h2>
        <form className="row" onSubmit={save} key={JSON.stringify(s)}>
          <label>Freigabe<select name="approval" defaultValue={s.approval} disabled={!gf}><option value="saved">Gespeichertes Aufmaß zählt</option><option value="customer">Kundenfreigabe nötig</option></select></label>
          <label>Tagessoll (EUR)<input name="daily" defaultValue={(t.dailyCents / 100).toFixed(2).replace('.', ',')} disabled={!gf} /></label>
          <label>Referenz-Wochentage<input name="ref" type="number" min={1} max={23} defaultValue={t.referenceDays} disabled={!gf} /></label>
          <label>gilt ab<input name="from" type="date" defaultValue={t.from} disabled={!gf} /></label>
          <label>AG-Aufschlag %<input name="employer" type="number" defaultValue={s.employerPct} disabled={!gf} /></label>
          <label>Standard-Stundenlohn (EUR)<input name="hourly" defaultValue={(s.defaultHourly / 100).toFixed(2).replace('.', ',')} disabled={!gf} /></label>
          <label>Samstag-Prognose je Samstag (EUR)<input name="sat" defaultValue={(s.saturdayForecastCents / 100).toFixed(2).replace('.', ',')} disabled={!gf} /></label>
          <label>Steuerreserve %<input name="tax" type="number" defaultValue={s.taxReservePct} disabled={!gf} /></label>
          <label>Samstagsbonus in Personalkosten modellieren<input name="bonus" type="checkbox" defaultChecked={s.modelSaturdayBonus} disabled={!gf} /></label>
          <label style={{ flex: 1 }}>Zusätzliche Feiertage (JJJJ-MM-TT)<input name="holidays" defaultValue={s.extraHolidays.join(' ')} disabled={!gf} /></label>
          {gf ? <button className="btn primary">Speichern</button> : <small className="muted">Nur die Geschäftsführung ändert Regeln.</small>}
        </form>
        <small className="muted">Tagessoll aktuell {money(t.dailyCents)} bei {t.referenceDays} Referenztagen; eine neue „gilt ab“-Zeile ersetzt den Wert ab diesem Datum, ältere Monate bleiben unverändert. Feiertage: Rheinland-Pfalz (automatisch). Samstagsbonus nur einmal ansetzen: entweder hier modelliert oder später aus dem LohnTool.</small>
      </section>

      <section className="card">
        <h2>Sub-Firmen zusammenführen</h2>
        <table><thead><tr><th>Schreibweise</th><th>zählt als</th></tr></thead><tbody>{aliases.map((a) => <tr key={a.alias}><td>{a.alias}</td><td>{a.canonical}</td></tr>)}</tbody></table>
        {gf && <form className="row" onSubmit={addAlias} style={{ marginTop: 8 }}><label>Schreibweise<input name="alias" required /></label><label>Firma<input name="canonical" required /></label><button className="btn primary">Hinzufügen</button></form>}
        <small className="muted">Im Aufmaß-Tool ist die Firma Freitext. Neue Zuordnungen wirken nach dem nächsten Aktualisieren des Monats.</small>
      </section>

      {gf && <>
        <section className="card">
          <h2>Benutzer</h2>
          <table><thead><tr><th>E-Mail</th><th>Rolle</th><th>Name</th><th>Personalkosten sichtbar</th><th></th></tr></thead><tbody>
            {roles.map((r) => <tr key={r.email}><td>{r.email}</td><td>{r.role}</td><td>{r.name}</td><td>{r.sensitive ? 'ja' : 'nein'}</td><td><button className="btn" onClick={() => api(`/api/roles?email=${encodeURIComponent(r.email)}`, { method: 'DELETE' }).then(load)}>Entfernen</button></td></tr>)}</tbody></table>
          <form className="row" onSubmit={addRole} style={{ marginTop: 8 }}>
            <label>E-Mail<input name="email" type="email" required /></label><label>Name<input name="name" /></label>
            <label>Rolle<select name="role"><option value="viewer">Lesen</option><option value="buchhaltung">Buchhaltung</option><option value="gf">Geschäftsführung</option></select></label>
            <label>Personalkosten sichtbar<input name="sensitive" type="checkbox" /></label><button className="btn primary">Speichern</button>
          </form>
        </section>
        <section className="card">
          <h2>Ereignisprotokoll</h2>
          <div className="scroll"><table><thead><tr><th>Zeit</th><th>Wer</th><th>Aktion</th><th>Detail</th></tr></thead><tbody>{audit.map((a, i) => <tr key={i}><td>{new Date(a.at).toLocaleString('de-DE')}</td><td>{a.actor}</td><td>{a.action}</td><td style={{ whiteSpace: 'normal', textAlign: 'left' }}>{a.detail}</td></tr>)}</tbody></table></div>
        </section>
        <section className="card">
          <h2>Daten-API (nur lesend)</h2>
          {keys && <p>Adresse: <code>{keys.url}</code> · Schnittstellenbeschreibung für ein Custom GPT: <a href={keys.spec} target="_blank" rel="noreferrer">{keys.spec}</a></p>}
          {fresh && <div className="warn"><strong>Neuer Schlüssel (nur jetzt sichtbar):</strong> <code>{fresh}</code><br /><button className="btn" onClick={() => navigator.clipboard.writeText(fresh)}>Kopieren</button> <button className="btn" onClick={() => setFresh('')}>Ausblenden</button></div>}
          <table><thead><tr><th>Name</th><th>Erstellt</th><th>Von</th><th>Status</th><th></th></tr></thead><tbody>
            {keys?.keys.map((k) => <tr key={k.id}><td>{k.name}</td><td>{new Date(k.created_at).toLocaleString('de-DE')}</td><td>{k.created_by}</td><td>{k.revoked ? 'widerrufen' : 'aktiv'}</td><td>{!k.revoked && <button className="btn" onClick={() => api(`/api/api-keys?id=${k.id}`, { method: 'DELETE' }).then(load)}>Widerrufen</button>}</td></tr>)}</tbody></table>
          <form className="row" onSubmit={newKey} style={{ marginTop: 8 }}><label>Name (z. B. „David ChatGPT“)<input name="name" required /></label><button className="btn primary">Schlüssel erzeugen</button></form>
          <small className="muted">Custom GPT: Aktionen, Schema von der obigen Adresse importieren, Authentifizierung „API-Schlüssel“, Typ „Bearer“. Die API liefert nur Umsatz-, Sub- und Projektzahlen, keine Löhne oder Personalkosten, und ändert nichts.</small>
        </section>
        <section className="card">
          <h2>LohnTool-Schnittstelle</h2>
          <p>Zahlen je Mitarbeiter und Monat (kein Lohnlauf) als JSON: <a href={`/api/lohn-export?month=${month}`}>/api/lohn-export?month={month}</a>. Version 1, Beträge in Cent.</p>
        </section>
      </>}
    </>
  );
}
