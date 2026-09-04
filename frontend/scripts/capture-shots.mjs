import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '../playwright-shots');
const htmlBase = 'http://127.0.0.1:8765/datanitiv-planning-agent_voice_09_03_2026_latest.html';
const reactBase = 'http://127.0.0.1:5173/';

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

async function shot(name) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, fullPage: true, timeout: 60000 });
  console.log('saved', name);
}

await page.goto(htmlBase, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1500);
await shot('html-portfolio.png');

await page.goto(reactBase, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('.ptbl, .land, .openb, .prow', { timeout: 60000 });
await page.waitForTimeout(2000);
await shot('react-portfolio.png');

await page.locator('.navviews span', { hasText: 'Queue' }).click();
await page.waitForTimeout(800);
await shot('react-queue.png');

await page.locator('.navviews span', { hasText: 'Portfolio' }).click();
await page.waitForSelector('.openb, .prow', { timeout: 30000 });
const openBtn = page.locator('.openb').first();
if (await openBtn.count()) {
  await openBtn.click();
  await page.waitForSelector('.stp', { timeout: 30000 });
  await page.waitForTimeout(1500);
  const tabs = ['Overview', 'Headcount', 'New Hire', 'Shrinkage', 'Attrition', 'Recommend', 'Execute'];
  for (const label of tabs) {
    const tab = page.locator('.stp', { hasText: label });
    if (await tab.count()) {
      await tab.click();
      await page.waitForTimeout(800);
      const slug = label.toLowerCase().replace(/\s+/g, '-');
      await shot(`react-plan-${slug}.png`);
    }
  }
  const fw = page.locator('.stp', { hasText: 'Forecast' });
  if (await fw.count()) {
    await fw.click();
    await page.waitForTimeout(800);
    await shot('react-plan-forecast.png');
  }
} else {
  console.warn('no openb found — plan tab shots skipped');
}

await browser.close();
console.log('done');
