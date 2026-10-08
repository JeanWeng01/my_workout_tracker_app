// The upgrade path: a phone that already holds Day 1 (old data format) opens the new app.
import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, acceptDownloads: true });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: () => false }));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
};
const text = () => page.locator('body').innerText();

// Open once so the database exists, then replace its contents with the OLD app's data (schema 1, no shoulder fields).
await page.goto(URL);
await page.getByText('Ego lifts').waitFor();
await page.waitForTimeout(800);

const DAY1 = await page.evaluate(async () => {
  const sets = (w) => Array.from({ length: 5 }, () => ({ type: 'work', targetWeight: w, targetReps: 5, weight: w, reps: 5, done: true }));
  const day1 = {
    id: '7d3a0c9e-1b2f-4c55-9a11-0f6f2a8f1a01',
    updatedAt: '2026-10-07T20:00:00.000Z',
    deleted: false,
    schemaVersion: 1,
    date: '2026-10-07',
    finishedAt: '2026-10-07T20:00:00.000Z',
    phase: 'linear',
    label: 'Workout A',
    notes: 'Felt my shoulder on the bench.',
    rules: { microplates: false, retriesBeforeDeload: 3, deloadPercent: 0.1, tmPercent: 0.85, barWeights: { squat: 45, bench: 45, row: 45, ohp: 45, deadlift: 45 } },
    lifts: [
      { lift: 'squat', scheme: '5x5', skipped: false, sets: sets(65) },
      { lift: 'bench', scheme: '5x5', skipped: false, sets: sets(45) },
      { lift: 'row', scheme: '5x5', skipped: false, sets: sets(45) },
    ],
    dirty: 0,
  };
  // The old settings record: schema 1, none of the shoulder / rehab / accessory groups, user had tweaked the rest times.
  const oldSettings = {
    id: 'settings',
    updatedAt: '2026-10-07T19:00:00.000Z',
    deleted: false,
    schemaVersion: 1,
    unit: 'lb',
    barWeights: { squat: 45, bench: 45, row: 45, ohp: 45, deadlift: 45 },
    platesOwned: [45, 35, 25, 10, 5, 2.5],
    microplates: false,
    retriesBeforeDeload: 3,
    deloadPercent: 0.1,
    linearLayout: 'stronglifts',
    tmPercent: 0.85,
    liftsPerSession: 1,
    template: 'fsl',
    bbbPercent: 0.5,
    deloadStyle: 'forever',
    startingWeights: { squat: 65, bench: 45, row: 45, ohp: 45, deadlift: 95 },
    restSeconds: { warmup: 60, work: 120, supplemental: 90 },
    dirty: 0,
  };
  await new Promise((res, rej) => {
    const open = indexedDB.open('bulletproof');
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(['sessions', 'settings', 'decisions'], 'readwrite');
      tx.objectStore('sessions').clear();
      tx.objectStore('decisions').clear();
      tx.objectStore('sessions').put(day1);
      tx.objectStore('settings').put(oldSettings);
      tx.oncomplete = () => {
        db.close();
        res();
      };
      tx.onerror = () => rej(tx.error);
    };
    open.onerror = () => rej(open.error);
  });
  return day1;
});

const readDb = () =>
  page.evaluate(
    () =>
      new Promise((res, rej) => {
        const open = indexedDB.open('bulletproof');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['sessions', 'settings', 'decisions'], 'readonly');
          const out = {};
          let pending = 3;
          for (const name of ['sessions', 'settings', 'decisions']) {
            const r = tx.objectStore(name).getAll();
            r.onsuccess = () => {
              out[name] = r.result;
              if (--pending === 0) {
                db.close();
                res(out);
              }
            };
          }
        };
        open.onerror = () => rej(open.error);
      }),
  );

await page.reload();
await page.getByText('Ego lifts').waitFor();
await page.getByRole('heading', { name: 'Workout B' }).waitFor({ timeout: 8000 });
let home = await text();
check('after the update the next workout is B (Day 1 was A) with Seated DB OHP 2 × 12.5 lb', /Seated DB OHP 3 × 10/.test(home) && home.includes('2 × 12.5 lb'));
check('squat continues from Day 1: 70', home.includes('70'));
check('no barbell Bench or OHP is planned', !home.includes('Bench Press') && !home.includes('Overhead Press'));

let db = await readDb();
check('Day 1 is untouched, byte for byte', JSON.stringify(db.sessions.find((s) => s.id === DAY1.id)) === JSON.stringify(DAY1));
const tracks = db.decisions.filter((d) => d.body.kind === 'track_change');
check('exactly two track decisions were created: Bench -> rehab @ 15, OHP -> rehab @ 12.5', tracks.length === 2 && tracks.some((d) => d.body.lift === 'bench' && d.body.startWeight === 15) && tracks.some((d) => d.body.lift === 'ohp' && d.body.startWeight === 12.5));
check('...effective after Day 1', tracks.every((d) => d.afterSessionId === DAY1.id));
const settings = db.settings[0];
check('settings were upgraded to schema 2 with the new groups', settings.schemaVersion === 2 && settings.shoulder?.tracking === true && settings.rehab?.ladders?.db_floor_press?.[0] === 15);
check('...and the user\'s own settings survived (rest time 120 s)', settings.restSeconds.work === 120);

// Reloading never creates them again
await page.reload();
await page.getByRole('heading', { name: 'Workout B' }).waitFor();
await page.reload();
await page.getByRole('heading', { name: 'Workout B' }).waitFor();
db = await readDb();
check('reloading twice does not duplicate the migration', db.decisions.filter((d) => d.body.kind === 'track_change').length === 2);

// Calendar and CSV still show Day 1
await page.getByRole('button', { name: 'Workout calendar' }).click();
check('the calendar still counts Day 1', await page.getByText('Total workouts: 1').isVisible());
await page.getByRole('button', { name: 'Workout calendar' }).click();
await page.getByRole('button', { name: 'Settings' }).click();
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
const csv = (await import('node:fs')).readFileSync(await dl.path(), 'utf8');
const rows = csv.slice(1).split('\r\n').filter(Boolean).map((r) => r.split(','));
const benchRows = rows.filter((r) => r[4] === 'bench');
check('CSV: Day 1 barbell bench rows are still there, unchanged (5 sets, 45 lb, linear 5x5)', benchRows.length === 5 && benchRows.every((r) => r[3] === 'linear' && r[5] === '5x5' && r[10] === '45' && r[11] === '5'));
check('CSV has the new pain columns', rows[0].slice(-2).join() === 'pain_0_10,pain_sharp');
check('CSV: the Day 1 note is on the first row only', rows[1][18] === 'Felt my shoulder on the bench.' && rows.slice(2).every((r) => r[18] === ''));

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
