// A workout in progress that was planned from older history: Home says so and offers to start over.
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
await page.getByRole('button', { name: /^Squat/ }).click();
check('a fresh workout in progress does not trigger the banner', true);
await page.getByRole('button', { name: /Home/ }).click();
await page.getByRole('button', { name: 'Resume workout' }).waitFor();
check('no out-of-date banner when the plan has not changed', (await page.getByText(/planned before your history changed/).count()) === 0);

// Pretend the plan changed under it: the draft was planned with squat at 60 and one set ticked.
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
          const lifts = s.lifts.map((l, i) => (i !== 0 ? l : { ...l, sets: l.sets.map((x, j) => (x.type === 'work' ? { ...x, targetWeight: 60, weight: 60, done: j === l.sets.findIndex((y) => y.type === 'work'), reps: j === l.sets.findIndex((y) => y.type === 'work') ? 5 : 0 } : x)) }));
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
await page.getByText(/planned before your history changed/).waitFor({ timeout: 5000 });
check('a workout planned from older numbers is flagged on Home', true);
check('...with Start over and Keep going', (await page.getByRole('button', { name: 'Start over' }).count()) === 1 && (await page.getByRole('button', { name: 'Keep going' }).count()) === 1);

await page.getByRole('button', { name: 'Keep going' }).click();
check('Keep going dismisses the banner and keeps the workout', (await page.getByText(/planned before your history changed/).count()) === 0 && (await page.getByRole('button', { name: 'Resume workout' }).count()) === 1);

await page.reload();
await page.getByText(/planned before your history changed/).waitFor({ timeout: 5000 });
await page.getByRole('button', { name: 'Start over' }).click();
check('it has sets ticked, so starting over asks first', (await page.getByText(/clears the sets you have ticked/).count()) === 1);
await page.getByRole('button', { name: 'Yes, start over' }).click();
await page.getByRole('button', { name: 'Start workout' }).waitFor({ timeout: 4000 });
check('after starting over there is no workout in progress', (await page.getByRole('button', { name: 'Resume workout' }).count()) === 0 && (await page.getByText(/planned before your history changed/).count()) === 0);
await page.getByRole('button', { name: 'Start workout' }).click();
await page.getByRole('button', { name: /^Squat/ }).click();
check('the new workout is planned from the current history (squat 65, nothing ticked)', (await page.locator('.card', { hasText: 'Squat' }).locator('.card-weight').innerText()) === '65' && (await page.getByRole('button', { name: /^Complete set/ }).evaluateAll((e) => e.filter((x) => x.getAttribute('aria-pressed') === 'true').length)) === 0);

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
