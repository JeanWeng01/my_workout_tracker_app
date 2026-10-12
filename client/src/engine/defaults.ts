import { DEFAULT_PLATES } from './rounding';
import { deriveState } from './state';
import type { Decision, RuleSnapshot, Session, Settings } from './types';

/** 1 = original app. 2 = shoulder rehab tracks, pain ratings and accessories (change request 01). */
export const SCHEMA_VERSION = 2;

export function snapshotRules(s: Settings): RuleSnapshot {
  return {
    microplates: s.microplates,
    retriesBeforeDeload: s.retriesBeforeDeload,
    deloadPercent: s.deloadPercent,
    tmPercent: s.tmPercent,
    barWeights: { ...s.barWeights },
    shoulder: { ...s.shoulder, tracked: [...s.shoulder.tracked] },
  };
}

export function defaultSettings(now = new Date().toISOString()): Settings {
  return {
    id: 'settings',
    updatedAt: now,
    deleted: false,
    schemaVersion: SCHEMA_VERSION,
    unit: 'lb',
    barWeights: { squat: 45, bench: 45, row: 45, ohp: 45, deadlift: 45 },
    platesOwned: [...DEFAULT_PLATES],
    microplates: false,
    retriesBeforeDeload: 3,
    deloadPercent: 0.1,
    linearLayout: 'stronglifts',
    tmPercent: 0.85,
    liftsPerSession: 1,
    template: 'fsl',
    bbbPercent: 0.5,
    deloadStyle: 'forever',
    startingWeights: { squat: 65, bench: 45, row: 45, ohp: 45, deadlift: 95 },
    restSeconds: { warmup: 60, work: 180, supplemental: 90 },
    shoulder: {
      tracking: true,
      tracked: ['db_floor_press', 'seated_db_ohp', 'bench', 'ohp', 'row'],
      greenMax: 2,
      amberMax: 4,
    },
    rehab: {
      sets: 3,
      repSteps: [10, 12, 15],
      ladders: {
        db_floor_press: [15, 17.5, 20, 25, 30],
        seated_db_ohp: [12.5, 15, 17.5, 20],
      },
      returnWeights: { bench: 55, ohp: 45 },
    },
    accessories: {
      rehabSets: 3,
      maintenanceSets: 2,
      repSteps: [10, 12, 15],
      ladders: {
        side_lying_er: [3, 5, 8, 10, 12],
        db_scaption: [3, 5, 8, 10, 12, 15],
      },
    },
  };
}

/**
 * The 1:30 default the app briefly shipped with. Saved copies still holding exactly these (never customised) go back to the
 * 3:00 default; anything the lifter set themselves is left alone.
 */
const OLD_REST_DEFAULT = { warmup: 60, work: 90, supplemental: 90 };

/**
 * Stored settings filled in with anything added since they were saved (including the shoulder/rehab/accessory
 * groups from schema 2, merged field by field), plus small default migrations.
 */
export function withDefaults(stored: Settings): Settings {
  const d = defaultSettings();
  const merged: Settings = {
    ...d,
    ...stored,
    shoulder: { ...d.shoulder, ...stored.shoulder },
    rehab: {
      ...d.rehab,
      ...stored.rehab,
      ladders: { ...d.rehab.ladders, ...stored.rehab?.ladders },
      returnWeights: { ...d.rehab.returnWeights, ...stored.rehab?.returnWeights },
    },
    accessories: {
      ...d.accessories,
      ...stored.accessories,
      ladders: { ...d.accessories.ladders, ...stored.accessories?.ladders },
    },
    schemaVersion: Math.max(stored.schemaVersion ?? 1, SCHEMA_VERSION),
  };
  const r = merged.restSeconds;
  if (r.warmup === OLD_REST_DEFAULT.warmup && r.work === OLD_REST_DEFAULT.work && r.supplemental === OLD_REST_DEFAULT.supplemental) {
    merged.restSeconds = { ...d.restSeconds };
  }
  return merged;
}

// ---------- one-time data migration to schema 2 ----------

