import { LINEAR_WORKOUTS, SCHEME_SETS, SEVENTH, WAVE } from './program';
import { resolvePrescription, type Prescription } from './rehab';
import { effectivePlates, platesPerSide, roundToPlates } from './rounding';
import { daysBetween, inMaintenance } from './state';
import {
  ACCESSORIES,
  ACCESSORY_CUE,
  LIFT_NAME,
  LIFT_SHORT,
  REHAB_OF,
  ROTATION,
  type AccessoryId,
  type Alert,
  type Lift,
  type MainLift,
  type PlannedExtra,
  type PlannedLift,
  type PlannedSet,
  type PlannedWarmup,
  type RehabExercise,
  type ProgramState,
  type SessionPlan,
  type SevenType,
  type Settings,
  type Track,
} from './types';

export function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- warm-ups ----------

function dedupe(warmups: PlannedWarmup[]): PlannedWarmup[] {
  const out: PlannedWarmup[] = [];
  for (const w of warmups) if (!out.some((o) => o.weight === w.weight)) out.push(w);
  return out;
}

export function linearWarmups(working: number, lift: Lift, settings: Settings): PlannedWarmup[] {
  const bar = settings.barWeights[lift];
  if (working <= bar) return [];
  const r = (pct: number) => roundToPlates(working * pct, settings, lift, 'nearest');
  const raw: PlannedWarmup[] = [
    { weight: bar, reps: 5 },
    { weight: r(0.55), reps: 3 },
    { weight: r(0.75), reps: 2 },
  ];
  const out: PlannedWarmup[] = [];
  for (const w of raw) {
    if (w.weight < bar || (w.weight === bar && out.length > 0)) continue; // bar only as the first set
    if (out.some((o) => o.weight === w.weight)) continue;
    if (w.weight >= working) continue;
    out.push(w);
  }
  return out;
}

export function waveWarmups(tm: number, lift: Lift, settings: Settings): PlannedWarmup[] {
  const bar = settings.barWeights[lift];
  const raw = [
    { pct: 0.4, reps: 5 },
    { pct: 0.5, reps: 5 },
    { pct: 0.6, reps: 3 },
  ].map((w) => ({ weight: roundToPlates(tm * w.pct, settings, lift, 'nearest'), reps: w.reps }));
  // roundToPlates floors at the bar; drop sets whose raw percentage fell below it.
  return dedupe(raw.filter((_, i) => tm * [0.4, 0.5, 0.6][i] >= bar));
}

// ---------- lift planning ----------

function breakAlert(lastTrained: string | null, handled: boolean, base: number, lift: Lift, settings: Settings, today: string): Alert | null {
  if (!lastTrained || handled) return null;
  const days = daysBetween(lastTrained, today);
  if (days <= 14) return null;
  const pct = days > 28 ? 0.2 : 0.1;
  const to = roundToPlates(base * (1 - pct), settings, lift, 'down');
  return {
    kind: 'break',
    lift,
    severity: 'action',
    value: to,
    message: `${days} days since your last ${LIFT_SHORT[lift].toLowerCase()}. Start at ${to} instead of ${base}?`,
  };
}

const trackOf = (state: ProgramState, slot: Lift): Track => (slot === 'row' ? 'linear' : state.track[slot]);

function planLinearLift(state: ProgramState, lift: Lift, settings: Settings, today: string): PlannedLift {
  const ls = state.linear[lift];
  const { sets, reps } = SCHEME_SETS[ls.scheme];
  const planned: PlannedSet[] = Array.from({ length: sets }, () => ({ type: 'work', weight: ls.weight, reps }));
  const bar = settings.barWeights[lift];
  const alerts: Alert[] = [];
  if (ls.pending) alerts.push(ls.pending);
  const br = breakAlert(ls.lastTrained, ls.breakHandled, ls.weight, lift, settings, today);
  if (br) alerts.push(br);
  return {
    lift,
    slot: lift,
    track: 'linear',
    scheme: ls.scheme,
    workingWeight: ls.weight,
    emptyBar: ls.weight <= bar,
    sets: planned,
    warmups: linearWarmups(ls.weight, lift, settings),
    platesPerSide: platesPerSide(ls.weight, bar, effectivePlates(settings)),
    alerts,
    holding: ls.complete && lift !== 'squat',
  };
}

