import { describe, expect, it } from 'vitest';
import { deterministicId, ohpBackToBarbellMigration } from './defaults';
import { abandonSession, finishSession, retroFinishedAt } from './logging';
import { planNextSession } from './plan';
import { linearLift, ok, Timeline } from './testkit';
import { alertFor, pain, rehabLift, withPain } from './testkit2';

const TODAY = '2026-10-12';
const ohpNext = (t: Timeline) => t.state().linear.ohp.weight;
const planB = (t: Timeline) => planNextSession(t.state(), t.settings, TODAY);

describe('Overhead Press progression on the barbell (the plain rules)', () => {
  const dayThenB = (ohp: ReturnType<typeof linearLift>) => {
    const t = new Timeline();
    t.log([linearLift('squat', 65, ok()), linearLift('bench', 45, ok()), linearLift('row', 45, ok())]); // Workout A
    t.log([linearLift('squat', 70, ok()), ohp, linearLift('deadlift', 95, [5])]); // Workout B
    return t;
  };

  it('completed with no shoulder rating: +5 (45 -> 50)', () => expect(ohpNext(dayThenB(linearLift('ohp', 45, ok())))).toBe(50));
  it('completed with a green rating (0-2): +5', () => {
    for (const r of [0, 1, 2]) expect(ohpNext(dayThenB(withPain(linearLift('ohp', 45, ok()), r)))).toBe(50);
  });
  it('completed but rated amber (3-4): HOLDS at 45, by design, and says why', () => {
    const t = dayThenB(withPain(linearLift('ohp', 45, ok()), 3));
    expect(ohpNext(t)).toBe(45);
    expect(alertFor(t, 'ohp')?.kind).toBe('linear_amber');
    expect(alertFor(t, 'ohp')?.message).toBe("Shoulder rated 3, so OHP holds at 45 next time. This doesn't count as a miss.");
  });
  it('rated red (5+): holds at 45 and offers a drop (the empty bar is the floor, so 45 again)', () => {
    const t = dayThenB(withPain(linearLift('ohp', 45, ok()), 6));
    expect(ohpNext(t)).toBe(45);
    expect(alertFor(t, 'ohp')?.kind).toBe('linear_red');
  });
  it('a missed set: retry the same weight', () => expect(ohpNext(dayThenB(linearLift('ohp', 45, [5, 5, 5, 5, 4])))).toBe(45));
  it('untouched sets counted as missed at Finish: retry the same weight', () => expect(ohpNext(dayThenB(linearLift('ohp', 45, [5, 5, 0, 0, 0])))).toBe(45));
  it('with shoulder tracking off the rating never matters: +5', () => {
    const t = new Timeline();
    t.settings.shoulder.tracking = false;
    t.log([withPain(linearLift('ohp', 45, ok()), 8)]);
    expect(ohpNext(t)).toBe(50);
  });
});

describe('the exact history: squat 80, deadlift 105, OHP 45 on Workout B', () => {
  /**
   * Day 1 (A), the second workout (B) done while OHP was still the Seated DB press (the first version of the update),
   * then a third workout (A, the one that was left unfinished and recovered). OHP went back to the barbell afterwards.
   */
  function yourHistory({ ohpWasDumbbell }: { ohpWasDumbbell: boolean }) {
    const t = new Timeline();
    const now = '2026-10-08T09:00:00.000Z';
    t.log([linearLift('squat', 65, ok()), linearLift('bench', 45, ok()), linearLift('row', 45, ok())], 'linear', 0); // A
    const b = t.log(
      [linearLift('squat', 70, ok()), ohpWasDumbbell ? rehabLift('seated_db_ohp', 12.5, 10, undefined, pain(1)) : linearLift('ohp', 45, ok()), linearLift('deadlift', 95, [5])],
      'linear',
      1,
    ); // B
    for (const lift of ['bench', 'ohp'] as const) {
      t.decisions.push({
        id: deterministicId(`schema2:track_change:${lift}:rehab`), updatedAt: now, deleted: false, schemaVersion: 2, createdAt: now,
        afterSessionId: 's0', body: { kind: 'track_change', lift, to: 'rehab', startWeight: lift === 'bench' ? 15 : 12.5 },
      });
    }
    // the third workout was left unfinished, then recovered and counted on its own day
    const third = t.log([linearLift('squat', 75, ok()), { ...rehabLift('db_floor_press', 15, 10, undefined, pain(1)) }, linearLift('row', 50, ok())], 'linear', 3);
    const left = abandonSession({ ...third, finishedAt: null }, '2026-10-12T08:00:00.000Z');
    t.sessions = t.sessions.filter((s) => s.id !== third.id);
    t.sessions.push(finishSession(left, retroFinishedAt(third.date, '2026-10-12T10:00:00.000Z'), '2026-10-12T10:00:00.000Z'));
    // the "OHP back to the barbell" decision, created on Monday after the second workout (the third was still unfinished then)
    t.decisions.push(...ohpBackToBarbellMigration(t.settings, t.sessions.filter((s) => s.id !== third.id), t.decisions, '2026-10-12T08:30:00.000Z').map((d) => ({ ...d, afterSessionId: b.id })));
    return t;
  }

  it('reproduces today\'s plan: Workout B with squat 80, OHP 45, deadlift 105', () => {
    const plan = planB(yourHistory({ ohpWasDumbbell: true }));
    expect(plan.label).toBe('Workout B');
    expect(plan.lifts.map((l) => [l.lift, l.workingWeight])).toEqual([['squat', 80], ['ohp', 45], ['deadlift', 105]]);
  });

  it('why OHP is 45 again: the last time it was done it was the dumbbell press, so 45 is its FIRST barbell session', () => {
    const t = yourHistory({ ohpWasDumbbell: true });
    expect(t.state().rehab.seated_db_ohp.sessions).toBe(1); // the second workout counted for the dumbbell press
    expect(t.state().linear.ohp.weight).toBe(45); // restarted at the empty bar after the switch back
    expect(planB(t).lifts[1]).toMatchObject({ lift: 'ohp', track: 'linear', workingWeight: 45, emptyBar: true });
  });

  it('...and had that second workout been the BARBELL press at 45 (green), the plan would have been 50', () => {
    const t = new Timeline();
    t.log([linearLift('squat', 65, ok()), linearLift('bench', 45, ok()), linearLift('row', 45, ok())], 'linear', 0);
    t.log([linearLift('squat', 70, ok()), linearLift('ohp', 45, ok()), linearLift('deadlift', 95, [5])], 'linear', 1);
    t.log([linearLift('squat', 75, ok()), linearLift('bench', 45, ok()), linearLift('row', 50, ok())], 'linear', 3);
    expect(planB(t).lifts.map((l) => [l.lift, l.workingWeight])).toEqual([['squat', 80], ['ohp', 50], ['deadlift', 105]]);
  });

  it('the recovered workout does not disturb it: it sits after the switch-back decision in the history', () => {
    const t = yourHistory({ ohpWasDumbbell: true });
    const order = t.sessions.filter((s) => s.finishedAt).sort((a, b) => (a.finishedAt! < b.finishedAt! ? -1 : 1)).map((s) => s.date);
    expect(order).toEqual([...order].sort()); // chronological by the day it was done
    expect(t.state().linearSessionCount).toBe(3);
  });
});
