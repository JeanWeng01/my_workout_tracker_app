// Editing a finished workout opened from the calendar: cards start collapsed, and every kind of entry can be changed.
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

const pad = (n) => String(n).padStart(2, '0');
const then = new Date(Date.now() - 2 * 86_400_000);
const thenDate = `${then.getFullYear()}-${pad(then.getMonth() + 1)}-${pad(then.getDate())}`;
const dayName = then.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

await page.goto(URL);
await page.getByText('Ego lifts').waitFor();
await page.waitForTimeout(800);

// A finished Workout A as the app writes it: squat (with warm-ups), the rehab press with a shoulder rating, and the row.
await page.evaluate(
  async ({ thenDate }) => {
    const work = (w, n, reps = 5, type = 'work') => Array.from({ length: n }, () => ({ type, targetWeight: w, targetReps: reps, weight: w, reps, done: true }));
    const warm = (w, reps) => ({ type: 'warmup', targetWeight: w, targetReps: reps, weight: w, reps, done: true });
    const finishedAt = new Date(`${thenDate}T18:00:00`).toISOString();
    const session = {
      id: '11111111-2222-4333-8444-555555555555',
      updatedAt: finishedAt,
      deleted: false,
      schemaVersion: 2,
      date: thenDate,
      finishedAt,
      phase: 'linear',
      label: 'Workout A',
      lifts: [
        { lift: 'squat', scheme: '5x5', skipped: false, sets: [warm(45, 5), warm(50, 2), ...work(65, 5)] },
        { lift: 'db_floor_press', scheme: 'rehab', skipped: false, pain: { rating: 1, sharp: false }, sets: work(15, 3, 10) },
        { lift: 'row', scheme: '5x5', skipped: false, pain: { rating: 2, sharp: false }, sets: work(45, 5) },
      ],
      dirty: 0,
    };
    await new Promise((res, rej) => {
      const open = indexedDB.open('bulletproof');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').clear();
        tx.objectStore('sessions').put(session);
        tx.oncomplete = () => {
          db.close();
          res();
        };
        tx.onerror = () => rej(tx.error);
      };
      open.onerror = () => rej(open.error);
    });
  },
  { thenDate },
);
await page.reload();
await page.getByText('Ego lifts').waitFor();
await page.getByRole('button', { name: 'Workout calendar' }).waitFor();

// ---- open it from the calendar: collapsed to begin with
await page.getByRole('button', { name: 'Workout calendar' }).click();
if (then.getMonth() !== new Date().getMonth()) await page.getByRole('button', { name: 'Previous month' }).click();
await page.getByRole('button', { name: new RegExp(`^${dayName}, 1 workout`) }).click();
await page.getByRole('button', { name: 'Delete workout' }).waitFor();
check('the workout opens with its cards collapsed', (await page.locator('.card-body').count()) === 0 && (await page.getByRole('button', { name: /Complete set/ }).count()) === 0);
check('...three collapsed lift cards', (await page.locator('.card-head').count()) === 3);
await shot('60-past-collapsed');

const squat = page.locator('.card', { hasText: 'Squat' });
const waitText = (card, sel, text) => page.waitForFunction(({ card, sel, text }) => { const c = [...document.querySelectorAll('.card')].find((x) => x.textContent.includes(card)); return c && [...c.querySelectorAll(sel)].some((e) => e.textContent.trim() === text); }, { card, sel, text }, { timeout: 3000 }).then(() => true).catch(() => false);

// ---- expand one card, then edit
await page.getByRole('button', { name: /^Squat/ }).click();
check('expanding shows the sets, warm-ups already open', (await squat.getByRole('button', { name: /^Complete set/ }).count()) === 5 && (await squat.locator('.warm-row').count()) === 2);

await squat.locator('.chip').first().click(); // tapping a set opens its editor
const tapEditor = page.getByRole('dialog');
check('tapping a set opens its editor (weight and reps, each with + and −)', await tapEditor.waitFor({ timeout: 2000 }).then(() => true).catch(() => false));
await tapEditor.getByRole('button', { name: 'Reps plus' }).click(); // 5 -> 6: a rep count can go UP as well
await tapEditor.getByRole('button', { name: 'Reps minus' }).click();
await tapEditor.getByRole('button', { name: 'Reps minus' }).click(); // 5 -> 4
await tapEditor.getByRole('button', { name: 'Done' }).click();
check('...and the new reps are saved', await waitText('Squat', '.chip', '4'));
await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 2000 }).catch(() => {});

