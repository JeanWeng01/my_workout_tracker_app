import { DELOADS_PER_SCHEME, startingScheme, TM_INCREMENT } from './program';
import { roundingIncrement, roundToPlates } from './rounding';
import {
  ALL_LIFTS,
  LIFT_SHORT,
  MAIN_LIFTS,
  type Alert,
  type AlertKind,
  type Decision,
  type DecisionBody,
  type Lift,
  type LinearLiftState,
  type LoggedLift,
  type LoggedSet,
  type MainLift,
  type ProgramState,
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
    lastSeven: null,
    override: null,
    lastTrained: null,
    breakHandled: false,
    pending: null,
  };
}

export function initialState(settings: Settings): ProgramState {
  const linear = {} as Record<Lift, LinearLiftState>;
  for (const lift of ALL_LIFTS) linear[lift] = freshLinear(lift, settings.startingWeights[lift]);
  const wave = {} as Record<MainLift, WaveLiftState>;
  for (const lift of MAIN_LIFTS) wave[lift] = freshWave();
  return {
    phase: 'linear',
    linear,
    wave,
    linearSessionCount: 0,
    rotationCursor: null,
    revertedAutoSwitch: false,
  };
}

// ---------- linear ----------

/** Increment applied after a completed session. */
export function linearIncrement(lift: Lift, ls: LinearLiftState, settings: Settings): number {
  if (ls.complete) return roundingIncrement(settings); // holding pattern: smallest step
  if (lift === 'deadlift') return ls.hadMiss ? 5 : 10;
  if (settings.microplates && ls.hadDeload && (lift === 'bench' || lift === 'ohp')) return 2.5;
  return 5;
}

function applyLinearLift(ls: LinearLiftState, l: LoggedLift, lift: Lift, date: string, settings: Settings): void {
  if (!wasPerformed(l)) return; // skipped: no state change
  const W = workingWeightOf(l);
  ls.pending = null;
  ls.lastTrained = date;
  ls.breakHandled = false;

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
  const name = LIFT_SHORT[lift];

  if (ls.streak < retries) {
    ls.pending = {
      kind: 'missed_retry',
      lift,
      severity: 'info',
      message: `Missed reps at ${W}. Next time: retry ${W} (attempt ${ls.streak + 1} of ${retries}).`,
    };
    return;
  }

  // Stalled.
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

function applyWaveLift(ws: WaveLiftState, l: LoggedLift, lift: MainLift, date: string, settings: Settings): void {
  if (!wasPerformed(l)) return;
  ws.pending = null;
  ws.lastTrained = date;
  ws.breakHandled = false;
  const name = LIFT_SHORT[lift];
  const amrap = plannedWorkSets(l).filter((s) => s.type === 'amrap').pop();
  const repsOf = (s?: LoggedSet) => (s && s.done ? s.reps : 0);

  if (!isSeventh(l.scheme)) {
    const week = l.waveWeek ?? 1;
    if (week === 1) ws.cyclePasses = [];
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
      if (allPass) {
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

// ---------- decisions ----------

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
          const tm = body.tms?.[lift];
          state.wave[lift].tm = tm ?? roundToPlates(state.linear[lift].weight * 1.1 * settings.tmPercent, settings, lift, 'down');
        }
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
      state.linearSessionCount = 0;
      state.phase = 'linear';
      return;
    }
    case 'alert_response': {
      if (body.alertKind === 'break') {
        applyBreak(state, body);
        return;
      }
      const isWave = WAVE_ALERTS.includes(body.alertKind) && isMain(body.lift);
      applyAlertDecision(body, settings, isWave ? state.wave[body.lift as MainLift] : state.linear[body.lift]);
      return;
    }
  }
}

const WAVE_ALERTS: AlertKind[] = ['amrap_missed', 'tm_reset', 'tm_test_failed', 'tm_test_passed'];

type AlertResponse = Extract<DecisionBody, { kind: 'alert_response' }>;

function applyBreak(state: ProgramState, body: AlertResponse) {
  const lift = body.lift;
  const in531 = state.phase === '531' && isMain(lift);
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

function applyAlertDecision(body: AlertResponse, settings: Settings, holder: LinearLiftState | WaveLiftState): void {
  const pending = holder.pending;
  if (!pending || pending.kind !== body.alertKind) return;
  holder.pending = null;
  if (body.choice !== 'accept') return;

  if ('scheme' in holder) {
    if (pending.kind === 'deload') {
      holder.weight = body.value ?? deloadWeight(holder.weight, body.lift, settings);
      holder.streak = 0;
      holder.missWeight = null;
      holder.hadDeload = true;
      if (!holder.complete) holder.deloadsInScheme += 1;
    } else if (pending.kind === 'switch_3x5') {
      holder.scheme = '3x5';
      holder.streak = 0;
      holder.missWeight = null;
      holder.deloadsInScheme = 0;
    }
  } else if ((pending.kind === 'tm_reset' || pending.kind === 'tm_test_failed') && pending.value !== undefined) {
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
  if (session.phase === 'linear') {
    state.linearSessionCount += 1;
    for (const l of session.lifts) applyLinearLift(state.linear[l.lift], l, l.lift, session.date, settings);
  } else {
    for (const l of session.lifts) {
      if (!isMain(l.lift)) continue;
      if (wasPerformed(l)) {
        state.rotationCursor = l.lift;
      }
    }
    for (const l of session.lifts) if (isMain(l.lift)) applyWaveLift(state.wave[l.lift], l, l.lift, session.date, settings);
  }
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

/** Alerts that came out of one session, given the state before it. */
export function evaluateSession(state: ProgramState, session: Session, settings: Settings): Alert[] {
  const copy = structuredClone(state);
  applySession(copy, session, settings);
  const alerts: Alert[] = [];
  for (const l of session.lifts) {
    const p = session.phase === '531' && isMain(l.lift) ? copy.wave[l.lift].pending : copy.linear[l.lift].pending;
    if (p && wasPerformed(l)) alerts.push(p);
  }
  return alerts;
}
