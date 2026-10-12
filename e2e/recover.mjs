// A workout that was left unfinished (yellow day) can be opened from the calendar, edited and finished.
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
const shot = (n) => page.screenshot({ path: `shots/${n}.png` });
let home;
const text = () => page.locator('body').innerText();

const DAYS_AGO = 2; // "Saturday", found again on Monday
const pad = (n) => String(n).padStart(2, '0');
const then = new Date(Date.now() - DAYS_AGO * 86_400_000);
const thenDate = `${then.getFullYear()}-${pad(then.getMonth() + 1)}-${pad(then.getDate())}`;
const dayName = then.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

await page.goto(URL);
await page.getByText('Ego lifts').waitFor();

// ---- Saturday: do most of a workout, never press Finish
await page.getByRole('button', { name: 'Start workout' }).click();
await page.getByRole('button', { name: /^Squat/ }).click();
for (const c of await page.locator('.card', { hasText: 'Squat' }).getByRole('button', { name: /^Complete set/ }).all()) await c.click();
await page.waitForTimeout(600);

// ...and it is now two days later: the draft is old, and it is dated Saturday
await page.evaluate(
  async ({ thenDate, daysAgo }) => {
    await new Promise((res, rej) => {
      const open = indexedDB.open('bulletproof');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('sessions', 'readwrite');
        const store = tx.objectStore('sessions');
        const all = store.getAll();
        all.onsuccess = () => {
          for (const s of all.result) {
            if (s.finishedAt === null && !s.abandonedAt) store.put({ ...s, date: thenDate, updatedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString() });
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
  },
  { thenDate, daysAgo: DAYS_AGO },
);
await page.reload();
await page.getByText('Ego lifts').waitFor();
await page.getByRole('heading', { name: /Workout/ }).waitFor();
check('two days later Home says the workout was left unfinished', await page.getByText('Last workout was left unfinished').waitFor({ timeout: 4000 }).then(() => true).catch(() => false));

// ---- Open it from the calendar
await page.getByRole('button', { name: 'Workout calendar' }).click();
const monthLabel = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
if (!(await page.getByText(monthLabel).isVisible())) await page.getByRole('button', { name: 'Next month' }).click();
if (then.getMonth() !== new Date().getMonth()) await page.getByRole('button', { name: 'Previous month' }).click();
const yellow = page.getByRole('button', { name: new RegExp(`^${dayName}, workout unfinished`) });
check('the yellow day is there and it is no longer disabled', (await yellow.count()) === 1 && !(await yellow.isDisabled()));
await shot('50-calendar-yellow');
await yellow.click();
await page.getByText('This workout was left unfinished.').waitFor();
check('it opens, with a banner saying what to do', true);
check('...its cards start collapsed; opening one shows its warm-up sets and sets', (await page.getByRole('button', { name: /^Complete set/ }).count()) === 0);
await page.getByRole('button', { name: /^Squat/ }).click();
check('...the opened card has its warm-up sets showing and its sets editable', (await page.locator('.warm-row').first().isVisible()) && (await page.getByRole('button', { name: /^Complete set/ }).count()) === 5);
check('...with Finish workout, and no "Can\'t finish today"', (await page.getByRole('button', { name: 'Finish workout' }).isVisible()) && (await page.getByRole('button', { name: "Can't finish today" }).count()) === 0);
check('the sets that were done are still green', (await page.locator('.card', { hasText: 'Squat' }).getByRole('button', { name: /^Complete set/ }).evaluateAll((els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').length)) === 5);
await shot('51-recovered');

// ---- Edit it: tap a set that was missed, then finish
await page.getByRole('button', { name: /^DB Floor Press/ }).click();
const press = page.locator('.card', { hasText: 'DB Floor Press' });
await press.getByRole('button', { name: /^Complete set/ }).first().click();
await page.waitForFunction(() => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('DB Floor Press'))?.querySelector('button[aria-label^="Complete set"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 3000 });
check('a set can be ticked in the old workout', true);

await page.getByRole('button', { name: 'Finish workout' }).click();
// the shoulder rating comes first for a tracked lift that was worked
const dialog = page.getByRole('dialog', { name: 'Shoulder check' });
if (await dialog.waitFor({ timeout: 2500 }).then(() => true).catch(() => false)) {
  await dialog.getByRole('button', { name: 'Shoulder 1', exact: true }).click();
  await dialog.getByRole('button', { name: /^(Next|Done)$/ }).click();
}
await page.getByText(/untouched/).waitFor({ timeout: 4000 });
check('untouched sets: count as missed, or keep it unfinished (nothing about skipping)', (await page.getByRole('button', { name: 'Count as missed reps' }).count()) === 1 && (await page.getByRole('button', { name: 'Keep it unfinished' }).count()) === 1 && (await page.getByRole('button', { name: /skip/i }).count()) === 0);
await page.getByRole('button', { name: 'Count as missed reps' }).click();
await page.getByRole('button', { name: 'Workout calendar' }).waitFor({ timeout: 6000 });

// ---- It is now a finished workout on Saturday
const stored = await page.evaluate(
  () =>
    new Promise((res, rej) => {
      const open = indexedDB.open('bulletproof');
      open.onsuccess = () => {
        const r = open.result.transaction('sessions').objectStore('sessions').getAll();
        r.onsuccess = () => res(r.result);
      };
      open.onerror = () => rej(open.error);
    }),
);
const rec = stored.find((s) => s.date === thenDate);
check('it is finished, no longer "unfinished", and marked for syncing', !!rec.finishedAt && !rec.abandonedAt && rec.dirty === 1);
check('...and it counts on Saturday (end of that day), not on the day it was recovered', rec.finishedAt === new Date(`${thenDate}T23:59:00`).toISOString());
home = await text();
check('Home no longer says it was left unfinished', !home.includes('Last workout was left unfinished'));
check('the next workout moved on to B', /Workout B/.test(home));
await page.getByRole('button', { name: 'Workout calendar' }).click();
if (then.getMonth() !== new Date().getMonth()) await page.getByRole('button', { name: 'Previous month' }).click();
check('the day is green now, and counted in the total', (await page.getByRole('button', { name: new RegExp(`^${dayName}, 1 workout`) }).count()) === 1 && (await page.getByText('Total workouts: 1').isVisible()));
check('no yellow day is left', (await page.locator('.cal-day.unfinished').count()) === 0);
await shot('52-green');

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);


