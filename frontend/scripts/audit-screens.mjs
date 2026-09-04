import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '../playwright-shots/audit');
const htmlBase = 'http://127.0.0.1:8765/datanitiv-planning-agent_voice_09_03_2026_latest.html';
const reactBase = 'http://127.0.0.1:5173/';

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

async function shot(name) {
  await page.screenshot({ path: path.join(outDir, name), fullPage: false, timeout: 60000 });
  console.log('saved', name);
}

// ---- HTML portfolio ----
await page.goto(htmlBase, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1200);
await shot('html-01-portfolio.png');

// HTML plan overview — force navigation (demo overlay intercepts normal clicks)
await page.evaluate(() => {
  if (typeof focusPlan === 'function') focusPlan('CAP00010');
  else {
    document.querySelectorAll('.pane').forEach((p) => p.classList.remove('on'));
    const plan = document.querySelector('.pane[data-view="plan"]');
    if (plan) plan.classList.add('on');
  }
});
await page.waitForTimeout(800);
await shot('html-02-plan-overview.png');

// HTML plan steps
for (const [step, name] of [
  ['hc', 'headcount'],
  ['nh', 'new-hire'],
  ['shr', 'shrinkage'],
  ['att', 'attrition'],
  ['rec', 'recommend'],
  ['exec', 'execute'],
]) {
  await page.evaluate((s) => {
    document.querySelectorAll('.stp').forEach((el) => el.classList.toggle('on', el.getAttribute('data-step') === s));
    document.querySelectorAll('.tsec').forEach((el) => el.classList.toggle('on', el.getAttribute('data-sec') === s));
  }, step);
  await page.waitForTimeout(500);
  await shot(`html-03-plan-${name}.png`);
}

// HTML hours / rollback panes
for (const [view, name] of [
  ['hours', 'hours'],
  ['roll', 'rollback'],
]) {
  await page.evaluate((v) => {
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.getAttribute('data-view') === v));
  }, view);
  await page.waitForTimeout(500);
  await shot(`html-04-${name}.png`);
}

await page.evaluate(() => {
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.getAttribute('data-view') === 'port'));
});
await page.waitForTimeout(400);
await shot('html-01b-portfolio-filters.png');

// ---- React portfolio ----
await page.goto(reactBase, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('.ptbl, .prow, .land', { timeout: 60000 });
await page.waitForTimeout(2000);
await shot('react-01-portfolio.png');

await page.locator('.navviews span', { hasText: 'Queue' }).click();
await page.waitForTimeout(800);
await shot('react-05-queue.png');

await page.locator('.navviews span', { hasText: 'Time' }).click();
await page.waitForTimeout(800);
await shot('react-06-time.png');

await page.locator('.navviews span', { hasText: 'Portfolio' }).click();
await page.waitForSelector('.openb', { timeout: 30000 });
await page.locator('.openb').first().click();
await page.waitForSelector('.stp', { timeout: 30000 });
await page.waitForTimeout(1200);
await shot('react-02-plan-overview.png');

for (const label of ['Overview', 'Forecast', 'Headcount', 'New Hire', 'Shrinkage', 'Attrition', 'Recommend', 'Execute']) {
  const tab = page.locator('.stp', { hasText: label });
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(700);
    const slug = label.toLowerCase().replace(/\s+/g, '-');
    await shot(`react-03-plan-${slug}.png`);
  }
}

await browser.close();
console.log('audit done');
