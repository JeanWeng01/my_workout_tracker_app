import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo } from 'react';
import { withDefaults, deriveState, isActiveDraft, planNextSession, type Decision, type ProgramState, type Session, type SessionPlan, type Settings } from '../engine';
import { db, requestPersistence } from './db';
import { abandonStaleDrafts, runMigrations } from './store';

export interface Program {
  ready: boolean;
  settings: Settings;
  sessions: Session[];
  decisions: Decision[];
  state: ProgramState;
  plan: SessionPlan;
  draft: Session | undefined;
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Live view of everything: state and plan are always re-derived from the logged history. */
export function useProgram(): Program | null {
  useEffect(() => {
    void runMigrations();
    void requestPersistence();
    void abandonStaleDrafts();
    const onVisible = () => document.visibilityState === 'visible' && void abandonStaleDrafts();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const stored = useLiveQuery(() => db.settings.get('settings'), []);
  const settings = useMemo(() => (stored ? withDefaults(stored) : undefined), [stored]);
  const sessions = useLiveQuery(() => db.sessions.toArray(), []);
  const decisions = useLiveQuery(() => db.decisions.toArray(), []);

  return useMemo(() => {
    if (!settings || !sessions || !decisions) return null;
    const state = deriveState(settings, sessions, decisions);
    const plan = planNextSession(state, settings, today());
    const draft = sessions.find(isActiveDraft);
    return { ready: true, settings, sessions, decisions, state, plan, draft };
  }, [settings, sessions, decisions]);
}
