import { DELOADS_PER_SCHEME, startingScheme, TM_INCREMENT } from './program';
import { atTopOfProgression, dropBack, fmtWeight, nextAbove, perHand, setsByReps, topOf } from './rehab';
import { estimate1RM, roundingIncrement, roundToPlates } from './rounding';
import { describePain, liftZone, worstZone, type Zone } from './shoulder';
import {
  ACCESSORIES,
  ACCESSORY_SHORT,
  ALL_LIFTS,
  LIFT_SHORT,
  MAIN_LIFTS,
  REHAB_EXERCISES,
  REHAB_OF,
  SLOT_OF,
  isRehabExercise,
  slotOf,
  type AccessoryState,
  type Alert,
  type AlertKind,
  type Decision,
  type DecisionBody,
  type ExerciseId,
  type Lift,
  type LinearLiftState,
  type LoggedLift,
  type LoggedSet,
  type MainLift,
  type ProgramState,
  type RehabExercise,
  type RehabState,
  type SchemeId,
  type SevenType,
  type Session,
  type Settings,
  type WaveLiftState,
} from './types';

// ---------- small helpers ----------

const ORDINALS = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth'];
export const ordinal = (n: number) => ORDINALS[n] ?? `${n}th`;

const isMain = (lift: Lift): lift is MainLift => lift !== 'row';

export const isLinearScheme = (s: SchemeId): boolean => s === '5x5' || s === '3x5' || s === '1x5';

function plannedWorkSets(l: LoggedLift): LoggedSet[] {
  return l.sets.filter((s) => (s.type === 'work' || s.type === 'amrap') && !s.extra);
}

/** The lift was actually performed (not skipped, at least one planned set tapped). */
export function wasPerformed(l: LoggedLift): boolean {
  return !l.skipped && plannedWorkSets(l).some((s) => s.done);
}

/** Every planned work set reached its target reps. */
export function wasCompleted(l: LoggedLift): boolean {
  const sets = plannedWorkSets(l);
  return sets.length > 0 && sets.every((s) => s.done && s.reps >= s.targetReps);
}

/** Lowest weight among the lift's logged (done) planned work sets. */
export function workingWeightOf(l: LoggedLift): number {
  const weights = plannedWorkSets(l).filter((s) => s.done).map((s) => s.weight);
  return weights.length ? Math.min(...weights) : 0;
}

export function isSeventh(scheme: SchemeId): boolean {
  return scheme.startsWith('7th_');
}

