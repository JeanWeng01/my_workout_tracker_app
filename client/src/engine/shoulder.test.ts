import { describe, expect, it } from 'vitest';
import { buildCsv } from './csv';
import { defaultSettings, deterministicId, schema2Migration, withDefaults } from './defaults';
import {
  accessoriesRevealed,
  draftFromPlan,
  isWorkoutComplete,
  liftFromPlan,
  liftsNeedingRating,
  liftsWithUntouched,
  resolveUntouched,
  setPain,
  setSkipped,
  skipPain,
  toggleSet,
} from './logging';
import { accessoryPrescription, planNextSession, rehabPrescription } from './plan';
import { zoneOfRating } from './shoulder';
import { deriveState } from './state';
import { linearLift, ok, Timeline, waveLift } from './testkit';
import { acc, alertFor, answer, extraSets, goRehab, pain, planned, rehabLift, withPain, withSets } from './testkit2';

const TODAY = '2026-01-10';
const ex = 'db_floor_press' as const;
const exO = 'seated_db_ohp' as const;
const rx = (t: Timeline, e: typeof ex | typeof exO = ex) => rehabPrescription(t.state(), e, t.settings);
const logRehab = (t: Timeline, w: number, reps: number, p?: number, done?: number[]) =>
  t.log([rehabLift(ex, w, reps, done, p === undefined ? undefined : pain(p))]);

/** Day 1 as it really happened: squat 65, bench 45, row 45, all 5x5 completed. */
function day1() {
  const t = new Timeline();
  t.log([linearLift('squat', 65, ok()), linearLift('bench', 45, ok()), linearLift('row', 45, ok())]);
  return t;
}

describe('1. migration: after the update the next workouts show the rehab exercises', () => {
  it('Bench and OHP move to rehab at the first ladder rungs; nothing logged is touched', () => {
    const t = day1();
    const before = JSON.stringify(t.sessions);
    const made = schema2Migration(t.settings, t.sessions, t.decisions, '2026-01-02T00:00:00.000Z');
    expect(made).toHaveLength(2);
    expect(made.map((d) => d.body)).toEqual([
      { kind: 'track_change', lift: 'bench', to: 'rehab', startWeight: 15 },
      { kind: 'track_change', lift: 'ohp', to: 'rehab', startWeight: 12.5 },
    ]);
    expect(made.every((d) => d.afterSessionId === 's0')).toBe(true);
    t.decisions.push(...made);
    expect(JSON.stringify(t.sessions)).toBe(before);
  });

  it('is idempotent and uses stable ids so two devices never duplicate it', () => {
    const t = day1();
    const a = schema2Migration(t.settings, t.sessions, t.decisions, '2026-01-02T00:00:00.000Z');
    const b = schema2Migration(t.settings, t.sessions, t.decisions, '2026-03-05T00:00:00.000Z');
    expect(a.map((d) => d.id)).toEqual(b.map((d) => d.id));
    expect(a[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a[0].id).not.toBe(a[1].id);
    expect(deterministicId('x')).toBe(deterministicId('x'));
    t.decisions.push(...a);
    expect(schema2Migration(t.settings, t.sessions, t.decisions)).toEqual([]);
  });

  it('next is Workout B (Day 1 was A): Squat, Seated DB OHP 2 x 12.5 lb 3 x 10, Deadlift; then A: Squat, DB Floor Press 2 x 15 lb 3 x 10, Row 50', () => {
    const t = day1();
    t.decisions.push(...schema2Migration(t.settings, t.sessions, t.decisions));
    let plan = planNextSession(t.state(), t.settings, TODAY);
    expect(plan.label).toBe('Workout B');
    expect(plan.lifts.map((l) => l.lift)).toEqual(['squat', 'seated_db_ohp', 'deadlift']);
    expect(plan.lifts[0].workingWeight).toBe(70);
    const ohp = plan.lifts[1];
    expect(ohp).toMatchObject({ perHand: true, workingWeight: 12.5, track: 'rehab', slot: 'ohp', cue: 'Lower for 3 s', warmups: [], platesPerSide: [] });
    expect(ohp.sets.map((s) => [s.weight, s.reps])).toEqual([[12.5, 10], [12.5, 10], [12.5, 10]]);
    expect(plan.lifts[2].workingWeight).toBe(95);

    t.log([linearLift('squat', 70, ok()), rehabLift(exO, 12.5, 10, undefined, pain(1)), linearLift('deadlift', 95, [5])]);
    plan = planNextSession(t.state(), t.settings, TODAY);
    expect(plan.label).toBe('Workout A');
    expect(plan.lifts.map((l) => l.lift)).toEqual(['squat', 'db_floor_press', 'row']);
    expect(plan.lifts[1].sets.map((s) => [s.weight, s.reps])).toEqual([[15, 10], [15, 10], [15, 10]]);
    expect(plan.lifts[2].workingWeight).toBe(50);
    expect(plan.lifts).toHaveLength(3); // no extra cards for the shoulder work
  });

  it('Day 1 barbell bench stays in history; the new exercise has its own history', () => {
    const t = day1();
    t.decisions.push(...schema2Migration(t.settings, t.sessions, t.decisions));
    logRehab(t, 15, 10, 1);
    const st = t.state();
    expect(st.linear.bench.weight).toBe(50); // barbell state untouched while on rehab
    expect(st.rehab.db_floor_press.sessions).toBe(1);
    expect(st.e1rm.bench).toHaveLength(1); // only the barbell session counts for the training max
  });
});

describe('2. rehab double progression', () => {
  it('3x10 -> 3x12 -> 3x15 at 15 lb, then 17.5 lb at 3x10, each step only after a completed + green session', () => {
    const t = new Timeline();
    goRehab(t, ['bench']);
    expect(rx(t)).toEqual({ weight: 15, reps: 10 });
    logRehab(t, 15, 10, 1);
    expect(rx(t)).toEqual({ weight: 15, reps: 12 });
    expect(alertFor(t, ex)?.message).toBe('Clean and comfortable. Next time: 2 × 15 lb for 3 × 12.');
    logRehab(t, 15, 12, 2);
    expect(rx(t)).toEqual({ weight: 15, reps: 15 });
    logRehab(t, 15, 15, 0);
    expect(rx(t)).toEqual({ weight: 17.5, reps: 10 });
    expect(alertFor(t, ex)?.message).toBe('3 × 15 done with a happy shoulder. Next time: 2 × 17.5 lb for 3 × 10.');
    expect(alertFor(t, ex)?.severity).toBe('info');
  });

  it('works through the whole default ladder, and a session at weight W never leaps ahead', () => {
    const t = new Timeline();
    goRehab(t, ['bench']);
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      const p = rx(t);
      seen.push(`${p.weight}x${p.reps}`);
      logRehab(t, p.weight, p.reps, 1);
    }
    expect(seen.slice(0, 9)).toEqual(['15x10', '15x12', '15x15', '17.5x10', '17.5x12', '17.5x15', '20x10', '20x12', '20x15']);
  });
});

