import { fmtWeight, LIFT_NAME, type PlannedLift } from '../engine';

export function schemeLabel(l: PlannedLift): string {
  if (l.paused) return 'Paused';
  if (l.scheme === 'rehab') return `${l.sets.length} × ${l.sets[0]?.reps ?? ''}`;
  if (l.scheme === '531') return `5/3/1 · week ${l.waveWeek}`;
  if (l.scheme.startsWith('7th_')) {
    return l.sevenType === 'tm_test' ? '7th week · TM test' : '7th week · deload';
  }
  return l.scheme.replace('x', '×');
}

/** One-line weight summary for Home: "155" for linear, "65 · 75 · 85" for 5/3/1, "2 × 15 lb" for dumbbells. */
export function weightSummary(l: PlannedLift): string {
  if (l.paused) return '—';
  if (l.perHand) return `2 × ${fmtWeight(l.workingWeight)} lb`;
  const work = l.sets.filter((s) => s.type !== 'supplemental');
  const uniq = [...new Set(work.map((s) => s.weight))];
  return uniq.join(' · ');
}

export { LIFT_NAME };
