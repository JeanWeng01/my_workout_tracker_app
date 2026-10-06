import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, freshApp } from './helpers.js';

let app: FastifyInstance;
let pool: Pool;
beforeAll(async () => {
  const dist = mkdtempSync(join(tmpdir(), 'dist-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Bulletproof</title>');
  writeFileSync(join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(dist, 'sw.js'), '// service worker');
  ({ app, pool } = await freshApp({ clientDist: dist }));
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('serving the client', () => {
  it('serves index.html at / without caching', async () => {
    const r = await app.inject({ url: '/' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Bulletproof');
    expect(r.headers['cache-control']).toBe('no-cache');
  });

  it('caches hashed assets for a year, but never the service worker', async () => {
    expect((await app.inject({ url: '/assets/app-abc123.js' })).headers['cache-control']).toContain('immutable');
    expect((await app.inject({ url: '/sw.js' })).headers['cache-control']).toBe('no-cache');
  });

  it('falls back to index.html for app routes, but never for /api', async () => {
    const spa = await app.inject({ url: '/some/route' });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain('Bulletproof');
    const api = await app.inject({ url: '/api/missing', headers: auth });
    expect(api.statusCode).toBe(404);
    expect(api.headers['content-type']).toContain('json');
  });
});
