import { describe, expect, it } from 'vitest';
import { computeTrainingMaxes } from './graduation';
import { planNextSession } from './plan';
import { isPR } from './pr';
import { estimate1RM, platesPerSide, roundToPlates } from './rounding';
import { deriveState, evaluateSession } from './state';
import { linearLift, ok, seventhLift, skipped, Timeline, waveLift } from './testkit';
import type { Lift, MainLift } from './types';

const TODAY = '2026-01-10';

/** Logs `n` missed-rep sessions of one lift at one weight. */
function stall(t: Timeline, lift: Lift, weight: number, scheme?: '5x5' | '3x5' | '1x5', n = 3) {
  for (let i = 0; i < n; i++) t.log([linearLift(lift, weight, [5, 5, 5, 4, 4], scheme)]);
}

describe('rounding and plates', () => {
  it('estimates 1RM with Epley, 1-10 reps only', () => {
    expect(estimate1RM(180, 5)).toBeCloseTo(210);
    expect(estimate1RM(100, 0)).toBe(0);
    expect(estimate1RM(100, 11)).toBe(0);
  });

  it('16. microplates off: 132.4 -> 130; on: 132.5', () => {
    const off = new Timeline().settings;
    const on = new Timeline({ microplates: true }).settings;
    expect(roundToPlates(132.4, off, 'squat', 'nearest')).toBe(130);
    expect(roundToPlates(132.4, on, 'squat', 'nearest')).toBe(132.5);
  });

  it('ties round down, floors never go below the bar', () => {
    const s = new Timeline().settings;
    expect(roundToPlates(132.5, s, 'squat', 'nearest')).toBe(130);
    expect(roundToPlates(134.9, s, 'squat', 'down')).toBe(130);
    expect(roundToPlates(20, s, 'squat', 'down')).toBe(45);
  });

  it('breaks weight into plates per side from owned plates', () => {
    expect(platesPerSide(155, 45, [45, 35, 25, 10, 5, 2.5])).toEqual([45, 10]);
    expect(platesPerSide(45, 45, [45])).toEqual([]);
    expect(platesPerSide(100, 45, [45, 35, 25, 10, 5, 2.5])).toEqual([25, 2.5]);
  });
});

