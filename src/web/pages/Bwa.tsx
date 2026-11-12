import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import readXlsxFile from 'read-excel-file';
import { api, money, monthLabel } from '../api.ts';
import { linesFromRows, linesFromText, type Line } from '../../calc/bwa.ts';
import type { Me } from '../types.ts';

type Imp = { id: string; kind: string; period: string; version: number; filename: string; source_format: string; mapping_version: number; imported_by: string; imported_at: string; status: string; unmapped: number };
type Detail = { import: Imp; lines: { n: number; account: string; label: string; cents: number; bucket: string }[]; buckets: string[] };

const csvRows = (t: string) => t.split(/\r?\n/).filter(Boolean).map((l) => l.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, '')));
const toB64 = (buf: ArrayBuffer) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

export function Bwa({ me, month, onChange }: { me: Me; month: string; onChange: () => void }) {
  const [period, setPeriod] = useState(month);
  const [kind, setKind] = useState<'bwa' | 'susa'>('bwa');
  const [list, setList] = useState<Imp[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [cmp, setCmp] = useState<any>(null);
  const [paste, setPaste] = useState('');
  const [err, setErr] = useState('');
  const allowed = me.role === 'gf' || me.role === 'buchhaltung';
  const fail = (e: unknown) => setErr((e as Error).message);

  const load = useCallback(() => {
    api<Imp[]>(`/api/bwa?period=${period}`).then(setList).catch(fail);
    api(`/api/bwa-compare?period=${period}`).then(setCmp).catch(fail);
  }, [period]);
  useEffect(load, [load]);

  const send = async (lines: Line[], filename: string, format: string, file?: string) => {
    setErr('');
    if (!lines.length) return setErr('Keine Zeilen erkannt. Bitte Datei oder Text prüfen.');
    try { const r = await api<{ id: string }>('/api/bwa/import', { method: 'POST', json: { kind, period, filename, format, lines, file } }); await open(r.id); load(); } catch (e) { fail(e); }
  };
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    try {
      const name = f.name.toLowerCase();
      if (name.endsWith('.xlsx')) await send(linesFromRows(await readXlsxFile(f) as unknown[][]), f.name, 'xlsx', toB64(await f.arrayBuffer()));
      else if (name.endsWith('.csv')) await send(linesFromRows(csvRows(await f.text())), f.name, 'csv', toB64(await f.arrayBuffer()));
      else if (name.endsWith('.pdf')) setErr('PDF: Text aus der PDF unten einfügen (eine Zeile je Konto). Die Originaldatei wird beim Import mitgespeichert.'), setPdf(f);
      else setErr('Bitte .xlsx, .csv oder .pdf wählen.');
    } catch (x) { fail(x); }
  };
  const [pdf, setPdf] = useState<File | null>(null);
  const sendPaste = async () => send(linesFromText(paste), pdf?.name || 'eingefügt.txt', pdf ? 'pdf' : 'text', pdf ? toB64(await pdf.arrayBuffer()) : undefined);
  const open = (id: string) => api<Detail>(`/api/bwa/${id}`).then(setDetail).catch(fail);
  const map = async (n: number, bucket: string) => { try { await api(`/api/bwa/${detail!.import.id}/map`, { method: 'POST', json: { n, bucket } }); await open(detail!.import.id); load(); } catch (e) { fail(e); } };
  const accept = async () => { try { await api(`/api/bwa/${detail!.import.id}/accept`, { method: 'POST' }); await open(detail!.import.id); load(); onChange(); } catch (e) { fail(e); } };
  const takeSuggestion = async (name: string, monthly: number) => {
    const d = new Date(Date.parse(period + '-01T00:00:00Z')); d.setUTCMonth(d.getUTCMonth() + 1);
    try { await api('/api/suggestion/accept', { method: 'POST', json: { name, monthly, validFrom: d.toISOString().slice(0, 10) } }); load(); onChange(); } catch (e) { fail(e); }
  };

  return (
    <>
      {err && <div className="warn err">{err}</div>}
      <section className="card">
        <h2>BWA / SuSa importieren</h2>
        <div className="row">
          <label>Periode<input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} /></label>
          <label>Typ<select value={kind} onChange={(e) => setKind(e.target.value as 'bwa' | 'susa')}><option value="bwa">BWA</option><option value="susa">SuSa</option></select></label>
          {allowed && <label>Datei (xlsx, csv, pdf)<input type="file" accept=".xlsx,.csv,.pdf" onChange={onFile} /></label>}
        </div>
        {allowed && pdf && <div style={{ marginTop: 8 }}>
          <label>Text aus der PDF (eine Zeile je Konto: „4120 Gehälter 12.345,67“)<textarea rows={6} style={{ width: '100%' }} value={paste} onChange={(e) => setPaste(e.target.value)} /></label>
          <button className="btn primary" onClick={sendPaste}>Prüfmaske öffnen</button>
        </div>}
        <small className="muted">BWA und SuSa derselben Periode werden nie addiert; ein erneuter Import erzeugt eine neue Version. Jeder Import wird erst nach der Prüfung der Kontenzuordnung übernommen. Das Standard-Mapping ist ein Startpunkt und muss mit echten Dateien des Steuerberaters geprüft werden.</small>
        <div className="scroll"><table><thead><tr><th>Typ</th><th>Version</th><th>Datei</th><th>Importiert</th><th>Status</th><th>Offen</th><th></th></tr></thead><tbody>
          {list.map((i) => <tr key={i.id}><td>{i.kind.toUpperCase()}</td><td>{i.version}</td><td>{i.filename}</td><td>{new Date(i.imported_at).toLocaleString('de-DE')} · {i.imported_by}</td><td>{i.status}</td><td className={i.unmapped ? 'err' : ''}>{i.unmapped}</td><td><button className="btn" onClick={() => open(i.id)}>Prüfen</button></td></tr>)}
        </tbody></table></div>
      </section>

      {detail && (
        <section className="card">
          <div className="row"><h2>Prüfmaske {detail.import.kind.toUpperCase()} v{detail.import.version}, {monthLabel(detail.import.period)}</h2><span className="spacer" />
            {allowed && detail.import.status === 'review' && <button className="btn primary" onClick={accept} disabled={detail.import.unmapped > 0}>Übernehmen</button>}</div>
          <div className="scroll"><table><thead><tr><th>Konto</th><th>Bezeichnung</th><th>Betrag</th><th>Zuordnung</th></tr></thead><tbody>
            {detail.lines.map((l) => <tr key={l.n} style={!l.bucket ? { background: 'color-mix(in srgb, var(--amber) 22%, transparent)' } : undefined}>
              <td>{l.account}</td><td>{l.label}</td><td>{money(l.cents)}</td>
              <td>{allowed && detail.import.status === 'review' ? <select value={l.bucket} onChange={(e) => map(l.n, e.target.value)}><option value="">– wählen –</option>{detail.buckets.map((b) => <option key={b}>{b}</option>)}</select> : l.bucket}</td></tr>)}
          </tbody></table></div>
        </section>
      )}

      <section className="card">
        <h2>Abgleich {monthLabel(period)}</h2>
        {cmp?.source ? <>
          <div className="tiles">
            <div className="tile"><small>BWA/SuSa-Umsatz ({cmp.source.kind.toUpperCase()} v{cmp.source.version})</small><strong>{money(cmp.bwa.revenue)}</strong></div>
            <div className="tile"><small>Operativer Umsatz (Leistungsdatum)</small><strong>{money(cmp.operational)}</strong></div>
            <div className="tile"><small>Differenz</small><strong>{money(cmp.difference)}</strong></div>
            <div className="tile"><small>Betriebsergebnis</small><strong>{money(cmp.bwa.operating)}</strong><small>Marge {cmp.bwa.margin ?? '–'} %</small></div>
            <div className="tile"><small>Steuerreserve (Planung, {cmp.taxReservePct} %)</small><strong>{money(cmp.taxReserve)}</strong><small>kein Steuerbescheid</small></div>
          </div>
          <p className="muted">{cmp.note}</p>
          <h2>Vorschlag Folgemonat</h2>
          <table><thead><tr><th>Kostenart</th><th>Standard</th><th>Ist letzte Periode</th><th>Abweichung</th><th></th></tr></thead><tbody>
            {cmp.suggestion.map((s: any) => <tr key={s.name}><td>{s.name}</td><td>{money(s.current)}</td><td>{money(s.proposed)}</td><td>{money(s.deviation)}</td><td>{me.role === 'gf' && <button className="btn" onClick={() => takeSuggestion(s.name, s.proposed)}>Übernehmen ab Folgemonat</button>}</td></tr>)}
          </tbody></table>
          <small className="muted">Die Übernahme ist der Geschäftsführung vorbehalten und legt eine neue Version an; bestehende Werte werden nicht überschrieben.</small>
        </> : <p className="muted">{cmp?.note || 'Lade…'}</p>}
      </section>
    </>
  );
}