/**
 * A stable UUID-shaped id made from a fixed string. Two devices running the migration produce the same id, so the
 * server (and the other phone) end up with one record, not two.
 */
export function deterministicId(seed: string): string {
  const hash = (salt: number) => {
    let h = 2166136261 ^ salt;
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    return (h >>> 0).toString(16).padStart(8, '0');
  };
  const hex = hash(1) + hash(2) + hash(3) + hash(4);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The most recent finished session: decisions created by a migration take effect after it. */
function latestFinishedId(sessions: Session[]): string | null {
  const latest = sessions
    .filter((s) => !s.deleted && s.finishedAt)
    .sort((a, b) => (a.finishedAt! < b.finishedAt! ? -1 : 1))
    .pop();
  return latest?.id ?? null;
}

/**
 * Decisions to create on the first launch after the shoulder update: Bench moves to the rehab track at the first rung of its
 * dumbbell ladder, effective after the latest finished session. (Overhead Press stays on the barbell.) Nothing logged is
 * touched. Returns [] when track decisions already exist (already migrated, on this or another device).
 */
export function schema2Migration(settings: Settings, sessions: Session[], decisions: Decision[], now = new Date().toISOString()): Decision[] {
  if (decisions.some((d) => d.body.kind === 'track_change')) return [];
  return [
    {
      id: deterministicId('schema2:track_change:bench:rehab'),
      updatedAt: now,
      deleted: false,
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      afterSessionId: latestFinishedId(sessions),
      body: { kind: 'track_change', lift: 'bench', to: 'rehab', startWeight: settings.rehab.ladders.db_floor_press[0] },
    },
  ];
}

/** The first version of this step reset OHP to 45 even if it had barbell sessions, wiping out their progress. */
const OHP_BACK_V1_ID = deterministicId('migration:track_change:ohp:linear:back-to-barbell');
const OHP_BACK_ID = deterministicId('migration:track_change:ohp:linear:back-to-barbell:keep-progress');

/**
 * The shoulder tolerated the barbell overhead press, so Overhead Press goes back to the barbell **and carries on from the
 * barbell progress it already has** (nothing is reset). A phone that already moved it to rehab (the first version of the
 * shoulder update did) gets one decision doing that, at the same spot in its history. A phone that also received the first
 * version of this step (which restarted OHP at 45 and so erased earned progress) has that decision retracted (a tombstone,
 * which syncs) and replaced. It runs once (fixed id) and never overrides a choice made later in Settings.
 */
export function ohpBackToBarbellMigration(settings: Settings, sessions: Session[], decisions: Decision[], now = new Date().toISOString()): Decision[] {
  if (decisions.some((d) => d.id === OHP_BACK_ID)) return [];
  const old = decisions.find((d) => d.id === OHP_BACK_V1_ID);
  const out: Decision[] = [];
  if (old && !old.deleted) {
    const retracted: Decision = { ...old, deleted: true, updatedAt: now };
    out.push(retracted);
  } else if (!old && deriveState(settings, sessions, decisions).track.ohp !== 'rehab') {
    return []; // a fresh install, or the lifter already moved it
  }
  // Replace at the old decision's own position so everything after it replays exactly as before; a new one goes at the end.
  out.push({
    id: OHP_BACK_ID,
    updatedAt: now,
    deleted: false,
    schemaVersion: SCHEMA_VERSION,
    createdAt: old?.createdAt ?? now,
    afterSessionId: old ? old.afterSessionId : latestFinishedId(sessions),
    body: { kind: 'track_change', lift: 'ohp', to: 'linear', keepProgress: true },
  });
  return out;
}

/** Everything the app has to create on launch, in order. Idempotent. */
export function pendingMigrations(settings: Settings, sessions: Session[], decisions: Decision[], now = new Date().toISOString()): Decision[] {
  const first = schema2Migration(settings, sessions, decisions, now);
  const second = ohpBackToBarbellMigration(settings, sessions, [...decisions, ...first], now);
  return [...first, ...second];
}