describe('3. hold: amber, missed reps or a missing rating', () => {
  const holds = (label: string, run: (t: Timeline) => void, reason: string) =>
    it(label, () => {
      const t = new Timeline();
      goRehab(t, ['bench']);
      run(t);
      expect(rx(t)).toEqual({ weight: 15, reps: 10 });
      expect(alertFor(t, ex)?.kind).toBe('rehab_hold');
      expect(alertFor(t, ex)?.message).toBe(`Holding at 2 × 15 lb for 3 × 10 (${reason}).`);
      const st = t.state();
      expect(st.linear.bench.streak).toBe(0); // holding is never a stall
      expect(st.linear.bench.pending).toBeNull();
    });
  holds('amber (rated 3)', (t) => logRehab(t, 15, 10, 3), 'shoulder rated 3');
  holds('missed reps', (t) => logRehab(t, 15, 10, 1, [10, 10, 8]), 'missed reps');
  holds('no shoulder rating', (t) => logRehab(t, 15, 10), 'no shoulder rating');

  it('holding repeats forever without a deload', () => {
    const t = new Timeline();
    goRehab(t, ['bench']);
    for (let i = 0; i < 6; i++) logRehab(t, 15, 10, 1, [10, 8, 6]);
    expect(rx(t)).toEqual({ weight: 15, reps: 10 });
    expect(alertFor(t, ex)?.kind).toBe('rehab_hold');
  });

  it('with shoulder tracking off a completed session steps up even without a rating', () => {
    const t = new Timeline();
    t.settings.shoulder.tracking = false;
    goRehab(t, ['bench']);
    logRehab(t, 15, 10);
    expect(rx(t)).toEqual({ weight: 15, reps: 12 });
  });
});

describe('4. red on the rehab track', () => {
  it('suggests one rung down at 3x10; accepting moves down, keeping holds', () => {
    const t = new Timeline();
    t.decide({ kind: 'track_change', lift: 'bench', to: 'rehab', startWeight: 20 });
    logRehab(t, 20, 10, 1); // -> 20 x 12
    logRehab(t, 20, 12, 6);
    const a = alertFor(t, ex)!;
    expect(a.kind).toBe('rehab_red');
    expect(a.severity).toBe('action');
    expect(a.message).toBe('Shoulder rated 6. Drop back to 2 × 17.5 lb for 3 × 10?');
    expect(rx(t)).toEqual({ weight: 20, reps: 12 }); // nothing changes until accepted
    answer(t, ex, 'accept');
    expect(rx(t)).toEqual({ weight: 17.5, reps: 10 });
    expect(alertFor(t, ex)).toBeNull();
  });

  it('keep my numbers repeats exactly what was lifted', () => {
    const t = new Timeline();
    t.decide({ kind: 'track_change', lift: 'bench', to: 'rehab', startWeight: 20 });
    logRehab(t, 20, 10, 7);
    answer(t, ex, 'keep');
    expect(rx(t)).toEqual({ weight: 20, reps: 10 });
  });

  it('on the first ladder weight the suggestion is 3x10 at the same weight', () => {
    const t = new Timeline();
    goRehab(t, ['bench']);
    logRehab(t, 15, 10, 1);
    logRehab(t, 15, 12, 5);
    const a = alertFor(t, ex)!;
    expect(a.message).toBe('Shoulder rated 5. Drop back to 2 × 15 lb for 3 × 10?');
    answer(t, ex, 'accept');
    expect(rx(t)).toEqual({ weight: 15, reps: 10 });
  });

  it('"sharp / pinching" is always red, whatever the number', () => {
    const t = new Timeline();
    goRehab(t, ['bench']);
    t.log([rehabLift(ex, 15, 10, undefined, pain(1, true))]);
    expect(alertFor(t, ex)?.kind).toBe('rehab_red');
    expect(alertFor(t, ex)?.message).toContain('sharp');
  });

  it('a calm session resets the red streak', () => {
    const t = new Timeline();
    goRehab(t, ['bench']);
    logRehab(t, 15, 10, 6);
    logRehab(t, 15, 10, 1);
    logRehab(t, 15, 12, 6);
    expect(alertFor(t, ex)?.kind).toBe('rehab_red'); // one red since the calm session, not two
  });
});

