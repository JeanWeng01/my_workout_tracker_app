import { describe, expect, it } from 'vitest';
import { defaultSettings } from './defaults';
import {
  addExtraSet, draftFromPlan, finishSession, liftsWithUntouched, resolveUntouched, setSetValues,
  setWorkingWeight, stepReps, toggleSet,
} from './logging';
import { planNextSession } from './plan';
import { deriveState } from './state';

const settings = defaultSettings('2026-01-01T00:00:00Z');
settings.startingWeights.squat = 200;
settings.shoulder.tracking = false; // these tests cover the barbell basics; shoulder extras have their own tests
const plan = planNextSession(deriveState(settings, [], []), settings, '2026-01-02');
const fresh = () => draftFromPlan(plan, settings, 'd1', '2026-01-02T10:00:00Z', '2026-01-02');
/** A lift the app itself skips (paused). The lifter has no way to skip one. */
const skipLift = (d: ReturnType<typeof fresh>, i: number) => ({ ...d, lifts: d.lifts.map((l, j) => (j === i ? { ...l, skipped: true, paused: true } : l)) });
const firstWork = (s: ReturnType<typeof fresh>, li = 0) => s.lifts[li].sets.findIndex((x) => x.type === 'work');

describe('draft operations', () => {
  it('builds a draft with warm-ups first, then work sets, nothing done', () => {
    const d = fresh();
    expect(d.finishedAt).toBeNull();
    expect(d.rules?.microplates).toBe(false);
    const squat = d.lifts[0];
    expect(squat.sets.filter((x) => x.type === 'warmup')).toHaveLength(3);
    expect(squat.sets.filter((x) => x.type === 'work')).toHaveLength(5);
    expect(squat.sets.every((x) => !x.done)).toBe(true);
  });

  it('toggle completes at target reps and undoes; chip steps reps down and wraps', () => {
    let d = fresh();
    const i = firstWork(d);
    d = toggleSet(d, 0, i);
    expect(d.lifts[0].sets[i]).toMatchObject({ done: true, reps: 5 });
    d = stepReps(d, 0, i);
    expect(d.lifts[0].sets[i].reps).toBe(4);
    for (let n = 0; n < 4; n++) d = stepReps(d, 0, i);
    expect(d.lifts[0].sets[i].reps).toBe(0);
    d = stepReps(d, 0, i);
    expect(d.lifts[0].sets[i].reps).toBe(5);
    d = toggleSet(d, 0, i);
    expect(d.lifts[0].sets[i]).toMatchObject({ done: false, reps: 0 });
    expect(stepReps(d, 0, i)).toEqual(d); // chip does nothing until done
  });

  it('does not mutate its input', () => {
    const d = fresh();
    const snapshot = JSON.stringify(d);
    toggleSet(d, 0, firstWork(d));
    expect(JSON.stringify(d)).toBe(snapshot);
  });

  it('working weight edit moves only not-yet-done work sets', () => {
    let d = fresh();
    const i = firstWork(d);
    d = toggleSet(d, 0, i);
    d = setWorkingWeight(d, 0, 210);
    const work = d.lifts[0].sets.filter((x) => x.type === 'work');
    expect(work[0].weight).toBe(200);
    expect(work.slice(1).every((x) => x.weight === 210)).toBe(true);
    expect(d.lifts[0].sets.filter((x) => x.type === 'warmup').every((x) => x.weight < 200)).toBe(true);
  });

  it('setSetValues edits one set and marks it done', () => {
    let d = fresh();
    const i = firstWork(d);
    d = setSetValues(d, 0, i, { weight: 195, reps: 3 });
    expect(d.lifts[0].sets[i]).toMatchObject({ weight: 195, reps: 3, done: true });
  });

  it('extra sets are flagged and never count as untouched', () => {
    let d = fresh();
    d = addExtraSet(d, 0);
    const extra = d.lifts[0].sets[d.lifts[0].sets.length - 1];
    expect(extra.extra).toBe(true);
    for (let j = 0; j < d.lifts[0].sets.length; j++) if (d.lifts[0].sets[j].type === 'work' && !d.lifts[0].sets[j].extra) d = toggleSet(d, 0, j);
    expect(liftsWithUntouched(d).includes(0)).toBe(false);
  });

  it('finish: every untouched set counts as missed; nothing is ever skipped', () => {
    let d = fresh();
    d = toggleSet(d, 0, firstWork(d)); // squat: one set done, four untouched
    expect(liftsWithUntouched(d)).toEqual([0, 1, 2]);
    const missed = resolveUntouched(d);
    expect(missed.lifts.every((l) => !l.skipped)).toBe(true);
    expect(missed.lifts[0].sets.filter((x) => x.type === 'work').map((x) => x.reps)).toEqual([5, 0, 0, 0, 0]);
    expect(missed.lifts[1].sets.filter((x) => x.type === 'work').every((x) => x.done && x.reps === 0)).toBe(true);
    expect(liftsWithUntouched(missed)).toEqual([]);
  });

  it('a lift the app paused is left out; finishing stamps the time', () => {
    let d = skipLift(fresh(), 1);
    expect(liftsWithUntouched(d)).toEqual([0, 2]);
    expect(resolveUntouched(d).lifts[1].sets.every((x) => !x.done)).toBe(true);
    d = finishSession(d, '2026-01-02T11:00:00Z');
    expect(d.finishedAt).toBe('2026-01-02T11:00:00Z');
  });

  it('a logged draft feeds back into the engine (round trip)', () => {
    let d = fresh();
    for (let j = 0; j < d.lifts[0].sets.length; j++) if (d.lifts[0].sets[j].type === 'work') d = toggleSet(d, 0, j);
    d = finishSession(resolveUntouched(d), '2026-01-02T11:00:00Z');
    const st = deriveState(settings, [d], []);
    expect(st.linear.squat.weight).toBe(205);
    expect(st.linear.bench.weight).toBe(45); // untouched = missed: retry the same weight
    expect(st.linear.bench.streak).toBe(1);
    expect(planNextSession(st, settings, '2026-01-03').label).toBe('Workout B');
  });
});

