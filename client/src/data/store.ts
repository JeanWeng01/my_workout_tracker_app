import {
  abandonSession,
  checkGraduation,
  defaultSettings,
  withDefaults,
  deriveState,
  draftFromPlan,
  finishSession,
  isActiveDraft,
  isEmptyDraft,
  isStaleDraft,
  newId,
  liftFromPlan,
  liftsWithUntouched,
  planNextSession,
  resolveUntouched,
  type Alert,
  type Backup,
  type Lift,
  type Decision,
  type DecisionBody,
  type MainLift,
  type Session,
  type SevenType,
  type Settings,
  type Template,
} from '../engine';
import { db } from './db';
import { scheduleSync } from './sync';

const nowIso = () => new Date().toISOString();

function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function ensureSettings(): Promise<Settings> {
  const existing = await db.settings.get('settings');
  // Fill in fields added by newer versions of the app.
  if (existing) return withDefaults(existing);
  // Epoch timestamp and not dirty: untouched defaults can never overwrite real settings on the server.
  const s = { ...defaultSettings('1970-01-01T00:00:00.000Z'), dirty: 0 as const };
  await db.settings.put(s);
  return s;
}

export async function saveSettings(s: Settings): Promise<void> {
  await db.settings.put({ ...s, updatedAt: nowIso(), dirty: 1 });
  scheduleSync();
}

export async function getDraft(): Promise<Session | undefined> {
  return db.sessions.filter(isActiveDraft).first();
}

/** Creates the draft from the engine's plan, or returns the one already in progress. */
export async function startWorkout(): Promise<Session> {
  return db.transaction('rw', db.settings, db.sessions, db.decisions, async () => {
    const existing = await getDraft();
    if (existing) return existing;
    const settings = await ensureSettings();
    const [sessions, decisions] = await Promise.all([db.sessions.toArray(), db.decisions.toArray()]);
    const plan = planNextSession(deriveState(settings, sessions, decisions), settings, localDate());
    const draft = draftFromPlan(plan, settings, newId(), nowIso(), localDate());
    await db.sessions.put({ ...draft, dirty: 0 });
    return draft;
  });
}

/** Read-modify-write inside a transaction, so rapid taps never clobber each other. Autosaves every call. */
export async function updateDraft(id: string, fn: (s: Session) => Session): Promise<void> {
  await db.transaction('rw', db.sessions, async () => {
    const cur = await db.sessions.get(id);
    if (!cur || cur.finishedAt !== null) return;
    await db.sessions.put({ ...fn(cur), updatedAt: nowIso(), dirty: 0 });
  });
}

/**
 * Leave the workout unfinished. If anything was logged it stays as a yellow day (partial sets kept,
 * never counted); a workout with nothing logged just disappears. Returns whether a yellow day was kept.
 */
export async function exitWorkout(id: string): Promise<boolean> {
  const kept = await db.transaction('rw', db.sessions, async () => {
    const cur = await db.sessions.get(id);
    if (!cur || cur.finishedAt !== null) return false;
    if (isEmptyDraft(cur)) {
      await db.sessions.delete(id);
      return false;
    }
    await db.sessions.put({ ...abandonSession(cur, nowIso()), dirty: 1 });
    return true;
  });
  if (kept) scheduleSync();
  return kept;
}

/** On app open: a draft untouched for 12+ hours becomes an unfinished workout. */
export async function abandonStaleDrafts(): Promise<void> {
  const now = Date.now();
  const stale = await db.sessions.filter((s) => isStaleDraft(s, now)).toArray();
  for (const s of stale) await exitWorkout(s.id);
}

export interface FinishResult {
  /** The finished session made squat LINEAR COMPLETE and the program switched to 5/3/1. */
  graduated: boolean;
  discarded: boolean;
}

/** Whether Finish needs to ask about untouched sets. */
export function needsUntouchedChoice(s: Session): boolean {
  return liftsWithUntouched(s).length > 0;
}

export async function finishWorkout(id: string, untouched: 'missed' | 'skip'): Promise<FinishResult> {
  return db.transaction('rw', db.settings, db.sessions, db.decisions, async () => {
    const cur = await db.sessions.get(id);
    if (!cur || cur.finishedAt !== null) return { graduated: false, discarded: false };
    const resolved = resolveUntouched(cur, untouched);
    if (isEmptyDraft(resolved)) {
      await db.sessions.delete(id);
      return { graduated: false, discarded: true };
    }
    const finished = { ...finishSession(resolved, nowIso()), dirty: 1 as const };
    await db.sessions.put(finished);

    const settings = await ensureSettings();
    const [sessions, decisions] = await Promise.all([db.sessions.toArray(), db.decisions.toArray()]);
    const grad = checkGraduation(settings, sessions, decisions, id);
    if (grad) await db.decisions.put({ ...grad, dirty: 1 });
    return { graduated: !!grad, discarded: false };
  }).then((r) => {
    scheduleSync();
    return r;
  });
}