describe('5. two reds in a row: pause', () => {
  function twoReds() {
    const t = day1();
    goRehab(t, ['bench']);
    logRehab(t, 15, 10, 6);
    logRehab(t, 15, 10, 7);
    return t;
  }

  it('asks to pause with the exact copy and button labels', () => {
    const t = twoReds();
    const a = alertFor(t, ex)!;
    expect(a.kind).toBe('two_reds');
    expect(a.message).toBe('Your shoulder flagged red twice in a row. Pause this lift and get it assessed before continuing.');
    expect([a.acceptLabel, a.keepLabel]).toEqual(['Pause this lift', 'Keep going']);
  });

  it('Pause: the lift is skipped automatically until resumed in Settings', () => {
    const t = twoReds();
    answer(t, ex, 'accept');
    expect(t.state().paused.bench).toBe(true);
    t.log([linearLift('squat', 70, ok())]); // so the next workout is the one with Bench
    // linear layout: still listed, marked Paused, and drafted as skipped
    const plan = planNextSession(t.state(), t.settings, TODAY);
    const lift = plan.lifts.find((l) => l.slot === 'bench')!;
    expect(lift.paused).toBe(true);
    expect(liftFromPlan(lift)).toMatchObject({ skipped: true, paused: true });
    // 5/3/1 rotation passes over it
    t.decide({ kind: 'phase_switch', to: '531', auto: false, tms: { squat: 100, bench: 100, deadlift: 100, ohp: 100 } });
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = planNextSession(t.state(), t.settings, TODAY);
      order.push(p.lifts[0].slot);
      t.log([waveLift(p.lifts[0].slot as 'squat', 1, 100, 5)], '531');
    }
    expect(order).toEqual(['squat', 'deadlift', 'ohp', 'squat']);
    // resume
    t.decide({ kind: 'resume_lift', lift: 'bench' });
    expect(t.state().paused.bench).toBe(false);
  });

  it('Keep going leaves it running, and another red asks again', () => {
    const t = twoReds();
    answer(t, ex, 'keep');
    expect(t.state().paused.bench).toBe(false);
    expect(alertFor(t, ex)).toBeNull();
    logRehab(t, 15, 10, 8);
    expect(alertFor(t, ex)?.kind).toBe('two_reds');
  });
});

describe('6. return to the barbell', () => {
  function atTop() {
    const t = day1();
    t.decide({ kind: 'track_change', lift: 'bench', to: 'rehab', startWeight: 30 });
    logRehab(t, 30, 10, 1);
    logRehab(t, 30, 12, 1);
    return t;
  }

  it('final weight + top rep step + green asks, with the exact copy and buttons', () => {
    const t = atTop();
    expect(alertFor(t, ex)?.kind).toBe('rehab_step');
    logRehab(t, 30, 15, 1);
    const a = alertFor(t, ex)!;
    expect(a.kind).toBe('return_barbell');
    expect(a.message).toBe('Your shoulder has handled 2 × 30 lb for 3 × 15 cleanly. Ready to return to the barbell bench press at 55 lb?');
    expect([a.acceptLabel, a.keepLabel]).toEqual(['Return to barbell', 'Not yet']);
    expect(a.value).toBe(55);
  });

  it('an amber session at the top does not ask', () => {
    const t = atTop();
    logRehab(t, 30, 15, 3);
    expect(alertFor(t, ex)?.kind).toBe('rehab_hold');
  });

  it('"Not yet" keeps the rehab track at 3x15 and asks again after 3 more sessions', () => {
    const t = atTop();
    logRehab(t, 30, 15, 1);
    answer(t, ex, 'keep');
    expect(t.state().track.bench).toBe('rehab');
    expect(rx(t)).toEqual({ weight: 30, reps: 15 });
    logRehab(t, 30, 15, 1);
    expect(alertFor(t, ex)?.kind).toBe('rehab_hold');
    logRehab(t, 30, 15, 1);
    expect(alertFor(t, ex)?.kind).toBe('rehab_hold');
    logRehab(t, 30, 15, 1);
    expect(alertFor(t, ex)?.kind).toBe('return_barbell');
  });

  it('"Return" starts fresh linear 5x5 at 55: streak 0, no deloads, barbell history not carried over', () => {
    const t = atTop();
    logRehab(t, 30, 15, 1);
    answer(t, ex, 'accept');
    const st = t.state();
    expect(st.track.bench).toBe('linear');
    expect(st.linear.bench).toMatchObject({ weight: 55, scheme: '5x5', streak: 0, deloadsInScheme: 0, hadDeload: false, complete: false, pending: null });
    const lift = planNextSession(st, t.settings, TODAY).lifts.find((l) => l.slot === 'bench');
    expect(lift).toMatchObject({ lift: 'bench', track: 'linear', workingWeight: 55 });
    expect(lift!.sets).toHaveLength(5);
  });

  it('OHP returns at the empty bar (45)', () => {
    const t = new Timeline();
    t.decide({ kind: 'track_change', lift: 'ohp', to: 'rehab', startWeight: 20 });
    t.log([rehabLift(exO, 20, 10, undefined, pain(1))]);
    t.log([rehabLift(exO, 20, 12, undefined, pain(1))]);
    t.log([rehabLift(exO, 20, 15, undefined, pain(1))]);
    const a = alertFor(t, exO)!;
    expect(a.message).toBe('Your shoulder has handled 2 × 20 lb for 3 × 15 cleanly. Ready to return to the barbell overhead press at 45 lb?');
    answer(t, exO, 'accept');
    expect(t.state().linear.ohp.weight).toBe(45);
  });
});

