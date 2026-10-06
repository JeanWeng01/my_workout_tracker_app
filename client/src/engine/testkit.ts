import { defaultSettings, snapshotRules } from './defaults';
import { WAVE } from './program';
import { checkGraduation } from './graduation';
import { deriveState } from './state';
import type { Decision, DecisionBody, Lift, LoggedLift, MainLift, LoggedSet, Phase, SchemeId, Session, Settings } from './types';

/** Linear lift: `reps` per planned set, -1 = untouched. */
export function linearLift(lift: Lift, weight: number, reps: number[], scheme?: SchemeId): LoggedLift {
  const sc: SchemeId = scheme ?? (lift === 'deadlift' ? '1x5' : '5x5');
  const sets: LoggedSet[] = reps.map((r) => ({
    type: 'work',
    targetWeight: weight,
    targetReps: 5,
    weight,
    reps: Math.max(r, 0),
    done: r >= 0,
  }));
  return { lift, scheme: sc, skipped: false, sets };
}

export const ok = (n = 5) => Array<number>(n).fill(5);
export const skipped = (lift: Lift): LoggedLift => ({ lift, scheme: '5x5', skipped: true, sets: [] });

/** 5/3/1 main lift for a wave week; `amrapReps` is the reps on the last set. */
export function waveLift(lift: Lift, week: 1 | 2 | 3, weight: number, amrapReps: number): LoggedLift {
  const sets: LoggedSet[] = WAVE[week].map((m, i, arr) => {
    const last = i === arr.length - 1;
    return {
      type: last ? 'amrap' : 'work',
      targetWeight: weight,
      targetReps: m.reps,
      weight,
      reps: last ? amrapReps : m.reps,
      done: true,
      minReps: last ? m.reps : undefined,
    };
  });
  return { lift, scheme: '531', skipped: false, sets, waveWeek: week };
}

export function seventhLift(lift: Lift, type: 'tm_test' | 'deload_forever' | 'deload_light', weight: number, topReps = 3): LoggedLift {
  const sets: LoggedSet[] = [
    { type: 'work', targetWeight: weight, targetReps: 5, weight, reps: 5, done: true },
    {
      type: type === 'tm_test' ? 'amrap' : 'work',
      targetWeight: weight,
      targetReps: 3,
      weight,
      reps: topReps,
      done: true,
      minReps: type === 'tm_test' ? 3 : undefined,
    },
  ];
  return { lift, scheme: `7th_${type}`, skipped: false, sets };
}

/** Builds a history one session or decision at a time. */
export class Timeline {
  sessions: Session[] = [];
  decisions: Decision[] = [];
  settings: Settings;
  private n = 0;
  private base = Date.parse('2026-01-01T12:00:00Z');

  constructor(overrides: Partial<Settings> = {}) {
    this.settings = { ...defaultSettings('2026-01-01T00:00:00Z'), ...overrides };
  }

  private day(offset: number) {
    return new Date(this.base + offset * 86_400_000).toISOString();
  }

  log(lifts: LoggedLift[], phase: Phase = 'linear', dayOffset?: number): Session {
    const i = this.n++;
    const finishedAt = this.day(dayOffset ?? i);
    const s: Session = {
      id: `s${i}`,
      updatedAt: finishedAt,
      deleted: false,
      schemaVersion: 1,
      date: finishedAt.slice(0, 10),
      finishedAt,
      phase,
      label: 'test',
      rules: snapshotRules(this.settings),
      lifts,
    };
    this.sessions.push(s);
    return s;
  }

  decide(body: DecisionBody, afterSessionId?: string | null): Decision {
    const last = this.sessions[this.sessions.length - 1];
    const i = this.n++;
    const createdAt = new Date(Date.parse(last?.finishedAt ?? this.day(0)) + 60_000 + i).toISOString();
    const d: Decision = {
      id: `d${i}`,
      updatedAt: createdAt,
      deleted: false,
      schemaVersion: 1,
      createdAt,
      afterSessionId: afterSessionId === undefined ? (last?.id ?? null) : afterSessionId,
      body,
    };
    this.decisions.push(d);
    return d;
  }

  /** Like the UI: an accepted alert carries the exact value it proposed. */
  respond(lift: Lift, alertKind: Extract<DecisionBody, { kind: 'alert_response' }>['alertKind'], choice: 'accept' | 'keep' = 'accept', value?: number) {
    if (value === undefined && alertKind !== 'break') {
      const st = this.state();
      const p = (alertKind === 'tm_reset' || alertKind === 'tm_test_failed' ? st.wave[lift as MainLift] : st.linear[lift]).pending;
      value = p?.value;
    }
    return this.decide({ kind: 'alert_response', lift, alertKind, choice, value });
  }

  state() {
    return deriveState(this.settings, this.sessions, this.decisions);
  }

  graduation() {
    const last = this.sessions[this.sessions.length - 1];
    const now = new Date(Date.parse(last.finishedAt!) + 30_000).toISOString();
    return checkGraduation(this.settings, this.sessions, this.decisions, last.id, now);
  }
}
