import { useState } from 'react';
import { api, dayLabel, download, money } from '../api.ts';
import { Bars } from '../Bars.tsx';
import type { MonthData } from '../types.ts';

type Trace = { day: string; own: any[]; sub: any[] };

export function Overview({ d, month }: { d: MonthData; month: string }) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [changes, setChanges] = useState<any[] | null>(null);
  const f = d.forecast;
  const open = (day: string) => api<Trace>(`/api/trace?day=${day}`).then(setTrace);
  const warnings = [...d.warnings, ...d.ingestWarnings];

  return (
    <>
      <div className="tiles">
        <div className="tile"><small>Gesamtumsatz (freigegeben)</small><strong>{money(d.revenue)}</strong><small>Mitarbeiter {money(d.ownRevenue)} · Subs {money(d.subRevenue)}</small></div>
        <div className="tile"><small>Erwarteter Umsatz (Pipeline)</small><strong>{money(d.pipeline.total)}</strong><small>noch nicht verbindlich, nicht in der Summe</small></div>
        <div className="tile"><small>Mitarbeiterumsatz 90 %</small><strong>{money(d.ownEmployeeValue)}</strong><small>Ansicht auf den Mitarbeiterumsatz, kein zusätzlicher Erlös</small></div>
        <div className="tile"><small>Tages-Soll</small><strong>{money(d.dayTarget)}</strong><small>{d.weekdays} Mo–Fr-Tage im Monat</small></div>
        <div className="tile"><small>Gemeinkosten</small><strong>{money(d.costs.overhead)}</strong><small>Fix {money(d.costs.fixedTotal)} · übergreifend {money(d.costs.central)}</small></div>
        <div className="tile"><small>Gewinn (Schätzung)</small><strong>{d.profit === null ? 'ohne Berechtigung' : money(d.profit)}</strong><small>{d.profit === null ? 'Personalkosten nicht freigegeben' : 'inkl. geschätzter Personalkosten ' + money(d.costs.personnel)}</small></div>
        {f && <div className="tile"><small>Prognose Monatsumsatz</small><strong>{money(f.forecast)}</strong><small>Ist {money(f.ist)} · Prognose, keine BWA</small></div>}
        {d.costForecast !== null && <div className="tile"><small>Prognose Kosten</small><strong>{money(d.costForecast)}</strong><small>Fix voll, variabel nach Umsatz</small></div>}
      </div>

      {warnings.length > 0 && <div className="warn"><strong>Hinweise</strong><ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}

      <section className="card">
        <h2>Umsatz je Tag</h2>
        <Bars bars={d.daily.map((x) => ({ label: x.day.slice(8), value: x.own, second: x.sub }))} line={d.dayTarget} />
        <small className="muted">Violett: Mitarbeiter, orange: Subs, gestrichelt: Tages-Soll. Stand {d.dataDate}{d.lastIngest ? `, Daten zuletzt abgeglichen ${new Date(d.lastIngest).toLocaleString('de-DE')}` : ''}. Freigabe: {d.approval === 'saved' ? 'gespeichertes Aufmaß zählt' : 'Kundenfreigabe nötig'}.</small>
      </section>

      {f && <section className="card"><h2>Annahmen der Prognose</h2><ul>{f.assumptions.map((a, i) => <li key={i}>{a}</li>)}<li>Kostenprognose: Fixkosten voll, variable Kosten im Verhältnis zum prognostizierten Umsatz.</li></ul></section>}

      <section className="card">
        <div className="row"><h2>Tage</h2><span className="spacer" /><button className="btn" onClick={() => download(`/api/export?what=days&month=${month}`)}>CSV</button></div>
        <div className="scroll"><table>
          <thead><tr><th>Tag</th><th>Mitarbeiter</th><th>Subs</th><th>Gesamt</th><th>Köpfe</th><th>Umsatz/Kopf</th><th>Soll-Ist je Kopf</th></tr></thead>
          <tbody>{d.daily.filter((x) => x.total || x.heads).map((x) => (
            <tr key={x.day} className="click" onClick={() => open(x.day)}>
              <td>{dayLabel(x.day)}</td><td>{money(x.own)}</td><td>{money(x.sub)}</td><td>{money(x.total)}</td><td>{x.heads}</td>
              <td>{x.perHead === null ? 'keine Berechnung' : money(x.perHead)}</td>
              <td className={x.perHead !== null && x.target !== null ? (x.perHead >= x.target ? 'ok' : 'err') : ''}>{x.perHead !== null && x.target !== null ? money(x.perHead - x.target) : '–'}</td>
            </tr>))}</tbody>
        </table></div>
      </section>

      {trace && (
        <section className="card">
          <div className="row"><h2>Nachweis {dayLabel(trace.day)}</h2><span className="spacer" /><button className="btn" onClick={() => setTrace(null)}>Schließen</button></div>
          <table><thead><tr><th>Aufmaß-ID</th><th>Projekt</th><th>Wer</th><th>Kundenumsatz</th><th>Status</th></tr></thead><tbody>
            {[...trace.own.map((r) => ({ ...r, who: r.name })), ...trace.sub.map((r) => ({ ...r, who: `${r.firm} ${r.team}` }))].map((r, i) => (
              <tr key={i}><td title={r.report_id}>{String(r.report_id).slice(0, 8)}</td><td>{r.label}</td><td>{r.who}</td><td>{money(r.customer_cents)}</td>
                <td>{r.binding ? 'verbindlich' : 'Pipeline'} {r.estimated ? <span className="chip est">auf Tage verteilt</span> : null}</td></tr>))}
          </tbody></table>
          <small className="muted">Mitarbeiterzeilen sind Anteile desselben Kundenumsatzes: ein Aufmaß zählt im Gesamtumsatz nur einmal.</small>
        </section>
      )}

      <section className="card">
        <div className="row"><h2>Änderungsprotokoll</h2><span className="spacer" /><button className="btn" onClick={() => api<any[]>(`/api/changes?month=${month}`).then(setChanges)}>Anzeigen</button></div>
        {changes && (changes.length ? <div className="scroll"><table><thead><tr><th>Zeitpunkt</th><th>Tag</th><th>Bereich</th><th>Aufmaß</th><th>Vorher</th><th>Nachher</th><th>Grund</th></tr></thead><tbody>
          {changes.map((c, i) => <tr key={i}><td>{new Date(c.at).toLocaleString('de-DE')}</td><td>{c.day}</td><td>{c.scope}</td><td>{String(c.report_id).slice(0, 8)}</td><td>{money(c.before_cents)}</td><td>{money(c.after_cents)}</td><td>{c.reason}</td></tr>)}
        </tbody></table></div> : <p className="muted">Keine nachträglichen Änderungen in diesem Monat.</p>)}
      </section>
    </>
  );
}
