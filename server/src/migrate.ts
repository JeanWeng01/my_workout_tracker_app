import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

export const SCHEMA = 'bulletproof';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_DIR = join(here, '..', 'migrations');

/**
 * Safety net for a database shared with other projects: a migration may only touch the
 * bulletproof schema. Returns a list of problems (empty = fine).
 */
export function lintMigration(sql: string): string[] {
  const problems: string[] = [];
  const code = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  if (/\b(create|alter|drop)\s+schema\b/i.test(code)) problems.push('migrations must not create, alter or drop schemas (the runner owns that)');
  if (/\bset\s+(local\s+)?search_path\b/i.test(code)) problems.push('migrations must not change search_path');
  if (/\b(public|pg_catalog|information_schema)\s*\./i.test(code)) problems.push('migrations must not reference other schemas');
  if (/\btruncate\b/i.test(code)) problems.push('migrations must not TRUNCATE');
  if (/\b(create|alter|drop)\s+(extension|role|user|database)\b/i.test(code)) problems.push('migrations must not manage extensions, roles or databases');

  // Every table/view/sequence/type/function must be explicitly schema-qualified with bulletproof.
  const obj = /\b(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:temp(?:orary)?\s+)?(table|view|materialized\s+view|sequence|type|function)\s+(?:if\s+(?:not\s+)?exists\s+)?("?[\w]+"?(?:\."?[\w]+"?)?)/gi;
  for (const m of code.matchAll(obj)) {
    if (!new RegExp(`^"?${SCHEMA}"?\\.`, 'i').test(m[2])) problems.push(`${m[1]} ${m[2]} is not qualified with ${SCHEMA}.`);
  }
  // Indexes and ALTER/INSERT targets named after ON / INTO / UPDATE / FROM must be ours too.
  const target = /\b(?:on|into|update|from|references)\s+("?[\w]+"?(?:\."?[\w]+"?)?)/gi;
  for (const m of code.matchAll(target)) {
    const name = m[1].replace(/"/g, '').toLowerCase();
    if (['conflict', 'delete', 'update', 'cascade', 'set', 'null'].includes(name)) continue;
    if (!name.startsWith(`${SCHEMA}.`)) problems.push(`reference to ${m[1]} is not qualified with ${SCHEMA}.`);
  }
  return problems;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/** Applies pending .sql files in order, each in its own transaction, recording them in bulletproof.schema_migrations. */
export async function migrate(pool: Pool, dir = DEFAULT_MIGRATIONS_DIR, log: (m: string) => void = () => {}): Promise<MigrationResult> {
  const files = readdirSync(dir).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
  const contents = new Map(files.map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
  for (const [f, sql] of contents) {
    const problems = lintMigration(sql);
    if (problems.length) throw new Error(`Refusing to run ${f}: ${problems.join('; ')}`);
  }

  const client = await pool.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    // One migrator at a time (e.g. two instances starting together).
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [`${SCHEMA}-migrate`]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query<{ name: string }>(`SELECT name FROM ${SCHEMA}.schema_migrations`)).rows.map((r) => r.name));

    for (const f of files) {
      if (done.has(f)) {
        result.skipped.push(f);
        continue;
      }
      log(`applying ${f}`);
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL search_path TO ${SCHEMA}`);
        await client.query(contents.get(f)!);
        await client.query(`INSERT INTO ${SCHEMA}.schema_migrations (name) VALUES ($1)`, [f]);
        await client.query('COMMIT');
        result.applied.push(f);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`${SCHEMA}-migrate`]).catch(() => {});
    client.release();
  }
  return result;
}
