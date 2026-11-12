// Small inline-SVG bar chart. Hatched bars are forecasts, solid bars are actuals.
import { money } from './api.ts';

export type Bar = { label: string; value: number; kind?: 'ist' | 'prognose' | 'hochrechnung'; second?: number };

export function Bars({ bars, height = 140, line }: { bars: Bar[]; height?: number; line?: number | null }) {
  const w = Math.max(320, bars.length * 26), pad = 18;
  const max = Math.max(1, ...bars.map((b) => b.value + (b.second || 0)), line || 0);
  const bw = (w - 8) / bars.length;
  const y = (v: number) => height - pad - ((height - pad - 6) * v) / max;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" role="img" aria-label="Balkendiagramm" style={{ maxHeight: height * 1.6 }}>
      <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--accent)" opacity=".55" /></pattern></defs>
      <line x1="0" x2={w} y1={height - pad} y2={height - pad} stroke="var(--line)" />
      {bars.map((b, i) => {
        const x = 4 + i * bw;
        return (
          <g key={i}>
            <title>{`${b.label}: ${money(b.value)}${b.kind && b.kind !== 'ist' ? ` (${b.kind})` : ''}`}</title>
            <rect x={x + 1} width={Math.max(2, bw - 3)} y={y(b.value)} height={height - pad - y(b.value)} rx="2" fill={b.kind && b.kind !== 'ist' ? 'url(#hatch)' : 'var(--accent)'} stroke="var(--accent)" strokeWidth={b.kind && b.kind !== 'ist' ? 1 : 0} />
            {b.second ? <rect x={x + 1} width={Math.max(2, bw - 3)} y={y(b.value + b.second)} height={y(b.value) - y(b.value + b.second)} fill="var(--amber)" opacity=".8" /> : null}
            {(bars.length <= 14 || i % 2 === 0) && <text x={x + bw / 2} y={height - 5} textAnchor="middle">{b.label}</text>}
          </g>
        );
      })}
      {line ? <line x1="0" x2={w} y1={y(line)} y2={y(line)} stroke="var(--ok)" strokeDasharray="4 3"><title>Tages-Soll</title></line> : null}
    </svg>
  );
}
