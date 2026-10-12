// The real-life case, with a server: Saturday was left unfinished and synced, then recovered and finished on Monday.
// The finished version must win everywhere: after a reload, and on a phone that starts from the server's copy.
// Run against the local stack: node e2e/stack.mjs, then URL=http://localhost:3100/ node e2e/recover-sync.mjs
import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:3100/';
const TOKEN = 'e2e-token-e2e-token-e2e-token';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const errors = [];
let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
};

async function phone(label) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${label}: ${m.text()}`));
  await page.goto(URL);
  await page.getByText('Ego lifts').waitFor();
  return page;
}
const waitSynced = (page) => page.waitForFunction(() => /^Synced/.test(document.querySelector('.sync-line')?.textContent ?? ''), null, { timeout: 15000 });
const serverSessions = async () => (await (await fetch(`${URL}api/sync`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()).sessions;
async function setToken(page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Sync token').fill(TOKEN);
  await page.getByRole('button', { name: 'Save token' }).click();
  await page.getByText('Token saved on this phone.').waitFor();
  await page.getByRole('button', { name: '← Home' }).click();
  await waitSynced(page);
}

const pad = (n) => String(n).padStart(2, '0');
const then = new Date(Date.now() - 2 * 86_400_000);
const thenDate = `${then.getFullYear()}-${pad(then.getMonth() + 1)}-${pad(then.getDate())}`;
const dayName = then.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
const openDayInCalendar = async (page, re) => {
  await page.getByRole('button', { name: 'Workout calendar' }).click();
  if (then.getMonth() !== new Date().getMonth()) await page.getByRole('button', { name: 'Previous month' }).click();
  return page.getByRole('button', { name: re });
};

const A = await phone('A');
await setToken(A);

// ---- Saturday: most of a workout, never finished, and the day is two days ago
await A.getByRole('button', { name: 'Start workout' }).click();
await A.getByRole('button', { name: /^Squat/ }).click();
for (const c of await A.locator('.card', { hasText: 'Squat' }).getByRole('button', { name: /^Complete set/ }).all()) await c.click();
await A.waitForTimeout(600);
await A.evaluate(
  async ({ thenDate }) => {
    await new Promise((res, rej) => {
      const open = indexedDB.open('bulletproof');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('sessions', 'readwrite');
        const store = tx.objectStore('sessions');
        const all = store.getAll();
        all.onsuccess = () => {
          for (const s of all.result) if (s.finishedAt === null && !s.abandonedAt) store.put({ ...s, date: thenDate, updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() });
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
  { thenDate },
);
await A.reload();
await A.getByText('Last workout was left unfinished').waitFor({ timeout: 5000 });
await waitSynced(A);
for (let i = 0; i < 20 && !(await serverSessions()).some((s) => s.abandonedAt); i++) await new Promise((r) => setTimeout(r, 500));
let server = await serverSessions();
const abandoned = server.find((s) => s.abandonedAt);
check('the unfinished Saturday reached the server as unfinished', !!abandoned && !abandoned.finishedAt);

// Monday: a workout is started from that wrong plan (nothing ticked yet)
await A.getByRole('button', { name: 'Start workout' }).click();
await A.getByRole('button', { name: /^Squat/ }).waitFor();
check('today\'s workout is planned from the unfinished Saturday: squat 65', (await A.locator('.card', { hasText: 'Squat' }).locator('.card-weight').innerText()) === '65');
await A.getByRole('button', { name: /Home/ }).click();
check('Home offers to resume it', (await A.getByRole('button', { name: 'Resume workout' }).count()) === 1);

// ---- Recover Saturday and finish it
let yellow = await openDayInCalendar(A, new RegExp(`^${dayName}, workout unfinished`));
await yellow.click();
await A.getByText('This workout was left unfinished.').waitFor();
await A.getByRole('button', { name: 'Finish workout' }).click();
const dlg = A.getByRole('dialog', { name: 'Shoulder check' });
if (await dlg.waitFor({ timeout: 2000 }).then(() => true).catch(() => false)) await dlg.getByRole('button', { name: 'Skip' }).click();
await A.getByRole('button', { name: 'Count as missed reps' }).click();
await A.getByRole('button', { name: 'Workout calendar' }).waitFor({ timeout: 6000 });
await waitSynced(A);

// the server now has it finished, as the newer copy
for (let i = 0; i < 30; i++) {
  server = await serverSessions();
  if (server.find((s) => s.id === abandoned.id)?.finishedAt) break;
  await new Promise((r) => setTimeout(r, 500));
}
const onServer = server.find((s) => s.id === abandoned.id);
check('the server accepted the finished version (not rejected as older)', !!onServer.finishedAt && !onServer.abandonedAt);
check('...it was last changed after the unfinished copy, whatever day it counts on', onServer.updatedAt > abandoned.updatedAt);
check('...and it counts on Saturday', onServer.finishedAt === new Date(`${thenDate}T23:59:00`).toISOString() && onServer.date === thenDate);

// the workout that was in progress on the wrong numbers is gone, so Start plans afresh
const home = await A.locator('body').innerText();
check('the untouched workout in progress was dropped: no Resume, and the new plan is Workout B', (await A.getByRole('button', { name: 'Resume workout' }).count()) === 0 && /Workout B/.test(home));
check('...and squat now continues from Saturday: 70', home.includes('70'));

// ---- Reload: it stays finished (this is where it used to fall back to unfinished)
await A.reload();
await A.getByText('Ego lifts').waitFor();
await waitSynced(A);
await A.waitForTimeout(1500);
let day = await openDayInCalendar(A, new RegExp(`^${dayName}, 1 workout`));
check('after a reload Saturday is still finished (green)', (await day.count()) === 1 && (await A.locator('.cal-day.unfinished').count()) === 0);
check('...and still not "left unfinished" on Home', !(await A.locator('body').innerText()).includes('Last workout was left unfinished'));

// ---- A phone that starts from the server's copy (like a reinstall)
const B = await phone('B');
await setToken(B);
await B.waitForTimeout(1500);
day = await openDayInCalendar(B, new RegExp(`^${dayName}, 1 workout`));
check('a fresh phone pulling from the server also sees Saturday finished', (await day.count()) === 1 && (await B.locator('.cal-day.unfinished').count()) === 0);
check('...with Total workouts: 1 and Workout B next', (await B.getByText('Total workouts: 1').isVisible()));

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
