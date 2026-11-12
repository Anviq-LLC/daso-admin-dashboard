// Hours and absences from the Montageplanung tables, bucketed on Europe/Berlin days.
export type Punch = { resource_id: string; project_id: string | null; started: string; ended: string | null; pause: number | null };
export type Assignment = { resource_id: string; project_id: string | null; day: string; assignment_type: string };
export type HoursFact = { day: string; resourceId: string; projectId: string; minutes: number; travel: boolean; open: boolean };
export type AbsenceFact = { day: string; resourceId: string; kind: string; review: boolean };

const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
export const berlinDay = (iso: string) => fmt.format(new Date(iso));

// A shift over midnight is counted on its start day; the source has no split either.
export function hoursFacts(punches: Punch[], month: string): HoursFact[] {
  const out: HoursFact[] = [];
  for (const p of punches) {
    const day = berlinDay(p.started);
    if (!day.startsWith(month)) continue;
    const open = !p.ended;
    const minutes = open ? 0 : Math.max(0, Math.round((Date.parse(p.ended!) - Date.parse(p.started)) / 60000 - (p.pause || 0)));
    out.push({ day, resourceId: p.resource_id, projectId: p.project_id || '', minutes, travel: !p.project_id, open });
  }
  return out;
}

export const ABSENCE_KINDS: Record<string, string> = { vacation: 'Urlaub', sick: 'Krank', unpaid: 'Unbezahlt' };

// A project booking on the same day as an absence cannot be valued without a half-day rule: it is flagged.
export function absenceFacts(rows: Assignment[], month: string): AbsenceFact[] {
  const byKey = new Map<string, Assignment[]>();
  for (const a of rows) if (a.day.startsWith(month)) (byKey.get(a.resource_id + '|' + a.day) || byKey.set(a.resource_id + '|' + a.day, []).get(a.resource_id + '|' + a.day)!).push(a);
  const out: AbsenceFact[] = [];
  for (const list of byKey.values()) {
    const away = list.find((a) => a.assignment_type in ABSENCE_KINDS);
    if (!away) continue;
    out.push({ day: away.day, resourceId: away.resource_id, kind: away.assignment_type, review: list.some((a) => a.project_id && a.assignment_type === 'project') });
  }
  return out;
}
