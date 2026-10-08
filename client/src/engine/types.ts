/** The five barbell lifts. These are the "slots" a workout is built from. */
export type MainLift = 'squat' | 'bench' | 'deadlift' | 'ohp';
export type Lift = MainLift | 'row';

/** Neutral-grip dumbbell exercises that temporarily fill the Bench / OHP slots (shoulder rehab). */
export type RehabExercise = 'db_floor_press' | 'seated_db_ohp';
/** Anything that can be a card in a workout. Each has its own history. */
export type ExerciseId = Lift | RehabExercise;
/** Shoulder accessories that ride inside the last card. */
export type AccessoryId = 'side_lying_er' | 'db_scaption';
/** Warm-up item that rides inside the first card. */
export type PrepId = 'band_pull_apart';
export type SetExercise = AccessoryId | PrepId;

export const MAIN_LIFTS: MainLift[] = ['squat', 'bench', 'deadlift', 'ohp'];
export const ALL_LIFTS: Lift[] = ['squat', 'bench', 'row', 'ohp', 'deadlift'];
export const REHAB_EXERCISES: RehabExercise[] = ['db_floor_press', 'seated_db_ohp'];
export const ACCESSORIES: AccessoryId[] = ['side_lying_er', 'db_scaption'];
/** 5/3/1 rotation order when liftsPerSession = 1. */
export const ROTATION: MainLift[] = ['squat', 'bench', 'deadlift', 'ohp'];

/** Which slot a rehab exercise fills, and which exercise fills a slot while it is on rehab. */
export const SLOT_OF: Record<RehabExercise, 'bench' | 'ohp'> = { db_floor_press: 'bench', seated_db_ohp: 'ohp' };
export const REHAB_OF: Record<'bench' | 'ohp', RehabExercise> = { bench: 'db_floor_press', ohp: 'seated_db_ohp' };

export const isRehabExercise = (x: ExerciseId): x is RehabExercise => x === 'db_floor_press' || x === 'seated_db_ohp';
/** The barbell slot an exercise belongs to (a rehab exercise maps to its slot). */
export const slotOf = (x: ExerciseId): Lift => (isRehabExercise(x) ? SLOT_OF[x] : x);

export const LIFT_NAME: Record<ExerciseId, string> = {
  squat: 'Squat',
  bench: 'Bench Press',
  row: 'Barbell Row',
  ohp: 'Overhead Press',
  deadlift: 'Deadlift',
  db_floor_press: 'DB Floor Press',
  seated_db_ohp: 'Seated DB OHP',
};
/** Short names used in alert copy. */
export const LIFT_SHORT: Record<ExerciseId, string> = {
  squat: 'Squat',
  bench: 'Bench',
  row: 'Row',
  ohp: 'OHP',
  deadlift: 'Deadlift',
  db_floor_press: 'DB floor press',
  seated_db_ohp: 'Seated DB OHP',
};
export const ACCESSORY_NAME: Record<SetExercise, string> = {
  band_pull_apart: 'Band pull-aparts',
  side_lying_er: 'Side-lying DB external rotation',
  db_scaption: 'DB scaption',
};
/** Short names used in alert copy. */
export const ACCESSORY_SHORT: Record<SetExercise, string> = {
  band_pull_apart: 'Pull-aparts',
  side_lying_er: 'External rotation',
  db_scaption: 'Scaption',
};
export const ACCESSORY_CUE: Record<SetExercise, string> = {
  band_pull_apart: 'Squeeze, hold 1 s',
  side_lying_er: 'Towel under elbow, hold 2 s',
  db_scaption: 'Thumbs up, 45°, to shoulder height',
};

export type Phase = 'linear' | '531';
/** Where a main lift currently is: shoulder rehab dumbbells, barbell linear progression, or 5/3/1. */
export type Track = 'rehab' | 'linear' | '531';
export type LinearScheme = '5x5' | '3x5' | '1x5';
export type SevenType = 'tm_test' | 'deload_forever' | 'deload_light';
export type SchemeId = LinearScheme | '531' | `7th_${SevenType}` | 'rehab';
export type Template = 'minimalist' | 'fsl' | 'bbb';
export type LinearLayout = 'stronglifts' | 'deadlift_every_session';

/** Fields shared by every synced record. */
export interface Rec {
  id: string;
  updatedAt: string;
  deleted: boolean;
}

export interface ShoulderSettings {
  /** Master switch: off = ratings are never asked for and never gate anything. */
  tracking: boolean;
  /** Exercises that get a rating row. */
  tracked: ExerciseId[];
  /** Green is 0..greenMax, amber is greenMax+1..amberMax, red is above amberMax (or "sharp"). */
  greenMax: number;
  amberMax: number;
}

export interface RehabSettings {
  sets: number;
  /** Rep targets, climbed in order before the weight goes up. */
  repSteps: number[];
  /** Dumbbell weight per hand, ascending. Edit to match the gym's rack. */
  ladders: Record<RehabExercise, number[]>;
  /** Barbell weight a lift restarts linear progression at when it returns from rehab. */
  returnWeights: Record<'bench' | 'ohp', number>;
}