describe('7. linear tracked lift', () => {
  const bench = (t: Timeline, w: number, reps: number[], rating?: number) =>
    t.log([rating === undefined ? linearLift('bench', w, reps) : withPain(linearLift('bench', w, reps), rating)]);

  it('amber: hold the weight, and it is not a miss or a stall', () => {
    const t = new Timeline();
    t.settings.startingWeights.bench = 60;
    bench(t, 60, ok(), 3);
    let ls = t.state().linear.bench;
    expect(ls.weight).toBe(60);
    expect(ls.streak).toBe(0);
    expect(ls.pending?.message).toBe("Shoulder rated 3, so bench holds at 60 next time. This doesn't count as a miss.");
    // even missed reps under amber never count toward a stall
    for (let i = 0; i < 4; i++) bench(t, 60, [5, 5, 5, 4, 4], 4);
    ls = t.state().linear.bench;
    expect(ls.weight).toBe(60);
    expect(ls.streak).toBe(0);
    expect(ls.pending?.kind).toBe('linear_amber');
    // a calm completed session moves on again
    bench(t, 60, ok(), 1);
    expect(t.state().linear.bench.weight).toBe(65);
  });

  it('green or no rating follows the normal rules', () => {
    const t = new Timeline();
    bench(t, 45, ok(), 2);
    expect(t.state().linear.bench.weight).toBe(50);
    bench(t, 50, ok());
    expect(t.state().linear.bench.weight).toBe(55);
  });

  it('red: suggests a 10% deload (never an increase); accepting lowers, keeping holds', () => {
    const t = new Timeline();
    t.settings.startingWeights.bench = 100;
    bench(t, 100, ok(), 5);
    const a = alertFor(t, 'bench')!;
    expect(a.kind).toBe('linear_red');
    expect(a.message).toBe('Shoulder rated 5. Dial bench down to 90?');
    expect(t.state().linear.bench.weight).toBe(100);
    answer(t, 'bench', 'accept');
    expect(t.state().linear.bench).toMatchObject({ weight: 90, streak: 0, deloadsInScheme: 0, hadDeload: false });

    const k = new Timeline();
    k.settings.startingWeights.bench = 100;
    bench(k, 100, ok(), 6);
    answer(k, 'bench', 'keep');
    expect(k.state().linear.bench.weight).toBe(100);
  });

  it('two reds in a row: the same pause question', () => {
    const t = new Timeline();
    t.settings.startingWeights.bench = 100;
    bench(t, 100, ok(), 6);
    bench(t, 100, ok(), 7);
    const a = alertFor(t, 'bench')!;
    expect(a.kind).toBe('two_reds');
    answer(t, 'bench', 'accept');
    expect(t.state().paused.bench).toBe(true);
  });

  it('only tracked lifts are gated: squat is not tracked by default, Row is', () => {
    const t = new Timeline();
    t.log([withPain(linearLift('squat', 65, ok()), 9)]);
    expect(t.state().linear.squat.weight).toBe(70);
    const r = new Timeline();
    r.log([withPain(linearLift('row', 45, ok()), 9)]);
    expect(r.state().linear.row.weight).toBe(45);
    expect(alertFor(r, 'row')?.kind).toBe('linear_red');
    r.settings.shoulder.tracked = [...r.settings.shoulder.tracked, 'squat'];
    const s = new Timeline();
    s.settings.shoulder.tracked.push('squat');
    s.log([withPain(linearLift('squat', 65, ok()), 9)]);
    expect(s.state().linear.squat.weight).toBe(65);
  });

  it('with shoulder tracking off, ratings never gate anything', () => {
    const t = new Timeline();
    t.settings.shoulder.tracking = false;
    bench(t, 45, ok(), 9);
    expect(t.state().linear.bench.weight).toBe(50);
  });
});

describe('8. squat triggers 5/3/1 while Bench is on rehab', () => {
  const TMS = { squat: 100, bench: 100, deadlift: 100, ohp: 100 };
  const sw = (t: Timeline) => t.decide({ kind: 'phase_switch', to: '531', auto: false, tms: TMS });

  it('Bench stays rehab in its rotation slot: 3 sets, no percentages, no supplemental', () => {
    const t = day1();
    goRehab(t, ['bench']);
    sw(t);
    const st = t.state();
    expect(st.track).toMatchObject({ squat: '531', deadlift: '531', ohp: '531', bench: 'rehab' });
    t.log([waveLift('squat', 1, 65, 5)], '531');
    const p = planNextSession(t.state(), t.settings, TODAY);
    expect(p.lifts).toHaveLength(1);
    const l = p.lifts[0];
    expect(l).toMatchObject({ lift: 'db_floor_press', track: 'rehab', perHand: true });
    expect(l.sets.map((s) => s.type)).toEqual(['work', 'work', 'work']);
    expect(l.sets.every((s) => s.pct === undefined)).toBe(true);
    expect(p.label).toContain('DB Floor Press');
  });

  it('after returning it runs linear 5x5 in its slot until its first stall, then joins 5/3/1 at block 1 / cycle 1 / week 1', () => {
    const t = day1();
    goRehab(t, ['bench']);
    sw(t);
    t.decide({ kind: 'track_change', lift: 'bench', to: 'linear', startWeight: 55 });
    const rotate = (except: 'bench'[] = []) => {
      for (const l of ['deadlift', 'ohp', 'squat'] as const) {
        void except;
        t.log([waveLift(l, 1, 100, 5)], '531');
      }
    };
    t.log([waveLift('squat', 1, 65, 5)], '531');
    let plan = planNextSession(t.state(), t.settings, TODAY);
    expect(plan.lifts[0]).toMatchObject({ lift: 'bench', track: 'linear', workingWeight: 55 });
    expect(plan.lifts[0].sets).toHaveLength(5);

    t.log([linearLift('bench', 55, ok())], '531'); // completed: 55 -> 60
    expect(t.state().linear.bench.weight).toBe(60);
    for (let i = 0; i < 3; i++) {
      rotate();
      t.log([linearLift('bench', 60, [5, 5, 5, 5, 4])], '531');
      if (i < 2) expect(t.state().track.bench).toBe('linear');
    }
    const st = t.state();
    expect(st.track.bench).toBe('531');
    // e1RM history: 45x5 (Day 1), 55x5, then 60x5 three times -> best 70 * 0.85 = 59.5 -> 55
    expect(st.wave.bench.tm).toBe(55);
    expect(st.wave.bench.step).toBe(0);
    expect(st.wave.bench.pending?.message).toBe('Bench joins 5/3/1. Training max: 55 lb.');
    expect(st.wave.bench.pending?.severity).toBe('info');
    expect(st.linear.bench.pending).toBeNull();
    rotate();
    plan = planNextSession(t.state(), t.settings, TODAY);
    expect(plan.lifts[0]).toMatchObject({ lift: 'bench', track: '531', waveWeek: 1, cycle: 1, block: 1, tm: 55 });
  });

  it('a lift on the barbell before the switch is not affected by the late-joiner rule', () => {
    const t = new Timeline();
    t.settings.startingWeights.bench = 100;
    for (let i = 0; i < 3; i++) t.log([linearLift('bench', 100, [5, 5, 5, 5, 4])]);
    expect(alertFor(t, 'bench')?.kind).toBe('deload');
    expect(t.state().track.bench).toBe('linear');
  });
});

