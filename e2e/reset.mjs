// No skipping a lift, and a workout that isn't finished within 12 hours resets to be redone in whole.
import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
};

await page.goto(URL);
await page.getByText('Ego lifts').waitFor();

// ---- there is no way to skip a lift
await page.getByRole('button', { name: 'Start workout' }).click();
await page.getByRole('button', { name: /^Squat/ }).click();
await page.getByRole('button', { name: /^DB Floor Press/ }).click();
check('no "Skip lift" button on any expanded card', (await page.getByRole('button', { name: /skip lift/i }).count()) === 0);
check('no "Undo skip" either', (await page.getByRole('button', { name: /undo skip/i }).count()) === 0);

// finish with only squat done: the choices are "count as missed" or "leave unfinished", nothing about skipping
for (const c of await page.locator('.card', { hasText: 'Squat' }).getByRole('button', { name: /^Complete set/ }).all()) await c.click();
await page.getByRole('button', { name: 'Finish workout' }).click();
const dialogText = await page.locator('body').innerText();
check('Finish asks: count as missed reps, or leave unfinished', dialogText.includes('Count them as missed reps, or leave this workout unfinished and redo it from the start?'));
check('...with exactly those two buttons and no skip option', (await page.getByRole('button', { name: 'Count as missed reps' }).count()) === 1 && (await page.getByRole('button', { name: 'Leave unfinished' }).count()) === 1 && (await page.getByRole('button', { name: /skip/i }).count()) === 0);
await page.getByRole('button', { name: 'Back' }).click();

// ---- 12 hours later the workout has reset
await page.waitForTimeout(500); // let the last tap autosave
await page.evaluate(async () => {
  await new Promise((res, rej) => {
    const open = indexedDB.open('bulletproof');
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('sessions', 'readwrite');
      const store = tx.objectStore('sessions');
      const all = store.getAll();
      all.onsuccess = () => {
        for (const s of all.result) {
          if (s.finishedAt === null && !s.abandonedAt) store.put({ ...s, updatedAt: new Date(Date.now() - 13 * 3_600_000).toISOString() });
        }
      };
      tx.oncomplete = () => {
        db.close();
        res();
      };
      tx.onerror = () => rej(tx.error);
    };
    open.onerror = () => rej(open.error);
  });
});
await page.reload();
await page.getByText('Ego lifts').waitFor();
await page.getByRole('heading', { name: /Workout/ }).waitFor();
const home = await page.locator('body').innerText();
check('after 12+ hours the workout is not resumable any more (Start, not Resume)', (await page.getByRole('button', { name: 'Start workout' }).count()) === 1 && (await page.getByRole('button', { name: 'Resume workout' }).count()) === 0);
check('Home says it will be redone from the top', home.includes('Last workout was left unfinished. Starting it over from the top.'));
check('the same workout is next, in whole', /Workout A/.test(home));
await page.getByRole('button', { name: 'Workout calendar' }).click();
check('the day shows as unfinished (yellow) on the calendar', (await page.locator('.cal-day.unfinished').count()) === 1);
check('and it does not count as a finished workout', await page.getByText('Total workouts: 0').isVisible());
await page.getByRole('button', { name: 'Workout calendar' }).click();

// ---- redone in whole: a fresh draft, nothing carried over
await page.getByRole('button', { name: 'Start workout' }).click();
await page.getByRole('button', { name: /^Squat/ }).click();
const pressed = await page.getByRole('button', { name: /^Complete set/ }).evaluateAll((els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').length);
check('the redo starts clean: no set carried over', pressed === 0);

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