export interface AccessorySettings {
  /** Sets while Bench or OHP is still on rehab. */
  rehabSets: number;
  /** Sets once both are back on the barbell. */
  maintenanceSets: number;
  repSteps: number[];
  ladders: Record<AccessoryId, number[]>;
}

export interface Settings extends Rec {
  schemaVersion: number;
  unit: 'lb';
  barWeights: Record<Lift, number>;
  platesOwned: number[];
  microplates: boolean;
  retriesBeforeDeload: number;
  /** Fraction, 0.10 = 10%. */
  deloadPercent: number;
  linearLayout: LinearLayout;
  /** Fraction, 0.85 = 85%. Allowed 0.80–0.90. */
  tmPercent: number;
  liftsPerSession: 1 | 2;
  template: Template;
  /** Fraction of TM, 0.5 = 50%. */
  bbbPercent: number;
  deloadStyle: 'forever' | 'light';
  startingWeights: Record<Lift, number>;
  /** Rest countdown lengths in seconds. */
  restSeconds: { warmup: number; work: number; supplemental: number };
  shoulder: ShoulderSettings;
  rehab: RehabSettings;
  accessories: AccessorySettings;
}

/** The progression rules a session was played under. Replay uses these, never today's settings. */
export type RuleSnapshot = Pick<Settings, 'microplates' | 'retriesBeforeDeload' | 'deloadPercent' | 'tmPercent' | 'barWeights'> & {
  shoulder?: ShoulderSettings;
};

export type SetType = 'warmup' | 'work' | 'amrap' | 'supplemental' | 'prep' | 'accessory';

export interface LoggedSet {
  type: SetType;
  targetWeight: number;
  targetReps: number;
  /** Actual weight lifted. Per hand for dumbbell exercises. */
  weight: number;
  /** Actual reps. 0 when not done. */
  reps: number;
  /** Tapped by the lifter. An untouched set is not done. */
  done: boolean;
  /** AMRAP minimum (the pass threshold). */
  minReps?: number;
  /** A set beyond the planned count: logged, never evaluated. */
  extra?: boolean;
  /** For `prep` and `accessory` sets: which exercise this is. */
  exercise?: SetExercise;
}

/** One 0–10 shoulder rating per lift per session. */
export interface PainRating {
  rating: number;
  sharp: boolean;
}

export interface LoggedLift {
  lift: ExerciseId;
  scheme: SchemeId;
  skipped: boolean;
  sets: LoggedSet[];
  /** 5/3/1 main-set week (1–3). Absent for 7th week and linear. */
  waveWeek?: 1 | 2 | 3;
  pain?: PainRating;
  /** The rating prompt was skipped for this lift this session. */
  painSkipped?: boolean;
  /** The lift was paused (shoulder flagged); it is skipped automatically. */
  paused?: boolean;
}

export interface Session extends Rec {
  schemaVersion: number;
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Null until finished. Unfinished sessions never count toward progression. */
  finishedAt: string | null;
  /** Set when the lifter left the workout unfinished. Shows as a yellow day; partial sets are kept but ignored. */
  abandonedAt?: string | null;
  /** Free-text personal note for the workout. Exported in the CSV notes column. */
  notes?: string;
  phase: Phase;
  label: string;
  /** Snapshot taken at Finish. Absent on legacy records: current settings apply. */
  rules?: RuleSnapshot;
  lifts: LoggedLift[];
}

export type AlertKind =
  | 'missed_retry'
  | 'deload'
  | 'switch_3x5'
  | 'linear_complete'
  | 'amrap_missed'
  | 'tm_reset'
  | 'tm_test_failed'
  | 'tm_test_passed'
  | 'break'
  | 'rehab_step'
  | 'rehab_hold'
  | 'rehab_red'
  | 'two_reds'
  | 'return_barbell'
  | 'linear_amber'
  | 'linear_red'
  | 'tm_red_held'
  | 'joins_531'
  | 'accessory_info';

export interface Alert {
  kind: AlertKind;
  /** The barbell slot the alert belongs to (a rehab exercise reports its slot). */
  lift: Lift;
  /** 'info' alerts have no buttons. */
  severity: 'info' | 'action';
  message: string;
  /** Weight / TM the alert proposes, where relevant. */
  value?: number;
  /** Button labels, when not the usual Accept / Try again next workout. */
  acceptLabel?: string;
  keepLabel?: string;
}

export type DecisionBody =
  | { kind: 'alert_response'; lift: Lift; alertKind: AlertKind; choice: 'accept' | 'keep'; value?: number }
  | { kind: 'phase_switch'; to: Phase; auto: boolean; tms?: Record<MainLift, number> }
  | { kind: 'set_tm'; lift: MainLift; tm: number }
  | { kind: 'override_7th'; lift: MainLift; sevenType: SevenType }
  | { kind: 'restart_linear'; weights: Record<Lift, number> }
  /** Move a main lift to another track. `startWeight`: rehab dumbbell / barbell weight / training max. */
  | { kind: 'track_change'; lift: MainLift; to: Track; startWeight?: number }
  | { kind: 'pause_lift'; lift: MainLift }
  | { kind: 'resume_lift'; lift: MainLift };

