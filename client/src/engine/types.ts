export type MainLift = 'squat' | 'bench' | 'deadlift' | 'ohp';
export type Lift = MainLift | 'row';

export const MAIN_LIFTS: MainLift[] = ['squat', 'bench', 'deadlift', 'ohp'];
export const ALL_LIFTS: Lift[] = ['squat', 'bench', 'row', 'ohp', 'deadlift'];
/** 5/3/1 rotation order when liftsPerSession = 1. */
export const ROTATION: MainLift[] = ['squat', 'bench', 'deadlift', 'ohp'];

export const LIFT_NAME: Record<Lift, string> = {
  squat: 'Squat',
  bench: 'Bench Press',
  row: 'Barbell Row',
  ohp: 'Overhead Press',
  deadlift: 'Deadlift',
};
/** Short names used in alert copy. */
export const LIFT_SHORT: Record<Lift, string> = {
  squat: 'Squat',
  bench: 'Bench',
  row: 'Row',
  ohp: 'OHP',
  deadlift: 'Deadlift',
};

export type Phase = 'linear' | '531';
export type LinearScheme = '5x5' | '3x5' | '1x5';
export type SevenType = 'tm_test' | 'deload_forever' | 'deload_light';
export type SchemeId = LinearScheme | '531' | `7th_${SevenType}`;
export type Template = 'minimalist' | 'fsl' | 'bbb';
export type LinearLayout = 'stronglifts' | 'deadlift_every_session';

/** Fields shared by every synced record. */
export interface Rec {
  id: string;
  updatedAt: string;
  deleted: boolean;
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
}

/** The progression rules a session was played under. Replay uses these, never today's settings. */
export type RuleSnapshot = Pick<Settings, 'microplates' | 'retriesBeforeDeload' | 'deloadPercent' | 'tmPercent' | 'barWeights'>;

export type SetType = 'warmup' | 'work' | 'amrap' | 'supplemental';

export interface LoggedSet {
  type: SetType;
  targetWeight: number;
  targetReps: number;
  /** Actual weight lifted. */
  weight: number;
  /** Actual reps. 0 when not done. */
  reps: number;
  /** Tapped by the lifter. An untouched set is not done. */
  done: boolean;
  /** AMRAP minimum (the pass threshold). */
  minReps?: number;
  /** A set beyond the planned count: logged, never evaluated. */
  extra?: boolean;
}

export interface LoggedLift {
  lift: Lift;
  scheme: SchemeId;
  skipped: boolean;
  sets: LoggedSet[];
  /** 5/3/1 main-set week (1–3). Absent for 7th week and linear. */
  waveWeek?: 1 | 2 | 3;
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
  | 'break';

export interface Alert {
  kind: AlertKind;
  lift: Lift;
  /** 'info' alerts have no buttons. */
  severity: 'info' | 'action';
  message: string;
  /** Weight / TM the alert proposes, where relevant. */
  value?: number;
}

export type DecisionBody =
  | { kind: 'alert_response'; lift: Lift; alertKind: AlertKind; choice: 'accept' | 'keep'; value?: number }
  | { kind: 'phase_switch'; to: Phase; auto: boolean; tms?: Record<MainLift, number> }
  | { kind: 'set_tm'; lift: MainLift; tm: number }
  | { kind: 'override_7th'; lift: MainLift; sevenType: SevenType }
  | { kind: 'restart_linear'; weights: Record<Lift, number> };

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
  lastSeven: SevenType | null;
  override: { block: number; type: SevenType } | null;
  lastTrained: string | null;
  breakHandled: boolean;
  pending: Alert | null;
}

export interface ProgramState {
  phase: Phase;
  linear: Record<Lift, LinearLiftState>;
  wave: Record<MainLift, WaveLiftState>;
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

export interface PlannedLift {
  lift: Lift;
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
}

export interface SessionPlan {
  phase: Phase;
  label: string;
  workout?: 'A' | 'B';
  lifts: PlannedLift[];
  alerts: Alert[];
}
