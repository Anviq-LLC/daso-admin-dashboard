import { useEffect, useState } from 'react';
import { api, money, monthLabel } from '../api.ts';
import { Bars } from '../Bars.tsx';
import type { YearData } from '../types.ts';

export function Year({ year }: { year: number }) {
  const [y, setY] = useState<YearData | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { setY(null); api<YearData>(`/api/year?year=${year}`).then(setY).catch((e) => setErr(e.message)); }, [year]);
  if (err) return <div className="warn err">{err}</div>;
  if (!y) return <div className="card">Lade {year}…</div>;
  const kind = Object.fromEntries(y.forecast.points.map((p) => [p.month, p.kind]));
  return (
    <>
      <div className="tiles">
        <div className="tile"><small>Ist-Umsatz {year}</small><strong>{money(y.totals.revenue)}</strong></div>
        <div className="tile"><small>Jahresprognose</small><strong>{money(y.forecast.total)}</strong><small>{y.forecast.note}</small></div>
        <div className="tile"><small>Gewinn Ist (Schätzung)</small><strong>{y.totals.profit === null ? 'ohne Berechtigung' : money(y.totals.profit)}</strong></div>
      </div>
      <section className="card">
        <h2>Monate</h2>
        <Bars bars={y.forecast.points.map((p) => ({ label: p.month.slice(5), value: p.revenue, kind: p.kind }))} height={170} />
        <small className="muted">Volle Balken: Ist. Schraffiert: Prognose (laufender Monat) und Hochrechnung der Restmonate. Die Prognose wird nie als BWA bezeichnet.</small>
        <div className="scroll"><table>
          <thead><tr><th>Monat</th><th>Status</th><th>Umsatz</th><th>Mitarbeiter</th><th>Subs</th><th>Pipeline</th><th>Gemeinkosten</th><th>Direkte Kosten</th><th>Gewinn</th></tr></thead>
          <tbody>{y.months.map((m) => <tr key={m.month}><td>{monthLabel(m.month)}</td><td>{kind[m.month] === 'ist' ? (m.hasData ? 'Ist' : 'keine Daten') : kind[m.month] === 'prognose' ? 'laufend' : 'offen'}</td><td>{money(m.revenue)}</td><td>{money(m.own)}</td><td>{money(m.sub)}</td><td>{money(m.pipeline)}</td><td>{m.overhead === null ? '–' : money(m.overhead)}</td><td>{m.directProject === null ? '–' : money(m.directProject)}</td><td>{m.profit === null ? '–' : money(m.profit)}</td></tr>)}</tbody>
        </table></div>
      </section>
      <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))' }}>
        <section className="card"><h2>Mitarbeiter-Ranking (real, 90 %)</h2><div className="scroll"><table><thead><tr><th>#</th><th>Name</th><th>Real</th><th>Ausgleich</th><th>Bewertung</th></tr></thead><tbody>
          {y.employees.map((e, i) => <tr key={e.id}><td>{i + 1}</td><td>{e.name}</td><td>{money(e.real)}</td><td>{money(e.fiction)}</td><td>{money(e.valuation)}</td></tr>)}</tbody></table></div></section>
        <section className="card"><h2>Sub-Ranking</h2><div className="scroll"><table><thead><tr><th>#</th><th>Firma</th><th>Umsatz</th><th>Gewinn</th></tr></thead><tbody>
          {y.subs.map((s, i) => <tr key={s.firm}><td>{i + 1}</td><td>{s.firm}</td><td>{money(s.revenue)}</td><td>{money(s.profit)}</td></tr>)}</tbody></table></div></section>
        <section className="card"><h2>Projekte Top</h2><table><tbody>{y.projectsTop.map((p) => <tr key={p.id}><td>{p.label}</td><td>{money(p.before)}</td></tr>)}</tbody></table>
          <h2 style={{ marginTop: 12 }}>Projekte Flop</h2><table><tbody>{y.projectsFlop.map((p) => <tr key={p.id}><td>{p.label}</td><td className={p.before < 0 ? 'err' : ''}>{money(p.before)}</td></tr>)}</tbody></table>
          <small className="muted">Gewinn vor Gemeinkosten.</small></section>
      </div>
    </>
  );
}
