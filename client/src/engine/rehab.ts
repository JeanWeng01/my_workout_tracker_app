import type { RehabNext, Settings } from './types';

/** First value strictly above `v` in an ascending list, or null. */
export function nextAbove(list: number[], v: number): number | null {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted.find((x) => x > v + 1e-9) ?? null;
}

/** Last value strictly below `v` in an ascending list, or null. */
export function prevBelow(list: number[], v: number): number | null {
  const sorted = [...list].sort((a, b) => a - b);
  const below = sorted.filter((x) => x < v - 1e-9);
  return below.length ? below[below.length - 1] : null;
}

export const topOf = (list: number[]): number => Math.max(...list);
export const bottomOf = (list: number[]): number => Math.min(...list);

export interface Prescription {
  weight: number;
  reps: number;
}

/**
 * What a dumbbell exercise prescribes next, worked out against the ladders as they are *now*. State only keeps what was
 * lifted last time plus what should happen next, so editing a ladder changes the next suggestion and never the history.
 * Reaching the end of a list simply stays at the end.
 */
export function resolvePrescription(
  last: Prescription,
  next: RehabNext,
  ladder: number[],
  repSteps: number[],
): Prescription {
  if (next === 'hold') return { ...last };
  if (next === 'rep_up') {
    const r = nextAbove(repSteps, last.reps);
    if (r !== null) return { weight: last.weight, reps: r };
    // No higher rep step: fall through to a weight step.
  }
  const w = nextAbove(ladder, last.weight);
  if (w === null) return { weight: last.weight, reps: Math.max(last.reps, topOf(repSteps)) };
  return { weight: w, reps: bottomOf(repSteps) };
}

/** One rung down at the first rep step; stays put on the lowest rung. */
export function dropBack(ladder: number[], weight: number, repSteps: number[]): Prescription {
  return { weight: prevBelow(ladder, weight) ?? weight, reps: bottomOf(repSteps) };
}

/** "2 × 15 lb": dumbbells are always shown per hand. */
export const perHand = (w: number): string => `2 × ${fmtWeight(w)} lb`;

export const fmtWeight = (w: number): string => (Number.isInteger(w) ? String(w) : String(Math.round(w * 100) / 100));

/** "3 × 12" */
export const setsByReps = (sets: number, reps: number): string => `${sets} × ${reps}`;

export function atTopOfProgression(weight: number, reps: number, ladder: number[], repSteps: number[]): boolean {
  return weight >= topOf(ladder) - 1e-9 && reps >= topOf(repSteps);
}

export const rehabLadder = (s: Settings, ex: 'db_floor_press' | 'seated_db_ohp'): number[] => s.rehab.ladders[ex];
