import { LIFT_NAME, type PlannedLift } from '../engine';

/** Rest lengths in seconds. Becomes a setting in phase 5. */
export const REST_SECONDS = { warmup: 60, work: 180, supplemental: 90 } as const;

export function schemeLabel(l: PlannedLift): string {
  if (l.scheme === '531') return `5/3/1 · week ${l.waveWeek}`;
  if (l.scheme.startsWith('7th_')) {
    return l.sevenType === 'tm_test' ? '7th week · TM test' : '7th week · deload';
  }
  return l.scheme.replace('x', '×');
}

/** One-line weight summary for Home: "155" for linear, "65 · 75 · 85" for 5/3/1. */
export function weightSummary(l: PlannedLift): string {
  const work = l.sets.filter((s) => s.type !== 'supplemental');
  const uniq = [...new Set(work.map((s) => s.weight))];
  return uniq.join(' · ');
}

export { LIFT_NAME };
