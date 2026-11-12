export async function api<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers: Record<string, string> = {};
  let body = init?.body;
  if (init?.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(init.json); }
  const res = await fetch(path, { ...init, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Fehler ${res.status}`);
  return data as T;
}

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export const money = (c: number | null | undefined) => (c === null || c === undefined ? '–' : eur.format(c / 100));
export const hours = (min: number) => (min / 60).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const dayLabel = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
export const monthLabel = (m: string) => new Date(m + '-15T12:00:00Z').toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
// euro text ("1.234,50") to cents
export const toCents = (v: string) => {
  const n = Number(v.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
export const download = (path: string) => { window.location.href = path; };
