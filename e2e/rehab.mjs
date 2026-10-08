// Shoulder rehab, pain ratings, pull-aparts and accessories, in the real UI (dev server or built stack).
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
const shot = (n) => page.screenshot({ path: `shots/${n}.png` });
const text = () => page.locator('body').innerText();

await page.goto(URL);
await page.getByText('Ego lifts').waitFor();
await page.getByRole('heading', { name: 'Workout A' }).waitFor();

// ---- 1. The migration put Bench on rehab: Workout A shows the dumbbell press
let home = await text();
check('Workout A previews DB Floor Press 3 × 10 at 2 × 15 lb', /DB Floor Press 3 × 10/.test(home) && home.includes('2 × 15 lb'));
check('...and no barbell Bench Press', !home.includes('Bench Press'));
await shot('40-home-rehab');

await page.getByRole('button', { name: 'Start workout' }).click();
await page.getByRole('button', { name: /Squat/ }).waitFor();

// ---- 14. Pull-aparts are the first item in the first card's Warm-up row (squat), no extra card
await page.getByRole('button', { name: /^Squat/ }).click();
await page.getByRole('button', { name: /Warm-up \(\d+ sets\)/ }).click();
const warmText = await text();
check('pull-aparts appear in the first card\'s Warm-up row', warmText.includes('Band pull-aparts × 20') && warmText.includes('Squeeze, hold 1 s'));
const order = await page.evaluate(() => [...document.querySelectorAll('.warm-row')].map((r) => r.textContent));
check('...as the first item, before the barbell warm-ups', /Band pull-aparts/.test(order[0] ?? ''));
check('only the three lift cards exist (no prep or accessories card)', (await page.locator('.card').count()) === 3);
await shot('41-first-card-warmup');

// ---- 13. The rehab card shows only the weight, set chips, the cue and the Shoulder row
await page.getByRole('button', { name: /^DB Floor Press/ }).click();
const rehabCard = page.locator('.card', { hasText: 'DB Floor Press' });
const rc = await rehabCard.innerText();
check('rehab card shows 2 × 15 lb, the cue and the Shoulder row', rc.includes('2 × 15 lb') && rc.includes('Lower for 3 s') && rc.includes('Shoulder'));
check('...three set chips targeting 10', (await rehabCard.locator('.chip').count()) === 3 && (await rehabCard.locator('.chip').first().innerText()) === '10');
check('...no warm-up row, plate breakdown, or rule text', !/Warm-up|per side|empty bar|progress|double progression/i.test(rc));
await shot('42-rehab-card');

// ---- 15. Accessories are hidden until the last card's work is done
await page.getByRole('button', { name: /^Barbell Row/ }).click();
const rowCard = page.locator('.card', { hasText: 'Barbell Row' });
check('accessories hidden before the last lift\'s work is done', !(await rowCard.innerText()).includes('Side-lying'));
check('the collapsed card never mentions them', !(await page.getByRole('button', { name: /^Barbell Row/ }).innerText()).includes('Side-lying'));

const doWork = async () => {
  for (const c of await page.getByRole('button', { name: /^Complete set/ }).all()) {
    if ((await c.getAttribute('aria-pressed')) !== 'true') await c.click();
  }
};
await doWork();
await rowCard.getByText('Towel under elbow, hold 2 s').waitFor({ timeout: 4000 });
const afterRow = await rowCard.innerText();
check('accessories appear after the last lift\'s work is done', afterRow.includes('Side-lying DB external rotation') && afterRow.includes('DB scaption'));
check('...with their cues and 3 sets each', afterRow.includes('Towel under elbow, hold 2 s') && (await rowCard.locator('.acc .chip').count()) === 6);
check('the workout does not finish before the accessories are done', await page.getByRole('button', { name: 'Finish workout' }).isVisible());
await shot('43-accessories');

// ---- Rating before the workout completes itself
for (const c of await page.getByRole('button', { name: /^Complete (Side-lying|DB scaption)/ }).all()) await c.click();
await page.getByText('Rate your shoulder for DB Floor Press?').waitFor({ timeout: 4000 });
check('last set green: asks for the shoulder rating first (no popup yet)', (await page.getByText('Workout complete! 🎉').count()) === 0);
await shot('44-rating-prompt');
const dlg = page.getByRole('dialog', { name: 'Shoulder check' });
await dlg.getByRole('button', { name: 'Shoulder 1', exact: true }).click();
await dlg.getByRole('button', { name: 'Next' }).click();
await page.getByText('Rate your shoulder for Barbell Row?').waitFor();
await page.getByRole('dialog', { name: 'Shoulder check' }).getByRole('button', { name: 'Skip' }).click();
await page.getByText('Workout complete! 🎉').waitFor({ timeout: 3000 });
check('then the popup shows, and it exits to Home by itself', true);
await page.getByRole('heading', { name: 'Workout B' }).waitFor({ timeout: 6000 });
home = await text();
check('next is Workout B with Seated DB OHP 2 × 12.5 lb', home.includes('Seated DB OHP') && home.includes('2 × 12.5 lb'));