import { abandonSession, isActiveDraft, isStaleDraft } from './logging';
import { dayStatuses, totalWorkouts } from './calendar';

describe('unfinished workouts', () => {
  const noon = (d: string) => `${d}T12:00:00.000Z`;

  it('an abandoned session never affects progression, and the same workout is next again', () => {
    let d = fresh();
    d = toggleSet(d, 0, firstWork(d));
    const gone = abandonSession(d, noon('2026-01-02'));
    expect(isActiveDraft(gone)).toBe(false);
    const st = deriveState(settings, [gone], []);
    expect(st.linear.squat.weight).toBe(200);
    expect(st.linearSessionCount).toBe(0);
    expect(planNextSession(st, settings, '2026-01-05').label).toBe('Workout A');
    expect(gone.lifts[0].sets.some((x) => x.done)).toBe(true); // partial sets kept
  });

  it('a redo from the start counts normally; abandoned data is ignored', () => {
    const gone = abandonSession(toggleSet(fresh(), 0, firstWork(fresh())), noon('2026-01-02'));
    let redo = { ...fresh(), id: 'd2', date: '2026-01-05' };
    for (let j = 0; j < redo.lifts[0].sets.length; j++) if (redo.lifts[0].sets[j].type === 'work') redo = toggleSet(redo, 0, j);
    redo = finishSession(resolveUntouched(redo), noon('2026-01-05'));
    expect(deriveState(settings, [gone, redo], []).linear.squat.weight).toBe(205);
  });

  it('drafts go stale after 12 hours', () => {
    const d = { ...fresh(), updatedAt: '2026-01-02T10:00:00.000Z' };
    expect(isStaleDraft(d, Date.parse('2026-01-02T21:00:00.000Z'))).toBe(false);
    expect(isStaleDraft(d, Date.parse('2026-01-02T23:00:00.000Z'))).toBe(true);
    expect(isStaleDraft(finishSession(d, noon('2026-01-02')), Date.parse('2026-02-01T00:00:00Z'))).toBe(false);
  });

  it('calendar: yellow for unfinished, green once finished, green wins on a shared day', () => {
    const gone = abandonSession({ ...fresh(), id: 'a', date: '2026-01-02' }, noon('2026-01-02'));
    const done = finishSession({ ...fresh(), id: 'b', date: '2026-01-05' }, noon('2026-01-05'));
    const sameDay = finishSession({ ...fresh(), id: 'c', date: '2026-01-02' }, noon('2026-01-02'));
    const inProgress = { ...fresh(), id: 'e', date: '2026-01-09' };
    const m = dayStatuses([gone, done, inProgress]);
    expect(m.get('2026-01-02')).toBe('unfinished');
    expect(m.get('2026-01-05')).toBe('finished');
    expect(m.has('2026-01-09')).toBe(false);
    expect(dayStatuses([gone, sameDay]).get('2026-01-02')).toBe('finished');
    expect(totalWorkouts([gone, done, sameDay, inProgress])).toBe(2);
  });
});

