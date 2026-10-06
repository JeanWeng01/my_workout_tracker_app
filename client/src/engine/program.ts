import type { Lift, LinearLayout, LinearScheme, MainLift, SevenType } from './types';

export const LINEAR_WORKOUTS: Record<LinearLayout, { A: Lift[]; B: Lift[] }> = {
  stronglifts: {
    A: ['squat', 'bench', 'row'],
    B: ['squat', 'ohp', 'deadlift'],
  },
  deadlift_every_session: {
    A: ['squat', 'bench', 'deadlift'],
    B: ['squat', 'ohp', 'deadlift'],
  },
};

export const SCHEME_SETS: Record<LinearScheme, { sets: number; reps: number }> = {
  '5x5': { sets: 5, reps: 5 },
  '3x5': { sets: 3, reps: 5 },
  '1x5': { sets: 1, reps: 5 },
};

export function startingScheme(lift: Lift): LinearScheme {
  return lift === 'deadlift' ? '1x5' : '5x5';
}

/** Deloads allowed within a scheme before the ladder moves on. */
export const DELOADS_PER_SCHEME = 2;

export const WAVE: Record<1 | 2 | 3, { pct: number; reps: number }[]> = {
  1: [{ pct: 0.65, reps: 5 }, { pct: 0.75, reps: 5 }, { pct: 0.85, reps: 5 }],
  2: [{ pct: 0.7, reps: 3 }, { pct: 0.8, reps: 3 }, { pct: 0.9, reps: 3 }],
  3: [{ pct: 0.75, reps: 5 }, { pct: 0.85, reps: 3 }, { pct: 0.95, reps: 1 }],
};

/** `minReps` is the pass threshold; `reps` is the target shown on the chip. */
export const SEVENTH: Record<SevenType, { pct: number; reps: number; minReps?: number; amrap?: boolean }[]> = {
  deload_forever: [
    { pct: 0.7, reps: 5 },
    { pct: 0.8, reps: 3 },
    { pct: 0.9, reps: 1 },
    { pct: 1.0, reps: 1 },
  ],
  deload_light: [
    { pct: 0.4, reps: 5 },
    { pct: 0.5, reps: 5 },
    { pct: 0.6, reps: 5 },
  ],
  tm_test: [
    { pct: 0.7, reps: 5 },
    { pct: 0.8, reps: 5 },
    { pct: 0.9, reps: 5 },
    { pct: 1.0, reps: 3, minReps: 3, amrap: true },
  ],
};

export const TM_INCREMENT: Record<MainLift, number> = { squat: 10, deadlift: 10, bench: 5, ohp: 5 };

export const SEVENTH_STEPS = 7; // 3 + 3 + the 7th week
