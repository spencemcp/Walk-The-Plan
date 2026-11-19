// Renders still shots of a pitch tour with headless Chrome (software WebGL).
// Setup (once, outside the repo): npm i @sparticuz/chromium@131 puppeteer-core@23
// Serve the repo root:  npx http-server . -p 8765 -c-1
// Use: TOUR=greystone-qgjs node shot.mjs outdir "kitchen-airy|view=kitchen&pkg=airy&ui=0|1600|900" ...
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
const [,, outDir, ...jobs] = process.argv;
const TOUR = process.env.TOUR || 'greystone-qgjs';
const BASE = process.env.BASE || 'http://localhost:8765';
const browser = await puppeteer.launch({
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  executablePath: await chromium.executablePath(),
  headless: true,
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('console', (m) => console.log('console:', m.text()));
page.on('pageerror', (e) => console.log('pageerror:', e.message));
for (const job of jobs) {
  const [name, query, w, h] = job.split('|');
  await page.setViewport({ width: +(w || 1600), height: +(h || 900) });
  const t0 = Date.now();
  await page.goto(`${BASE}/t/${TOUR}/?${query}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__tour, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('shot', name, Date.now() - t0, 'ms');
}
await browser.close();