describe('linear progression', () => {
  it('1. 5x5 completed: squat 65 -> 70 -> 75', () => {
    const t = new Timeline();
    expect(t.state().linear.squat.weight).toBe(65);
    t.log([linearLift('squat', 65, ok())]);
    expect(t.state().linear.squat.weight).toBe(70);
    expect(planNextSession(t.state(), t.settings, TODAY).lifts[0].workingWeight).toBe(70);
    t.log([linearLift('squat', 70, ok())]);
    expect(t.state().linear.squat.weight).toBe(75);
  });

  it('alternates A, B, A with the stronglifts layout', () => {
    const t = new Timeline();
    const names = (tl: Timeline) => planNextSession(tl.state(), tl.settings, TODAY).lifts.map((l) => l.lift);
    expect(names(t)).toEqual(['squat', 'bench', 'row']);
    t.log([linearLift('squat', 65, ok())]);
    expect(names(t)).toEqual(['squat', 'ohp', 'deadlift']);
    t.log([linearLift('squat', 70, ok())]);
    expect(names(t)).toEqual(['squat', 'bench', 'row']);
  });

  it('2. missed reps retry, streak 1 -> 2 -> 3, third offers a deload', () => {
    const t = new Timeline({ startingWeights: { squat: 150, bench: 45, row: 45, ohp: 45, deadlift: 95 } });
    t.log([linearLift('squat', 150, [5, 5, 5, 4, 4])]);
    let sq = t.state().linear.squat;
    expect(sq.weight).toBe(150);
    expect(sq.streak).toBe(1);
    expect(sq.pending?.message).toBe('Missed reps at 150. Next time: retry 150 (attempt 2 of 3).');
    t.log([linearLift('squat', 150, [5, 5, 5, 4, 4])]);
    expect(t.state().linear.squat.streak).toBe(2);
    t.log([linearLift('squat', 150, [5, 5, 5, 4, 4])]);
    sq = t.state().linear.squat;
    expect(sq.streak).toBe(3);
    expect(sq.pending?.kind).toBe('deload');
    expect(sq.pending?.value).toBe(135);
    expect(sq.pending?.message).toBe('Third miss at 150. Dial down to 135 and climb back.');
    // Not applied until accepted.
    expect(sq.weight).toBe(150);
    t.respond('squat', 'deload');
    expect(t.state().linear.squat.weight).toBe(135);
    expect(t.state().linear.squat.pending).toBeNull();
  });

  it('keeping my numbers dismisses the alert and keeps the weight', () => {
    const t = new Timeline({ startingWeights: { squat: 150, bench: 45, row: 45, ohp: 45, deadlift: 95 } });
    stall(t, 'squat', 150);
    t.respond('squat', 'deload', 'keep');
    const sq = t.state().linear.squat;
    expect(sq.weight).toBe(150);
    expect(sq.pending).toBeNull();
    stall(t, 'squat', 150, '5x5', 1);
    expect(t.state().linear.squat.pending?.kind).toBe('deload'); // re-fires on the next miss
  });

  it('3. deadlift +10 until its first missed session, then +5 forever', () => {
    const t = new Timeline();
    t.log([linearLift('deadlift', 95, [5])]);
    expect(t.state().linear.deadlift.weight).toBe(105);
    t.log([linearLift('deadlift', 105, [5])]);
    expect(t.state().linear.deadlift.weight).toBe(115);
    t.log([linearLift('deadlift', 115, [4])]);
    expect(t.state().linear.deadlift.weight).toBe(115);
    t.log([linearLift('deadlift', 115, [5])]);
    expect(t.state().linear.deadlift.weight).toBe(120);
    t.log([linearLift('deadlift', 120, [5])]);
    expect(t.state().linear.deadlift.weight).toBe(125);
  });

  it('4. two deloads then a third stall offers 3x5 at the same weight', () => {
    const t = new Timeline({ startingWeights: { squat: 150, bench: 45, row: 45, ohp: 45, deadlift: 95 } });
    stall(t, 'squat', 150);
    t.respond('squat', 'deload'); // 135
    stall(t, 'squat', 135);
    t.respond('squat', 'deload'); // 120
    expect(t.state().linear.squat.weight).toBe(120);
    stall(t, 'squat', 120);
    const sq = t.state().linear.squat;
    expect(sq.pending?.kind).toBe('switch_3x5');
    expect(sq.pending?.message).toBe('Third stall on 5×5. Switch squat to 3×5 at 120?');
    t.respond('squat', 'switch_3x5');
    const after = t.state().linear.squat;
    expect(after.scheme).toBe('3x5');
    expect(after.weight).toBe(120);
    const plan = planNextSession(t.state(), t.settings, TODAY);
    expect(plan.lifts[0].sets).toHaveLength(3);
  });

  it('5. third stall on 3x5 is LINEAR COMPLETE; the next stall is a holding-pattern deload', () => {
    const t = new Timeline();
    // OHP (not squat) so we can see the info alert and the holding behaviour.
    t.settings.startingWeights.ohp = 100;
    stall(t, 'ohp', 100);
    t.respond('ohp', 'deload'); // 90
    stall(t, 'ohp', 90);
    t.respond('ohp', 'deload'); // 80
    stall(t, 'ohp', 80);
    t.respond('ohp', 'switch_3x5');
    stall(t, 'ohp', 80, '3x5');
    t.respond('ohp', 'deload'); // 70
    stall(t, 'ohp', 70, '3x5');
    t.respond('ohp', 'deload'); // 60
    stall(t, 'ohp', 60, '3x5');
    let ohp = t.state().linear.ohp;
    expect(ohp.complete).toBe(true);
    expect(ohp.pending?.kind).toBe('linear_complete');
    expect(ohp.pending?.severity).toBe('info');
    expect(ohp.weight).toBe(60);
    expect(planNextSession(t.state(), t.settings, TODAY).lifts.find((l) => l.lift === 'ohp')).toBeUndefined(); // workout A
    // Holding: a further stall deloads again.
    stall(t, 'ohp', 60, '3x5');
    ohp = t.state().linear.ohp;
    expect(ohp.pending?.kind).toBe('deload');
    t.respond('ohp', 'deload');
    expect(t.state().linear.ohp.weight).toBe(50); // 54 rounds down
    // ...and it climbs at the smallest increment.
    t.log([linearLift('ohp', 50, ok(3), '3x5')]);
    expect(t.state().linear.ohp.weight).toBe(55);
  });

  it('6. weight edited up to 160 (suggested 155) and completed -> next 165', () => {
    const t = new Timeline({ startingWeights: { squat: 155, bench: 45, row: 45, ohp: 45, deadlift: 95 } });
    t.log([linearLift('squat', 160, ok())]);
    expect(t.state().linear.squat.weight).toBe(165);
  });

  it('7. skipped lifts change nothing; lifts are evaluated independently', () => {
    const t = new Timeline();
    t.log([skipped('squat'), linearLift('bench', 45, ok())]);
    let st = t.state();
    expect(st.linear.squat.weight).toBe(65);
    expect(st.linear.squat.streak).toBe(0);
    expect(st.linear.squat.lastTrained).toBeNull();
    expect(st.linear.bench.weight).toBe(50);
    t.log([linearLift('squat', 65, ok()), linearLift('bench', 50, [5, 5, 4, 3, 3])]);
    st = t.state();
    expect(st.linear.squat.weight).toBe(70);
    expect(st.linear.bench.weight).toBe(50);
    expect(st.linear.bench.streak).toBe(1);
  });

  it('skipping between misses does not break or advance the streak', () => {
    const t = new Timeline();
    t.log([linearLift('bench', 45, [5, 5, 5, 4, 4])]);
    t.log([skipped('bench')]);
    t.log([linearLift('bench', 45, [5, 5, 5, 4, 4])]);
    expect(t.state().linear.bench.streak).toBe(2);
  });

  it('8. missed reps at different weights do not accumulate a streak', () => {
    const t = new Timeline();
    t.log([linearLift('squat', 100, [5, 5, 5, 4, 4])]);
    t.log([linearLift('squat', 105, [5, 5, 5, 4, 4])]);
    t.log([linearLift('squat', 110, [5, 5, 5, 4, 4])]);
    expect(t.state().linear.squat.streak).toBe(1);
    expect(t.state().linear.squat.pending?.kind).toBe('missed_retry');
  });

  it('a completed session resets the streak', () => {
    const t = new Timeline();
    t.log([linearLift('squat', 100, [5, 5, 5, 4, 4])]);
    t.log([linearLift('squat', 100, [5, 5, 5, 4, 4])]);
    t.log([linearLift('squat', 100, ok())]);
    expect(t.state().linear.squat.streak).toBe(0);
    expect(t.state().linear.squat.weight).toBe(105);
  });

  it('untouched planned sets count as missed; extra sets are never evaluated', () => {
    const t = new Timeline();
    t.log([linearLift('squat', 100, [5, 5, 5, 5, -1])]);
    expect(t.state().linear.squat.streak).toBe(1);
    const lift = linearLift('squat', 100, ok());
    lift.sets.push({ type: 'work', targetWeight: 100, targetReps: 5, weight: 100, reps: 2, done: true, extra: true });
    const t2 = new Timeline();
    t2.log([lift]);
    expect(t2.state().linear.squat.weight).toBe(105);
  });

  it('microplates off: no 2.5 jump ever; on: bench/OHP use +2.5 after their first deload', () => {
    const off = new Timeline();
    off.settings.startingWeights.bench = 100;
    stall(off, 'bench', 100);
    off.respond('bench', 'deload'); // 90
    off.log([linearLift('bench', 90, ok())]);
    expect(off.state().linear.bench.weight).toBe(95);

    const on = new Timeline({ microplates: true });
    on.settings.startingWeights.bench = 100;
    on.log([linearLift('bench', 100, ok())]);
    expect(on.state().linear.bench.weight).toBe(105); // not yet deloaded
    stall(on, 'bench', 105);
    on.respond('bench', 'deload'); // 94.5 -> 92.5
    expect(on.state().linear.bench.weight).toBe(92.5);
    on.log([linearLift('bench', 92.5, ok())]);
    expect(on.state().linear.bench.weight).toBe(95);
    on.log([linearLift('squat', 65, ok())]);
    expect(on.state().linear.squat.weight).toBe(70); // squat stays +5
  });

  it('18. deleting or editing a past session re-derives', () => {
    const t = new Timeline();
    t.log([linearLift('squat', 65, ok())]);
    t.log([linearLift('squat', 70, ok())]);
    t.log([linearLift('squat', 75, ok())]);
    expect(t.state().linear.squat.weight).toBe(80);
    t.sessions[2].deleted = true;
    expect(t.state().linear.squat.weight).toBe(75);
    t.sessions[1].lifts = [linearLift('squat', 70, [5, 5, 5, 5, 4])];
    expect(t.state().linear.squat.weight).toBe(70);
    expect(t.state().linearSessionCount).toBe(2);
  });

  it('drafts never count', () => {
    const t = new Timeline();
    const s = t.log([linearLift('squat', 65, ok())]);
    s.finishedAt = null;
    expect(t.state().linear.squat.weight).toBe(65);
  });

  it('evaluateSession returns the alerts a session produces', () => {
    const t = new Timeline();
    const s = t.log([linearLift('squat', 65, [5, 5, 5, 4, 4])]);
    const before = deriveState(t.settings, [], []);
    const alerts = evaluateSession(before, s, t.settings);
    expect(alerts.map((a) => a.kind)).toEqual(['missed_retry']);
  });
});

