import type { Lift, Settings } from './types';

export const DEFAULT_PLATES = [45, 35, 25, 10, 5, 2.5];
const EPS = 1e-9;

/** Epley: w × (1 + reps/30). Only meaningful for 1–10 reps; otherwise 0. */
export function estimate1RM(weight: number, reps: number): number {
  if (!Number.isFinite(weight) || reps < 1 || reps > 10) return 0;
  return weight * (1 + reps / 30);
}

export function roundingIncrement(settings: Pick<Settings, 'microplates'>): number {
  return settings.microplates ? 2.5 : 5;
}

/** Plates actually available: 1.25s exist only while the microplate toggle is on. */
export function effectivePlates(settings: Pick<Settings, 'platesOwned' | 'microplates'>): number[] {
  const plates = settings.platesOwned.filter((p) => p !== 1.25);
  if (settings.microplates) plates.push(1.25);
  return plates.sort((a, b) => b - a);
}

/**
 * Round to the rounding increment, never below the lift's bar weight.
 * 'nearest' sends ties down; 'down' floors.
 */
export function roundToPlates(
  weight: number,
  settings: Pick<Settings, 'microplates' | 'barWeights'>,
  lift: Lift,
  mode: 'nearest' | 'down',
): number {
  const inc = roundingIncrement(settings);
  const q = weight / inc;
  const rounded = mode === 'down' ? Math.floor(q + EPS) : Math.ceil(q - 0.5 - EPS);
  return Math.max(settings.barWeights[lift], rounded * inc);
}

/** Greedy plate breakdown for one side of the bar, heaviest first. */
export function platesPerSide(weight: number, barWeight: number, platesOwned: number[]): number[] {
  let remaining = (weight - barWeight) / 2;
  const out: number[] = [];
  for (const plate of [...platesOwned].sort((a, b) => b - a)) {
    while (remaining >= plate - EPS) {
      out.push(plate);
      remaining -= plate;
    }
  }
  return out;
}
