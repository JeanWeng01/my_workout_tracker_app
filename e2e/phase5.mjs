// Phase 5 headless test: calendar, past-session edit/delete, settings, CSV, backup + restore.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, acceptDownloads: true });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: () => false })); // force the download path
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
};
const shot = (n) => page.screenshot({ path: `shots/${n}.png` });

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const ym = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const day = (d) => `${ym}-${pad(d)}`;
const todayN = now.getDate();
const dA = todayN === 2 ? 3 : 2; // finished
const dB = todayN === 4 ? 5 : 4; // abandoned
const monthDay = (d) => new Date(`${day(d)}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

await page.goto(URL);
await page.getByText('Ego lifts').waitFor();

// Seed history straight into IndexedDB (a finished and an abandoned workout on different days).
await page.evaluate(
  async ({ dA, dB, fin, aband }) => {
    const sets = (w, done) => Array.from({ length: 5 }, () => ({ type: 'work', targetWeight: w, targetReps: 5, weight: w, reps: done ? 5 : 0, done }));
    const base = { updatedAt: new Date().toISOString(), deleted: false, schemaVersion: 1, phase: 'linear', label: 'Workout A', dirty: 1,
      rules: { microplates: false, retriesBeforeDeload: 3, deloadPercent: 0.1, tmPercent: 0.85, barWeights: { squat: 45, bench: 45, row: 45, ohp: 45, deadlift: 45 } } };
    const finished = { ...base, id: 'seed-fin', date: dA, finishedAt: fin, lifts: [{ lift: 'squat', scheme: '5x5', skipped: false, sets: sets(65, true) }] };
    const abandoned = { ...base, id: 'seed-ab', date: dB, finishedAt: null, abandonedAt: aband, lifts: [{ lift: 'bench', scheme: '5x5', skipped: false, sets: sets(45, true) }] };
    await new Promise((res, rej) => {
      const open = indexedDB.open('bulletproof');
      open.onsuccess = () => {
        const tx = open.result.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put(finished);
        tx.objectStore('sessions').put(abandoned);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      };
      open.onerror = () => rej(open.error);
    });
  },
  { dA: day(dA), dB: day(dB), fin: `${day(dA)}T18:00:00.000Z`, aband: `${day(dB)}T18:00:00.000Z` },
);
await page.reload();
await page.getByRole('heading', { name: /Workout/ }).waitFor();
check('after seeding, squat is planned at 70', await page.getByText('70', { exact: true }).first().isVisible());

// Calendar
await page.getByRole('button', { name: 'Workout calendar' }).click();
check('calendar shows Total workouts: 1', await page.getByText('Total workouts: 1').isVisible());
check('finished day labelled', (await page.getByRole('button', { name: `${monthDay(dA)}, 1 workout` }).count()) === 1);
check('unfinished day labelled', (await page.getByRole('button', { name: `${monthDay(dB)}, workout unfinished` }).count()) === 1);
check('unfinished day is not tappable', await page.getByRole('button', { name: `${monthDay(dB)}, workout unfinished` }).isDisabled());
await shot('10-calendar');

// Open the finished day, undo a set, go back: plan should change and say so.
await page.getByRole('button', { name: `${monthDay(dA)}, 1 workout` }).click();
await page.getByRole('button', { name: /Delete workout/ }).waitFor();
check('past session opens editable', true);
await page.getByRole('button', { name: /Squat/ }).click();
await page.getByRole('button', { name: /Complete set/ }).first().click();
await shot('11-past-edit');
await page.getByRole('button', { name: 'Done' }).click();
await page.getByText('Plan updated from your history edit.').waitFor();
check('history edit shows "Plan updated" notice', true);
check('squat plan went back to 65', await page.getByText('65', { exact: true }).first().isVisible());
await page.getByRole('button', { name: 'OK' }).click();

// Delete it
await page.getByRole('button', { name: 'Workout calendar' }).click();
await page.getByRole('button', { name: `${monthDay(dA)}, 1 workout` }).click();
await page.getByRole('button', { name: 'Delete workout' }).click();
await page.getByText('Delete this workout?').waitFor();
await page.getByRole('button', { name: 'Delete workout' }).click();
await page.getByRole('button', { name: 'Workout calendar' }).waitFor();
await page.getByRole('button', { name: 'Workout calendar' }).click();
check('total workouts back to 0', await page.getByText('Total workouts: 0').isVisible());
await page.getByRole('button', { name: 'Workout calendar' }).click();

// Settings
await page.getByRole('button', { name: 'Settings' }).click();
await page.getByRole('heading', { name: 'Settings' }).waitFor();
await shot('12-settings');
const settingsText = await page.locator('body').innerText();
check('microplate toggle present while off', settingsText.includes('1.25 lb microplates'));
await page.getByRole('button', { name: 'Off' }).click();
check('microplate toggle turns on', await page.getByRole('button', { name: 'On', exact: true }).isVisible());
await page.getByRole('button', { name: 'On', exact: true }).click();

// CSV
const [csvDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
check('CSV filename pattern', /^bulletproof_export_\d{4}-\d{2}-\d{2}\.csv$/.test(csvDl.suggestedFilename()));
const csv = readFileSync(await csvDl.path(), 'utf8');
check('CSV has BOM and header', csv.startsWith('\uFEFFdate,session_id,session_label'));

// Backup + restore round trip
const [bkDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup (JSON)' }).click()]);
check('backup filename pattern', /^bulletproof_backup_\d{4}-\d{2}-\d{2}\.json$/.test(bkDl.suggestedFilename()));
const bkPath = await bkDl.path();
const bk = JSON.parse(readFileSync(bkPath, 'utf8'));
check('backup includes the abandoned session', bk.sessions.some((s) => s.id === 'seed-ab'));

await page.setInputFiles('input[type=file]', { name: 'junk.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') });
check('junk backup rejected, nothing changed', await page.getByText("Nothing was changed").isVisible());
await page.setInputFiles('input[type=file]', bkPath);
await page.getByText(/Restoring replaces everything/).waitFor();
await page.getByRole('button', { name: 'Replace my data' }).click();
await page.getByText('Backup restored.').waitFor();
check('restore succeeds', true);

// About the rules: must not mention microplate stuff while the toggle is off
await page.getByRole('button', { name: 'Off' }).count();
await page.getByRole('button', { name: 'About the rules' }).click();
const about = await page.locator('body').innerText();
check('About the rules renders', about.includes('The big idea'));
check('About the rules never mentions 1.25', !about.includes('1.25'));
await shot('13-about');

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
