// PWA checks against the local stack (node e2e/stack.mjs): manifest, service worker, offline use, API never cached.
import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:3100/';
const TOKEN = 'e2e-token-e2e-token-e2e-token';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
};

await page.goto(URL);
await page.getByText('Ego lifts').waitFor();

// Manifest
const manifestHref = await page.locator('link[rel=manifest]').getAttribute('href');
const manifest = await (await fetch(new globalThis.URL(manifestHref, URL))).json();
check('manifest: name, standalone, start_url', manifest.name === 'Bulletproof' && manifest.display === 'standalone' && manifest.start_url === '/');
check('manifest: 192, 512 and a maskable icon', ['192x192', '512x512'].every((s) => manifest.icons.some((i) => i.sizes === s)) && manifest.icons.some((i) => i.purpose === 'maskable'));
for (const icon of manifest.icons) {
  const r = await fetch(new globalThis.URL(icon.src, URL));
  check(`icon ${icon.src} is served as an image`, r.ok && (r.headers.get('content-type') ?? '').includes('image/png'));
}
check('theme colour and apple touch icon present', (await page.locator('meta[name=theme-color]').count()) === 1 && (await page.locator('link[rel=apple-touch-icon]').count()) === 1);

// Service worker takes control
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.getByText('Ego lifts').waitFor();
check('service worker controls the page', await page.evaluate(() => !!navigator.serviceWorker.controller));

// Precache holds the shell and the fonts
const cached = await page.evaluate(async () => {
  const urls = [];
  for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
  return urls;
});
check('precache has index.html and JS/CSS', cached.some((u) => u === '/index.html' || u === '/') && cached.some((u) => u.endsWith('.js')) && cached.some((u) => u.endsWith('.css')));
check('precache has the self-hosted fonts', cached.some((u) => u.endsWith('.woff2')));

// Use the app with a token so sync traffic exists, then prove /api is never cached
await page.getByRole('button', { name: 'Settings' }).click();
await page.getByLabel('Sync token').fill(TOKEN);
await page.getByRole('button', { name: 'Save token' }).click();
await page.getByRole('button', { name: 'Sync now' }).click();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: '← Home' }).click();
const afterSync = await page.evaluate(async () => {
  const urls = [];
  for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
  return urls;
});
check('no /api response is ever cached', !afterSync.some((u) => u.startsWith('/api')));

// Offline: reload, then log a workout with no network
await ctx.setOffline(true);
await page.reload();
await page.getByText('Ego lifts').waitFor();
check('offline: app loads from the cache', await page.getByRole('button', { name: /Start workout|Resume workout/ }).isVisible());
await page.getByRole('button', { name: /Start workout|Resume workout/ }).click();
await page.getByRole('button', { name: /Squat/ }).click();
await page.getByRole('button', { name: /Complete set/ }).first().click();
check('offline: set logged, rest timer runs', await page.getByRole('timer').isVisible());
await page.reload();
await page.getByRole('button', { name: 'Resume workout' }).waitFor();
check('offline: reload keeps the draft (Resume workout)', true);
const font = await page.evaluate(() => document.fonts.check('800 36px "Archivo Variable"'));
check('offline: self-hosted font is available', font);
await page.screenshot({ path: 'shots/21-offline.png' });

// Online again
await ctx.setOffline(false);

console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
