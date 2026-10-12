// Resuming a workout whose sets are all ticked must not finish it behind your back (it may be stale); only a tap does.
import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true })).newPage();
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
await page.getByRole('button', { name: 'Start workout' }).click();
await page.getByRole('button', { name: /^Squat/ }).waitFor();
await page.getByRole('button', { name: /Home/ }).click();
await page.waitForTimeout(500);

// Everything ticked and every tracked lift rated, but never finished (as when the app was closed at the very end).
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
          if (s.finishedAt !== null || s.abandonedAt) continue;
          const lifts = s.lifts.map((l) => ({
            ...l,
            pain: { rating: 1, sharp: false },
            sets: l.sets.map((x) => (['work', 'amrap', 'supplemental', 'accessory'].includes(x.type) ? { ...x, done: true, reps: x.targetReps } : x)),
          }));
          store.put({ ...s, lifts });
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
await page.getByRole('button', { name: /Resume workout/ }).click();
await page.getByRole('button', { name: /^Squat/ }).waitFor();
await page.waitForTimeout(4000); // longer than the 2-second popup
check('opening an already-complete workout does not pop up "Workout complete" or leave by itself', (await page.getByText('Workout complete! 🎉').count()) === 0 && (await page.getByRole('button', { name: 'Finish workout' }).isVisible()));
const stillDraft = await page.evaluate(() => new Promise((res) => { const o = indexedDB.open('bulletproof'); o.onsuccess = () => { const r = o.result.transaction('sessions').objectStore('sessions').getAll(); r.onsuccess = () => res(r.result.filter((s) => s.finishedAt === null && !s.abandonedAt).length); }; }));
check('...and it was not finished in the background', stillDraft === 1);

// a deliberate change then completes it as usual
await page.getByRole('button', { name: /^Squat/ }).click();
const firstCheck = page.locator('.card', { hasText: 'Squat' }).getByRole('button', { name: /^Complete set/ }).first();
await firstCheck.click(); // un-tick
await page.waitForTimeout(400);
await firstCheck.click(); // tick again
await page.getByText('Workout complete! 🎉').waitFor({ timeout: 4000 });
check('ticking the last set during this visit finishes it as usual', true);
await page.getByRole('button', { name: 'Workout calendar' }).waitFor({ timeout: 6000 });
check('...and returns to Home', true);

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
