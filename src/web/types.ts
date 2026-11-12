import type { monthReport, yearReport } from '../worker/data.ts';

export type MonthData = Awaited<ReturnType<typeof monthReport>>;
export type YearData = Awaited<ReturnType<typeof yearReport>>;
export type Me = { email: string; role: 'gf' | 'buchhaltung' | 'viewer'; sensitive: boolean; today: string };
