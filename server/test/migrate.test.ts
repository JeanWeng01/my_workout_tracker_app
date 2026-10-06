import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { lintMigration, migrate } from '../src/migrate.js';
import { freshDb } from './helpers.js';

const pools: { end(): Promise<void> }[] = [];
afterAll(async () => {
  for (const p of pools) await p.end();
});

type Db = Awaited<ReturnType<typeof freshDb>>;
const tracked = async (): Promise<Db> => {
  const p = await freshDb();
  pools.push(p);
  return p;
};

const catalog = async (pool: Db) =>
  (
    await pool.query(
      `SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
        ORDER BY 1, 2`,
    )
  ).rows as { schema: string; name: string; kind: string }[];

describe('23. migrations touch only the bulletproof schema', () => {
  it('leaves other schemas, tables and data exactly as they were', async () => {
    const pool = await tracked();
    // Simulate the other project sharing this database.
    await pool.query('CREATE TABLE public.tripsheet (id int PRIMARY KEY, note text)');
    await pool.query("INSERT INTO public.tripsheet VALUES (1, 'keep me')");
    await pool.query('CREATE SCHEMA other_app');
    await pool.query('CREATE TABLE other_app.things (id int)');
    const before = (await catalog(pool)).filter((r) => r.schema !== 'bulletproof');

    const r = await migrate(pool);
    expect(r.applied).toEqual(['001_init.sql']);

    const all = await catalog(pool);
    expect(all.filter((x) => x.schema !== 'bulletproof')).toEqual(before);
    const ours = all.filter((x) => x.schema === 'bulletproof' && x.kind === 'r').map((x) => x.name);
    expect(ours).toEqual(['decisions', 'schema_migrations', 'sessions', 'settings']);
    expect((await pool.query('SELECT note FROM public.tripsheet')).rows).toEqual([{ note: 'keep me' }]);
    const inPublic = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map((x) => x.table_name);
    expect(inPublic).toEqual(['tripsheet']);
  });

  it('is idempotent: running again applies nothing', async () => {
    const pool = await tracked();
    await migrate(pool);
    const second = await migrate(pool);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['001_init.sql']);
  });

  it('rolls a failed migration back completely and records nothing', async () => {
    const pool = await tracked();
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    writeFileSync(join(dir, '001_bad.sql'), 'CREATE TABLE bulletproof.half (id int);\nSELECT 1/0;');
    await expect(migrate(pool, dir)).rejects.toThrow();
    const names = (await catalog(pool)).map((x) => `${x.schema}.${x.name}`);
    expect(names).not.toContain('bulletproof.half');
    expect((await pool.query('SELECT name FROM bulletproof.schema_migrations')).rows).toEqual([]);
  });

  it('refuses migrations that reach outside the schema, before running anything', async () => {
    const pool = await tracked();
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    writeFileSync(join(dir, '001_evil.sql'), 'CREATE TABLE bulletproof.ok (id int);\nDROP TABLE public.tripsheet;');
    await expect(migrate(pool, dir)).rejects.toThrow(/Refusing/);
    const schemas = (await pool.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'bulletproof'")).rows;
    expect(schemas).toEqual([]); // not even the schema was created
  });
});

describe('migration lint', () => {
  const bad = [
    'DROP SCHEMA public CASCADE;',
    'DROP TABLE public.users;',
    'CREATE TABLE users (id int);',
    'CREATE TABLE bulletproof.a (id int); ALTER TABLE other.b ADD COLUMN x int;',
    'INSERT INTO users VALUES (1);',
    'DELETE FROM sessions;',
    'SET search_path TO public;',
    'TRUNCATE bulletproof.sessions;',
    'CREATE EXTENSION pgcrypto;',
    'CREATE SCHEMA other;',
    'CREATE TABLE bulletproof.a (b int REFERENCES public.c(id));',
  ];
  for (const sql of bad) it(`rejects: ${sql}`, () => expect(lintMigration(sql).length).toBeGreaterThan(0));

  it('accepts qualified statements and ignores comments', () => {
    const sql = [
      '-- DROP TABLE public.x;',
      '/* DROP SCHEMA public */',
      'CREATE TABLE bulletproof.a (id int);',
      'CREATE INDEX a_idx ON bulletproof.a (id);',
      'ALTER TABLE bulletproof.a ADD COLUMN b text;',
    ].join('\n');
    expect(lintMigration(sql)).toEqual([]);
  });

  it('the real migration files pass the lint', () => {
    const dir = new URL('../migrations/', import.meta.url);
    for (const f of readdirSync(dir)) expect(lintMigration(readFileSync(new URL(f, dir), 'utf8')), f).toEqual([]);
  });
});