describe('9. 5/3/1 tracked lift', () => {
  const TMS = { squat: 100, bench: 100, deadlift: 100, ohp: 100 };
  const cycle = (t: Timeline, ratings: (number | undefined)[]) => {
    ([1, 2, 3] as const).forEach((w, i) => {
      const l = waveLift('bench', w, 100, 15);
      t.log([ratings[i] === undefined ? l : withPain(l, ratings[i]!)], '531');
    });
  };

  it('one red session in a cycle holds the TM, with an info alert', () => {
    const t = new Timeline();
    t.decide({ kind: 'phase_switch', to: '531', auto: false, tms: TMS });
    cycle(t, [1, 6, 2]);
    const ws = t.state().wave.bench;
    expect(ws.tm).toBe(100);
    expect(ws.missedCycles).toBe(0); // pain is not a miss
    expect(ws.pending?.message).toBe('Shoulder flagged red this cycle. Bench training max stays at 100.');
    expect(ws.pending?.severity).toBe('info');
  });

  it('amber is logged only: the TM still goes up', () => {
    const t = new Timeline();
    t.decide({ kind: 'phase_switch', to: '531', auto: false, tms: TMS });
    cycle(t, [3, 4, 3]);
    expect(t.state().wave.bench.tm).toBe(105);
  });

  it('the next cycle is judged on its own', () => {
    const t = new Timeline();
    t.decide({ kind: 'phase_switch', to: '531', auto: false, tms: TMS });
    cycle(t, [6, 1, 1]);
    cycle(t, [1, 1, 1]);
    expect(t.state().wave.bench.tm).toBe(105);
  });
});

describe('10. editing a ladder changes the next suggestion, never the history', () => {
  it('ladder, rep steps and return weight edits apply to what comes next', () => {
    const t = new Timeline();
    goRehab(t, ['bench']);
    logRehab(t, 15, 10, 1);
    logRehab(t, 15, 12, 1);
    logRehab(t, 15, 15, 1);
    expect(rx(t)).toEqual({ weight: 17.5, reps: 10 });
    const sessionsBefore = JSON.stringify(t.sessions);
    t.settings.rehab.ladders.db_floor_press = [15, 16, 22.5, 30];
    expect(rx(t)).toEqual({ weight: 16, reps: 10 });
    expect(JSON.stringify(t.sessions)).toBe(sessionsBefore);
    t.settings.rehab.repSteps = [8, 10, 12];
    logRehab(t, 16, 10, 1);
    expect(rx(t)).toEqual({ weight: 16, reps: 12 });
  });

  it('a weight lifted that is no longer on the ladder still steps to the next rung above it', () => {
    const t = new Timeline();
    goRehab(t, ['bench']);
    t.settings.rehab.ladders.db_floor_press = [15, 17.5, 20];
    logRehab(t, 15, 10, 1);
    logRehab(t, 15, 12, 1);
    logRehab(t, 15, 15, 1);
    t.settings.rehab.ladders.db_floor_press = [12.5, 20, 25];
    expect(rx(t)).toEqual({ weight: 20, reps: 10 });
  });
});

describe('11. CSV', () => {
  it('Day 1 barbell rows are unchanged by later shoulder work', () => {
    const t = day1();
    const csv1 = buildCsv(t.settings, t.sessions, t.decisions).split('\r\n');
    t.decisions.push(...schema2Migration(t.settings, t.sessions, t.decisions));
    t.log([withSets(withPain(rehabLift(exO, 12.5, 10), 3), [])]);
    const csv2 = buildCsv(t.settings, t.sessions, t.decisions).split('\r\n');
    const day1Rows = csv1.slice(1, 1 + 15);
    expect(csv2.slice(1, 1 + 15)).toEqual(day1Rows);
    const bench = day1Rows.map((r) => r.split(',')).filter((c) => c[4] === 'bench');
    expect(bench).toHaveLength(5);
    expect(bench[0][3]).toBe('linear');
    expect(bench[0][5]).toBe('5x5');
    expect(bench[0][19]).toBe(''); // pain columns blank for an unrated lift
  });

  it('has the pain columns, repeats the lift rating on each of its rows, and names the dumbbell exercises', () => {
    const t = new Timeline();
    t.log([withPain(rehabLift(ex, 15, 10), 3, true)]);
    const rows = buildCsv(t.settings, t.sessions, t.decisions).slice(1).split('\r\n').filter(Boolean);
    const header = rows[0].split(',');
    expect(header.slice(-3)).toEqual(['notes', 'pain_0_10', 'pain_sharp']);
    const cols = rows.slice(1).map((r) => r.split(','));
    expect(cols).toHaveLength(3);
    for (const c of cols) {
      expect(c[3]).toBe('rehab');
      expect(c[4]).toBe('DB Floor Press');
      expect(c[5]).toBe('rehab');
      expect(c[8]).toBe('15'); // per hand
      expect(c[17]).toBe(''); // no e1RM for dumbbell work
      expect(c.slice(-2)).toEqual(['3', 'TRUE']);
    }
  });

  it('exports prep and accessory rows with their own names, only if tapped, and no pain on them', () => {
    const t = new Timeline();
    const squat = withSets(
      linearLift('squat', 65, ok()),
      extraSets('prep', 'band_pull_apart', 0, 20, [20, -1]),
    );
    const row = withSets(withPain(linearLift('row', 45, ok()), 1), [...acc('side_lying_er', 3, 10, 3), ...acc('db_scaption', 3, 10, 3, [10, -1, -1])]);
    t.log([squat, row]);
    const cols = buildCsv(t.settings, t.sessions, t.decisions).slice(1).split('\r\n').filter(Boolean).map((r) => r.split(','));
    const prep = cols.filter((c) => c[7] === 'prep');
    expect(prep).toHaveLength(1); // the untouched second set is left out
    expect(prep[0][4]).toBe('Band pull-aparts');
    expect(prep[0][5]).toBe('prep');
    const accRows = cols.filter((c) => c[7] === 'accessory');
    expect(accRows.map((c) => c[4])).toEqual([
      'Side-lying DB external rotation',
      'Side-lying DB external rotation',
      'Side-lying DB external rotation',
      'DB scaption',
    ]);
    for (const c of [...prep, ...accRows]) expect(c.slice(-2)).toEqual(['', '']);
    const rowMain = cols.filter((c) => c[4] === 'row' && c[7] === 'work');
    expect(rowMain.every((c) => c.slice(-2).join() === '1,FALSE')).toBe(true);
  });
});

