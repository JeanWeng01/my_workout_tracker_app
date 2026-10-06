import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildApp } from './app.js';
import { migrate } from './migrate.js';

const here = dirname(fileURLToPath(import.meta.url));

const databaseUrl = process.env.DATABASE_URL;
const syncToken = process.env.SYNC_TOKEN;
const port = Number(process.env.PORT ?? 3000);
const clientDist = process.env.CLIENT_DIST ?? join(here, '..', '..', 'client', 'dist');

if (!databaseUrl) throw new Error('DATABASE_URL is not set');
if (!syncToken) throw new Error('SYNC_TOKEN is not set');
if (syncToken.length < 24) throw new Error('SYNC_TOKEN is too short: use at least 24 random characters');

const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
pool.on('error', (e) => console.error('postgres pool error', e.message));

// Creates the "bulletproof" schema and its tables; touches nothing else in the database.
const result = await migrate(pool, undefined, (m) => console.log(`[migrate] ${m}`));
console.log(`[migrate] applied ${result.applied.length}, already applied ${result.skipped.length}`);

const app = await buildApp({ pool, syncToken, clientDist, logger: true });
await app.listen({ port, host: '0.0.0.0' });

const stop = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
