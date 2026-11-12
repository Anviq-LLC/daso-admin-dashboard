import type { Env } from './auth.ts';
import { holidaysRP } from '../calc/holidays.ts';
import type { ApprovalMode, Target } from '../calc/rules.ts';

export type Settings = {
  approval: ApprovalMode;
  targets: { from: string; dailyCents: number; referenceDays: number }[];
  employerPct: number; defaultHourly: number; modelSaturdayBonus: boolean; saturdayForecastCents: number;
  taxReservePct: number; extraHolidays: string[];
};
export const DEFAULTS: Settings = {
  approval: 'saved', targets: [{ from: '2026-01-01', dailyCents: 40_000, referenceDays: 20 }],
  employerPct: 21, defaultHourly: 2_000, modelSaturdayBonus: true, saturdayForecastCents: 0, taxReservePct: 30, extraHolidays: [],
};

export async function loadSettings(env: Env): Promise<Settings> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'main'").first<{ value: string }>();
  return { ...DEFAULTS, ...(row ? JSON.parse(row.value) : {}) };
}
export async function saveSettings(env: Env, s: Settings) {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('main', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(s)).run();
}

export function targetFor(s: Settings, month: string): Target {
  const t = [...s.targets].sort((a, b) => b.from.localeCompare(a.from)).find((x) => x.from <= month + '-01') || s.targets[0] || DEFAULTS.targets[0];
  return { dailyCents: t.dailyCents, referenceDays: t.referenceDays };
}
export function holidaySet(s: Settings, year: number): Set<string> {
  return new Set([...Object.keys(holidaysRP(year)), ...s.extraHolidays.filter((d) => d.startsWith(String(year)))]);
}

// Minimal validation at the trust boundary: the settings are edited by hand.
export function checkSettings(v: unknown): Settings {
  const o = v as Partial<Settings>;
  const int = (n: unknown, lo: number, hi: number) => Number.isSafeInteger(n) && (n as number) >= lo && (n as number) <= hi;
  if (o.approval !== 'saved' && o.approval !== 'customer') throw new Error('Ungültiger Freigabemodus.');
  if (!Array.isArray(o.targets) || !o.targets.length || !o.targets.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.from) && int(t.dailyCents, 0, 10_000_000) && int(t.referenceDays, 1, 23))) throw new Error('Ungültiger Tagessollwert.');
  if (!int(o.employerPct, 0, 100) || !int(o.defaultHourly, 0, 100_000) || !int(o.saturdayForecastCents, 0, 100_000_000) || !int(o.taxReservePct, 0, 100)) throw new Error('Ungültige Zahl in den Einstellungen.');
  return { ...DEFAULTS, ...o, modelSaturdayBonus: !!o.modelSaturdayBonus, extraHolidays: (o.extraHolidays || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) } as Settings;
}