describe('warm-ups, empty bar, plates', () => {
  it('linear warm-ups: bar x5, 55% x3, 75% x2, no duplicates, none at the bar', () => {
    const t = new Timeline();
    const p = planNextSession(t.state(), t.settings, TODAY).lifts[0]; // squat 65
    expect(p.warmups).toEqual([{ weight: 45, reps: 5 }, { weight: 50, reps: 2 }]); // 55% lands on the bar and is dropped
    t.settings.startingWeights.squat = 200;
    const q = planNextSession(t.state(), t.settings, TODAY).lifts[0];
    expect(q.warmups).toEqual([
      { weight: 45, reps: 5 },
      { weight: 110, reps: 3 },
      { weight: 150, reps: 2 },
    ]);
    const bench = planNextSession(t.state(), t.settings, TODAY).lifts[1]; // empty bar
    expect(bench.warmups).toEqual([]);
    expect(bench.emptyBar).toBe(true);
  });

  it('shows plates per side from owned plates', () => {
    const t = new Timeline();
    t.settings.startingWeights.squat = 155;
    expect(planNextSession(t.state(), t.settings, TODAY).lifts[0].platesPerSide).toEqual([45, 10]);
  });
});

describe('graduation and the 5/3/1 switch', () => {
  function squatToLinearComplete() {
    const t = new Timeline({ startingWeights: { squat: 150, bench: 45, row: 45, ohp: 45, deadlift: 95 } });
    stall(t, 'squat', 150);
    t.respond('squat', 'deload'); // 135
    stall(t, 'squat', 135);
    t.respond('squat', 'deload'); // 120
    stall(t, 'squat', 120);
    t.respond('squat', 'switch_3x5');
    stall(t, 'squat', 120, '3x5');
    t.respond('squat', 'deload'); // 108 -> 105
    stall(t, 'squat', 105, '3x5');
    t.respond('squat', 'deload'); // 94.5 -> 90
    return t;
  }

  it('9. squat LINEAR COMPLETE auto-creates a phase_switch and plans 5/3/1 squat week 1', () => {
    const t = squatToLinearComplete();
    stall(t, 'squat', 90, '3x5', 2);
    expect(t.graduation()).toBeNull();
    t.log([linearLift('squat', 90, [5, 5, 4], '3x5'), linearLift('bench', 100, ok()), linearLift('deadlift', 200, [5])]);
    expect(t.state().linear.squat.complete).toBe(true);
    const d = t.graduation();
    expect(d).not.toBeNull();
    expect(d!.body.kind).toBe('phase_switch');
    if (d!.body.kind !== 'phase_switch') throw new Error();
    expect(d!.body.auto).toBe(true);
    expect(d!.afterSessionId).toBe(t.sessions[t.sessions.length - 1].id);
    // TMs per 4.3 over the sessions so far, including this one.
    const tms = computeTrainingMaxes(t.settings, t.sessions);
    expect(d!.body.tms).toEqual(tms);
    expect(tms.deadlift).toBe(roundDown5(200 * (1 + 5 / 30) * 0.85));
    t.decisions.push(d!);

    const st = t.state();
    expect(st.phase).toBe('531');
    const plan = planNextSession(st, t.settings, TODAY);
    expect(plan.phase).toBe('531');
    expect(plan.lifts[0].lift).toBe('squat');
    expect(plan.lifts[0].waveWeek).toBe(1);
    expect(plan.lifts[0].cycle).toBe(1);
    expect(plan.lifts[0].tm).toBe(tms.squat);
    expect(plan.label).toBe('5/3/1 · Squat · Week 1 of cycle 1');
    // Graduating twice is impossible: a later linear-complete check returns null.
    expect(t.graduation()).toBeNull();
  });

  it('bench, deadlift and OHP all LINEAR COMPLETE while squat is not: no switch', () => {
    const t = new Timeline();
    for (const lift of ['bench', 'ohp', 'deadlift'] as const) {
      t.settings.startingWeights[lift] = 200;
      const first = lift === 'deadlift' ? '1x5' : '5x5';
      stall(t, lift, 200, first);
      t.respond(lift, 'deload'); // 180
      stall(t, lift, 180, first);
      t.respond(lift, 'deload'); // 160
      if (lift === 'deadlift') {
        stall(t, lift, 160, '1x5');
      } else {
        stall(t, lift, 160, '5x5');
        t.respond(lift, 'switch_3x5');
        stall(t, lift, 160, '3x5');
        t.respond(lift, 'deload'); // 144 -> 140
        stall(t, lift, 140, '3x5');
        t.respond(lift, 'deload'); // 126 -> 125
        stall(t, lift, 125, '3x5');
      }
      expect(t.graduation()).toBeNull();
      expect(t.state().linear[lift].complete).toBe(true);
    }
    const st = t.state();
    expect(st.phase).toBe('linear');
    expect(st.linear.squat.complete).toBe(false);
    // All three are in the holding pattern.
    t.log([skipped('squat')]); // advance to whichever workout has the other lifts
    const lifts = [st, t.state()].flatMap((s) => planNextSession(s, t.settings, TODAY).lifts);
    for (const lift of ['bench', 'ohp', 'deadlift'] as const) expect(lifts.find((l) => l.lift === lift)?.holding).toBe(true);
  });

  it('manual switch back to linear works, and undoing keeps history', () => {
    const t = squatToLinearComplete();
    stall(t, 'squat', 90, '3x5');
    t.decisions.push(t.graduation()!);
    expect(t.state().phase).toBe('531');
    t.decide({ kind: 'phase_switch', to: 'linear', auto: false });
    const st = t.state();
    expect(st.phase).toBe('linear');
    expect(st.linear.squat.complete).toBe(true);
    expect(planNextSession(st, t.settings, TODAY).phase).toBe('linear');
  });

  it('editing the triggering session away reverts an auto switch if no 5/3/1 session exists', () => {
    const t = squatToLinearComplete();
    stall(t, 'squat', 90, '3x5');
    t.decisions.push(t.graduation()!);
    expect(t.state().phase).toBe('531');
    t.sessions[t.sessions.length - 1].lifts = [linearLift('squat', 90, ok(3), '3x5')];
    const st = t.state();
    expect(st.phase).toBe('linear');
    expect(st.revertedAutoSwitch).toBe(true);
  });

  it('...but keeps 5/3/1 once a 5/3/1 session has been logged', () => {
    const t = squatToLinearComplete();
    stall(t, 'squat', 90, '3x5');
    t.decisions.push(t.graduation()!);
    t.log([waveLift('squat', 1, 100, 5)], '531');
    t.sessions[t.sessions.length - 2].lifts = [linearLift('squat', 90, ok(3), '3x5')];
    expect(t.state().phase).toBe('531');
  });

  it('10. TM calc: 180 x 5 at 85% -> 175; at 90% -> 185', () => {
    const t = new Timeline();
    t.log([linearLift('squat', 180, ok())]);
    expect(computeTrainingMaxes(t.settings, t.sessions).squat).toBe(175);
    t.settings.tmPercent = 0.9;
    expect(computeTrainingMaxes(t.settings, t.sessions).squat).toBe(185);
  });

  it('TM calc looks only at the last 6 non-skipped sessions', () => {
    const t = new Timeline();
    t.log([linearLift('squat', 300, ok())]); // falls out of the window
    for (let i = 0; i < 6; i++) t.log([linearLift('squat', 100, ok())]);
    expect(computeTrainingMaxes(t.settings, t.sessions).squat).toBe(roundDown5(100 * (1 + 5 / 30) * 0.85));
  });
});

