// Auto-finish popup, 1:30 rest timer, and workout notes (typed, kept, exported in the CSV).
import { readFileSync } from 'node:fs';
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
const NOTE = 'Left knee clicky, felt strong.';

await page.goto(URL);
await page.getByText('Ego lifts').waitFor();
await page.getByRole('button', { name: 'Start workout' }).click();
await page.getByRole('button', { name: /Squat/ }).waitFor();

// 1:30 rest after the first work set
await page.getByRole('button', { name: /Squat/ }).click();
await page.getByRole('button', { name: /Complete set/ }).first().click();
const timer = await page.getByRole('timer').innerText();
check('rest timer starts at 1:30', /1:30|1:29/.test(timer));

// A note, typed before the workout ends
await page.getByRole('button', { name: 'Note', exact: true }).click();
await page.getByLabel('Note for this workout').fill(NOTE);
check('note link shows a dot once there is a note', (await page.getByRole('button', { name: /^Note •$/ }).count()) === 1);
await page.reload();
await page.getByRole('button', { name: 'Resume workout' }).click();
await page.getByRole('button', { name: /^Note •$/ }).click();
check('note survives a reload', (await page.getByLabel('Note for this workout').inputValue()) === NOTE);
check('"Can\'t finish today" is on the left, "Note" on the right of the same row', await page.evaluate(() => {
  const row = document.querySelector('.link-row');
  const [a, b] = [...row.querySelectorAll('button')];
  return a.textContent.includes("Can't finish today") && b.textContent.startsWith('Note') && a.getBoundingClientRect().left < b.getBoundingClientRect().left;
}));
await page.screenshot({ path: 'shots/30-note.png' });

// Tap every work set, in all three lifts. "Not yet" holds the auto-finish.
const completeAll = async () => {
  for (const name of [/Squat/, /Bench Press/, /Barbell Row/]) {
    const card = page.getByRole('button', { name }).first();
    if ((await card.getAttribute('aria-expanded')) !== 'true') await card.click();
  }
  for (const c of await page.getByRole('button', { name: /Complete set/ }).all()) {
    if ((await c.getAttribute('aria-pressed')) !== 'true') await c.click();
  }
};
await completeAll();
await page.getByText('Workout complete! 🎉').waitFor({ timeout: 3000 });
check('popup appears once every set is green', true);
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/31-complete-popup.png' });
await page.getByRole('button', { name: 'Not yet' }).click();
await page.waitForTimeout(2600);
check('"Not yet" keeps me on the workout (no auto-exit)', await page.getByRole('button', { name: 'Finish workout' }).isVisible());

// Un-green one set and re-green it: the popup returns, and this time let it run out
const first = page.getByRole('button', { name: /Complete set/ }).first();
await first.click();
check('popup gone while a set is open', (await page.getByText('Workout complete! 🎉').count()) === 0);
await first.click();
await page.getByText('Workout complete! 🎉').waitFor({ timeout: 3000 });
const t0 = Date.now();
await page.getByRole('heading', { name: 'Workout B' }).waitFor({ timeout: 6000 });
const took = Date.now() - t0;
check(`auto-exits to the main page after ~2 s (took ${took} ms)`, took >= 1200 && took <= 3500);
check('the finished workout counted: next is Workout B', true);

// CSV carries the note, once
await page.getByRole('button', { name: 'Settings' }).click();
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
const csv = readFileSync(await dl.path(), 'utf8');
const lines = csv.slice(1).split('\r\n').filter(Boolean);
check('CSV header ends with notes', lines[0].endsWith(',notes'));
check('note appears exactly once in the CSV', csv.split(NOTE).length - 1 === 1);
check('...on the first data row', lines[1].includes(NOTE));

// Past session: Note is editable there too
await page.getByRole('button', { name: '← Home' }).click();
await page.getByRole('button', { name: 'Workout calendar' }).click();
await page.locator('.cal-day.finished').first().click();
await page.getByRole('button', { name: /^Note •$/ }).click();
check('the saved note shows when reopening a past workout', (await page.getByLabel('Note for this workout').inputValue()) === NOTE);
await page.getByLabel('Note for this workout').fill(NOTE + ' Edited later.');
await page.getByRole('button', { name: 'Done' }).click();
await page.getByRole('button', { name: 'Settings' }).click();
const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
check('an edited note exports too', readFileSync(await dl2.path(), 'utf8').includes('Edited later.'));

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