export type Decision = Rec & {
  schemaVersion: number;
  createdAt: string;
  /** The session this decision applies after. Null/unknown: placed by createdAt. */
  afterSessionId: string | null;
} & { body: DecisionBody };

export interface LinearLiftState {
  weight: number;
  scheme: LinearScheme;
  /** Consecutive missed-rep sessions at the same working weight. */
  streak: number;
  missWeight: number | null;
  /** Deloads accepted within the current scheme (0–2). */
  deloadsInScheme: number;
  hadDeload: boolean;
  /** Deadlift only: has any session missed reps yet. */
  hadMiss: boolean;
  complete: boolean;
  /** Consecutive sessions with a red shoulder rating. */
  reds: number;
  lastTrained: string | null;
  breakHandled: boolean;
  pending: Alert | null;
}

export interface WaveLiftState {
  tm: number;
  /** Times this lift has been trained in 5/3/1. */
  step: number;
  missedCycles: number;
  cyclePasses: boolean[];
  /** A red shoulder rating happened in the current cycle: the TM is held at cycle end. */
  redInCycle: boolean;
  lastSeven: SevenType | null;
  override: { block: number; type: SevenType } | null;
  lastTrained: string | null;
  breakHandled: boolean;
  pending: Alert | null;
}

/** What to do with a rehab exercise next time, resolved against the *current* ladder when planning. */
export type RehabNext = 'hold' | 'rep_up' | 'weight_up';

export interface RehabState {
  /** Dumbbell weight per hand lifted last time. */
  weight: number;
  /** Rep target lifted last time. */
  reps: number;
  next: RehabNext;
  /** Consecutive sessions flagged red. */
  reds: number;
  /** Sessions of this exercise so far. */
  sessions: number;
  /** "Not yet" on the return-to-barbell question: ask again once `sessions` reaches this. */
  returnAskAt: number;
  lastTrained: string | null;
  breakHandled: boolean;
  pending: Alert | null;
}

export interface AccessoryState {
  weight: number;
  reps: number;
  next: RehabNext;
  /** The "add a heavier dumbbell" note was already shown at this weight. */
  topNoted: boolean;
}

export interface ProgramState {
  phase: Phase;
  /** Barbell state per lift. Kept even while a lift is on rehab (its history is simply not used). */
  linear: Record<Lift, LinearLiftState>;
  wave: Record<MainLift, WaveLiftState>;
  track: Record<MainLift, Track>;
  /** Paused lifts are skipped automatically until resumed in Settings. */
  paused: Record<MainLift, boolean>;
  rehab: Record<RehabExercise, RehabState>;
  accessory: Record<AccessoryId, AccessoryState>;
  /** Best estimated 1RM of each of the last sessions per barbell lift (newest last), for the training max. */
  e1rm: Record<MainLift, number[]>;
  /** One-line info notes about accessories (maintenance mode, top of ladder, red drop-back). */
  accessoryAlerts: Alert[];
  maintenanceAnnounced: boolean;
  /** Finished linear sessions since the last restart; drives A/B. */
  linearSessionCount: number;
  /** Last lift actually performed in 5/3/1; rotation continues after it. */
  rotationCursor: MainLift | null;
  /** An automatic switch was undone by a history edit. */
  revertedAutoSwitch: boolean;
}

export interface PlannedSet {
  type: 'work' | 'amrap' | 'supplemental';
  weight: number;
  reps: number;
  minReps?: number;
  /** Percent of TM, for display. */
  pct?: number;
}

export interface PlannedWarmup {
  weight: number;
  reps: number;
}

export interface PlannedExtra {
  exercise: SetExercise;
  sets: number;
  reps: number;
  /** lb per hand; 0 for the band. */
  weight: number;
  cue: string;
}

export interface PlannedLift {
  lift: ExerciseId;
  /** The barbell slot this card fills. */
  slot: Lift;
  track: Track;
  scheme: SchemeId;
  workingWeight: number;
  emptyBar: boolean;
  sets: PlannedSet[];
  warmups: PlannedWarmup[];
  platesPerSide: number[];
  alerts: Alert[];
  holding: boolean;
  waveWeek?: 1 | 2 | 3;
  cycle?: 1 | 2;
  block?: number;
  /** 7th week only. */
  sevenType?: SevenType;
  tm?: number;
  /** Dumbbell exercise: weights are per hand and there is no plate breakdown. */
  perHand?: boolean;
  cue?: string;
  paused?: boolean;
  /** Warm-up item (pull-aparts) shown first in the card's Warm-up row. First card only. */
  prep?: PlannedExtra;
  /** Shoulder accessories, revealed after this card's main work. Last non-skipped card only. */
  accessories?: PlannedExtra[];
}

export interface SessionPlan {
  phase: Phase;
  label: string;
  workout?: 'A' | 'B';
  lifts: PlannedLift[];
  alerts: Alert[];
}