function roundDown5(n: number) {
  return Math.floor(n / 5 + 1e-9) * 5;
}

/** A timeline already in 5/3/1 with the given TMs. */
function in531(tms: Record<MainLift, number>, overrides = {}) {
  const t = new Timeline(overrides);
  t.log([linearLift('squat', 65, ok())]);
  t.decide({ kind: 'phase_switch', to: '531', auto: false, tms });
  return t;
}
const TM100 = { squat: 100, bench: 100, deadlift: 100, ohp: 100 };

describe('5/3/1', () => {
  it('11. week 1 with TM 100: 65 / 75 / 85; FSL 5x5 @ 65; BBB 5x10 @ 50', () => {
    const t = in531(TM100);
    const p = planNextSession(t.state(), t.settings, TODAY).lifts[0];
    const main = p.sets.filter((s) => s.type !== 'supplemental');
    expect(main.map((s) => [s.weight, s.reps])).toEqual([[65, 5], [75, 5], [85, 5]]);
    expect(main[2].type).toBe('amrap');
    expect(main[2].minReps).toBe(5);
    const fsl = p.sets.filter((s) => s.type === 'supplemental');
    expect(fsl).toHaveLength(5);
    expect(fsl.every((s) => s.weight === 65 && s.reps === 5)).toBe(true);

    t.settings.template = 'bbb';
    const bbb = planNextSession(t.state(), t.settings, TODAY).lifts[0].sets.filter((s) => s.type === 'supplemental');
    expect(bbb).toHaveLength(5);
    expect(bbb.every((s) => s.weight === 50 && s.reps === 10)).toBe(true);

    t.settings.template = 'minimalist';
    expect(planNextSession(t.state(), t.settings, TODAY).lifts[0].sets).toHaveLength(3);
  });

  it('plans weeks 2 and 3 and warm-ups off the TM', () => {
    const t = in531(TM100);
    t.log([waveLift('squat', 1, 100, 5)], '531');
    const w2 = planNextSession(t.state(), t.settings, TODAY); // bench is next, week 1
    expect(w2.lifts[0].lift).toBe('bench');
    expect(w2.lifts[0].waveWeek).toBe(1);
    expect(w2.lifts[0].warmups).toEqual([{ weight: 50, reps: 5 }, { weight: 60, reps: 3 }]);
    for (const lift of ['bench', 'deadlift', 'ohp'] as const) t.log([waveLift(lift, 1, 100, 5)], '531');
    const p = planNextSession(t.state(), t.settings, TODAY).lifts[0]; // squat week 2 (cycle 1)
    expect(p.lift).toBe('squat');
    expect(p.waveWeek).toBe(2);
    expect(p.sets.slice(0, 3).map((s) => s.weight)).toEqual([70, 80, 90]);
  });

  /** Runs one 3-week cycle for a lift with the AMRAP reps given per week. */
  function cycle(t: Timeline, lift: MainLift, reps: [number, number, number]) {
    for (const w of [1, 2, 3] as const) t.log([waveLift(lift, w, 100, reps[w - 1])], '531');
  }

  it('12. a passed cycle adds +10 (squat) / +5 (bench) even with AMRAP 15', () => {
    const t = in531(TM100);
    cycle(t, 'squat', [15, 15, 15]);
    cycle(t, 'bench', [15, 15, 15]);
    const st = t.state();
    expect(st.wave.squat.tm).toBe(110);
    expect(st.wave.bench.tm).toBe(105);
  });

  it('13. one AMRAP below minimum holds the TM; two held cycles suggest a 10% reset', () => {
    const t = in531(TM100);
    cycle(t, 'bench', [5, 2, 1]);
    let ws = t.state().wave.bench;
    expect(ws.tm).toBe(100);
    expect(ws.missedCycles).toBe(1);
    expect(ws.pending).toBeNull();
    cycle(t, 'bench', [5, 3, 0]);
    ws = t.state().wave.bench;
    expect(ws.tm).toBe(100);
    expect(ws.missedCycles).toBe(2);
    expect(ws.pending?.kind).toBe('tm_reset');
    expect(ws.pending?.value).toBe(90);
    expect(ws.pending?.message).toBe('Two cycles in a row short of minimums. Reset bench training max 100 → 90?');
    t.respond('bench', 'tm_reset');
    ws = t.state().wave.bench;
    expect(ws.tm).toBe(90);
    expect(ws.missedCycles).toBe(0);
  });

  it('shows the amrap-missed info alert right after the miss', () => {
    const t = in531(TM100);
    t.log([waveLift('bench', 2, 100, 2)], '531');
    expect(t.state().wave.bench.pending?.message).toBe('Bench 3+ set: got 2. Hold your training max and repeat this cycle.');
  });

  it('a successful cycle resets missedCycles', () => {
    const t = in531(TM100);
    cycle(t, 'bench', [1, 1, 0]);
    expect(t.state().wave.bench.missedCycles).toBe(1);
    cycle(t, 'bench', [5, 3, 1]);
    expect(t.state().wave.bench.missedCycles).toBe(0);
    expect(t.state().wave.bench.tm).toBe(105);
  });

  it('14. TM test with 2 reps at TM 180 suggests 160', () => {
    const t = in531({ ...TM100, squat: 180 });
    t.log([seventhLift('squat', 'tm_test', 180, 2)], '531');
    const ws = t.state().wave.squat;
    expect(ws.pending?.kind).toBe('tm_test_failed');
    expect(ws.pending?.value).toBe(160);
    t.respond('squat', 'tm_test_failed');
    expect(t.state().wave.squat.tm).toBe(160);
  });

  it('TM test with 3+ reps passes: "Your training max is honest."', () => {
    const t = in531(TM100);
    t.log([seventhLift('squat', 'tm_test', 100, 4)], '531');
    expect(t.state().wave.squat.pending?.message).toBe('Your training max is honest.');
    expect(t.state().wave.squat.tm).toBe(100);
  });

  /** Plays one block (two cycles) for squat, then returns the plan for its 7th week. */
  function toSeventh(t: Timeline) {
    cycle(t, 'squat', [5, 3, 1]);
    cycle(t, 'squat', [5, 3, 1]);
  }
  const seventh = (t: Timeline) => planNextSession(t.state(), t.settings, TODAY).lifts.find((l) => l.lift === 'squat')!;
  // Rotation puts squat first only when it is next, so force it by planning a squat-only history.
  function squatNext(t: Timeline) {
    const st = t.state();
    st.rotationCursor = 'ohp';
    return planNextSession(st, t.settings, TODAY).lifts[0];
  }

  it('15. 7th week alternates deload / TM test, with the deload style from settings', () => {
    const t = in531(TM100);
    toSeventh(t);
    let p = squatNext(t);
    expect(p.sevenType).toBe('deload_forever');
    expect(p.tm).toBe(120); // two passed cycles: 100 -> 110 -> 120
    expect(p.sets.map((s) => [s.weight, s.reps])).toEqual([[85, 5], [95, 3], [110, 1], [120, 1]]);
    t.settings.deloadStyle = 'light';
    p = squatNext(t);
    expect(p.sevenType).toBe('deload_light');
    expect(p.sets.map((s) => s.weight)).toEqual([50, 60, 70]);
    t.settings.deloadStyle = 'forever';

    t.log([seventhLift('squat', 'deload_forever', 100)], '531');
    expect(t.state().wave.squat.step).toBe(7);
    toSeventh(t);
    p = squatNext(t);
    expect(p.sevenType).toBe('tm_test');
    const top = p.sets[p.sets.length - 1];
    expect(top.type).toBe('amrap');
    expect(top.minReps).toBe(3);
    t.log([seventhLift('squat', 'tm_test', 100, 3)], '531');
    toSeventh(t);
    expect(squatNext(t).sevenType).toBe('deload_forever');
    expect(seventh).toBeDefined();
  });

  it('15b. swapping a TM test for a deload moves the TM test to the next block', () => {
    const t = in531(TM100);
    toSeventh(t);
    t.log([seventhLift('squat', 'deload_forever', 100)], '531');
    toSeventh(t);
    expect(squatNext(t).sevenType).toBe('tm_test');
    t.decide({ kind: 'override_7th', lift: 'squat', sevenType: 'deload_light' });
    expect(squatNext(t).sevenType).toBe('deload_light');
    t.log([seventhLift('squat', 'deload_light', 100)], '531');
    toSeventh(t);
    expect(squatNext(t).sevenType).toBe('tm_test'); // next block
    t.log([seventhLift('squat', 'tm_test', 100, 4)], '531');
    toSeventh(t);
    expect(squatNext(t).sevenType).toBe('deload_forever');
  });

  it('skipping a 5/3/1 lift does not advance its wave', () => {
    const t = in531(TM100);
    t.log([{ lift: 'squat', scheme: '531', skipped: true, sets: [] }], '531');
    expect(t.state().wave.squat.step).toBe(0);
    // Nothing was performed, so the same lift is next.
    expect(planNextSession(t.state(), t.settings, TODAY).lifts[0].lift).toBe('squat');
    t.log([waveLift('squat', 1, 100, 5)], '531');
    expect(planNextSession(t.state(), t.settings, TODAY).lifts[0].lift).toBe('bench');
  });

  it('19. rotation with liftsPerSession = 1 and 2', () => {
    const one = in531(TM100);
    const order: string[] = [];
    for (let i = 0; i < 5; i++) {
      const p = planNextSession(one.state(), one.settings, TODAY);
      order.push(p.lifts.map((l) => l.lift).join('+'));
      one.log(p.lifts.map((l) => waveLift(l.slot, l.waveWeek ?? 1, 100, 5)), '531');
    }
    expect(order).toEqual(['squat', 'bench', 'deadlift', 'ohp', 'squat']);
    expect(one.state().wave.squat.step).toBe(2);
    expect(one.state().wave.ohp.step).toBe(1);

    const two = in531(TM100, { liftsPerSession: 2 });
    const order2: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = planNextSession(two.state(), two.settings, TODAY);
      order2.push(p.lifts.map((l) => l.lift).join('+'));
      two.log(p.lifts.map((l) => waveLift(l.slot, l.waveWeek ?? 1, 100, 5)), '531');
    }
    expect(order2).toEqual(['squat+bench', 'deadlift+ohp', 'squat+bench', 'deadlift+ohp']);
    expect(two.state().wave.squat.step).toBe(2);
  });

  it('flags a PR on an AMRAP that beats best e1RM or best reps at that weight', () => {
    const t = in531(TM100);
    t.log([waveLift('squat', 1, 85, 6)], '531');
    expect(isPR(t.sessions, 'squat', 85, 7)).toBe(true);
    expect(isPR(t.sessions, 'squat', 85, 6)).toBe(false);
    expect(isPR(t.sessions, 'squat', 90, 5)).toBe(true); // e1RM 105 beats 102
    expect(isPR(t.sessions, 'squat', 80, 5)).toBe(false);
  });
});