/** What a dumbbell exercise prescribes next, against the ladders as they are now. */
export function rehabPrescription(state: ProgramState, ex: RehabExercise, settings: Settings): Prescription {
  const rs = state.rehab[ex];
  return resolvePrescription({ weight: rs.weight, reps: rs.reps }, rs.next, settings.rehab.ladders[ex], settings.rehab.repSteps);
}

/** What a shoulder accessory prescribes next. */
export function accessoryPrescription(state: ProgramState, id: AccessoryId, settings: Settings): Prescription {
  const acc = state.accessory[id];
  return resolvePrescription({ weight: acc.weight, reps: acc.reps }, acc.next, settings.accessories.ladders[id], settings.accessories.repSteps);
}

/** Dumbbell exercise on the rehab track: 3 sets, weight per hand, a slow-lowering cue, no warm-ups. */
function planRehabLift(state: ProgramState, slot: 'bench' | 'ohp', settings: Settings): PlannedLift {
  const ex = REHAB_OF[slot];
  const rs = state.rehab[ex];
  const p = rehabPrescription(state, ex, settings);
  const sets: PlannedSet[] = Array.from({ length: settings.rehab.sets }, () => ({ type: 'work', weight: p.weight, reps: p.reps }));
  return {
    lift: ex,
    slot,
    track: 'rehab',
    scheme: 'rehab',
    workingWeight: p.weight,
    emptyBar: false,
    sets,
    warmups: [],
    platesPerSide: [],
    alerts: rs.pending ? [rs.pending] : [],
    holding: false,
    perHand: true,
    cue: 'Lower for 3 s',
  };
}

export function seventhTypeFor(state: ProgramState, lift: MainLift, settings: Settings): SevenType {
  const ws = state.wave[lift];
  const block = Math.floor(ws.step / 7) + 1;
  if (ws.override && ws.override.block === block) return ws.override.type;
  if (ws.lastSeven === null || ws.lastSeven === 'tm_test') {
    return settings.deloadStyle === 'light' ? 'deload_light' : 'deload_forever';
  }
  return 'tm_test';
}

function planWaveLift(state: ProgramState, lift: MainLift, settings: Settings, today: string): PlannedLift {
  const ws = state.wave[lift];
  const bar = settings.barWeights[lift];
  const tm = ws.tm;
  const r = (pct: number) => roundToPlates(tm * pct, settings, lift, 'nearest');
  const pos = ws.step % 7;
  const block = Math.floor(ws.step / 7) + 1;
  const sets: PlannedSet[] = [];
  const base: Partial<PlannedLift> = { tm, block };
  let scheme: PlannedLift['scheme'] = '531';

  if (pos < 6) {
    const week = ((pos % 3) + 1) as 1 | 2 | 3;
    const main = WAVE[week];
    main.forEach((m, i) => {
      const last = i === main.length - 1;
      sets.push({ type: last ? 'amrap' : 'work', weight: r(m.pct), reps: m.reps, minReps: last ? m.reps : undefined, pct: m.pct });
    });
    if (settings.template === 'fsl') {
      for (let i = 0; i < 5; i++) sets.push({ type: 'supplemental', weight: r(main[0].pct), reps: 5, pct: main[0].pct });
    } else if (settings.template === 'bbb') {
      for (let i = 0; i < 5; i++) sets.push({ type: 'supplemental', weight: r(settings.bbbPercent), reps: 10, pct: settings.bbbPercent });
    }
    base.waveWeek = week;
    base.cycle = (Math.floor(pos / 3) + 1) as 1 | 2;
  } else {
    const type = seventhTypeFor(state, lift, settings);
    scheme = `7th_${type}`;
    for (const m of SEVENTH[type]) {
      sets.push({ type: m.amrap ? 'amrap' : 'work', weight: r(m.pct), reps: m.reps, minReps: m.minReps, pct: m.pct });
    }
    base.sevenType = type;
  }

  const working = sets[0].weight;
  const alerts: Alert[] = [];
  if (ws.pending) alerts.push(ws.pending);
  const br = breakAlert(ws.lastTrained, ws.breakHandled, tm, lift, settings, today);
  if (br) alerts.push(br);
  return {
    ...base,
    lift,
    slot: lift,
    track: '531',
    scheme,
    workingWeight: working,
    emptyBar: working <= bar,
    sets,
    warmups: waveWarmups(tm, lift, settings),
    platesPerSide: platesPerSide(working, bar, effectivePlates(settings)),
    alerts,
    holding: false,
  };
}

