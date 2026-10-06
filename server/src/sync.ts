import type { Pool } from 'pg';
import { SCHEMA } from './migrate.js';

export type Kind = 'settings' | 'sessions' | 'decisions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RECORDS = 5000;
const MAX_RECORD_BYTES = 1_000_000;
const DAY_MS = 86_400_000;

export interface SyncRecord {
  id: string;
  updatedAt: string;
  deleted?: boolean;
  [key: string]: unknown;
}

export interface PushBody {
  settings?: SyncRecord | null;
  sessions?: SyncRecord[];
  decisions?: SyncRecord[];
}

export class BadRequest extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function validateRecord(kind: Kind, r: unknown, now: number): { rec: SyncRecord; updatedAt: Date } {
  if (!isObj(r)) throw new BadRequest(`${kind}: record must be an object`);
  const id = r.id;
  if (typeof id !== 'string' || !id || id.length > 64) throw new BadRequest(`${kind}: missing id`);
  if (kind !== 'settings' && !UUID.test(id)) throw new BadRequest(`${kind}: id must be a uuid`);
  const t = typeof r.updatedAt === 'string' ? Date.parse(r.updatedAt) : NaN;
  if (!Number.isFinite(t)) throw new BadRequest(`${kind}: updatedAt must be an ISO timestamp`);
  if (JSON.stringify(r).length > MAX_RECORD_BYTES) throw new BadRequest(`${kind}: record too large`);
  // A badly wrong phone clock must not pin a record in the future forever.
  const updatedAt = new Date(Math.min(t, now + DAY_MS));
  return { rec: r as SyncRecord, updatedAt };
}

export function parsePush(body: unknown): { settings: SyncRecord | null; sessions: SyncRecord[]; decisions: SyncRecord[] } {
  if (!isObj(body)) throw new BadRequest('body must be a JSON object');
  const sessions = body.sessions ?? [];
  const decisions = body.decisions ?? [];
  if (!Array.isArray(sessions) || !Array.isArray(decisions)) throw new BadRequest('sessions and decisions must be arrays');
  if (sessions.length > MAX_RECORDS || decisions.length > MAX_RECORDS) throw new BadRequest('too many records in one request');
  if (body.settings != null && !isObj(body.settings)) throw new BadRequest('settings must be an object');
  return { settings: (body.settings as SyncRecord | null | undefined) ?? null, sessions: sessions as SyncRecord[], decisions: decisions as SyncRecord[] };
}

export interface PushResult {
  accepted: { settings: number; sessions: number; decisions: number };
  serverTime: string;
}

/** Upserts each record only if its updatedAt is strictly newer than the stored one (last write wins). */
export async function push(pool: Pool, body: unknown, now = Date.now()): Promise<PushResult> {
  const { settings, sessions, decisions } = parsePush(body);
  const checked = {
    settings: settings ? [validateRecord('settings', settings, now)] : [],
    sessions: sessions.map((r) => validateRecord('sessions', r, now)),
    decisions: decisions.map((r) => validateRecord('decisions', r, now)),
  };

  const client = await pool.connect();
  const accepted = { settings: 0, sessions: 0, decisions: 0 };
  try {
    await client.query('BEGIN');
    for (const { rec, updatedAt } of checked.settings) {
      const r = await client.query(
        `INSERT INTO ${SCHEMA}.settings AS t (id, data, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at, synced_at = now()
         WHERE t.updated_at < EXCLUDED.updated_at`,
        [rec.id, JSON.stringify(rec), updatedAt],
      );
      accepted.settings += r.rowCount ?? 0;
    }
    for (const kind of ['sessions', 'decisions'] as const) {
      for (const { rec, updatedAt } of checked[kind]) {
        const r = await client.query(
          `INSERT INTO ${SCHEMA}.${kind} AS t (id, data, updated_at, deleted) VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at, deleted = EXCLUDED.deleted, synced_at = now()
           WHERE t.updated_at < EXCLUDED.updated_at`,
          [rec.id, JSON.stringify(rec), updatedAt, rec.deleted === true],
        );
        accepted[kind] += r.rowCount ?? 0;
      }
    }
    const t = await client.query<{ now: Date }>('SELECT now()');
    await client.query('COMMIT');
    return { accepted, serverTime: t.rows[0].now.toISOString() };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export interface PullResult {
  serverTime: string;
  settings: SyncRecord[];
  sessions: SyncRecord[];
  decisions: SyncRecord[];
}

/** Everything the server accepted after `since` (tombstones included). */
export async function pull(pool: Pool, since: string | undefined): Promise<PullResult> {
  const t0 = since === undefined || since === '' ? 0 : Date.parse(since);
  if (!Number.isFinite(t0)) throw new BadRequest('since must be an ISO timestamp');
  const sinceDate = new Date(t0);
  const now = await pool.query<{ now: Date }>('SELECT now()');
  const q = async (table: Kind) =>
    (await pool.query<{ data: SyncRecord }>(`SELECT data FROM ${SCHEMA}.${table} WHERE synced_at > $1 ORDER BY synced_at, id`, [sinceDate])).rows.map((r) => r.data);
  const [settings, sessions, decisions] = await Promise.all([q('settings'), q('sessions'), q('decisions')]);
  return { serverTime: now.rows[0].now.toISOString(), settings, sessions, decisions };
}
