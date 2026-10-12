import { describe, expect, it } from 'vitest';
import { dayStatuses, openableOnDate } from './calendar';
import { abandonSession, finishSession, isUnfinished, retroFinishedAt, toggleSet } from './logging';
import { finishedSessions } from './state';
import { linearLift, ok, Timeline } from './testkit';

const NOW = '2026-10-12T09:00:00.000Z';

describe('recovering a workout that was left unfinished', () => {
  it('retroFinishedAt: counts on the day it was done (end of that local day), never later than now', () => {
    const past = retroFinishedAt('2026-10-10', NOW);
    expect(past).toBe(new Date('2026-10-10T23:59:00').toISOString());
    expect(past < NOW).toBe(true);
    // done today: end of day is still in the future, so it is simply now
    expect(retroFinishedAt('2026-10-12', NOW)).toBe(NOW);
  });

  it('finishing clears "left unfinished": the day turns green and it is no longer recoverable', () => {
    const t = new Timeline();
    const s = t.log([linearLift('squat', 65, ok())]);
    const gone = abandonSession({ ...s, finishedAt: null }, '2026-01-03T00:00:00Z');
    expect(isUnfinished(gone)).toBe(true);
    expect(dayStatuses([gone]).get(gone.date)).toBe('unfinished');
    const done = finishSession(gone, '2026-01-01T23:59:00Z');
    expect(done.abandonedAt).toBeNull();
    expect(isUnfinished(done)).toBe(false);
    expect(dayStatuses([done]).get(done.date)).toBe('finished');
  });

  it('every workout on a date can be opened: finished first, then unfinished; deleted ones and drafts never', () => {
    const t = new Timeline();
    const a = t.log([linearLift('squat', 65, ok())], 'linear', 0);
    const b = t.log([linearLift('squat', 70, ok())], 'linear', 0);
    const un = { ...t.log([linearLift('squat', 75, ok())], 'linear', 0), finishedAt: null, abandonedAt: '2026-01-02T00:00:00Z' };
    const draft = { ...t.log([linearLift('squat', 75, ok())], 'linear', 0), finishedAt: null };
    const deleted = { ...t.log([linearLift('squat', 75, ok())], 'linear', 0), deleted: true };
    t.sessions = [a, b, un, draft, deleted];
    expect(openableOnDate(t.sessions, a.date).map((s) => s.id)).toEqual([a.id, b.id, un.id]);
    expect(openableOnDate(t.sessions, '2030-01-01')).toEqual([]);
  });

  it('a recovered workout takes its place between the workouts done on either side of it', () => {
    const t = new Timeline();
    const before = t.log([linearLift('squat', 65, ok())], 'linear', 0); // day 0
    const left = t.log([linearLift('squat', 70, ok())], 'linear', 3); // day 3, was never finished
    const after = t.log([linearLift('bench', 45, ok())], 'linear', 5); // day 5
    // it was left unfinished and the later workout was done in the meantime
    const unfinished = abandonSession({ ...left, finishedAt: null }, '2026-01-06T00:00:00Z');
    t.sessions = [before, unfinished, after];
    expect(finishedSessions(t.sessions).map((s) => s.id)).toEqual([before.id, after.id]);
    expect(t.state().linear.squat.weight).toBe(70); // the unfinished one counted for nothing

    // recovered on day 6: it counts on day 3
    const recovered = finishSession({ ...unfinished }, retroFinishedAt(left.date, '2026-01-07T09:00:00.000Z'));
    t.sessions = [before, recovered, after];
    expect(finishedSessions(t.sessions).map((s) => s.id)).toEqual([before.id, recovered.id, after.id]);
    expect(t.state().linear.squat.weight).toBe(75); // 65 -> 70 -> 75, in the right order
    expect(recovered.date).toBe(left.date); // the calendar still shows it on the day it was done
  });

  it('untouched sets in a recovered workout count as missed, like any finish', () => {
    const t = new Timeline();
    const s = t.log([linearLift('squat', 65, [5, 5, 5, -1, -1])]);
    const gone = abandonSession({ ...s, finishedAt: null }, '2026-01-02T00:00:00Z');
    const withSet = toggleSet(gone, 0, 3); // tap one more set before finishing
    expect(withSet.lifts[0].sets[3].done).toBe(true);
  });
});

describe('finishing never makes a record look older (the sync rule is last-write-wins on updatedAt)', () => {
  it('a recovered workout counts on its own day but is last-changed NOW, so it beats the unfinished copy', () => {
    const t = new Timeline();
    const s = t.log([linearLift('squat', 65, ok())], 'linear', 0);
    const abandonedAt = '2026-01-12T08:00:00.000Z'; // Monday morning: the app reset it
    const unfinished = abandonSession({ ...s, finishedAt: null }, abandonedAt); // what the server holds
    const now = '2026-01-12T09:30:00.000Z';
    const recovered = finishSession(unfinished, retroFinishedAt(s.date, now), now);
    expect(recovered.finishedAt! < abandonedAt).toBe(true); // it counts on the earlier day...
    expect(recovered.updatedAt).toBe(now); // ...but was changed after the unfinished copy
    expect(recovered.updatedAt > unfinished.updatedAt).toBe(true); // so it wins when records are merged
    expect(recovered.abandonedAt).toBeNull();
  });

  it('without a separate updatedAt it defaults to the finish time (a normal workout finished now)', () => {
    const t = new Timeline();
    const s = { ...t.log([linearLift('squat', 65, ok())]), finishedAt: null };
    const done = finishSession(s, '2026-01-05T10:00:00.000Z');
    expect(done.updatedAt).toBe('2026-01-05T10:00:00.000Z');
  });
});

import { draftFromPlan, draftStarted, planKeyOfDraft, planKeyOfPlan, setWorkingWeight } from './logging';
import { planNextSession } from './plan';

describe('a workout in progress versus the current plan', () => {
  const plannedDraft = (t: Timeline) => {
    const plan = planNextSession(t.state(), t.settings, '2026-01-20');
    return { plan, draft: draftFromPlan(plan, t.settings, 'd', '2026-01-20T10:00:00Z', '2026-01-20') };
  };

  it('a draft matches the plan it was made from', () => {
    const t = new Timeline();
    const { plan, draft } = plannedDraft(t);
    expect(planKeyOfDraft(draft)).toBe(planKeyOfPlan(plan));
  });

  it('stays matching while you work: ticking sets and editing the weight change what was lifted, not what was planned', () => {
    const t = new Timeline();
    const { plan, draft } = plannedDraft(t);
    const i = draft.lifts[0].sets.findIndex((x) => x.type === 'work');
    let d = toggleSet(draft, 0, i);
    d = setWorkingWeight(d, 0, 100);
    expect(planKeyOfDraft(d)).toBe(planKeyOfPlan(plan));
    expect(draftStarted(draft)).toBe(false);
    expect(draftStarted(d)).toBe(true);
  });

  it('stops matching once the history changes: finishing an old workout changes the plan', () => {
    const t = new Timeline();
    const { draft } = plannedDraft(t); // planned with nothing in the history: squat 65, Workout A
    t.log([linearLift('squat', 65, ok())]); // a past workout gets finished afterwards
    const newPlan = planNextSession(t.state(), t.settings, '2026-01-20');
    expect(planKeyOfDraft(draft)).not.toBe(planKeyOfPlan(newPlan));
  });
});