describe('13-14. what the plan and the draft contain', () => {
  const settings = () => {
    const t = day1();
    t.decisions.push(...schema2Migration(t.settings, t.sessions, t.decisions));
    return t;
  };

  it('pull-aparts are the first items of the first card, even with no barbell warm-ups, and never an extra card', () => {
    const t = settings();
    t.settings.startingWeights.squat = 45; // empty bar: no barbell warm-up sets
    const fresh = new Timeline({ startingWeights: { ...t.settings.startingWeights } });
    fresh.decisions.push(...schema2Migration(fresh.settings, fresh.sessions, fresh.decisions));
    const plan = planNextSession(fresh.state(), fresh.settings, TODAY);
    expect(plan.lifts).toHaveLength(3);
    expect(plan.lifts[0].warmups).toEqual([]);
    expect(plan.lifts[0].prep).toMatchObject({ exercise: 'band_pull_apart', sets: 2, reps: 20, cue: 'Squeeze, hold 1 s' });
    expect(plan.lifts[1].prep).toBeUndefined();
    const draft = draftFromPlan(plan, fresh.settings, 'd', '2026-01-10T10:00:00Z', '2026-01-10');
    expect(draft.lifts[0].sets.slice(0, 2).map((x) => [x.type, x.exercise])).toEqual([['prep', 'band_pull_apart'], ['prep', 'band_pull_apart']]);
    expect(draft.lifts[1].sets.some((x) => x.type === 'prep')).toBe(false);
  });

  it('pull-aparts never affect progression or completion', () => {
    const t = new Timeline();
    const plain = linearLift('squat', 65, ok());
    const withPrep = withSets(linearLift('squat', 65, ok()), extraSets('prep', 'band_pull_apart', 0, 20, [20, 20]));
    const a = new Timeline();
    a.log([plain]);
    t.log([withPrep]);
    expect(t.state().linear.squat).toEqual(a.state().linear.squat);
    const plan = planNextSession(new Timeline().state(), new Timeline().settings, TODAY);
    let d = draftFromPlan(plan, new Timeline().settings, 'd', '2026-01-10T10:00:00Z', '2026-01-10');
    d.lifts.forEach((l, li) =>
      l.sets.forEach((x, si) => {
        if (x.type === 'prep') d = toggleSet(d, li, si);
      }),
    );
    expect(isWorkoutComplete(d)).toBe(false);
  });

  it('shoulder tracking off: no pull-aparts and no accessories', () => {
    const t = new Timeline();
    t.settings.shoulder.tracking = false;
    const plan = planNextSession(t.state(), t.settings, TODAY);
    expect(plan.lifts.every((l) => !l.prep && !l.accessories)).toBe(true);
  });

  it('the rehab card carries only what the prescription needs: weight per hand, sets, cue, no warm-ups or plates', () => {
    const t = settings();
    const p = planned(t, exO)!;
    expect(p).toMatchObject({ perHand: true, cue: 'Lower for 3 s', warmups: [], platesPerSide: [], emptyBar: false, holding: false });
    expect(p.sets).toHaveLength(3);
    expect(p.sets.every((s) => s.type === 'work' && s.weight === 12.5 && s.reps === 10)).toBe(true);
  });
});

describe('15. accessories live inside the last card', () => {
  function workoutA() {
    const t = day1();
    t.decisions.push(...schema2Migration(t.settings, t.sessions, t.decisions));
    t.log([linearLift('squat', 70, ok()), rehabLift(exO, 12.5, 10, undefined, pain(1)), linearLift('deadlift', 95, [5])]);
    return t; // next is Workout A: squat, DB floor press, row
  }
  const draftA = (t: Timeline) => draftFromPlan(planNextSession(t.state(), t.settings, TODAY), t.settings, 'd', '2026-01-10T10:00:00Z', '2026-01-10');

  it('are planned on the last card only (Row in A), two exercises of 3 sets in rehab mode', () => {
    const t = workoutA();
    const plan = planNextSession(t.state(), t.settings, TODAY);
    expect(plan.lifts.map((l) => !!l.accessories)).toEqual([false, false, true]);
    expect(plan.lifts[2].accessories!.map((a) => [a.exercise, a.sets, a.weight, a.reps])).toEqual([
      ['side_lying_er', 3, 3, 10],
      ['db_scaption', 3, 3, 10],
    ]);
    const d = draftA(t);
    expect(d.lifts[2].sets.filter((x) => x.type === 'accessory')).toHaveLength(6);
    expect(d.lifts[1].sets.some((x) => x.type === 'accessory')).toBe(false);
  });

  it('appear only after that lift\'s last work set is tapped', () => {
    const t = workoutA();
    let d = draftA(t);
    expect(accessoriesRevealed(d.lifts[2])).toBe(false);
    d.lifts[2].sets.forEach((x, si) => {
      if (x.type === 'work') d = toggleSet(d, 2, si);
    });
    expect(accessoriesRevealed(d.lifts[2])).toBe(true);
    // the workout is not complete until they are done too
    d.lifts.forEach((l, li) =>
      l.sets.forEach((x, si) => {
        if (x.type === 'work' && !d.lifts[li].sets[si].done) d = toggleSet(d, li, si);
      }),
    );
    expect(isWorkoutComplete(d)).toBe(false);
    d.lifts[2].sets.forEach((x, si) => {
      if (x.type === 'accessory') d = toggleSet(d, 2, si);
    });
    expect(isWorkoutComplete(d)).toBe(true);
  });

  it('move to the previous card when the last lift is skipped, and back when it is not', () => {
    const t = workoutA();
    let d = draftA(t);
    d = setSkipped(d, 2, true);
    expect(d.lifts[2].sets.some((x) => x.type === 'accessory')).toBe(false);
    expect(d.lifts[1].sets.filter((x) => x.type === 'accessory')).toHaveLength(6);
    d = setSkipped(d, 2, false);
    expect(d.lifts[2].sets.filter((x) => x.type === 'accessory')).toHaveLength(6);
    expect(d.lifts[1].sets.some((x) => x.type === 'accessory')).toBe(false);
  });

  it('untouched accessories are part of the Finish prompt', () => {
    const t = workoutA();
    let d = draftA(t);
    d.lifts.forEach((l, li) =>
      l.sets.forEach((x, si) => {
        if (x.type === 'work') d = toggleSet(d, li, si);
      }),
    );
    expect(liftsWithUntouched(d)).toEqual([2]); // only because of the accessories
    const missed = resolveUntouched(d, 'missed');
    const accs = missed.lifts[2].sets.filter((x) => x.type === 'accessory');
    expect(accs.every((x) => x.done && x.reps === 0)).toBe(true);
    const left = resolveUntouched(d, 'skip');
    expect(left.lifts[2].sets.filter((x) => x.type === 'accessory').every((x) => !x.done)).toBe(true);
  });
});

