// Renders the app icons (a barbell plate in iron on lavender) to client/public. Run: node e2e/make-icons.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const out = new URL('../client/public/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(out, { recursive: true });

const IRON = '#3d2a7a';
const LAV = '#dbceff';

/** `scale` = plate diameter as a share of the icon. Maskable icons keep the plate inside the safe zone. */
const svg = (scale) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${LAV}"/>
  <g transform="translate(256 256) scale(${scale})">
    <circle r="250" fill="${IRON}"/>
    <circle r="205" fill="none" stroke="${LAV}" stroke-width="10" opacity="0.55"/>
    <circle r="150" fill="none" stroke="${LAV}" stroke-width="6" opacity="0.35"/>
    <circle r="52" fill="${LAV}"/>
    <circle r="52" fill="none" stroke="${IRON}" stroke-width="8"/>
  </g>
</svg>`;

const jobs = [
  ['icon-192.png', 192, 0.82],
  ['icon-512.png', 512, 0.82],
  ['icon-maskable-512.png', 512, 0.62], // Android crops to a circle/squircle: keep the art well inside
  ['apple-touch-icon.png', 180, 0.82],
  ['favicon-32.png', 32, 0.9],
];

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage();
for (const [name, size, scale] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0">${svg(scale).replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body>`);
  await page.screenshot({ path: out + name, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', name);
}
await browser.close();
