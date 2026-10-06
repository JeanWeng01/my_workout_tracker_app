import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { bearerMatches, FailureLimiter } from './auth.js';
import { BadRequest, pull, push } from './sync.js';

export interface AppOptions {
  pool: Pool;
  syncToken: string;
  /** Built client (client/dist). Omitted in API-only tests. */
  clientDist?: string;
  logger?: boolean;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  if (!opts.syncToken) throw new Error('SYNC_TOKEN is required');
  // Behind Railway's proxy: take the caller's address from X-Forwarded-For.
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 10 * 1024 * 1024, trustProxy: true });

  // Keep search engines out and lock the page down. None of this affects the app itself.
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (req.headers['x-forwarded-proto'] === 'https') reply.header('Strict-Transport-Security', 'max-age=31536000');
  });

  const limiter = new FailureLimiter(30, 15 * 60_000);

  app.get('/api/health', async () => ({ ok: true }));

  // Everything else under /api needs the sync token.
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/') || path === '/api/health') return;
    if (limiter.blocked(req.ip)) return reply.code(429).header('Retry-After', '900').send({ error: 'too many failed attempts' });
    if (!bearerMatches(req.headers.authorization, opts.syncToken)) {
      limiter.fail(req.ip);
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: 'unauthorized' });
    }
  });

  app.get('/api/sync', async (req, reply) => {
    try {
      return await pull(opts.pool, (req.query as { since?: string }).since);
    } catch (e) {
      if (e instanceof BadRequest) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

  app.post('/api/sync', async (req, reply) => {
    try {
      return await push(opts.pool, req.body);
    } catch (e) {
      if (e instanceof BadRequest) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

  app.get('/api/*', async (_req, reply) => reply.code(404).send({ error: 'not found' }));

  if (opts.clientDist && existsSync(opts.clientDist)) {
    await app.register(fastifyStatic, {
      root: opts.clientDist,
      wildcard: false,
      // Hashed assets never change; everything else (index.html, service worker, manifest) must stay fresh.
      setHeaders(res, path) {
        const hashed = /[\\/]assets[\\/]/.test(path);
        res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    // Single-page app: any other GET serves index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html', join(opts.clientDist!));
    });
  }

  return app;
}
