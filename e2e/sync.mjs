// Two "phones" against the local stack (node e2e/stack.mjs): backup, restore with only a token, offline, tombstones.
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
  return { ctx, page };
}

const syncText = (page) => page.locator('.sync-line').innerText();
const waitSync = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.sync-line')?.textContent ?? ''), re.source, { timeout: 15000 });

async function enterToken(page, token) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Sync token').fill(token);
  await page.getByRole('button', { name: 'Save token' }).click();
  await page.getByText('Token saved on this phone.').waitFor();
  await page.getByRole('button', { name: '← Home' }).click();
}

async function logSquatWorkout(page) {
  await page.getByRole('button', { name: /Start workout|Resume workout/ }).click();
  await page.getByRole('button', { name: /Squat/ }).click();
  for (const c of await page.getByRole('button', { name: /Complete set/ }).all()) await c.click();
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Count as missed reps' }).click();
  await page.getByRole('heading', { name: /Workout/ }).waitFor();
}

const serverCount = async () => {
  const r = await fetch(`${URL}api/sync`, { headers: { authorization: `Bearer ${TOKEN}` } });
  return (await r.json()).sessions.filter((s) => !s.deleted).length;
};

// ---- Phone A: no token yet
const A = await phone('A');
check('no token: status line says so', /Sync token missing/.test(await syncText(A.page)));

// wrong token
await enterToken(A.page, 'wrong-token-wrong-token-wrong');
await waitSync(A.page, /rejected/);
check('wrong token: "token rejected"', true);

// right token
await enterToken(A.page, TOKEN);
await waitSync(A.page, /^Synced/);
check('right token: Synced', true);

// log a workout, it backs up on its own
await logSquatWorkout(A.page);
await waitSync(A.page, /^Synced/);
await A.page.waitForFunction(async () => (await (await fetch('/api/health')).json()).ok);
for (let i = 0; i < 20 && (await serverCount()) < 1; i++) await new Promise((r) => setTimeout(r, 500));
check('finished workout reached the server by itself', (await serverCount()) === 1);

// ---- Phone B: a different phone, only the token
const B = await phone('B');
await enterToken(B.page, TOKEN);
await waitSync(B.page, /^Synced/);
await B.page.getByRole('button', { name: 'Workout calendar' }).click();
await B.page.getByText('Total workouts: 1').waitFor();
check('restored onto a clean phone with only the token (calendar total 1)', true);
await B.page.getByRole('button', { name: 'Workout calendar' }).click();
check('phone B plans squat at 70 from the restored history', await B.page.getByText('70', { exact: true }).first().isVisible());
await B.page.screenshot({ path: 'shots/20-restored.png' });

// ---- Offline on A: work continues, status says so, it catches up when back online
await A.ctx.setOffline(true);
await logSquatWorkout(A.page);
await A.page.evaluate(() => window.dispatchEvent(new Event('offline')));
await A.page.getByRole('button', { name: 'Settings' }).click();
await A.page.getByRole('button', { name: 'Sync now' }).click();
await A.page.getByText('Not synced: offline').waitFor();
check('offline: logging still works and status says "Not synced: offline"', true);
await A.page.getByRole('button', { name: '← Home' }).click();
check('offline: server did not get it yet', (await serverCount()) === 1);
await A.ctx.setOffline(false);
await A.page.evaluate(() => window.dispatchEvent(new Event('online')));
await waitSync(A.page, /^Synced/);
for (let i = 0; i < 20 && (await serverCount()) < 2; i++) await new Promise((r) => setTimeout(r, 500));
check('back online: the offline workout synced', (await serverCount()) === 2);

// ---- Delete on B propagates to A as a tombstone
await B.page.getByRole('button', { name: 'Settings' }).click();
await B.page.getByRole('button', { name: 'Sync now' }).click();
await B.page.getByRole('button', { name: '← Home' }).click();
await B.page.getByRole('button', { name: 'Workout calendar' }).click();
await B.page.getByText('Total workouts: 2').waitFor();
await B.page.locator('.cal-day.finished').first().click();
await B.page.locator('.cal-pick button').first().click(); // two workouts on one date: pick one
await B.page.getByRole('button', { name: 'Delete workout' }).click();
await B.page.getByRole('button', { name: 'Delete workout' }).click();
await B.page.getByRole('button', { name: 'Workout calendar' }).waitFor();
for (let i = 0; i < 20 && (await serverCount()) > 1; i++) await new Promise((r) => setTimeout(r, 500));
check('delete on B reached the server as a tombstone', (await serverCount()) === 1);
await A.page.getByRole('button', { name: 'Settings' }).click();
await A.page.getByRole('button', { name: 'Sync now' }).click();
await A.page.getByRole('button', { name: '← Home' }).click();
await A.page.getByRole('button', { name: 'Workout calendar' }).click();
await A.page.getByText('Total workouts: 1').waitFor();
check('phone A sees the deletion after syncing', true);

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
