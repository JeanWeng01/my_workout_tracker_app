import { planNextSession } from './plan';
import { Timeline } from './testkit';
import type { AccessoryId, ExerciseId, LoggedLift, LoggedSet, PainRating, RehabExercise, SetExercise } from './types';

/** Rehab (dumbbell) lift: `reps` per set actually done; -1 = untouched. `target` is the planned rep target. */
export function rehabLift(ex: RehabExercise, weight: number, target: number, done?: number[], pain?: PainRating): LoggedLift {
  const reps = done ?? [target, target, target];
  const sets: LoggedSet[] = reps.map((r) => ({
    type: 'work',
    targetWeight: weight,
    targetReps: target,
    weight,
    reps: Math.max(r, 0),
    done: r >= 0,
  }));
  return { lift: ex, scheme: 'rehab', skipped: false, sets, ...(pain ? { pain } : {}) };
}

export const pain = (rating: number, sharp = false): PainRating => ({ rating, sharp });

export function withPain(l: LoggedLift, rating: number, sharp = false): LoggedLift {
  return { ...l, pain: { rating, sharp } };
}

/** Accessory or prep sets to append to a lift. */
export function extraSets(type: 'accessory' | 'prep', exercise: SetExercise, weight: number, target: number, reps: number[]): LoggedSet[] {
  return reps.map((r) => ({
    type,
    exercise,
    targetWeight: weight,
    targetReps: target,
    weight,
    reps: Math.max(r, 0),
    done: r >= 0,
  }));
}

export function withSets(l: LoggedLift, sets: LoggedSet[]): LoggedLift {
  return { ...l, sets: [...l.sets, ...sets] };
}

/** `n` full sets of an accessory at the given weight and rep target. */
export const acc = (id: AccessoryId, weight: number, target: number, n = 3, doneReps?: number[]): LoggedSet[] =>
  extraSets('accessory', id, weight, target, doneReps ?? Array(n).fill(target));

/** The planned lift for an exercise in the next session (searching both A and B is the caller's job). */
export function planned(t: Timeline, ex: ExerciseId, today = '2026-01-10') {
  return planNextSession(t.state(), t.settings, today).lifts.find((l) => l.lift === ex);
}

/** Puts Bench and/or OHP on the rehab track, as the migration does. */
export function goRehab(t: Timeline, lifts: ('bench' | 'ohp')[] = ['bench', 'ohp']) {
  for (const lift of lifts) {
    const ex = lift === 'bench' ? 'db_floor_press' : 'seated_db_ohp';
    t.decide({ kind: 'track_change', lift, to: 'rehab', startWeight: t.settings.rehab.ladders[ex][0] });
  }
}


import { pendingFor } from './state';
import type { Alert } from './types';

export const alertFor = (t: Timeline, ex: ExerciseId): Alert | null => pendingFor(t.state(), ex);

/** Answer the pending alert of an exercise the way the UI does (it carries the alert's own value). */
export function answer(t: Timeline, ex: ExerciseId, choice: 'accept' | 'keep') {
  const a = alertFor(t, ex);
  if (!a) throw new Error('no pending alert for ' + ex);
  return t.decide({ kind: 'alert_response', lift: a.lift, alertKind: a.kind, choice, value: a.value });
}
