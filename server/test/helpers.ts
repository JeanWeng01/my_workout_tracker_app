import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';

export const TOKEN = 'test-token-test-token-test-token';
export const auth = { authorization: `Bearer ${TOKEN}` };

/** A fresh, empty database per test file, so tests never see each other's data. */
export async function freshDb() {
  const admin = new pg.Pool({ connectionString: process.env.TEST_PG_URL, max: 1 });
  const name = `t_${randomUUID().replace(/-/g, '')}`;
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = process.env.TEST_PG_URL!.replace(/\/postgres$/, `/${name}`);
  return new pg.Pool({ connectionString: url, max: 4 });
}

export async function freshApp(opts: { clientDist?: string } = {}) {
  const pool = await freshDb();
  await migrate(pool);
  const app = await buildApp({ pool, syncToken: TOKEN, ...opts });
  return { app, pool };
}

export const uuid = () => randomUUID();

export const session = (over: Record<string, unknown> = {}) => ({
  id: uuid(),
  updatedAt: '2026-01-01T10:00:00.000Z',
  deleted: false,
  schemaVersion: 1,
  date: '2026-01-01',
  finishedAt: '2026-01-01T10:00:00.000Z',
  phase: 'linear',
  label: 'Workout A',
  lifts: [],
  ...over,
});
