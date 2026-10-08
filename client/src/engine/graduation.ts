import { SCHEMA_VERSION } from './defaults';
import { newId } from './uuid';
import { estimate1RM, roundToPlates } from './rounding';
import { deriveState, finishedSessions } from './state';
import { MAIN_LIFTS, type Decision, type MainLift, type Session, type Settings } from './types';

/** 4.3: TM from the best e1RM over a lift's last 6 non-skipped finished sessions. */
export function computeTrainingMaxes(settings: Settings, sessions: Session[]): Record<MainLift, number> {
  const ordered = finishedSessions(sessions);
  const out = {} as Record<MainLift, number>;
  for (const lift of MAIN_LIFTS) {
    const recent = ordered
      .filter((s) => s.lifts.some((l) => l.lift === lift && !l.skipped && l.sets.some((x) => x.done && (x.type === 'work' || x.type === 'amrap'))))
      .slice(-6);
    let best = 0;
    for (const s of recent) {
      for (const l of s.lifts) {
        if (l.lift !== lift) continue;
        for (const set of l.sets) {
          if ((set.type === 'work' || set.type === 'amrap') && set.done) best = Math.max(best, estimate1RM(set.weight, set.reps));
        }
      }
    }
    out[lift] = roundToPlates(best * settings.tmPercent, settings, lift, 'down');
  }
  return out;
}

/**
 * Call right after Finish workout. If this session is the one that made squat
 * LINEAR COMPLETE, returns the automatic phase_switch decision to save.
 */
export function checkGraduation(
  settings: Settings,
  sessions: Session[],
  decisions: Decision[],
  finishedSessionId: string,
  now = new Date().toISOString(),
): Decision | null {
  const withoutThis = sessions.filter((s) => s.id !== finishedSessionId);
  const before = deriveState(settings, withoutThis, decisions);
  const after = deriveState(settings, sessions, decisions);
  if (after.phase !== 'linear') return null;
  if (before.linear.squat.complete || !after.linear.squat.complete) return null;
  return {
    id: newId(),
    updatedAt: now,
    deleted: false,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    afterSessionId: finishedSessionId,
    body: { kind: 'phase_switch', to: '531', auto: true, tms: computeTrainingMaxes(settings, sessions) },
  };
}
