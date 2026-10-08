// Isolated school-entry regression. Requires local Vite on 4175 and 4176.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const tooling = path.join(process.env.TEMP, 'exammind-s8-playwright/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(tooling).href);
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--disable-background-networking', '--disable-component-update'],
});
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  return ['127.0.0.1', 'localhost'].includes(url.hostname) && ['4175', '4176'].includes(url.port)
    ? route.continue()
    : route.abort('blockedbyclient');
});

const source = await readFile('scripts/check_access_flow.mjs', 'utf8');
const marker = "await send('Page.addScriptToEvaluateOnNewDocument', { source: `";
const start = source.indexOf(marker) + marker.length;
const end = source.indexOf('};` });', start);
const fixture = vm.runInNewContext('`' + source.slice(start, end + 2) + '`');
const errors = [];
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.addInitScript({ content: fixture });

const navigate = async mode => {
  await page.goto('http://127.0.0.1:4175/#home');
  await page.evaluate(value => sessionStorage.setItem('exammind-access-fixture', value), mode);
  await page.reload({ waitUntil: 'networkidle' });
};

await navigate('new');
await page.locator('#access-gate-title').waitFor();
assert.equal(await page.locator('.workspace-shell').count(), 0);

await navigate('ksa_complete');
await page.locator('.workspace-shell').waitFor();

await navigate('ksa_pending');
await page.locator('#ksa-onboarding-title').waitFor();
await page.getByRole('button', { name: 'Next', exact: true }).click();
await page.locator('#ksa-notifications').waitFor();
assert.equal(await page.getByText('Send optional reminders about study activity', { exact: true }).count(), 1);

await navigate('cu');
await page.locator('.workspace-shell').waitFor();

await navigate('multi_no_active');
await page.locator('.account-bootstrap').waitFor();
const recoveryText = await page.locator('.account-bootstrap').innerText();
assert.match(recoveryText, /multiple verified school memberships/i);
assert.equal(await page.locator('#spaces-title').count(), 0);
assert.equal(await page.getByText('Switch learning space', { exact: true }).count(), 0);
assert.equal(await page.locator('.space-card').count(), 0);
assert.equal(await page.locator('.workspace-shell').count(), 0);

for (const width of [1366, 390]) {
  await page.setViewportSize({ width, height: width === 1366 ? 768 : 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}

assert.deepEqual(errors, []);
console.log(JSON.stringify({
  ok: true,
  checked: ['first access', 'returning KSA', 'pending KSA onboarding', 'returning CU', 'multi-membership fail-closed recovery', 'desktop/mobile overflow'],
  errors,
}, null, 2));
await context.close();
await browser.close();
