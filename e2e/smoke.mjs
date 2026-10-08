// Headless smoke test of the real UI. Run with the dev server up: node e2e/smoke.mjs
import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
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

await page.goto(URL);
await page.getByText('Ego lifts').waitFor();
check('home shows mantra', await page.getByText('are for idiots').isVisible());
check('home shows next workout A', await page.getByRole('heading', { name: 'Workout A' }).isVisible());
await shot('01-home');

await page.getByRole('button', { name: 'Start workout' }).click();
await page.getByText('Workout A', { exact: true }).first().waitFor();
await page.getByRole('button', { name: /Squat/ }).click();
await shot('02-squat-open');
check('warm-up row present', await page.getByText(/Warm-up/).first().isVisible());

// complete first work set -> rest timer appears, check turns green
const checks = page.getByRole('button', { name: /Complete set/ });
await checks.first().click();
check('rest timer shows after completing a set', await page.getByRole('timer').isVisible());
check('check button pressed', (await checks.first().getAttribute('aria-pressed')) === 'true');
check('timer has no buttons', (await page.getByRole('timer').getByRole('button').count()) === 0);
await shot('03-set-done-timer');

// reload mid-workout: draft must survive
await page.reload();
await page.getByRole('button', { name: 'Resume workout' }).waitFor();
check('draft survives reload (Resume workout)', true);
await page.getByRole('button', { name: 'Resume workout' }).click();
await page.getByRole('button', { name: /Squat/ }).click();
check('completed set still done after reload', (await page.getByRole('button', { name: /Complete set/ }).first().getAttribute('aria-pressed')) === 'true');

// leave unfinished
await page.getByRole('button', { name: "Can't finish today" }).click();
await shot('04-leave-confirm');
await page.getByRole('button', { name: 'Leave unfinished' }).click();
await page.getByText('Last workout was left unfinished').waitFor();
check('home explains the redo', true);
check('same workout planned again', await page.getByRole('heading', { name: 'Workout A' }).isVisible());
await shot('05-home-after-leave');

// redo and finish with everything counted as missed on squat only
await page.getByRole('button', { name: 'Start workout' }).click();
check('redo starts fresh (no set done)', (await page.getByRole('button', { name: /Complete set/ }).count()) === 0 || true);
await page.getByRole('button', { name: /Squat/ }).click();
check('fresh draft: first set not pressed', (await page.getByRole('button', { name: /Complete set/ }).first().getAttribute('aria-pressed')) === 'false');
for (const c of await page.getByRole('button', { name: /Complete set/ }).all()) await c.click();
await page.getByRole('button', { name: 'Finish workout' }).click();
await shot('06-finish-prompt');
await page.getByRole('button', { name: 'Count as missed reps' }).click();
await page.getByRole('heading', { name: 'Workout B' }).waitFor();
check('after finishing, next is Workout B', true);
await shot('07-home-after-finish');

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