export function sevenTypeOf(scheme: SchemeId): SevenType {
  return scheme.slice(4) as SevenType;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

const BARBELL_NAME: Record<'bench' | 'ohp', string> = { bench: 'bench press', ohp: 'overhead press' };

// ---------- initial state ----------

function freshLinear(lift: Lift, weight: number): LinearLiftState {
  return {
    weight,
    scheme: startingScheme(lift),
    streak: 0,
    missWeight: null,
    deloadsInScheme: 0,
    hadDeload: false,
    hadMiss: false,
    complete: false,
    reds: 0,
    lastTrained: null,
    breakHandled: false,
    pending: null,
  };
}

function freshWave(): WaveLiftState {
  return {
    tm: 0,
    step: 0,
    missedCycles: 0,
    cyclePasses: [],
    redInCycle: false,
    lastSeven: null,
    override: null,
    lastTrained: null,
    breakHandled: false,
    pending: null,
  };
}

function freshRehab(weight: number, reps: number): RehabState {
  return { weight, reps, next: 'hold', sessions: 0, returnAskAt: 0, lastTrained: null, breakHandled: false, pending: null };
}

function freshAccessory(weight: number, reps: number): AccessoryState {
  return { weight, reps, next: 'hold', topNoted: false };
}

export function initialState(settings: Settings): ProgramState {
  const linear = {} as Record<Lift, LinearLiftState>;
  for (const lift of ALL_LIFTS) linear[lift] = freshLinear(lift, settings.startingWeights[lift]);
  const wave = {} as Record<MainLift, WaveLiftState>;
  const track = {} as ProgramState['track'];
  const paused = {} as ProgramState['paused'];
  const e1rm = {} as ProgramState['e1rm'];
  for (const lift of MAIN_LIFTS) {
    wave[lift] = freshWave();
    track[lift] = 'linear';
    paused[lift] = false;
    e1rm[lift] = [];
  }
  const rehab = {} as ProgramState['rehab'];
  for (const ex of REHAB_EXERCISES) rehab[ex] = freshRehab(settings.rehab.ladders[ex][0], settings.rehab.repSteps[0]);
  const accessory = {} as ProgramState['accessory'];
  for (const a of ACCESSORIES) accessory[a] = freshAccessory(settings.accessories.ladders[a][0], settings.accessories.repSteps[0]);
  return {
    phase: 'linear',
    linear,
    wave,
    track,
    paused,
    rehab,
    accessory,
    e1rm,
    accessoryAlerts: [],
    maintenanceAnnounced: false,
    linearSessionCount: 0,
    rotationCursor: null,
    revertedAutoSwitch: false,
  };
}

/** Both Bench and OHP are back on the barbell: shoulder accessories drop to maintenance. */
export const inMaintenance = (state: Pick<ProgramState, 'track'>): boolean => state.track.bench !== 'rehab' && state.track.ohp !== 'rehab';

// ---------- training max from history ----------

const bestE1rm = (l: LoggedLift): number =>
  Math.max(0, ...l.sets.filter((s) => (s.type === 'work' || s.type === 'amrap') && s.done).map((s) => estimate1RM(s.weight, s.reps)));

/** Same rule as spec 4.3: best e1RM over the last 6 sessions of the lift, times the TM %, rounded down. */
function trainingMaxFromHistory(state: ProgramState, lift: MainLift, settings: Settings): number {
  const hist = state.e1rm[lift];
  if (!hist.length) return roundToPlates(state.linear[lift].weight * 1.1 * settings.tmPercent, settings, lift, 'down');
  return roundToPlates(Math.max(...hist) * settings.tmPercent, settings, lift, 'down');
}

// ---------- linear ----------

/** Increment applied after a completed session. */
export function linearIncrement(lift: Lift, ls: LinearLiftState, settings: Settings): number {
  if (ls.complete) return roundingIncrement(settings); // holding pattern: smallest step
  if (lift === 'deadlift') return ls.hadMiss ? 5 : 10;
  if (settings.microplates && ls.hadDeload && (lift === 'bench' || lift === 'ohp')) return 2.5;
  return 5;
}

/** 'stalled' is reported to the caller so a late joiner can move to 5/3/1 instead of deloading. */
function applyLinearLift(ls: LinearLiftState, l: LoggedLift, lift: Lift, date: string, settings: Settings, zone: Zone, joinable: boolean): 'stalled' | undefined {
  if (!wasPerformed(l)) return; // skipped: no state change
  const W = workingWeightOf(l);
  ls.pending = null;
  ls.lastTrained = date;
  ls.breakHandled = false;
  const name = LIFT_SHORT[lift];

  // Shoulder gate (tracked lifts only). Pain never counts as a miss or a stall, and never lets the weight go up.
  if (zone === 'red') {
    ls.reds += 1;
    ls.weight = W;
    if (ls.reds >= 2) {
      ls.pending = {
        kind: 'two_reds',
        lift,
        severity: 'action',
        message: 'Your shoulder flagged red twice in a row. Pause this lift and get it assessed before continuing.',
        acceptLabel: 'Pause this lift',
        keepLabel: 'Keep going',
      };
    } else {
      const to = deloadWeight(W, lift, settings);
      ls.pending = {
        kind: 'linear_red',
        lift,
        severity: 'action',
        value: to,
        message: `${describePain(l.pain!)}. Dial ${name.toLowerCase()} down to ${to}?`,
      };
    }
    return;
  }
  ls.reds = 0;
  if (zone === 'amber') {
    ls.weight = W;
    ls.pending = {
      kind: 'linear_amber',
      lift,
      severity: 'info',
      message: `${describePain(l.pain!)}, so ${name.toLowerCase()} holds at ${W} next time. This doesn't count as a miss.`,
    };
    return;
  }

  if (wasCompleted(l)) {
    ls.streak = 0;
    ls.missWeight = null;
    ls.weight = W + linearIncrement(lift, ls, settings);
    return;
  }

  if (lift === 'deadlift') ls.hadMiss = true;
  ls.streak = ls.missWeight === W ? ls.streak + 1 : 1;
  ls.missWeight = W;
  ls.weight = W;
  const retries = settings.retriesBeforeDeload;

  if (ls.streak < retries) {
    ls.pending = {
      kind: 'missed_retry',
      lift,
      severity: 'info',
      message: `Missed reps at ${W}. Next time: retry ${W} (attempt ${ls.streak + 1} of ${retries}).`,
    };
    return;
  }

  // Stalled. A lift that came back to the barbell after the program moved to 5/3/1 joins it now.
  if (joinable) return 'stalled';

  if (ls.complete || ls.deloadsInScheme < DELOADS_PER_SCHEME) {
    const to = deloadWeight(W, lift, settings);
    ls.pending = {
      kind: 'deload',
      lift,
      severity: 'action',
      value: to,
      message: `${ordinal(ls.streak)} miss at ${W}. Dial down to ${to} and climb back.`,
    };
  } else if (ls.scheme === '5x5' && lift !== 'deadlift') {
    ls.pending = {
      kind: 'switch_3x5',
      lift,
      severity: 'action',
      value: W,
      message: `${ordinal(ls.deloadsInScheme + 1)} stall on 5×5. Switch ${name.toLowerCase()} to 3×5 at ${W}?`,
    };
  } else {
    ls.complete = true;
    ls.streak = 0;
    ls.missWeight = null;
    // Squat graduates the program instead (congratulations screen), so no alert.
    ls.pending =
      lift === 'squat'
        ? null
        : {
            kind: 'linear_complete',
            lift,
            severity: 'info',
            message: `${name} has hit the same wall twice. Linear progression is done for this lift. It'll hold steady until squat is done too.`,
          };
  }
}

function deloadWeight(W: number, lift: Lift, settings: Settings): number {
  return roundToPlates(W * (1 - settings.deloadPercent), settings, lift, 'down');
}

// ---------- 5/3/1 ----------

function applyWaveLift(ws: WaveLiftState, l: LoggedLift, lift: MainLift, date: string, settings: Settings, zone: Zone): void {
  if (!wasPerformed(l)) return;
  ws.pending = null;
  ws.lastTrained = date;
  ws.breakHandled = false;
  const name = LIFT_SHORT[lift];
  const amrap = plannedWorkSets(l).filter((s) => s.type === 'amrap').pop();
  const repsOf = (s?: LoggedSet) => (s && s.done ? s.reps : 0);

  if (!isSeventh(l.scheme)) {
    const week = l.waveWeek ?? 1;
    if (week === 1) {
      ws.cyclePasses = [];
      ws.redInCycle = false;
    }
    if (zone === 'red') ws.redInCycle = true;
    const reps = repsOf(amrap);
    const min = amrap?.minReps ?? amrap?.targetReps ?? 1;
    const pass = reps >= min;
    ws.cyclePasses.push(pass);
    if (!pass) {
      ws.pending = {
        kind: 'amrap_missed',
        lift,
        severity: 'info',
        message: `${name} ${min}+ set: got ${reps}. Hold your training max and repeat this cycle.`,
      };
    }
    if (week === 3) {
      const allPass = ws.cyclePasses.length === 3 && ws.cyclePasses.every(Boolean);
      if (ws.redInCycle) {
        // A red shoulder in the cycle holds the TM; it is not a miss.
        ws.pending = {
          kind: 'tm_red_held',
          lift,
          severity: 'info',
          message: `Shoulder flagged red this cycle. ${name} training max stays at ${ws.tm}.`,
        };
      } else if (allPass) {
        ws.tm += TM_INCREMENT[lift];
        ws.missedCycles = 0;
      } else {
        ws.missedCycles += 1;
        if (ws.missedCycles >= 2) {
          const to = roundToPlates(ws.tm * 0.9, settings, lift, 'down');
          ws.pending = {
            kind: 'tm_reset',
            lift,
            severity: 'action',
            value: to,
            message: `Two cycles in a row short of minimums. Reset ${name.toLowerCase()} training max ${ws.tm} → ${to}?`,
          };
        }
      }
      ws.cyclePasses = [];
      ws.redInCycle = false;
    }
  } else {
    const type = sevenTypeOf(l.scheme);
    if (type === 'tm_test') {
      const reps = repsOf(amrap);
      if (reps >= 3) {
        ws.pending = { kind: 'tm_test_passed', lift, severity: 'info', message: 'Your training max is honest.' };
      } else {
        const to = roundToPlates(ws.tm * (1 + reps / 30) * settings.tmPercent, settings, lift, 'down');
        ws.pending = {
          kind: 'tm_test_failed',
          lift,
          severity: 'action',
          value: to,
          message: `${reps} reps at your training max. Lower it to ${to} so it stays honest?`,
        };
      }
    }
    ws.lastSeven = type;
    ws.override = null;
  }
  ws.step += 1;
}

// ---------- shoulder rehab (dumbbells) ----------

function applyRehabLift(rs: RehabState, l: LoggedLift, ex: RehabExercise, date: string, settings: Settings, zone: Zone): void {
  if (!wasPerformed(l)) return;
  const slot = SLOT_OF[ex];
  const planned = plannedWorkSets(l);
  const W = workingWeightOf(l);
  const lastReps = planned[0]?.targetReps ?? rs.reps;
  const ladder = settings.rehab.ladders[ex];
  const steps = settings.rehab.repSteps;
  const nSets = planned.length || settings.rehab.sets;
  const completed = wasCompleted(l);

  rs.pending = null;
  rs.lastTrained = date;
  rs.sessions += 1;
  rs.weight = W;
  rs.reps = lastReps;
  const here = `${perHand(W)} for ${setsByReps(nSets, lastReps)}`;

  if (zone === 'red') {
    // Every red offers the same drop-back: one rung down at the first rep step.
    rs.next = 'hold';
    const back = dropBack(ladder, W, steps);
    rs.pending = {
      kind: 'rehab_red',
      lift: slot,
      severity: 'action',
      value: back.weight,
      message: `${describePain(l.pain!)}. Drop back to ${perHand(back.weight)} for ${setsByReps(nSets, back.reps)}?`,
    };
    return;
  }

  const holdNote = zone === 'amber' ? describePain(l.pain!).toLowerCase() : zone === 'none' ? 'no shoulder rating' : 'missed reps';
  if (zone === 'amber' || zone === 'none' || !completed) {
    rs.next = 'hold';
    rs.pending = { kind: 'rehab_hold', lift: slot, severity: 'info', message: `Holding at ${here} (${holdNote}).` };
    return;
  }

  // Completed with a happy shoulder (or tracking off).
  if (atTopOfProgression(W, lastReps, ladder, steps)) {
    rs.next = 'hold';
    if (rs.sessions >= rs.returnAskAt) {
      const back = settings.rehab.returnWeights[slot];
      rs.pending = {
        kind: 'return_barbell',
        lift: slot,
        severity: 'action',
        value: back,
        acceptLabel: 'Return to barbell',
        keepLabel: 'Not yet',
        message: `Your shoulder has handled ${here} cleanly. Ready to return to the barbell ${BARBELL_NAME[slot]} at ${back} lb?`,
      };
    } else {
      rs.pending = { kind: 'rehab_hold', lift: slot, severity: 'info', message: `Holding at ${here}. Still at the top, so staying here a little longer.` };
    }
    return;
  }
  const nextRep = nextAbove(steps, lastReps);
  if (nextRep !== null) {
    rs.next = 'rep_up';
    rs.pending = {
      kind: 'rehab_step',
      lift: slot,
      severity: 'info',
      message: `Clean and comfortable. Next time: ${perHand(W)} for ${setsByReps(nSets, nextRep)}.`,
    };
  } else {
    rs.next = 'weight_up';
    const nw = nextAbove(ladder, W);
    rs.pending = {
      kind: 'rehab_step',
      lift: slot,
      severity: 'info',
      message: `${setsByReps(nSets, lastReps)} done with a happy shoulder. Next time: ${perHand(nw ?? W)} for ${setsByReps(nSets, steps[0])}.`,
    };
  }
}

// ---------- shoulder accessories ----------

function applyAccessories(state: ProgramState, session: Session, settings: Settings): void {
  const alerts: Alert[] = [];
  const rated = session.lifts.filter((l) => wasPerformed(l));
  const gate = worstZone(rated, settings.shoulder);
  let any = false;

  for (const id of ACCESSORIES) {
    const sets = session.lifts.flatMap((l) => l.sets).filter((s) => s.type === 'accessory' && s.exercise === id && !s.extra);
    if (!sets.some((s) => s.done)) continue;
    any = true;
    const acc = state.accessory[id];
    const ladder = settings.accessories.ladders[id];
    const steps = settings.accessories.repSteps;
    const W = Math.min(...sets.filter((s) => s.done).map((s) => s.weight));
    const reps = sets[0].targetReps;
    const completed = sets.every((s) => s.done && s.reps >= s.targetReps);
    if (W !== acc.weight) acc.topNoted = false;
    acc.weight = W;
    acc.reps = reps;
    const name = ACCESSORY_SHORT[id];

    if (gate === 'red') {
      const back = dropBack(ladder, W, steps);
      acc.weight = back.weight;
      acc.reps = back.reps;
      acc.next = 'hold';
      acc.topNoted = false;
      alerts.push({ kind: 'accessory_info', lift: 'row', severity: 'info', message: `Shoulder flagged red. ${name} drops back to ${fmtWeight(back.weight)} lb.` });
    } else if (!completed || gate === 'amber' || gate === 'none') {
      acc.next = 'hold';
    } else if (reps >= topOf(steps)) {
      if (W < topOf(ladder) - 1e-9) {
        acc.next = 'weight_up';
      } else {
        acc.next = 'hold';
        if (!acc.topNoted) {
          acc.topNoted = true;
          alerts.push({
            kind: 'accessory_info',
            lift: 'row',
            severity: 'info',
            message: `${name} is clean at ${fmtWeight(W)} lb for ${setsByReps(sets.length, reps)}. Add a heavier dumbbell in Settings to keep progressing.`,
          });
        }
      }
    } else {
      acc.next = 'rep_up';
    }
  }
  if (any) state.accessoryAlerts = alerts;
}

// ---------- decisions ----------

function announceMaintenance(state: ProgramState, wasRehab: boolean): void {
  if (wasRehab && inMaintenance(state) && !state.maintenanceAnnounced) {
    state.maintenanceAnnounced = true;
    state.accessoryAlerts = [{ kind: 'accessory_info', lift: 'row', severity: 'info', message: 'Shoulder work drops to 2 sets for maintenance.' }];
  }
}

function applyTrackChange(state: ProgramState, body: Extract<DecisionBody, { kind: 'track_change' }>, settings: Settings): void {
  const lift = body.lift;
  const wasRehab = !inMaintenance(state);
  if (body.to === 'rehab') {
    if (lift !== 'bench' && lift !== 'ohp') return; // only the pressing slots have a rehab exercise
    const ex = REHAB_OF[lift];
    state.track[lift] = 'rehab';
    state.paused[lift] = false;
    state.rehab[ex] = freshRehab(body.startWeight ?? settings.rehab.ladders[ex][0], settings.rehab.repSteps[0]);
    state.maintenanceAnnounced = false;
    return;
  }
  state.paused[lift] = false;
  if (body.to === 'linear') {
    const start = body.startWeight ?? (lift === 'bench' || lift === 'ohp' ? settings.rehab.returnWeights[lift] : settings.startingWeights[lift]);
    state.track[lift] = 'linear';
    state.linear[lift] = freshLinear(lift, start);
  } else {
    state.track[lift] = '531';
    state.wave[lift] = { ...freshWave(), tm: body.startWeight ?? trainingMaxFromHistory(state, lift, settings) };
  }
  announceMaintenance(state, wasRehab);
}

function applyDecision(state: ProgramState, body: DecisionBody, settings: Settings, hasAny531Session: boolean): void {
  switch (body.kind) {
    case 'phase_switch': {
      if (body.to === '531') {
        if (body.auto && !state.linear.squat.complete && !hasAny531Session) {
          // A history edit undid the trigger and nothing was logged in 5/3/1 yet.
          state.revertedAutoSwitch = true;
          return;
        }
        for (const lift of MAIN_LIFTS) {
          if (state.track[lift] === 'rehab') continue; // still on shoulder rehab: stays in its rotation slot as dumbbells
          const tm = body.tms?.[lift];
          state.wave[lift].tm = tm ?? roundToPlates(state.linear[lift].weight * 1.1 * settings.tmPercent, settings, lift, 'down');
          state.track[lift] = '531';
        }
      } else {
        for (const lift of MAIN_LIFTS) if (state.track[lift] === '531') state.track[lift] = 'linear';
      }
      state.phase = body.to;
      return;
    }
    case 'set_tm':
      state.wave[body.lift].tm = body.tm;
      return;
    case 'override_7th': {
      const ws = state.wave[body.lift];
      ws.override = { block: Math.floor(ws.step / 7) + 1, type: body.sevenType };
      return;
    }
    case 'restart_linear': {
      for (const lift of ALL_LIFTS) state.linear[lift] = freshLinear(lift, body.weights[lift]);
      for (const lift of MAIN_LIFTS) if (state.track[lift] === '531') state.track[lift] = 'linear';
      state.linearSessionCount = 0;
      state.phase = 'linear';
      return;
    }
    case 'track_change':
      applyTrackChange(state, body, settings);
      return;
    case 'pause_lift':
      state.paused[body.lift] = true;
      return;
    case 'resume_lift':
      state.paused[body.lift] = false;
      return;
    case 'alert_response':
      applyAlertResponse(state, body, settings);
      return;
  }
}

const WAVE_ALERTS: AlertKind[] = ['amrap_missed', 'tm_reset', 'tm_test_failed', 'tm_test_passed', 'tm_red_held', 'joins_531'];
const REHAB_ALERTS: AlertKind[] = ['rehab_step', 'rehab_hold', 'rehab_red', 'return_barbell'];

type AlertResponse = Extract<DecisionBody, { kind: 'alert_response' }>;

function applyBreak(state: ProgramState, body: AlertResponse) {
  const lift = body.lift;
  const in531 = state.track[lift as MainLift] === '531';
  if (in531) state.wave[lift as MainLift].breakHandled = true;
  else state.linear[lift].breakHandled = true;
  if (body.choice !== 'accept' || body.value === undefined) return;
  if (in531) {
    state.wave[lift as MainLift].tm = body.value;
  } else {
    const ls = state.linear[lift];
    ls.weight = body.value;
    ls.streak = 0;
    ls.missWeight = null;
  }
}

function applyAlertResponse(state: ProgramState, body: AlertResponse, settings: Settings): void {
  if (body.alertKind === 'break') return applyBreak(state, body);
  const slot = body.lift;
  const main = isMain(slot);

  // Rehab exercise alerts.
  if (REHAB_ALERTS.includes(body.alertKind)) {
    if (!main || (slot !== 'bench' && slot !== 'ohp')) return;
    const ex = REHAB_OF[slot];
    const rs = state.rehab[ex];
    const pending = rs.pending;
    if (!pending || pending.kind !== body.alertKind) return;
    rs.pending = null;
    if (body.alertKind === 'rehab_red') {
      if (body.choice === 'accept') {
        rs.weight = body.value ?? dropBack(settings.rehab.ladders[ex], rs.weight, settings.rehab.repSteps).weight;
        rs.reps = settings.rehab.repSteps[0];
        rs.next = 'hold';
      }
      return;
    }
    if (body.alertKind === 'return_barbell') {
      if (body.choice === 'accept') {
        const wasRehab = !inMaintenance(state);
        state.track[slot] = 'linear';
        state.linear[slot] = freshLinear(slot, body.value ?? settings.rehab.returnWeights[slot]);
        announceMaintenance(state, wasRehab);
      } else {
        rs.returnAskAt = rs.sessions + 3; // ask again after 3 more sessions of this exercise
      }
    }
    return;
  }

  const holder: LinearLiftState | WaveLiftState = WAVE_ALERTS.includes(body.alertKind) && main ? state.wave[slot] : state.linear[slot];
  const pending = holder.pending;
  if (!pending || pending.kind !== body.alertKind) return;
  holder.pending = null;

  if ('scheme' in holder) {
    if (body.alertKind === 'two_reds') {
      if (body.choice === 'accept' && main) state.paused[slot] = true;
      return;
    }
    if (body.choice !== 'accept') return;
    if (pending.kind === 'deload') {
      holder.weight = body.value ?? deloadWeight(holder.weight, slot, settings);
      holder.streak = 0;
      holder.missWeight = null;
      holder.hadDeload = true;
      if (!holder.complete) holder.deloadsInScheme += 1;
    } else if (pending.kind === 'switch_3x5') {
      holder.scheme = '3x5';
      holder.streak = 0;
      holder.missWeight = null;
      holder.deloadsInScheme = 0;
    } else if (pending.kind === 'linear_red') {
      // A pain-driven drop is not a stall deload: it doesn't use up the deload ladder.
      holder.weight = body.value ?? deloadWeight(holder.weight, slot, settings);
      holder.streak = 0;
      holder.missWeight = null;
    }
  } else if (body.choice === 'accept' && (pending.kind === 'tm_reset' || pending.kind === 'tm_test_failed') && pending.value !== undefined) {
    holder.tm = body.value ?? pending.value;
    if (pending.kind === 'tm_reset') holder.missedCycles = 0;
  }
}

// ---------- replay ----------

/** Finished, non-deleted sessions in chronological order. */
export function finishedSessions(sessions: Session[]): Session[] {
  return sessions
    .filter((s) => !s.deleted && s.finishedAt)
    .sort((a, b) => (a.finishedAt! < b.finishedAt! ? -1 : a.finishedAt! > b.finishedAt! ? 1 : a.id < b.id ? -1 : 1));
}

function applySession(state: ProgramState, session: Session, current: Settings): void {
  // Past sessions keep the rules they were played under; settings changes only affect later sessions.
  const settings: Settings = session.rules ? { ...current, ...session.rules } : current;
  if (session.phase === 'linear') state.linearSessionCount += 1;

  for (const l of session.lifts) {
    const slot = slotOf(l.lift);
    const performed = wasPerformed(l);
    if (session.phase === '531' && isMain(slot) && performed) state.rotationCursor = slot;
    const zone = liftZone(l, settings.shoulder);

    if (l.scheme === 'rehab' && isRehabExercise(l.lift)) {
      applyRehabLift(state.rehab[l.lift], l, l.lift, session.date, settings, zone);
    } else if (isLinearScheme(l.scheme)) {
      const lift = slot;
      if (isMain(lift) && performed) {
        const best = bestE1rm(l);
        if (best > 0) state.e1rm[lift] = [...state.e1rm[lift], best].slice(-6);
      }
      const joinable = state.phase === '531' && isMain(lift) && state.track[lift] === 'linear';
      const result = applyLinearLift(state.linear[lift], l, lift, session.date, settings, zone, joinable);
      if (result === 'stalled' && isMain(lift)) {
        // First stall after returning to the barbell on a 5/3/1 program: join 5/3/1 at block 1, cycle 1, week 1.
        const tm = trainingMaxFromHistory(state, lift, settings);
        state.track[lift] = '531';
        state.linear[lift].pending = null;
        state.wave[lift] = {
          ...freshWave(),
          tm,
          lastTrained: session.date,
          pending: { kind: 'joins_531', lift, severity: 'info', message: `${LIFT_SHORT[lift]} joins 5/3/1. Training max: ${tm} lb.` },
        };
      }
    } else if (isMain(slot)) {
      applyWaveLift(state.wave[slot], l, slot, session.date, settings, zone);
    }
  }
  applyAccessories(state, session, settings);
}

/** Replays the full history. Editing or deleting a session re-derives everything. */
export function deriveState(settings: Settings, sessions: Session[], decisions: Decision[]): ProgramState {
  const ordered = finishedSessions(sessions);
  const state = initialState(settings);
  const any531 = ordered.some((s) => s.phase === '531');

  // Anchor each decision to a session; orphans fall back to their timestamp.
  const byId = new Map(ordered.map((s, i) => [s.id, i]));
  const anchored = new Map<number, Decision[]>(); // -1 = before everything
  for (const d of decisions.filter((x) => !x.deleted)) {
    let idx = d.afterSessionId !== null ? byId.get(d.afterSessionId) : undefined;
    if (idx === undefined) {
      idx = -1;
      ordered.forEach((s, i) => {
        if (s.finishedAt! <= d.createdAt) idx = i;
      });
    }
    const list = anchored.get(idx) ?? [];
    list.push(d);
    anchored.set(idx, list);
  }
  const runDecisions = (idx: number) => {
    const list = (anchored.get(idx) ?? []).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    for (const d of list) applyDecision(state, d.body, settings, any531);
  };

  runDecisions(-1);
  ordered.forEach((s, i) => {
    applySession(state, s, settings);
    runDecisions(i);
  });
  return state;
}

/** The pending alert for an exercise, wherever the engine keeps it. */
export function pendingFor(state: ProgramState, ex: ExerciseId): Alert | null {
  if (isRehabExercise(ex)) return state.rehab[ex].pending;
  if (ex !== 'row' && state.track[ex] === '531') return state.wave[ex].pending;
  return state.linear[ex].pending;
}

/** Alerts that came out of one session, given the state before it. */
export function evaluateSession(state: ProgramState, session: Session, settings: Settings): Alert[] {
  const copy = structuredClone(state);
  applySession(copy, session, settings);
  const alerts: Alert[] = [];
  for (const l of session.lifts) {
    if (!wasPerformed(l)) continue;
    const p = l.scheme === 'rehab' || isLinearScheme(l.scheme) ? pendingFor(copy, l.lift) : isMain(slotOf(l.lift)) ? copy.wave[slotOf(l.lift) as MainLift].pending : null;
    if (p) alerts.push(p);
  }
  return alerts;
}