/** Saves a decision after the latest finished session. */
export async function saveDecision(body: DecisionBody): Promise<Decision> {
  const sessions = await db.sessions.toArray();
  const last = sessions.filter((s) => !s.deleted && s.finishedAt).sort((a, b) => (a.finishedAt! < b.finishedAt! ? -1 : 1)).pop();
  const now = nowIso();
  const d: Decision = {
    id: newId(),
    updatedAt: now,
    deleted: false,
    schemaVersion: 1,
    createdAt: now,
    afterSessionId: last?.id ?? null,
    body,
  };
  await db.decisions.put({ ...d, dirty: 1 });
  scheduleSync();
  return d;
}

/**
 * Accept / "Try again next workout". Accepting an alert changes the next weights, so if a draft
 * exists and that lift is still untouched, its sets are rebuilt from the new plan.
 */
export async function respondToAlert(alert: Alert, choice: 'accept' | 'keep'): Promise<void> {
  await saveDecision({ kind: 'alert_response', lift: alert.lift, alertKind: alert.kind, choice, value: alert.value });
  const draft = await getDraft();
  if (!draft || choice !== 'accept') return;
  const settings = await ensureSettings();
  const [sessions, decisions] = await Promise.all([db.sessions.toArray(), db.decisions.toArray()]);
  const plan = planNextSession(deriveState(settings, sessions, decisions), settings, localDate());
  await updateDraft(draft.id, (s) => ({
    ...s,
    lifts: s.lifts.map((l) => {
      const fresh = plan.lifts.find((p) => p.lift === l.lift);
      const untouched = !l.sets.some((x) => x.done);
      return fresh && untouched && !l.skipped ? liftFromPlan(fresh) : l;
    }),
  }));
}

/** 7th-week "Change": saves the override, and rebuilds the lift in an untouched draft. */
export async function changeSeventhWeek(lift: MainLift, sevenType: SevenType): Promise<void> {
  await saveDecision({ kind: 'override_7th', lift, sevenType });
  const draft = await getDraft();
  if (!draft) return;
  const settings = await ensureSettings();
  const [sessions, decisions] = await Promise.all([db.sessions.toArray(), db.decisions.toArray()]);
  const plan = planNextSession(deriveState(settings, sessions, decisions), settings, localDate());
  await updateDraft(draft.id, (s) => ({
    ...s,
    lifts: s.lifts.map((l) => {
      const fresh = plan.lifts.find((p) => p.lift === l.lift);
      return fresh && l.lift === lift && !l.sets.some((x) => x.done) ? liftFromPlan(fresh) : l;
    }),
  }));
}

/** Template switch applies from the next session; a draft in progress is untouched. */
export async function setTemplate(template: Template): Promise<void> {
  const s = await ensureSettings();
  await saveSettings({ ...s, template });
}

export async function setTrainingMax(lift: MainLift, tm: number): Promise<void> {
  await saveDecision({ kind: 'set_tm', lift, tm });
}

/** Edit a finished session from the calendar. State and plan re-derive from the new history. */
export async function updateSession(id: string, fn: (s: Session) => Session): Promise<void> {
  await db.transaction('rw', db.sessions, async () => {
    const cur = await db.sessions.get(id);
    if (!cur) return;
    await db.sessions.put({ ...fn(cur), updatedAt: nowIso(), dirty: 1 });
  });
  scheduleSync();
}

/** Soft delete: a tombstone, so the deletion syncs. */
export async function deleteSession(id: string): Promise<void> {
  await updateSession(id, (s) => ({ ...s, deleted: true }));
}

/** Manual phase switch from Settings (either direction). */
export async function switchPhase(to: 'linear' | '531', tms?: Record<MainLift, number>): Promise<void> {
  await saveDecision({ kind: 'phase_switch', to, auto: false, tms });
}

export async function restartLinear(weights: Record<Lift, number>): Promise<void> {
  await saveDecision({ kind: 'restart_linear', weights });
}

/** Replaces everything local with a validated backup. Call validateBackup first. */
export async function restoreBackup(b: Backup): Promise<void> {
  // Restored records get a fresh timestamp so the restore wins last-write-wins on the server too.
  const stamp = nowIso();
  await db.transaction('rw', db.settings, db.sessions, db.decisions, async () => {
    await Promise.all([db.settings.clear(), db.sessions.clear(), db.decisions.clear()]);
    await db.settings.put({ ...withDefaults(b.settings), updatedAt: stamp, dirty: 1 });
    await db.sessions.bulkPut(b.sessions.map((s) => ({ ...s, updatedAt: stamp, dirty: 1 as const })));
    await db.decisions.bulkPut(b.decisions.map((d) => ({ ...d, updatedAt: stamp, dirty: 1 as const })));
  });
  scheduleSync();
}

export async function loadEverything() {
  const [settings, sessions, decisions] = await Promise.all([ensureSettings(), db.sessions.toArray(), db.decisions.toArray()]);
  return { settings, sessions, decisions };
}
