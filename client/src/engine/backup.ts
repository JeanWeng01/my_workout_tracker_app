import { SCHEMA_VERSION } from './defaults';
import { ALL_LIFTS, type Decision, type Session, type Settings } from './types';

export interface Backup {
  app: 'bulletproof';
  schemaVersion: number;
  exportedAt: string;
  settings: Settings;
  sessions: Session[];
  decisions: Decision[];
}

export function makeBackup(settings: Settings, sessions: Session[], decisions: Decision[], now = new Date().toISOString()): Backup {
  return {
    app: 'bulletproof',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    settings,
    // Unfinished drafts are working state, not history.
    sessions: sessions.filter((s) => s.finishedAt !== null || s.abandonedAt),
    decisions,
  };
}

export function backupFilename(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `bulletproof_backup_${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.json`;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const SET_TYPES = ['warmup', 'work', 'amrap', 'supplemental'];
const DECISION_KINDS = ['alert_response', 'phase_switch', 'set_tm', 'override_7th', 'restart_linear'];

export type BackupCheck = { ok: true; data: Backup } | { ok: false; errors: string[] };

/** Validates everything before anything is written. Reports up to 10 problems. */
export function validateBackup(raw: unknown): BackupCheck {
  const errors: string[] = [];
  const bad = (m: string) => errors.length < 10 && errors.push(m);

  if (!isObj(raw)) return { ok: false, errors: ['File is not a Bulletproof backup.'] };
  if (raw.app !== 'bulletproof') bad('Not a Bulletproof backup (missing app marker).');
  if (!isNum(raw.schemaVersion)) bad('Missing schema version.');
  else if (raw.schemaVersion > SCHEMA_VERSION) bad(`Backup is from a newer version (${raw.schemaVersion}); update the app first.`);

  const st = raw.settings;
  if (!isObj(st) || !isObj(st.barWeights) || !Array.isArray(st.platesOwned) || !isObj(st.startingWeights)) bad('Settings are missing or malformed.');
  else for (const l of ALL_LIFTS) if (!isNum(st.barWeights[l])) bad(`Settings: bar weight for ${l} is missing.`);

  if (!Array.isArray(raw.sessions)) bad('Sessions are missing.');
  else {
    raw.sessions.forEach((s: unknown, i: number) => {
      if (!isObj(s) || !isStr(s.id)) return void bad(`Session ${i + 1}: missing id.`);
      if (typeof s.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) bad(`Session ${i + 1}: bad date.`);
      if (s.phase !== 'linear' && s.phase !== '531') bad(`Session ${i + 1}: bad phase.`);
      if (!Array.isArray(s.lifts)) return void bad(`Session ${i + 1}: lifts missing.`);
      s.lifts.forEach((l: unknown, j: number) => {
        if (!isObj(l) || !ALL_LIFTS.includes(l.lift as never) || !isStr(l.scheme) || !Array.isArray(l.sets)) return void bad(`Session ${i + 1}, lift ${j + 1}: malformed.`);
        l.sets.forEach((x: unknown, k: number) => {
          if (!isObj(x) || !SET_TYPES.includes(x.type as string) || !isNum(x.weight) || !isNum(x.reps) || typeof x.done !== 'boolean') bad(`Session ${i + 1}, lift ${j + 1}, set ${k + 1}: malformed.`);
        });
      });
    });
  }

  if (!Array.isArray(raw.decisions)) bad('Decisions are missing.');
  else {
    raw.decisions.forEach((d: unknown, i: number) => {
      if (!isObj(d) || !isStr(d.id) || !isStr(d.createdAt) || !isObj(d.body) || !DECISION_KINDS.includes(d.body.kind as string)) bad(`Decision ${i + 1}: malformed.`);
    });
  }

  return errors.length ? { ok: false, errors } : { ok: true, data: raw as unknown as Backup };
}