// ---- progression through the UI
const runWorkout = async (ratings /* name -> number */) => {
  await page.getByRole('button', { name: /Start workout|Resume workout/ }).click();
  await page.locator('.card').first().waitFor();
  for (const b of await page.locator('.card-head').all()) if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click();
  await doWork();
  // the accessories appear once the last lift's work is done
  await page.getByRole('button', { name: /^Complete (Side-lying|DB scaption)/ }).first().waitFor({ timeout: 5000 });
  for (const c of await page.getByRole('button', { name: /^Complete (Side-lying|DB scaption)/ }).all()) await c.click();
  const dialog = page.getByRole('dialog', { name: 'Shoulder check' });
  const home = page.getByRole('button', { name: 'Workout calendar' });
  for (let i = 0; i < 4; i++) {
    // either the next rating question or, once everything is answered, Home
    const which = await Promise.race([
      dialog.waitFor({ timeout: 5000 }).then(() => 'dialog'),
      home.waitFor({ timeout: 5000 }).then(() => 'home'),
    ]).catch(() => 'none');
    if (which !== 'dialog') break;
    const name = (await dialog.getByText(/^Rate your shoulder for/).innerText()).replace('Rate your shoulder for ', '').replace('?', '');
    const r = ratings[name];
    if (r === undefined) await dialog.getByRole('button', { name: 'Skip' }).click();
    else {
      await dialog.getByRole('button', { name: `Shoulder ${r}`, exact: true }).click();
      await dialog.getByRole('button', { name: /^(Next|Done)$/ }).click();
    }
    await page.waitForTimeout(250);
  }
  await page.getByRole('button', { name: 'Workout calendar' }).waitFor({ timeout: 8000 });
};
await runWorkout({ 'Seated DB OHP': 1 }); // B1, clean
home = await text();
check('A1 + B1 clean: Workout A is next with DB Floor Press 3 × 12', /Workout A/.test(home) && /DB Floor Press 3 × 12/.test(home));
await runWorkout({ 'DB Floor Press': 1 }); // A2, clean at 12
home = await text();
check('Workout B shows Seated DB OHP 3 × 12', /Seated DB OHP 3 × 12/.test(home));
await runWorkout({ 'Seated DB OHP': 3 }); // B2, amber
home = await text();
check('after the amber session Workout A shows DB Floor Press 3 × 15', /DB Floor Press 3 × 15/.test(home));
await page.getByRole('button', { name: 'Start workout' }).click();
await page.getByRole('button', { name: /^DB Floor Press/ }).click();
const pressCard = page.locator('.card', { hasText: 'DB Floor Press' });
check("the card shows the day's prescription: 3 chips at 15", (await pressCard.locator('.chip').count()) === 3 && (await pressCard.locator('.chip').first().innerText()) === '15');
await page.getByRole('button', { name: '← Home (workout stays open)' }).click();
await runWorkout({ 'DB Floor Press': 1 }); // A3, clean at 15 -> 17.5
home = await text();
check('amber held the OHP: Workout B still shows Seated DB OHP 3 × 12', /Seated DB OHP 3 × 12/.test(home));
await page.getByRole('button', { name: 'Start workout' }).click();
await page.getByRole('button', { name: /^Seated DB OHP/ }).click();
check('...with the hold explained in the card', (await page.locator('.card', { hasText: 'Seated DB OHP' }).innerText()).includes('Holding at 2 × 12.5 lb for 3 × 12 (shoulder rated 3).'));
await shot('46-hold-banner');
await page.getByRole('button', { name: '← Home (workout stays open)' }).click();

// ---- Settings: the new groups
await page.getByRole('button', { name: 'Settings' }).click();
await page.getByRole('heading', { name: 'Settings' }).waitFor();
const settingsText = await text();
check('Settings has shoulder check, rehab, accessories and lift tracks', ['Shoulder check', 'Shoulder rehab (dumbbells)', 'Shoulder accessories', 'Lift tracks'].every((t) => settingsText.includes(t)));
check('the ladders are editable settings', (await page.getByLabel('DB floor press ladder (lb per hand)').inputValue()) === '15, 17.5, 20, 25, 30');
await page.getByLabel('DB floor press ladder (lb per hand)').fill('15, 16, 20');
await page.getByLabel('DB floor press ladder (lb per hand)').blur();
await page.waitForTimeout(400);
check('a ladder edit is kept', (await page.getByLabel('DB floor press ladder (lb per hand)').inputValue()) === '15, 16, 20');
await page.getByLabel('DB floor press ladder (lb per hand)').fill('banana');
await page.getByLabel('DB floor press ladder (lb per hand)').blur();
check('a bad ladder entry is refused and the saved one comes back', (await page.getByLabel('DB floor press ladder (lb per hand)').inputValue()) === '15, 16, 20');
await shot('45-settings-shoulder');
check('Lift tracks show Bench on shoulder rehab', (await text()).includes('Bench Press: Shoulder rehab (dumbbells)'));

// tracking off hides the rating row
await page.getByRole('button', { name: 'On', exact: true }).first().click();
await page.getByRole('button', { name: '← Home' }).click();
await page.getByRole('button', { name: /Start workout|Resume workout/ }).click();
await page.getByRole('button', { name: /^Seated DB OHP/ }).click();
const off = await page.locator('.card', { hasText: 'Seated DB OHP' }).innerText();
check('shoulder tracking off: no Shoulder row on the card', !off.includes('Shoulder'));

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
