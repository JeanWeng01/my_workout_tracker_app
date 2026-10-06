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

const post = (payload: unknown, headers: Record<string, string> = auth) =>
  app.inject({ method: 'POST', url: '/api/sync', headers, payload: payload as object });
const get = (url: string, headers: Record<string, string> = auth) => app.inject({ method: 'GET', url, headers });
const idsOf = (list: { id: string }[]) => list.map((x) => x.id);

describe('20. authentication', () => {
  it('health works without a token', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
  });

  it('everything else returns 401 without the right token', async () => {
    for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: 'Basic abc' }, { authorization: 'Bearer ' }]) {
      expect((await get('/api/sync', headers)).statusCode).toBe(401);
      expect((await post({ sessions: [] }, headers)).statusCode).toBe(401);
    }
    expect((await get('/api/anything-else', {})).statusCode).toBe(401);
  });

  it('a valid token gets through, and unknown API paths are 404', async () => {
    expect((await get('/api/sync')).statusCode).toBe(200);
    expect((await get('/api/nope')).statusCode).toBe(404);
  });
});

describe('21. push is idempotent and last-write-wins', () => {
  it('re-posting the same payload changes nothing', async () => {
    const s = session();
    const first = (await post({ sessions: [s] })).json();
    expect(first.accepted.sessions).toBe(1);
    const again = (await post({ sessions: [s] })).json();
    expect(again.accepted.sessions).toBe(0);
    const n = (await pool.query('SELECT count(*)::int AS n FROM bulletproof.sessions WHERE id = $1', [s.id])).rows[0].n;
    expect(n).toBe(1);
  });

  it('an older updatedAt never overwrites a newer record', async () => {
    const id = uuid();
    await post({ sessions: [session({ id, updatedAt: '2026-02-01T00:00:00.000Z', label: 'newer' })] });
    const r = (await post({ sessions: [session({ id, updatedAt: '2026-01-15T00:00:00.000Z', label: 'older' })] })).json();
    expect(r.accepted.sessions).toBe(0);
    const stored = (await pool.query('SELECT data FROM bulletproof.sessions WHERE id = $1', [id])).rows[0].data;
    expect(stored.label).toBe('newer');
  });

  it('a newer updatedAt replaces an older record', async () => {
    const id = uuid();
    await post({ sessions: [session({ id, updatedAt: '2026-01-01T00:00:00.000Z', label: 'v1' })] });
    const r = (await post({ sessions: [session({ id, updatedAt: '2026-01-02T00:00:00.000Z', label: 'v2' })] })).json();
    expect(r.accepted.sessions).toBe(1);
    const stored = (await pool.query('SELECT data FROM bulletproof.sessions WHERE id = $1', [id])).rows[0].data;
    expect(stored.label).toBe('v2');
  });

  it('settings and decisions work the same way', async () => {
    const decision = {
      id: uuid(),
      updatedAt: '2026-01-01T00:00:00.000Z',
      deleted: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      afterSessionId: null,
      body: { kind: 'set_tm', lift: 'squat', tm: 150 },
    };
    const r1 = (await post({ settings: { id: 'settings', updatedAt: '2026-01-01T00:00:00.000Z', microplates: false }, decisions: [decision] })).json();
    expect(r1.accepted).toMatchObject({ settings: 1, decisions: 1 });
    const r2 = (await post({ settings: { id: 'settings', updatedAt: '2025-12-31T00:00:00.000Z', microplates: true }, decisions: [decision] })).json();
    expect(r2.accepted).toMatchObject({ settings: 0, decisions: 0 });
    const pulled = (await get('/api/sync')).json();
    expect(pulled.settings.find((s: { id: string }) => s.id === 'settings').microplates).toBe(false);
  });

  it('is atomic: one bad record rejects the whole request', async () => {
    const good = session();
    const r = await post({ sessions: [good, { id: 'not-a-uuid', updatedAt: '2026-01-01T00:00:00.000Z' }] });
    expect(r.statusCode).toBe(400);
    const n = (await pool.query('SELECT count(*)::int AS n FROM bulletproof.sessions WHERE id = $1', [good.id])).rows[0].n;
    expect(n).toBe(0);
  });

  it('rejects malformed payloads with 400', async () => {
    const asJson = (body: string) => app.inject({ method: 'POST', url: '/api/sync', headers: { ...auth, 'content-type': 'application/json' }, payload: body });
    expect((await asJson('"nope"')).statusCode).toBe(400);
    expect((await asJson('[1,2]')).statusCode).toBe(400);
    expect((await asJson('{bad json')).statusCode).toBe(400);
    expect((await post('nope')).statusCode).toBe(415);
    expect((await post({ sessions: 'x' })).statusCode).toBe(400);
    expect((await post({ sessions: [{ id: uuid() }] })).statusCode).toBe(400);
    expect((await post({ sessions: [{ id: uuid(), updatedAt: 'yesterday' }] })).statusCode).toBe(400);
    expect((await get('/api/sync?since=garbage')).statusCode).toBe(400);
  });

  it('clamps an updatedAt far in the future so a wrong phone clock cannot pin a record', async () => {
    const id = uuid();
    await post({ sessions: [session({ id, updatedAt: '2099-01-01T00:00:00.000Z' })] });
    const t = (await pool.query('SELECT updated_at FROM bulletproof.sessions WHERE id = $1', [id])).rows[0].updated_at as Date;
    expect(t.getTime()).toBeLessThan(Date.now() + 2 * 86_400_000);
  });
});

describe('pull', () => {
  it('returns records accepted after `since`, plus a server time to use next', async () => {
    const before = (await get('/api/sync')).json().serverTime as string;
    const s = session({ label: 'after-cursor' });
    await post({ sessions: [s] });
    const r = (await get(`/api/sync?since=${encodeURIComponent(before)}`)).json();
    expect(idsOf(r.sessions)).toContain(s.id);
    const next = (await get(`/api/sync?since=${encodeURIComponent(r.serverTime)}`)).json();
    expect(idsOf(next.sessions)).not.toContain(s.id);
  });

  it('a record edited offline long ago still reaches a device that already pulled', async () => {
    const cursor = (await get('/api/sync')).json().serverTime as string; // device B pulled here
    const stale = session({ updatedAt: '2025-06-01T00:00:00.000Z', label: 'edited-offline' }); // device A pushes later
    await post({ sessions: [stale] });
    const r = (await get(`/api/sync?since=${encodeURIComponent(cursor)}`)).json();
    expect(idsOf(r.sessions)).toContain(stale.id);
  });
});

describe('22. tombstones round-trip', () => {
  it('a deleted session is stored and a fresh client pulls it as deleted', async () => {
    const s = session({ deleted: true, updatedAt: '2026-03-01T00:00:00.000Z' });
    await post({ sessions: [s] });
    const row = (await pool.query('SELECT deleted FROM bulletproof.sessions WHERE id = $1', [s.id])).rows[0];
    expect(row.deleted).toBe(true);
    const full = (await get('/api/sync')).json(); // fresh client: no `since`
    expect(full.sessions.find((x: { id: string }) => x.id === s.id).deleted).toBe(true);
  });

  it('delete after create replaces the live record with its tombstone', async () => {
    const id = uuid();
    await post({ sessions: [session({ id, updatedAt: '2026-01-01T00:00:00.000Z' })] });
    await post({ sessions: [session({ id, updatedAt: '2026-01-02T00:00:00.000Z', deleted: true })] });
    const back = (await get('/api/sync')).json().sessions.find((x: { id: string }) => x.id === id);
    expect(back.deleted).toBe(true);
  });
});
