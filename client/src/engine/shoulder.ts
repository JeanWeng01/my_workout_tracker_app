import type { ExerciseId, LoggedLift, PainRating, ShoulderSettings } from './types';

/**
 * 'off'  : shoulder tracking is off or this exercise isn't tracked (ratings never gate anything)
 * 'none' : tracked, but no rating was given this session
 */
export type Zone = 'off' | 'none' | 'green' | 'amber' | 'red';

/** Zone of a rating. Sharp / pinching is always red. */
export function zoneOfRating(p: PainRating, s: Pick<ShoulderSettings, 'greenMax' | 'amberMax'>): 'green' | 'amber' | 'red' {
  if (p.sharp || p.rating > s.amberMax) return 'red';
  if (p.rating > s.greenMax) return 'amber';
  return 'green';
}

/** Words shown next to the rating row (colour is never the only signal). */
export const ZONE_LABEL: Record<'green' | 'amber' | 'red', string> = { green: 'OK', amber: 'Caution', red: 'Stop' };

export function isTracked(lift: ExerciseId, s: ShoulderSettings): boolean {
  return s.tracking && s.tracked.includes(lift);
}

export function liftZone(l: Pick<LoggedLift, 'lift' | 'pain'>, s: ShoulderSettings): Zone {
  if (!isTracked(l.lift, s)) return 'off';
  if (!l.pain) return 'none';
  return zoneOfRating(l.pain, s);
}

const RANK: Record<'green' | 'amber' | 'red', number> = { green: 0, amber: 1, red: 2 };

/**
 * The worst rating among the given lifts (only tracked, performed ones should be passed in).
 * 'off' when tracking is off, 'none' when no tracked lift was rated.
 */
export function worstZone(lifts: Pick<LoggedLift, 'lift' | 'pain'>[], s: ShoulderSettings): Zone {
  if (!s.tracking) return 'off';
  let worst: 'green' | 'amber' | 'red' | null = null;
  for (const l of lifts) {
    const z = liftZone(l, s);
    if (z === 'off' || z === 'none') continue;
    if (worst === null || RANK[z] > RANK[worst]) worst = z;
  }
  return worst ?? 'none';
}

/** "Shoulder rated 6" or "Shoulder flagged sharp" for alert copy. */
export function describePain(p: PainRating): string {
  return p.sharp ? `Shoulder flagged sharp (rated ${p.rating})` : `Shoulder rated ${p.rating}`;
}
