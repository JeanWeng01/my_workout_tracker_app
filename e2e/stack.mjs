// Local stack for end-to-end tests: real embedded Postgres + the built server + the built client.
// Usage: npm run build, then `node e2e/stack.mjs` (leave it running). Serves http://localhost:3100.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import EmbeddedPostgres from '../node_modules/embedded-postgres/dist/index.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const { default: pg } = await import(pathToFileURL(join(root, 'node_modules/pg/lib/index.js')).href);
const { buildApp } = await imp('server/dist/app.js');
const { migrate } = await imp('server/dist/migrate.js');

const dir = mkdtempSync(join(tmpdir(), 'bulletproof-e2e-pg-'));
const db = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port: 54329, persistent: false, onLog: () => {}, onError: () => {} });
await db.initialise();
await db.start();

const pool = new pg.Pool({ connectionString: 'postgres://postgres:postgres@localhost:54329/postgres' });
await migrate(pool);
const app = await buildApp({ pool, syncToken: 'e2e-token-e2e-token-e2e-token', clientDist: join(root, 'client/dist') });
await app.listen({ port: 3100, host: '0.0.0.0' });
console.log('stack ready on http://localhost:3100');

const stop = async () => {
  await app.close();
  await pool.end();
  await db.stop();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
