import { DEFAULT_PLATES } from './rounding';
import type { RuleSnapshot, Settings } from './types';

export const SCHEMA_VERSION = 1;

export function snapshotRules(s: Settings): RuleSnapshot {
  return {
    microplates: s.microplates,
    retriesBeforeDeload: s.retriesBeforeDeload,
    deloadPercent: s.deloadPercent,
    tmPercent: s.tmPercent,
    barWeights: { ...s.barWeights },
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
  };
}
