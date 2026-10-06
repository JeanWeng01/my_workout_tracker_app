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

describe('hardening', () => {
  it('asks search engines not to index, and sets security headers', async () => {
    const r = await app.inject({ url: '/' });
    expect(r.headers['x-robots-tag']).toContain('noindex');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });

  it('adds HSTS only behind https', async () => {
    expect((await app.inject({ url: '/' })).headers['strict-transport-security']).toBeUndefined();
    const r = await app.inject({ url: '/', headers: { 'x-forwarded-proto': 'https' } });
    expect(r.headers['strict-transport-security']).toContain('max-age');
  });

  it('turns a caller away after too many wrong tokens, but not other callers', async () => {
    const bad = { authorization: 'Bearer nope', 'x-forwarded-for': '203.0.113.9' };
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await app.inject({ url: '/api/sync', headers: bad })).statusCode;
    expect(last).toBe(429);
    // the real token from the same address is also paused until the window passes
    expect((await app.inject({ url: '/api/sync', headers: { ...auth, 'x-forwarded-for': '203.0.113.9' } })).statusCode).toBe(429);
    // a different caller is unaffected
    expect((await app.inject({ url: '/api/sync', headers: { ...auth, 'x-forwarded-for': '198.51.100.7' } })).statusCode).toBe(200);
  });
});