import { isWorkoutComplete, NOTES_MAX, setNotes } from './logging';
import { withDefaults } from './defaults';

describe('automatic finish', () => {
  const allWork = (s: ReturnType<typeof fresh>) => {
    let d = s;
    d.lifts.forEach((l, li) =>
      l.sets.forEach((x, si) => {
        if ((x.type === 'work' || x.type === 'amrap' || x.type === 'supplemental') && !x.extra) d = toggleSet(d, li, si);
      }),
    );
    return d;
  };

  it('is false until every work set of every lift is done; warm-ups do not matter', () => {
    let d = fresh();
    expect(isWorkoutComplete(d)).toBe(false);
    const done = allWork(d);
    expect(isWorkoutComplete(done)).toBe(true);
    expect(done.lifts[0].sets.filter((x) => x.type === 'warmup').every((x) => !x.done)).toBe(true);
    // undo one set again
    const i = done.lifts[2].sets.findIndex((x) => x.type === 'work');
    d = toggleSet(done, 2, i);
    expect(isWorkoutComplete(d)).toBe(false);
  });

  it('paused lifts are left out; a workout with everything paused is never complete', () => {
    let d = fresh();
    d = skipLift(skipLift(d, 1), 2);
    expect(isWorkoutComplete(d)).toBe(false);
    d.lifts[0].sets.forEach((x, si) => {
      if (x.type === 'work') d = toggleSet(d, 0, si);
    });
    expect(isWorkoutComplete(d)).toBe(true);
    const all = skipLift(skipLift(skipLift(fresh(), 0), 1), 2);
    expect(isWorkoutComplete(all)).toBe(false);
  });

  it('extra sets never block completion', () => {
    let d = allWork(fresh());
    d = addExtraSet(d, 0);
    expect(isWorkoutComplete(d)).toBe(true);
  });

  it('5/3/1: the extra-work (FSL) sets must be done too', () => {
    const s531 = { ...settings, template: 'fsl' as const };
    const st = deriveState(s531, [], []);
    st.phase = '531';
    for (const l of ['squat', 'bench', 'deadlift', 'ohp'] as const) {
      st.wave[l].tm = 200;
      st.track[l] = '531';
    }
    const plan531 = planNextSession(st, s531, '2026-01-02');
    let d = draftFromPlan(plan531, s531, 'w1', '2026-01-02T10:00:00Z', '2026-01-02');
    d.lifts[0].sets.forEach((x, si) => {
      if (x.type === 'work' || x.type === 'amrap') d = toggleSet(d, 0, si);
    });
    expect(isWorkoutComplete(d)).toBe(false); // supplemental still open
    d.lifts[0].sets.forEach((x, si) => {
      if (x.type === 'supplemental') d = toggleSet(d, 0, si);
    });
    expect(isWorkoutComplete(d)).toBe(true);
  });
});

describe('notes', () => {
  it('sets, trims to the limit, and clears when blank', () => {
    const d = setNotes(fresh(), 'felt good');
    expect(d.notes).toBe('felt good');
    expect(setNotes(d, '   ').notes).toBeUndefined();
    expect(setNotes(d, 'x'.repeat(NOTES_MAX + 50)).notes).toHaveLength(NOTES_MAX);
    expect(fresh().notes).toBeUndefined();
  });
});

describe('rest time default', () => {
  it('is 90 s for work sets, and an untouched saved 180 s default migrates; a custom one is kept', () => {
    expect(defaultSettings().restSeconds.work).toBe(90);
    const old = { ...defaultSettings(), restSeconds: { warmup: 60, work: 180, supplemental: 90 } };
    expect(withDefaults(old).restSeconds.work).toBe(90);
    const custom = { ...defaultSettings(), restSeconds: { warmup: 60, work: 120, supplemental: 90 } };
    expect(withDefaults(custom).restSeconds.work).toBe(120);
    const legacy = { ...defaultSettings() } as Partial<typeof old>;
    delete legacy.restSeconds;
    expect(withDefaults(legacy as typeof old).restSeconds.work).toBe(90);
  });
});
