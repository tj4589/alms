// Run the existing CDP fixture assertions through an isolated Playwright page.
// No new application dependencies, production traffic or provider calls.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const allowed = new Set(['check_workspace.mjs', 'check_collaboration.mjs', 'check_ksa_admin.mjs']);
const name = process.argv[2];
if (!allowed.has(name)) throw new Error('Specify an existing supported workspace, collaboration or KSA admin fixture.');
const source = await readFile(path.join('scripts', name), 'utf8');
const marker = name === 'check_workspace.mjs'
  ? "await send('Page.addScriptToEvaluateOnNewDocument', { source: `"
  : 'const fixture = `';
const start = source.indexOf(marker);
if (start < 0) throw new Error('Fixture entry point not found.');
const body = source.slice(start).replace(/ws\.close\(\);\s*$/, '');
const evidenceDir = path.join(process.env.TEMP, 'exammind-project-integrity', name.replace('.mjs', ''));
await mkdir(evidenceDir, { recursive:true });
const tooling = path.join(process.env.TEMP, 'exammind-s8-playwright/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(tooling).href);
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, timeout: 30_000,
  args: ['--disable-background-networking', '--disable-component-update'],
});
const context = await browser.newContext({ viewport: {width: 1366, height: 768}, serviceWorkers: 'block', reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  return ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '5173'
    ? route.continue() : route.abort('blockedbyclient');
});
const session = await context.newCDPSession(page);
const send = async (method, params = {}) => {
  let timer;
  try {
    return await Promise.race([
      session.send(method, params),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${method} timed out in isolated ${name}`)), 20_000); }),
    ]);
  } finally { clearTimeout(timer); }
};
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const waitFor = async expression => {
  await page.waitForFunction(expression => Boolean(eval(expression)), expression, { timeout: 20_000 });
};
const clickWhenAvailable = async selector => { await page.locator(selector).first().click({timeout:20_000}); };
try {
  await send('Page.enable');
  await send('Runtime.enable');
  const run = new (Object.getPrototypeOf(async function() {}).constructor)(
    'send', 'evaluate', 'waitFor', 'clickWhenAvailable', 'assert', 'errors', 'mkdir', 'writeFile', body,
  );
  await run(send, evaluate, waitFor, clickWhenAvailable, assert, errors,
    async () => {}, (filename, data) => writeFile(path.join(evidenceDir, path.basename(filename)), data));
  assert.deepEqual(errors, [], 'Fixture runtime errors');
  console.log(JSON.stringify({fixture:name, isolated:true, passed:true}));
} catch (failure) {
  console.error(JSON.stringify({fixture:name, error:failure.message, errors,
    page:(await page.locator('body').innerText().catch(() => '')).slice(0,1600)}, null, 2));
  throw failure;
} finally {
  await context.close();
  await browser.close();
}
