import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, freshApp, session, uuid } from './helpers.js';

let app: FastifyInstance;
let pool: Pool;
beforeAll(async () => {
  ({ app, pool } = await freshApp());
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const post = (payload: unknown) => app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: payload as object });
const get = () => app.inject({ method: 'GET', url: '/api/sync', headers: auth });

const set = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  targetWeight: 15,
  targetReps: 10,
  weight: 15,
  reps: 10,
  done: true,
  ...extra,
});

describe('12. shoulder records round-trip through the server unchanged', () => {
  const shoulderSession = session({
    schemaVersion: 2,
    notes: 'Left shoulder fine, slow lowering.',
    rules: { shoulder: { tracking: true, tracked: ['db_floor_press', 'row'], greenMax: 2, amberMax: 4 } },
    lifts: [
      {
        lift: 'squat',
        scheme: '5x5',
        skipped: false,
        sets: [set('prep', { exercise: 'band_pull_apart', targetWeight: 0, weight: 0, targetReps: 20, reps: 20 }), set('work', { targetWeight: 70, weight: 70, targetReps: 5, reps: 5 })],
      },
      {
        lift: 'db_floor_press',
        scheme: 'rehab',
        skipped: false,
        pain: { rating: 3, sharp: true },
        sets: [set('work'), set('work'), set('work')],
      },
      {
        lift: 'row',
        scheme: '5x5',
        skipped: false,
        pain: { rating: 1, sharp: false },
        painSkipped: false,
        sets: [
          set('work', { targetWeight: 50, weight: 50, targetReps: 5, reps: 5 }),
          set('accessory', { exercise: 'side_lying_er', targetWeight: 3, weight: 3 }),
          set('accessory', { exercise: 'db_scaption', targetWeight: 3, weight: 3 }),
        ],
      },
      { lift: 'bench', scheme: 'rehab', skipped: true, paused: true, sets: [] },
    ],
  });
  const trackDecision = {
    id: uuid(),
    updatedAt: '2026-01-02T00:00:00.000Z',
    deleted: false,
    schemaVersion: 2,
    createdAt: '2026-01-02T00:00:00.000Z',
    afterSessionId: shoulderSession.id,
    body: { kind: 'track_change', lift: 'bench', to: 'rehab', startWeight: 15 },
  };
  const pauseDecision = { ...trackDecision, id: uuid(), body: { kind: 'pause_lift', lift: 'bench' } };
  const returnDecision = {
    ...trackDecision,
    id: uuid(),
    body: { kind: 'alert_response', lift: 'bench', alertKind: 'return_barbell', choice: 'accept', value: 55 },
  };
  const settings = {
    id: 'settings',
    updatedAt: '2026-01-02T00:00:00.000Z',
    deleted: false,
    schemaVersion: 2,
    shoulder: { tracking: true, tracked: ['db_floor_press', 'seated_db_ohp', 'bench', 'ohp', 'row'], greenMax: 2, amberMax: 4 },
    rehab: { sets: 3, repSteps: [10, 12, 15], ladders: { db_floor_press: [15, 17.5], seated_db_ohp: [12.5] }, returnWeights: { bench: 55, ohp: 45 } },
    accessories: { rehabSets: 3, maintenanceSets: 2, repSteps: [10, 12, 15], ladders: { side_lying_er: [3, 5], db_scaption: [3] } },
  };

  it('pain ratings, prep and accessory sets, track decisions and the new settings come back exactly as pushed', async () => {
    const r = await post({ settings, sessions: [shoulderSession], decisions: [trackDecision, pauseDecision, returnDecision] });
    expect(r.statusCode).toBe(200);
    expect(r.json().accepted).toEqual({ settings: 1, sessions: 1, decisions: 3 });

    const pulled = (await get()).json();
    expect(pulled.sessions.find((s: { id: string }) => s.id === shoulderSession.id)).toEqual(shoulderSession);
    for (const d of [trackDecision, pauseDecision, returnDecision]) {
      expect(pulled.decisions.find((x: { id: string }) => x.id === d.id)).toEqual(d);
    }
    expect(pulled.settings.find((s: { id: string }) => s.id === 'settings')).toEqual(settings);
  });

  it('pushing the same shoulder records again changes nothing (idempotent)', async () => {
    const again = (await post({ settings, sessions: [shoulderSession], decisions: [trackDecision, pauseDecision, returnDecision] })).json();
    expect(again.accepted).toEqual({ settings: 0, sessions: 0, decisions: 0 });
  });

  it('needs no schema change: the new fields live inside the JSONB documents', async () => {
    const cols = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'bulletproof' AND table_name = 'sessions' ORDER BY ordinal_position")).rows.map(
      (c) => c.column_name,
    );
    expect(cols).toEqual(['id', 'data', 'updated_at', 'deleted', 'synced_at']);
    const doc = (await pool.query('SELECT data FROM bulletproof.sessions WHERE id = $1', [shoulderSession.id])).rows[0].data;
    expect(doc.lifts[1].pain).toEqual({ rating: 3, sharp: true });
  });

  it('a later edit of a rating wins over the older one (last write wins)', async () => {
    const edited = { ...shoulderSession, updatedAt: '2026-01-03T00:00:00.000Z', lifts: shoulderSession.lifts.map((l) => (l.lift === 'db_floor_press' ? { ...l, pain: { rating: 6, sharp: false } } : l)) };
    expect((await post({ sessions: [edited] })).json().accepted.sessions).toBe(1);
    const stale = { ...shoulderSession, updatedAt: '2026-01-02T12:00:00.000Z' };
    expect((await post({ sessions: [stale] })).json().accepted.sessions).toBe(0);
    const back = (await get()).json().sessions.find((s: { id: string }) => s.id === shoulderSession.id);
    expect(back.lifts[1].pain).toEqual({ rating: 6, sharp: false });
  });
});