await squat.getByRole('button', { name: /^Complete set/ }).nth(1).click(); // un-green set 2
check('the check button un-does a completed set', await page.waitForFunction(() => { const c = [...document.querySelectorAll('.card')].find((x) => x.textContent.includes('Squat')); return c?.querySelectorAll('button[aria-label^="Complete set"]')[1]?.getAttribute('aria-pressed') === 'false'; }, null, { timeout: 3000 }).then(() => true).catch(() => false));
await squat.getByRole('button', { name: /^Complete set/ }).nth(1).click(); // and back
await page.waitForTimeout(300);

// the working-weight stepper must move the weight of the sets that are already done
await squat.getByRole('button', { name: 'Raise working weight' }).click();
check('the weight stepper changes the weight of completed sets (65 -> 70)', await waitText('Squat', '.weight-big', '70'));
await squat.getByRole('button', { name: 'Lower working weight' }).click();
await squat.getByRole('button', { name: 'Lower working weight' }).click();
check('...and back down (65 -> 60)', await waitText('Squat', '.weight-big', '60'));
check('...the card header shows the new weight too', (await squat.locator('.card-weight').innerText()) === '60');

// long-press a chip: edit that set's weight and reps
const chip = squat.locator('.chip').nth(2);
const box = await chip.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.waitForTimeout(700);
await page.mouse.up();
const editor = page.getByRole('dialog');
check('long-press opens the set editor', await editor.waitFor({ timeout: 2000 }).then(() => true).catch(() => false));
await editor.getByRole('button', { name: 'Weight plus' }).click();
await editor.getByRole('button', { name: 'Reps minus' }).click();
await editor.getByRole('button', { name: 'Done' }).click();
check('...and saves the new reps for that set', await waitText('Squat', '.chip', '4'));
await shot('61-past-edited');

// rehab card: the dumbbell stepper, and the shoulder rating
await page.getByRole('button', { name: /^DB Floor Press/ }).click();
const press = page.locator('.card', { hasText: 'DB Floor Press' });
await press.getByRole('button', { name: 'Raise dumbbell weight' }).click();
check('the dumbbell stepper moves the finished sets up a rung (15 -> 17.5)', await page.waitForFunction(() => [...document.querySelectorAll('.card')].find((x) => x.textContent.includes('DB Floor Press'))?.querySelector('.weight-big')?.textContent.includes('17.5'), null, { timeout: 3000 }).then(() => true).catch(() => false));
await press.getByRole('button', { name: 'Shoulder 4', exact: true }).click();
check('the shoulder rating can be changed (4 = Caution)', await page.waitForFunction(() => [...document.querySelectorAll('.card')].find((x) => x.textContent.includes('DB Floor Press'))?.textContent.includes('Caution'), null, { timeout: 3000 }).then(() => true).catch(() => false));

// everything above is saved to the record and marked for sync
const rec = await page.evaluate(() => new Promise((res) => { const o = indexedDB.open('bulletproof'); o.onsuccess = () => { const r = o.result.transaction('sessions').objectStore('sessions').getAll(); r.onsuccess = () => res(r.result[0]); }; }));
const sq = rec.lifts[0].sets.filter((s) => s.type === 'work');
check('saved: squat weights [60, 60, 65, 60, 60] and reps [4, 5, 4, 5, 5] are in the record', JSON.stringify(sq.map((x) => x.weight)) === '[60,60,65,60,60]' && JSON.stringify(sq.map((x) => x.reps)) === '[4,5,4,5,5]');
check('saved: dumbbell press at 17.5 with rating 4', rec.lifts[1].sets.every((s) => s.weight === 17.5) && rec.lifts[1].pain.rating === 4);
check('...and it is marked for syncing', rec.dirty === 1);

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
