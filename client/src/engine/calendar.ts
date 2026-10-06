import type { Session } from './types';

export type DayStatus = 'finished' | 'unfinished';

/**
 * Calendar status per local date. Green (finished) wins over yellow (started, never finished)
 * when a day has both. Dates with no workout are absent. Drafts in progress don't show.
 */
export function dayStatuses(sessions: Session[]): Map<string, DayStatus> {
  const out = new Map<string, DayStatus>();
  for (const s of sessions) {
    if (s.deleted) continue;
    if (s.finishedAt) out.set(s.date, 'finished');
    else if (s.abandonedAt && !out.has(s.date)) out.set(s.date, 'unfinished');
  }
  return out;
}

/** Count for "Total workouts: X": finished, non-deleted sessions only. */
export function totalWorkouts(sessions: Session[]): number {
  return sessions.filter((s) => !s.deleted && s.finishedAt).length;
}

/**
 * Month grid, weeks as rows of 7. `weekStart`: 0 = Sunday … 6 = Saturday.
 * Cells outside the month are null.
 */
export function monthGrid(year: number, month0: number, weekStart: number): (string | null)[][] {
  const p = (n: number) => String(n).padStart(2, '0');
  const first = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const lead = (first - weekStart + 7) % 7;
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${p(month0 + 1)}-${p(d)}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Locale's first day of the week as 0 = Sunday … 6 = Saturday. Falls back to Sunday. */
export function localeWeekStart(locale?: string): number {
  try {
    const loc = new Intl.Locale(locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US')) as Intl.Locale & {
      weekInfo?: { firstDay: number };
      getWeekInfo?: () => { firstDay: number };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info) return info.firstDay % 7; // Intl: 1 = Monday … 7 = Sunday
  } catch {
    // fall through
  }
  return 0;
}

/** Finished sessions on one date, in time order. */
export function finishedOnDate(sessions: Session[], date: string): Session[] {
  return sessions.filter((s) => !s.deleted && s.finishedAt && s.date === date).sort((a, b) => (a.finishedAt! < b.finishedAt! ? -1 : 1));
}
