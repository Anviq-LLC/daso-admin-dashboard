import { download, money } from '../api.ts';
import type { MonthData } from '../types.ts';

export function Projects({ d, month }: { d: MonthData; month: string }) {
  const total = d.projects.reduce((s, p) => s + p.revenue, 0);
  return (
    <section className="card">
      <div className="row"><h2>Projektwirtschaftlichkeit</h2><span className="spacer" /><button className="btn" onClick={() => download(`/api/export?what=projects&month=${month}`)}>CSV</button></div>
      <div className="scroll"><table>
        <thead><tr><th>Projekt</th><th>Umsatz</th><th>Sub-Kosten</th><th>Sonstige direkt</th><th>Personal (Schätzung)</th><th>Gewinn vor Gemeinkosten</th><th>Gemeinkostenanteil</th><th>Gewinn nach Gemeinkosten</th></tr></thead>
        <tbody>{d.projects.map((p) => (
          <tr key={p.id}><td>{p.label}</td><td>{money(p.revenue)}</td>
            <td title={`Quelle: ${p.subCostSource}`}>{p.subCostMissing ? 'unvollständig' : money(p.subCost)} <span className="chip">{p.subCostSource}</span></td>
            <td>{money(p.other)}</td><td>{d.costs.personnel === null ? '–' : money(p.personnelEstimate)}</td>
            <td className={p.before < 0 ? 'err' : ''}>{money(p.before)}</td><td>{money(p.overhead)}</td><td className={p.after !== null && p.after < 0 ? 'err' : ''}>{money(p.after)}</td></tr>))}
        </tbody>
        <tfoot><tr><td>Summe</td><td>{money(total)}</td><td colSpan={4}></td><td>{money(d.costs.overhead)}</td><td>{d.profit === null ? '–' : money(d.profit)}</td></tr></tfoot>
      </table></div>
      <small className="muted">Gemeinkosten (Büro, Kfz, AGK, BGK und übergreifende Posten) werden einmal erfasst und im Verhältnis zum Projektumsatz verteilt; der Unternehmensgewinn zieht sie nur einmal ab. Ist für ein Projekt keine manuelle Sub-Kostenbuchung vorhanden, werden die Kosten aus dem Aufmaß (Stunden × Satz) genommen.</small>
    </section>
  );
}
