// BWA / SuSa rows -> buckets. A file is never summed with another file for the same period.
export type Line = { account: string; label: string; cents: number };
export type Mapping = { pattern: string; bucket: string };
export const BUCKETS = ['umsatz', 'personal', 'sub', 'material', 'buero', 'kfz', 'agk', 'bgk', 'sonstige_kosten', 'zinsen', 'steuern', 'ignorieren'] as const;
export const COST_BUCKETS = ['personal', 'sub', 'material', 'buero', 'kfz', 'agk', 'bgk', 'sonstige_kosten'];

// "1.234,56", "-1234.5", "1.234,56-", "1.234,56 H" -> cents (trailing minus or H = negative as the DATEV export writes it)
export function parseAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/\s|€|EUR/gi, '');
  if (!/\d/.test(s)) return null;
  let neg = false;
  if (/[-]$/.test(s)) { neg = true; s = s.slice(0, -1); }
  if (/[HhSs]$/.test(s)) { neg = neg || /[Hh]$/.test(s); s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) * (neg ? -1 : 1);
}

// Spreadsheet rows: first 3-8 digit cell is the account (SuSa), first text cell the label, last amount cell the balance.
export function linesFromRows(rows: unknown[][]): Line[] {
  const out: Line[] = [];
  for (const row of rows) {
    const cells = row.map((c) => (c === null || c === undefined ? '' : c));
    let account = '', label = '', cents: number | null = null;
    for (const c of cells) {
      const t = String(c).trim();
      if (!account && /^\d{3,8}$/.test(t)) { account = t; continue; }
      if (!label && t && parseAmount(t) === null) label = t;
    }
    for (let k = cells.length - 1; k >= 0; k--) {
      const t = String(cells[k]).trim();
      if (t === String(account)) continue;
      const a = parseAmount(cells[k]);
      if (a !== null && t !== '') { cents = a; break; }
    }
    if (cents !== null && (account || label)) out.push({ account, label, cents });
  }
  return out;
}

// PDF text pasted into the review mask: "4120 Gehaelter 12.345,67" per line.
export function linesFromText(text: string): Line[] {
  return linesFromRows(text.split(/\r?\n/).map((l) => {
    const m = l.trim().match(/^(\d{3,8})?\s*(.*?)\s+(-?[\d.]+,\d{2}-?\s?[HS]?)$/i);
    return m ? [m[1] || '', m[2], m[3]] : [];
  }));
}

export function bucketOf(line: Line, mapping: Mapping[]): string {
  for (const m of mapping) {
    if (m.pattern.startsWith('~')) { if (line.label.toLowerCase().includes(m.pattern.slice(1).toLowerCase())) return m.bucket; }
    else if (line.account && line.account.startsWith(m.pattern)) return m.bucket;
  }
  return '';
}

export function summarize(lines: (Line & { bucket: string })[]) {
  const by: Record<string, number> = {};
  for (const l of lines) if (l.bucket && l.bucket !== 'ignorieren') by[l.bucket] = (by[l.bucket] || 0) + l.cents;
  // SuSa writes credits (Haben, revenue) as negative and debits (Soll, costs) as positive: compare magnitudes per bucket.
  const revenue = Math.abs(by.umsatz || 0);
  const costs = COST_BUCKETS.reduce((s, b) => s + Math.abs(by[b] || 0), 0);
  const operating = revenue - costs;
  const beforeTax = operating - Math.abs(by.zinsen || 0);
  return { by, revenue, costs, operating, beforeTax, margin: revenue ? Math.round((operating / revenue) * 1000) / 10 : null };
}

// Expected cost by standard category from the last actual period; the suggestion never changes a booked value.
export const SUGGEST: Record<string, string> = { Büro: 'buero', Kfz: 'kfz', AGK: 'agk', BGK: 'bgk' };
export function suggest(by: Record<string, number>, current: { name: string; monthly: number }[]) {
  return current.filter((c) => SUGGEST[c.name]).map((c) => {
    const proposed = Math.abs(by[SUGGEST[c.name]] || 0);
    return { name: c.name, current: c.monthly, proposed, deviation: proposed - c.monthly };
  });
}

// Typical DATEV BWA labels and SKR03 ranges as a starting point. Real files must be checked in the review mask.
export const DEFAULT_MAPPING: Mapping[] = [
  { pattern: '~umsatzerl', bucket: 'umsatz' }, { pattern: '8', bucket: 'umsatz' },
  { pattern: '~personalkosten', bucket: 'personal' }, { pattern: '41', bucket: 'personal' },
  { pattern: '~fremdleistung', bucket: 'sub' }, { pattern: '~nachunternehmer', bucket: 'sub' }, { pattern: '3100', bucket: 'sub' },
  { pattern: '~wareneinsatz', bucket: 'material' }, { pattern: '3', bucket: 'material' },
  { pattern: '~raumkosten', bucket: 'buero' }, { pattern: '~bürobedarf', bucket: 'buero' }, { pattern: '49', bucket: 'buero' },
  { pattern: '~kfz', bucket: 'kfz' }, { pattern: '~fahrzeug', bucket: 'kfz' }, { pattern: '4530', bucket: 'kfz' },
  { pattern: '~zinsen', bucket: 'zinsen' }, { pattern: '~summe', bucket: 'ignorieren' }, { pattern: '~gesamt', bucket: 'ignorieren' },
];
