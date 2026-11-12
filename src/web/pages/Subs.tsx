import { useState } from 'react';
import { dayLabel, download, money } from '../api.ts';
import type { MonthData } from '../types.ts';

export function Subs({ d, month }: { d: MonthData; month: string }) {
  const [firm, setFirm] = useState('');
  const rows = d.subDays.filter((r) => !firm || r.firm === firm);
  const projects = [...new Set(rows.map((r) => r.project))];
  return (
    <>
      <section className="card">
        <div className="row"><h2>Nachunternehmer</h2><span className="spacer" /><button className="btn" onClick={() => download(`/api/export?what=subs&month=${month}`)}>CSV</button></div>
        <div className="scroll"><table>
          <thead><tr><th>Firma</th><th>Umsatz</th><th>Kosten</th><th>Gewinn</th><th>Personentage</th><th>Ø Tagessatz je Person</th><th>Tage</th><th>Projekte</th></tr></thead>
          <tbody>{d.subs.map((s) => (
            <tr key={s.firm} className="click" onClick={() => setFirm(firm === s.firm ? '' : s.firm)}>
              <td>{s.firm}</td><td>{money(s.revenue)}</td><td>{money(s.cost)}</td><td className={s.profit < 0 ? 'err' : ''}>{money(s.profit)}</td>
              <td>{s.personDays}</td><td>{s.perPersonDay === null ? 'keine Berechnung' : money(s.perPersonDay)}</td><td>{s.days}</td><td>{s.projects}</td>
            </tr>))}</tbody>
        </table></div>
        <small className="muted">Eine eingesetzte Person zählt als 1, unabhängig von den Stunden. Subdaten kommen ausschließlich aus dem Aufmaß-Tool; fehlende Stunden werden nicht geschätzt (Kosten dann leer). Firmennamen lassen sich unter Einstellungen zusammenführen.</small>
      </section>

      <section className="card">
        <h2>{firm || 'Alle Firmen'}: Projekte und Teams</h2>
        {projects.map((p) => (
          <div key={p}>
            <h2 style={{ fontSize: 14, marginTop: 12 }}>{p}</h2>
            <div className="scroll"><table>
              <thead><tr><th>Tag</th><th>Firma / Team</th><th>Umsatz</th><th>Kosten</th><th>Personen</th><th>Umsatz je Person</th></tr></thead>
              <tbody>{rows.filter((r) => r.project === p).map((r, i) => (
                <tr key={i}><td>{dayLabel(r.day)} {r.estimated && <span className="chip est" title="Aufmaß über mehrere Tage, nach Kosten verteilt">verteilt</span>}</td>
                  <td>{r.firm} {r.team}</td><td>{money(r.revenue)}</td><td>{money(r.cost)}</td><td>{r.heads ?? '–'}</td><td>{r.perHead === null ? 'keine Berechnung' : money(r.perHead)}</td></tr>))}</tbody>
            </table></div>
          </div>))}
        {!rows.length && <p className="muted">Keine verbindlichen Sub-Umsätze in diesem Monat.</p>}
      </section>
    </>
  );
}