describe('16. accessory progression', () => {
  const er = (t: Timeline) => accessoryPrescription(t.state(), 'side_lying_er', t.settings);
  /** A session: a rated row lift with side-lying ER sets. */
  const session = (t: Timeline, weight: number, reps: number, rating?: number, done?: number[], extra: ReturnType<typeof linearLift>[] = []) => {
    const row = withSets(rating === undefined ? linearLift('row', 45, ok()) : withPain(linearLift('row', 45, ok()), rating), acc('side_lying_er', weight, reps, 3, done));
    t.log([row, ...extra]);
  };

  it('3 lb: 3x10 -> 3x12 -> 3x15 -> 5 lb at 3x10, each step after a completed + green session', () => {
    const t = new Timeline();
    expect(er(t)).toEqual({ weight: 3, reps: 10 });
    session(t, 3, 10, 1);
    expect(er(t)).toEqual({ weight: 3, reps: 12 });
    session(t, 3, 12, 0);
    expect(er(t)).toEqual({ weight: 3, reps: 15 });
    session(t, 3, 15, 2);
    expect(er(t)).toEqual({ weight: 5, reps: 10 });
  });

  it('amber anywhere that session holds', () => {
    const t = new Timeline();
    session(t, 3, 10, 1, undefined, [withPain(linearLift('bench', 45, ok()), 3)]); // row green, bench amber
    expect(er(t)).toEqual({ weight: 3, reps: 10 });
  });

  it('missed reps hold, and so does no rating at all', () => {
    const t = new Timeline();
    session(t, 3, 10, 1, [10, 10, 8]);
    expect(er(t)).toEqual({ weight: 3, reps: 10 });
    session(t, 3, 10);
    expect(er(t)).toEqual({ weight: 3, reps: 10 });
  });

  it('red drops back one weight at the first rep step, with a one-line info alert', () => {
    const t = new Timeline();
    t.state(); // warm
    session(t, 3, 10, 1);
    session(t, 3, 12, 1);
    session(t, 3, 15, 1);
    session(t, 5, 10, 1);
    session(t, 5, 12, 1);
    expect(er(t)).toEqual({ weight: 5, reps: 15 });
    session(t, 5, 15, 6);
    expect(er(t)).toEqual({ weight: 3, reps: 10 });
    const al = t.state().accessoryAlerts;
    expect(al).toHaveLength(2 - 1);
    expect(al[0].message).toBe('Shoulder flagged red. External rotation drops back to 3 lb.');
    expect(al[0].severity).toBe('info');
  });

  it('with tracking off a completed session steps up without any rating', () => {
    const t = new Timeline();
    t.settings.shoulder.tracking = false;
    session(t, 3, 10);
    expect(er(t)).toEqual({ weight: 3, reps: 12 });
  });

  it('the two accessories progress independently', () => {
    const t = new Timeline();
    const row = withSets(withPain(linearLift('row', 45, ok()), 1), [...acc('side_lying_er', 3, 10), ...acc('db_scaption', 3, 10, 3, [10, 10, 7])]);
    t.log([row]);
    expect(accessoryPrescription(t.state(), 'side_lying_er', t.settings)).toEqual({ weight: 3, reps: 12 });
    expect(accessoryPrescription(t.state(), 'db_scaption', t.settings)).toEqual({ weight: 3, reps: 10 });
  });
});

