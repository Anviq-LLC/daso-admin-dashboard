import { useState } from 'react';
import { download, hours, money } from '../api.ts';
import type { MonthData } from '../types.ts';

const KIND: Record<string, string> = { vacation: 'U', sick: 'K', unpaid: 'UU', holiday: 'F' };

export function People({ d, month }: { d: MonthData; month: string }) {
  const [sel, setSel] = useState('');
  const emp = d.employees;
  const days = d.daily.map((x) => x.day);
  const dow = (day: string) => new Date(day + 'T12:00:00Z').getUTCDay();
  return (
    <>
      <section className="card">
        <div className="row"><h2>Mitarbeiter</h2><span className="spacer" /><button className="btn" onClick={() => download(`/api/export?what=employees&month=${month}`)}>CSV</button></div>
        <div className="scroll"><table>
          <thead><tr><th>Mitarbeiter</th><th>Realer Umsatz 90 %</th><th>Fiktiver Ausgleich</th><th>Bewertungsumsatz</th><th>Stunden</th><th>Abwesend</th><th>Samstag-Kennzahl 40 %</th><th>Prüfen</th></tr></thead>
          <tbody>{emp.map((e) => (
            <tr key={e.id} className="click" onClick={() => setSel(sel === e.id ? '' : e.id)}>
              <td>{e.name} {e.code && <span className="chip">{e.code}</span>}</td><td>{money(e.real)}</td><td>{money(e.fiction)}</td><td>{money(e.valuation)}</td>
              <td>{hours(e.workMinutes)}</td><td>{e.absenceDays}</td><td>{money(e.saturdayIndicator)}</td>
              <td className={e.reviewDays.length ? 'err' : ''}>{e.reviewDays.length ? `${e.reviewDays.length} Tag(e)` : ''}</td>
            </tr>))}</tbody>
        </table></div>
        <small className="muted">Ranking nach realem 90-%-Umsatz. Fiktiver Ausgleich ist nur eine interne Bewertung (kein Umsatz, kein Erlös) und fließt nicht in das Ranking. Samstag-Kennzahl = Samstags-Kundenumsatz × 0,9 × 0,4, Datenpunkt für das LohnTool.</small>
      </section>

      <section className="card">
        <h2>Kalender</h2>
        <div className="scroll"><table className="cal">
          <thead><tr><th>Mitarbeiter</th>{days.map((x) => <th key={x}>{x.slice(8)}</th>)}</tr></thead>
          <tbody>{emp.filter((e) => !sel || e.id === sel).map((e) => (
            <tr key={e.id}><td>{e.code || e.name}</td>{days.map((x) => {
              const c = e.perDay[x];
              return <td key={x} className={c?.absence ? 'abs' : dow(x) === 0 || dow(x) === 6 ? 'sat' : ''} title={c ? `${money(c.real)} · ${hours(c.minutes)} h` : ''}>
                {c?.absence ? KIND[c.absence] : c ? (c.real ? Math.round(c.real / 100) : '') : ''}{c && c.minutes ? <div className="muted">{hours(c.minutes)}h{c.sites > 1 ? ` (${c.sites})` : ''}</div> : null}
              </td>;
            })}</tr>))}</tbody>
        </table></div>
        <small className="muted">Zahl = 90-%-Umsatz in Euro, darunter Stunden (in Klammern: Anzahl Baustellen). U Urlaub, K Krank, UU unbezahlt, F Feiertag. Klick auf eine Zeile oben filtert den Kalender.</small>
      </section>
    </>
  );
}
