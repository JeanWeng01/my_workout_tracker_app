import { SCHEMA_VERSION, snapshotRules } from './defaults';
import { isTracked } from './shoulder';
import type {
  LoggedLift,
  LoggedSet,
  PainRating,
  PlannedExtra,
  PlannedLift,
  Session,
  SessionPlan,
  Settings,
  ShoulderSettings,
} from './types';

/** Pure operations on a draft session. Each returns a new session; none mutate. */

const MAIN_TYPES = ['work', 'amrap', 'supplemental'];

function extraSets(e: PlannedExtra, type: 'prep' | 'accessory'): LoggedSet[] {
  return Array.from({ length: e.sets }, () => ({
    type,
    exercise: e.exercise,
    targetWeight: e.weight,
    targetReps: e.reps,
    weight: e.weight,
    reps: 0,
    done: false,
  }));
}

export function liftFromPlan(p: PlannedLift): LoggedLift {
  const prep: LoggedSet[] = p.prep ? extraSets(p.prep, 'prep') : [];
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
  const acc: LoggedSet[] = (p.accessories ?? []).flatMap((a) => extraSets(a, 'accessory'));
  return {
    lift: p.lift,
    scheme: p.scheme,
    skipped: p.paused === true,
    ...(p.paused ? { paused: true } : {}),
    sets: [...prep, ...warm, ...main, ...acc],
    waveWeek: p.waveWeek,
  };
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

/** Moves every not-yet-done work set of a lift to a new weight (barbell stepper, or the next dumbbell rung). */
export function setWorkingWeight(s: Session, li: number, weight: number): Session {
  return {
    ...s,
    lifts: s.lifts.map((l, i) =>
      i !== li ? l : { ...l, sets: l.sets.map((x) => (!x.done && (x.type === 'work' || x.type === 'amrap') ? { ...x, weight } : x)) },
    ),
  };
}

/** Skipping (or un-skipping) a lift. Shoulder accessories move to the last lift that is still in the workout. */
export function setSkipped(s: Session, li: number, skipped: boolean): Session {
  return relocateAccessories({ ...s, lifts: s.lifts.map((l, i) => (i === li ? { ...l, skipped } : l)) });
}

/** The index of the last lift still in the workout (not skipped), or -1. */
export function lastActiveLift(s: Session): number {
  for (let i = s.lifts.length - 1; i >= 0; i--) if (!s.lifts[i].skipped) return i;
  return -1;
}

/** Keeps every `accessory` set inside the last non-skipped card. If every lift is skipped they stay where they are. */
export function relocateAccessories(s: Session): Session {
  const host = lastActiveLift(s);
  if (host < 0) return s;
  const moved = s.lifts.flatMap((l) => l.sets.filter((x) => x.type === 'accessory'));
  if (!moved.length) return s;
  const lifts = s.lifts.map((l, i) => {
    const rest = l.sets.filter((x) => x.type !== 'accessory');
    return i === host ? { ...l, sets: [...rest, ...moved] } : { ...l, sets: rest };
  });
  return { ...s, lifts };
}

/** The accessory row appears only once the host lift's last work and extra-work set has been tapped. */
export function accessoriesRevealed(l: LoggedLift): boolean {
  const main = l.sets.filter((x) => MAIN_TYPES.includes(x.type) && !x.extra);
  return main.length > 0 && main.every((x) => x.done);
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
const isAccessory = (x: LoggedSet) => x.type === 'accessory' && !x.extra;

/** Lifts that still have untouched planned work sets, or untouched shoulder accessories. */
export function liftsWithUntouched(s: Session): number[] {
  return s.lifts.flatMap((l, i) => (!l.skipped && l.sets.some((x) => (isPlannedWork(x) || isAccessory(x)) && !x.done) ? [i] : []));
}

/** Untouched *main* work in the workout (accessories alone don't count). */
export function hasUntouchedMainWork(s: Session): boolean {
  return s.lifts.some((l) => !l.skipped && l.sets.some((x) => isPlannedWork(x) && !x.done));
}

/**
 * Resolve untouched planned sets at Finish.
 * 'missed': they count as 0 reps (missed). Untouched accessories count as missed too.
 * 'skip':   lifts with nothing done are skipped; partly done lifts still count the rest as missed.
 *           Untouched accessories are simply left out.
 */
export function resolveUntouched(s: Session, mode: 'missed' | 'skip'): Session {
  const resolved: Session = {
    ...s,
    lifts: s.lifts.map((l) => {
      if (l.skipped) return l;
      let sets = l.sets;
      const untouchedMain = sets.some((x) => isPlannedWork(x) && !x.done);
      if (untouchedMain) {
        const anyDone = sets.some((x) => isPlannedWork(x) && x.done);
        if (mode === 'skip' && !anyDone) return { ...l, skipped: true };
        sets = sets.map((x) => (isPlannedWork(x) && !x.done ? { ...x, done: true, reps: 0 } : x));
      }
      if (mode === 'missed') sets = sets.map((x) => (isAccessory(x) && !x.done ? { ...x, done: true, reps: 0 } : x));
      return sets === l.sets ? l : { ...l, sets };
    }),
  };
  return relocateAccessories(resolved);
}

export function finishSession(s: Session, nowIso: string): Session {
  return { ...s, finishedAt: nowIso, updatedAt: nowIso };
}

/** True when nothing was logged at all (nothing to save). The band pull-aparts alone don't make a workout. */
export function isEmptyDraft(s: Session): boolean {
  return s.lifts.every((l) => l.skipped || !l.sets.some((x) => x.done && x.type !== 'prep'));
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

/**
 * Every planned work set, extra-work (supplemental) set and shoulder accessory set of every lift still in the workout has
 * been completed. Warm-ups and the band pull-aparts are optional; extra sets and skipped lifts don't count. Used to finish
 * automatically. Accessories are counted from the start, so the workout can never finish before they have been done.
 */
export function isWorkoutComplete(s: Session): boolean {
  let required = 0;
  for (const l of s.lifts) {
    if (l.skipped) continue;
    for (const x of l.sets) {
      if (x.extra || x.type === 'warmup' || x.type === 'prep') continue;
      required += 1;
      if (!x.done) return false;
    }
  }
  return required > 0;
}

// ---------- shoulder rating ----------

/** Sets, or clears (null), the one rating for a lift this session. */
export function setPain(s: Session, li: number, pain: PainRating | null): Session {
  return {
    ...s,
    lifts: s.lifts.map((l, i) => {
      if (i !== li) return l;
      const { pain: _p, painSkipped: _k, ...rest } = l;
      return pain ? { ...rest, pain } : rest;
    }),
  };
}

/** "Skip" on the rating prompt: don't ask again for this lift this session. */
export function skipPain(s: Session, li: number): Session {
  return { ...s, lifts: s.lifts.map((l, i) => (i === li ? { ...l, painSkipped: true } : l)) };
}

/** A tracked lift that was performed (a planned work set done) has not been rated yet and wasn't skipped. */
export function liftsNeedingRating(s: Session, shoulder: ShoulderSettings): number[] {
  return s.lifts.flatMap((l, i) => {
    if (l.skipped || l.pain || l.painSkipped || !isTracked(l.lift, shoulder)) return [];
    return l.sets.some((x) => isPlannedWork(x) && x.done) ? [i] : [];
  });
}

export const NOTES_MAX = 2000;

/** Personal note for the workout. Blank clears it. */
export function setNotes(s: Session, text: string): Session {
  const t = text.slice(0, NOTES_MAX);
  const { notes: _old, ...rest } = s;
  return t.trim() ? { ...rest, notes: t } : rest;
}
