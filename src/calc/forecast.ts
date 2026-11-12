// Forecasts are labelled as such and never mixed into booked actuals.
const dow = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay();
const daysIn = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: new Date(Date.UTC(y, m, 0)).getUTCDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};

export type MonthForecast = {
  ist: number; forecast: number; avgWeekday: number | null; remainingWeekdays: number; remainingSaturdays: number;
  productiveDays: number; assumptions: string[];
};

// asOf: last day with data (inclusive). A finished month has asOf at or after its last day.
export function forecastMonth(opts: {
  month: string; asOf: string; revenueByDay: Record<string, number>; holidays: ReadonlySet<string>; saturdayCents: number;
}): MonthForecast {
  const days = daysIn(opts.month);
  let ist = 0, sum = 0, n = 0;
  for (const d of days) {
    const v = opts.revenueByDay[d] || 0;
    if (d > opts.asOf) continue;
    ist += v;
    if (dow(d) >= 1 && dow(d) <= 5 && v > 0) { sum += v; n++; }
  }
  const future = days.filter((d) => d > opts.asOf);
  const remainingWeekdays = future.filter((d) => dow(d) >= 1 && dow(d) <= 5 && !opts.holidays.has(d)).length;
  const remainingSaturdays = future.filter((d) => dow(d) === 6).length;
  const avg = n ? Math.round(sum / n) : null;
  const forecast = ist + (avg ?? 0) * remainingWeekdays + opts.saturdayCents * remainingSaturdays;
  const assumptions = [
    avg === null ? 'Keine Umsatztage im Monat: Prognose entspricht dem Ist.' : `Durchschnitt produktiver Werktage (${n} Tage) auf ${remainingWeekdays} verbleibende Werktage ohne Feiertage.`,
    `Samstage separat: ${remainingSaturdays} verbleibende x ${(opts.saturdayCents / 100).toFixed(2)} EUR (einstellbare Annahme).`,
  ];
  return { ist, forecast, avgWeekday: avg, remainingWeekdays, remainingSaturdays, productiveDays: n, assumptions };
}

export type YearPoint = { month: string; kind: 'ist' | 'prognose' | 'hochrechnung'; revenue: number };

// Closed months are actuals, the running month its forecast, later months the mean of those so far (no seasonality).
export function forecastYear(year: number, today: string, revenue: Record<string, number>, running: number, withData: ReadonlySet<string> | null = null): { points: YearPoint[]; total: number; note: string } {
  const cur = today.slice(0, 7);
  const points: YearPoint[] = [];
  const known: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    if (key < cur) { points.push({ month: key, kind: 'ist', revenue: revenue[key] || 0 }); if (!withData || withData.has(key)) known.push(revenue[key] || 0); }
    else if (key === cur) { points.push({ month: key, kind: 'prognose', revenue: running }); known.push(running); }
  }
  const mean = known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : 0;
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    if (key > cur) points.push({ month: key, kind: 'hochrechnung', revenue: mean });
  }
  points.sort((a, b) => a.month.localeCompare(b.month));
  return { points, total: points.reduce((s, p) => s + p.revenue, 0), note: 'Restmonate = Mittel der bisherigen Monate, ohne Saisonannahme. Keine BWA.' };
}