/** A paused lift stays visible as "Paused" and is skipped automatically. */
function planPausedLift(state: ProgramState, slot: MainLift): PlannedLift {
  const track = state.track[slot];
  const lift = track === 'rehab' ? REHAB_OF[slot as 'bench' | 'ohp'] : slot;
  return {
    lift,
    slot,
    track,
    scheme: track === 'rehab' ? 'rehab' : track === '531' ? '531' : state.linear[slot].scheme,
    workingWeight: 0,
    emptyBar: false,
    sets: [],
    warmups: [],
    platesPerSide: [],
    alerts: [],
    holding: false,
    paused: true,
    perHand: track === 'rehab',
  };
}

function planSlot(state: ProgramState, slot: Lift, settings: Settings, today: string): PlannedLift {
  if (slot !== 'row' && state.paused[slot]) return planPausedLift(state, slot);
  const track = trackOf(state, slot);
  if (track === 'rehab') return planRehabLift(state, slot as 'bench' | 'ohp', settings);
  if (track === '531') return planWaveLift(state, slot as MainLift, settings, today);
  return planLinearLift(state, slot, settings, today);
}

// ---------- shoulder warm-up and accessories ----------

const PULL_APART: PlannedExtra = { exercise: 'band_pull_apart', sets: 2, reps: 20, weight: 0, cue: ACCESSORY_CUE.band_pull_apart };

function planAccessory(state: ProgramState, id: AccessoryId, settings: Settings): PlannedExtra {
  const p = accessoryPrescription(state, id, settings);
  const sets = inMaintenance(state) ? settings.accessories.maintenanceSets : settings.accessories.rehabSets;
  return { exercise: id, sets, reps: p.reps, weight: p.weight, cue: ACCESSORY_CUE[id] };
}

/**
 * With shoulder tracking on: band pull-aparts go first in the first card's Warm-up row, and the shoulder accessories ride
 * inside the last card. Neither adds a card. Paused lifts never host them.
 */
function addShoulderExtras(lifts: PlannedLift[], state: ProgramState, settings: Settings): void {
  if (!settings.shoulder.tracking) return;
  const live = lifts.filter((l) => !l.paused);
  if (!live.length) return;
  live[0].prep = { ...PULL_APART };
  const host = live[live.length - 1];
  host.accessories = ACCESSORIES.map((id) => planAccessory(state, id, settings));
  host.alerts = [...host.alerts, ...state.accessoryAlerts];
}

// ---------- session planning ----------

function waveLabel(p: PlannedLift): string {
  if (p.track === 'rehab') return `${LIFT_NAME[p.lift]} (shoulder rehab)`;
  const name = p.slot === 'ohp' ? 'OHP' : p.slot[0].toUpperCase() + p.slot.slice(1);
  if (p.track === 'linear') return `${name} · ${p.scheme.replace('x', '×')}`;
  if (p.sevenType) {
    const what = p.sevenType === 'tm_test' ? 'TM test' : 'deload';
    return `${name} · 7th week (${what})`;
  }
  return `${name} · Week ${p.waveWeek} of cycle ${p.cycle}`;
}

export function planNextSession(state: ProgramState, settings: Settings, today = localToday()): SessionPlan {
  if (state.phase === 'linear') {
    const workout = state.linearSessionCount % 2 === 0 ? 'A' : 'B';
    const lifts = LINEAR_WORKOUTS[settings.linearLayout][workout].map((l) => planSlot(state, l, settings, today));
    addShoulderExtras(lifts, state, settings);
    return { phase: 'linear', label: `Workout ${workout}`, workout, lifts, alerts: lifts.flatMap((l) => l.alerts) };
  }

  // Rotation continues after the last lift performed. An unfinished workout leaves it untouched, so the same lift comes
  // up again. Paused lifts are passed over.
  const order: MainLift[] = [];
  let i = state.rotationCursor ? ROTATION.indexOf(state.rotationCursor) : -1;
  for (let guard = 0; guard < ROTATION.length * 2 && order.length < settings.liftsPerSession; guard++) {
    i = (i + 1) % ROTATION.length;
    const l = ROTATION[i];
    if (state.paused[l] || order.includes(l)) continue;
    order.push(l);
  }
  const lifts = order.map((l) => planSlot(state, l, settings, today));
  addShoulderExtras(lifts, state, settings);
  const label = `5/3/1 · ${lifts.map(waveLabel).join(' + ')}`;
  return { phase: '531', label, lifts, alerts: lifts.flatMap((l) => l.alerts) };
}