describe('breaks', () => {
  it('17. 20 days off suggests -10%; 35 days suggests -20%', () => {
    const t = new Timeline();
    t.settings.startingWeights.squat = 225;
    t.log([linearLift('squat', 225, ok())], 'linear', 0);
    const date = (n: number) => new Date(Date.parse('2026-01-01T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
    const squatPlan = (today: string) => planNextSession(t.state(), t.settings, today).lifts[0];
    expect(squatPlan(date(10)).alerts).toHaveLength(0);
    const a20 = squatPlan(date(20)).alerts[0];
    expect(a20.kind).toBe('break');
    expect(a20.value).toBe(roundDown5(230 * 0.9));
    expect(squatPlan(date(35)).alerts[0].value).toBe(roundDown5(230 * 0.8));
    expect(a20.message).toBe(`20 days since your last squat. Start at ${a20.value} instead of 230?`);
  });

  it('accepting applies the reduction, keeping dismisses; training again re-arms it', () => {
    const t = new Timeline();
    t.log([linearLift('squat', 200, ok())], 'linear', 0);
    const day20 = '2026-01-21';
    const alert = planNextSession(t.state(), t.settings, day20).lifts[0].alerts[0];
    t.respond('squat', 'break', 'accept', alert.value);
    expect(t.state().linear.squat.weight).toBe(alert.value);
    expect(planNextSession(t.state(), t.settings, day20).lifts[0].alerts).toHaveLength(0);

    const k = new Timeline();
    k.log([linearLift('squat', 200, ok())], 'linear', 0);
    k.respond('squat', 'break', 'keep');
    expect(k.state().linear.squat.weight).toBe(205);
    expect(planNextSession(k.state(), k.settings, day20).lifts[0].alerts).toHaveLength(0);
  });
});

describe('history is never recalculated', () => {
  it('toggling microplates or the deload % later does not change past results', () => {
    const t = new Timeline();
    t.settings.startingWeights.bench = 100;
    stall(t, 'bench', 100);
    t.respond('bench', 'deload'); // 90 under 10%
    t.log([linearLift('bench', 90, ok())]);
    const before = JSON.stringify(t.state().linear);
    t.settings.microplates = true;
    t.settings.deloadPercent = 0.2;
    t.settings.retriesBeforeDeload = 2;
    expect(JSON.stringify(t.state().linear)).toBe(before);
    expect(t.state().linear.bench.weight).toBe(95);
  });

  it('only sessions logged after the change use the new rules', () => {
    const t = new Timeline();
    t.settings.startingWeights.bench = 100;
    stall(t, 'bench', 100);
    t.respond('bench', 'deload');
    t.settings.microplates = true;
    t.log([linearLift('bench', 90, ok())]); // played under microplates + first deload -> +2.5
    expect(t.state().linear.bench.weight).toBe(92.5);
  });

  it('an accepted deload keeps the weight the alert proposed', () => {
    const t = new Timeline();
    t.settings.startingWeights.squat = 150;
    stall(t, 'squat', 150);
    t.settings.deloadPercent = 0.5;
    t.respond('squat', 'deload'); // value read from the pending alert, computed with 10%
    expect(t.state().linear.squat.weight).toBe(135);
  });

  it('keep: the next workout repeats exactly the weights just lifted', () => {
    const t = new Timeline();
    t.settings.startingWeights.squat = 150;
    stall(t, 'squat', 150);
    t.respond('squat', 'deload', 'keep');
    expect(planNextSession(t.state(), t.settings, TODAY).lifts[0].sets.map((s) => s.weight)).toEqual([150, 150, 150, 150, 150]);
  });
});
