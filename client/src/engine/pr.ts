import { estimate1RM } from './rounding';
import { finishedSessions } from './state';
import type { Lift, Session } from './types';

/**
 * PR badge for an AMRAP set: beats the lift's best-ever e1RM, or the best reps
 * at that exact weight. Needs prior AMRAP history to compare against.
 */
export function isPR(sessions: Session[], lift: Lift, weight: number, reps: number, excludeSessionId?: string): boolean {
  let prior = 0;
  let bestE1 = 0;
  let bestRepsAtWeight = 0;
  for (const s of finishedSessions(sessions)) {
    if (s.id === excludeSessionId) continue;
    for (const l of s.lifts) {
      if (l.lift !== lift) continue;
      for (const set of l.sets) {
        if (set.type !== 'amrap' || !set.done) continue;
        prior += 1;
        bestE1 = Math.max(bestE1, estimate1RM(set.weight, set.reps));
        if (set.weight === weight) bestRepsAtWeight = Math.max(bestRepsAtWeight, set.reps);
      }
    }
  }
  if (prior === 0) return false;
  return estimate1RM(weight, reps) > bestE1 + 1e-9 || (bestRepsAtWeight > 0 && reps > bestRepsAtWeight);
}
