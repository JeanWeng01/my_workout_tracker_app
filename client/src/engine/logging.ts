import { SCHEMA_VERSION, snapshotRules } from './defaults';
import type { LoggedLift, LoggedSet, PlannedLift, Session, SessionPlan, Settings } from './types';

/** Pure operations on a draft session. Each returns a new session; none mutate. */

export function liftFromPlan(p: PlannedLift): LoggedLift {
  const warm: LoggedSet[] = p.warmups.map((w) => ({
    type: 'warmup',
    targetWeight: w.weight,
    targetReps: w.reps,
    weight: w.weight,
    reps: 0,
    done: false,
  }));
  const main: LoggedSet[] = p.sets.map((s) => ({
    type: s.type,
    targetWeight: s.weight,
    targetReps: s.reps,
    weight: s.weight,
    reps: 0,
    done: false,
    minReps: s.minReps,
  }));
  return { lift: p.lift, scheme: p.scheme, skipped: false, sets: [...warm, ...main], waveWeek: p.waveWeek };
}

export function draftFromPlan(plan: SessionPlan, settings: Settings, id: string, nowIso: string, localDate: string): Session {
  return {
    id,
    updatedAt: nowIso,
    deleted: false,
    schemaVersion: SCHEMA_VERSION,
    date: localDate,
    finishedAt: null,
    phase: plan.phase,
    label: plan.label,
    rules: snapshotRules(settings),
    lifts: plan.lifts.map(liftFromPlan),
  };
}

function mapSet(s: Session, li: number, si: number, f: (set: LoggedSet) => LoggedSet): Session {
  return {
    ...s,
    lifts: s.lifts.map((l, i) => (i !== li ? l : { ...l, sets: l.sets.map((x, j) => (j !== si ? x : f(x))) })),
  };
}

/** Complete button: done at target reps (AMRAP: at its minimum), or undo. */
export function toggleSet(s: Session, li: number, si: number): Session {
  return mapSet(s, li, si, (x) =>
    x.done ? { ...x, done: false, reps: 0 } : { ...x, done: true, reps: x.type === 'amrap' ? (x.minReps ?? x.targetReps) : x.targetReps },
  );
}

/** Chip tap on a completed set: reps − 1 … 0, then back to target. */
export function stepReps(s: Session, li: number, si: number): Session {
  return mapSet(s, li, si, (x) => (!x.done ? x : { ...x, reps: x.reps === 0 ? x.targetReps : x.reps - 1 }));
}

/** Explicit values from the number picker or the long-press editor. Marks the set done. */
export function setSetValues(s: Session, li: number, si: number, values: { weight?: number; reps?: number }): Session {
  return mapSet(s, li, si, (x) => ({
    ...x,
    weight: values.weight ?? x.weight,
    reps: values.reps ?? x.reps,
    done: true,
  }));
}

/** Linear lifts: moves every not-yet-done work set to a new weight. */
export function setWorkingWeight(s: Session, li: number, weight: number): Session {
  return {
    ...s,
    lifts: s.lifts.map((l, i) =>
      i !== li ? l : { ...l, sets: l.sets.map((x) => (!x.done && (x.type === 'work' || x.type === 'amrap') ? { ...x, weight } : x)) },
    ),
  };
}

export function setSkipped(s: Session, li: number, skipped: boolean): Session {
  return { ...s, lifts: s.lifts.map((l, i) => (i === li ? { ...l, skipped } : l)) };
}

/** Logged-but-not-evaluated set, copied from the last planned work set. */
export function addExtraSet(s: Session, li: number): Session {
  return {
    ...s,
    lifts: s.lifts.map((l, i) => {
      if (i !== li) return l;
      const work = l.sets.filter((x) => x.type === 'work' || x.type === 'amrap');
      const last = work[work.length - 1];
      if (!last) return l;
      const extra: LoggedSet = { ...last, type: 'work', minReps: undefined, reps: 0, done: false, extra: true };
      return { ...l, sets: [...l.sets, extra] };
    }),
  };
}

const isPlannedWork = (x: LoggedSet) => (x.type === 'work' || x.type === 'amrap') && !x.extra;

/** Lifts that still have untouched planned work sets. */
export function liftsWithUntouched(s: Session): number[] {
  return s.lifts.flatMap((l, i) => (!l.skipped && l.sets.some((x) => isPlannedWork(x) && !x.done) ? [i] : []));
}

/**
 * Resolve untouched planned sets at Finish.
 * 'missed': they count as 0 reps (missed).
 * 'skip':   lifts with nothing done are skipped; partly done lifts still count the rest as missed.
 */
export function resolveUntouched(s: Session, mode: 'missed' | 'skip'): Session {
  return {
    ...s,
    lifts: s.lifts.map((l) => {
      if (l.skipped || !l.sets.some((x) => isPlannedWork(x) && !x.done)) return l;
      const anyDone = l.sets.some((x) => isPlannedWork(x) && x.done);
      if (mode === 'skip' && !anyDone) return { ...l, skipped: true };
      return { ...l, sets: l.sets.map((x) => (isPlannedWork(x) && !x.done ? { ...x, done: true, reps: 0 } : x)) };
    }),
  };
}

export function finishSession(s: Session, nowIso: string): Session {
  return { ...s, finishedAt: nowIso, updatedAt: nowIso };
}

/** True when nothing was logged at all (nothing to save). */
export function isEmptyDraft(s: Session): boolean {
  return s.lifts.every((l) => l.skipped || !l.sets.some((x) => x.done));
}

/** Leaving the workout unfinished. Partial sets are kept on the record but never evaluated. */
export function abandonSession(s: Session, nowIso: string): Session {
  return { ...s, abandonedAt: nowIso, updatedAt: nowIso };
}

export const STALE_DRAFT_HOURS = 12;

/** An in-progress draft nobody touched for a long time becomes an unfinished workout on next open. */
export function isStaleDraft(s: Session, nowMs: number): boolean {
  return s.finishedAt === null && !s.abandonedAt && !s.deleted && nowMs - Date.parse(s.updatedAt) > STALE_DRAFT_HOURS * 3_600_000;
}

/** Session in progress (not finished, not abandoned, not deleted). */
export function isActiveDraft(s: Session): boolean {
  return s.finishedAt === null && !s.abandonedAt && !s.deleted;
}