describe('17. maintenance mode and the top of the ladder', () => {
  const both = (t: Timeline) => {
    t.decide({ kind: 'track_change', lift: 'bench', to: 'linear', startWeight: 55 });
    t.decide({ kind: 'track_change', lift: 'ohp', to: 'linear', startWeight: 45 });
  };
  const lastCard = (t: Timeline) => {
    const plan = planNextSession(t.state(), t.settings, TODAY);
    return plan.lifts[plan.lifts.length - 1];
  };

  it('rehab mode is 3 sets while either press is on rehab', () => {
    const t = new Timeline();
    goRehab(t, ['bench']);
    expect(lastCard(t).accessories!.every((a) => a.sets === 3)).toBe(true);
    t.decide({ kind: 'track_change', lift: 'ohp', to: 'linear', startWeight: 45 });
    expect(lastCard(t).accessories!.every((a) => a.sets === 3)).toBe(true); // bench still on rehab
  });

  it('once both are back on the barbell: 2 sets at their current weight and rep step, with one info alert', () => {
    const t = new Timeline();
    goRehab(t);
    t.log([withSets(withPain(linearLift('row', 45, ok()), 1), acc('side_lying_er', 3, 10))]); // -> 3 lb, 3x12
    both(t);
    const card = lastCard(t);
    expect(card.accessories!.map((a) => [a.exercise, a.sets, a.weight, a.reps])).toEqual([
      ['side_lying_er', 2, 3, 12],
      ['db_scaption', 2, 3, 10],
    ]);
    expect(t.state().accessoryAlerts.map((a) => a.message)).toEqual(['Shoulder work drops to 2 sets for maintenance.']);
    expect(card.alerts.some((a) => a.message === 'Shoulder work drops to 2 sets for maintenance.')).toBe(true);
  });

  it('a fresh install that never used rehab gets no maintenance announcement', () => {
    const t = new Timeline();
    expect(t.state().accessoryAlerts).toEqual([]);
    expect(lastCard(t).accessories!.every((a) => a.sets === 2)).toBe(true);
  });

  it('top of ladder + clean: stays there, and "add a heavier dumbbell" shows once', () => {
    const t = new Timeline();
    t.settings.accessories.ladders.db_scaption = [3, 5, 15];
    const scap = (rating: number) => t.log([withSets(withPain(linearLift('row', 45, ok()), rating), acc('db_scaption', 15, 15, 3))]);
    t.decide({ kind: 'track_change', lift: 'bench', to: 'linear', startWeight: 55 });
    // put scaption at the top first
    t.log([withSets(withPain(linearLift('row', 45, ok()), 1), acc('db_scaption', 15, 15, 3))]);
    expect(accessoryPrescription(t.state(), 'db_scaption', t.settings)).toEqual({ weight: 15, reps: 15 });
    expect(t.state().accessoryAlerts.map((a) => a.message)).toEqual([
      'Scaption is clean at 15 lb for 3 × 15. Add a heavier dumbbell in Settings to keep progressing.',
    ]);
    scap(1);
    expect(accessoryPrescription(t.state(), 'db_scaption', t.settings)).toEqual({ weight: 15, reps: 15 });
    expect(t.state().accessoryAlerts).toEqual([]); // not repeated
  });

  it('editing the accessory ladder changes the next suggestion without touching history', () => {
    const t = new Timeline();
    t.log([withSets(withPain(linearLift('row', 45, ok()), 1), acc('side_lying_er', 3, 15, 3))]);
    expect(accessoryPrescription(t.state(), 'side_lying_er', t.settings)).toEqual({ weight: 5, reps: 10 });
    t.settings.accessories.ladders.side_lying_er = [3, 4, 6];
    expect(accessoryPrescription(t.state(), 'side_lying_er', t.settings)).toEqual({ weight: 4, reps: 10 });
  });
});

describe('shoulder rating helpers', () => {
  const z = (rating: number, sharp = false) => zoneOfRating({ rating, sharp }, { greenMax: 2, amberMax: 4 });

  it('green 0-2, amber 3-4, red 5+ or sharp', () => {
    expect([0, 1, 2].map((r) => z(r))).toEqual(['green', 'green', 'green']);
    expect([3, 4].map((r) => z(r))).toEqual(['amber', 'amber']);
    expect([5, 8, 10].map((r) => z(r))).toEqual(['red', 'red', 'red']);
    expect(z(0, true)).toBe('red');
  });

  it('thresholds are editable', () => {
    expect(zoneOfRating({ rating: 4, sharp: false }, { greenMax: 3, amberMax: 6 })).toBe('amber');
    expect(zoneOfRating({ rating: 3, sharp: false }, { greenMax: 3, amberMax: 6 })).toBe('green');
  });

  it('asks for a rating once per performed, tracked lift, and Skip stops the asking', () => {
    const t = new Timeline();
    const plan = planNextSession(t.state(), t.settings, TODAY);
    let d = draftFromPlan(plan, t.settings, 'd', '2026-01-10T10:00:00Z', '2026-01-10');
    expect(liftsNeedingRating(d, t.settings.shoulder)).toEqual([]); // nothing done yet
    d.lifts.forEach((l, li) =>
      l.sets.forEach((x, si) => {
        if (x.type === 'work') d = toggleSet(d, li, si);
      }),
    );
    // Workout A: squat (not tracked), bench (tracked), row (tracked)
    expect(liftsNeedingRating(d, t.settings.shoulder)).toEqual([1, 2]);
    d = setPain(d, 1, { rating: 2, sharp: false });
    d = skipPain(d, 2);
    expect(liftsNeedingRating(d, t.settings.shoulder)).toEqual([]);
    d = setPain(d, 1, null);
    expect(liftsNeedingRating(d, t.settings.shoulder)).toEqual([1]);
  });

  it('old saved settings gain every new group with defaults, and keep what was set', () => {
    const old = { ...defaultSettings(), schemaVersion: 1 } as Record<string, unknown>;
    delete old.shoulder;
    delete old.rehab;
    delete old.accessories;
    old.microplates = true;
    const s = withDefaults(old as unknown as ReturnType<typeof defaultSettings>);
    expect(s.schemaVersion).toBe(2);
    expect(s.microplates).toBe(true);
    expect(s.rehab.ladders.db_floor_press).toEqual([15, 17.5, 20, 25, 30]);
    expect(s.rehab.ladders.seated_db_ohp).toEqual([12.5, 15, 17.5, 20]);
    expect(s.accessories.ladders.db_scaption).toEqual([3, 5, 8, 10, 12, 15]);
    expect(s.shoulder).toMatchObject({ tracking: true, greenMax: 2, amberMax: 4 });
    expect(s.shoulder.tracked).toEqual(['db_floor_press', 'seated_db_ohp', 'bench', 'ohp', 'row']);
  });

  it('a session keeps the zone rules it was played under', () => {
    const t = new Timeline();
    t.settings.shoulder.amberMax = 6; // rating 5 is amber under these rules
    t.settings.startingWeights.bench = 100;
    t.log([withPain(linearLift('bench', 100, ok()), 5)]);
    expect(t.state().linear.bench.pending?.kind).toBe('linear_amber');
    t.settings.shoulder.amberMax = 4; // stricter later: the past is not re-judged
    expect(t.state().linear.bench.pending?.kind).toBe('linear_amber');
    expect(deriveState(t.settings, t.sessions, t.decisions).linear.bench.weight).toBe(100);
  });
});
