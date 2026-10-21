// Browser-only regression for the upload progress surface. The API response
// is deliberately controlled here so this checks the real React/CSS rendering
// without pretending that a fixture proves extraction or indexing.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tooling = path.join(process.env.TEMP, 'exammind-s8-playwright/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(tooling).href);
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--disable-background-networking', '--disable-component-update'],
});
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
const apiOrigin = 'http://127.0.0.1:8001';
const response = (data, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(data),
});

await context.route('**/*', async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== apiOrigin) return route.continue();
  const method = request.method();
  if (url.pathname === '/auth/me') {
    return route.fulfill(response({ id: 1, name: 'Upload Fixture', username: 'upload_fixture', email: 'upload@example.com', role: 'student', account_status: 'active' }));
  }
  if (url.pathname === '/learning-spaces') {
    const space = { id: 1, slug: 'cu', name: 'Covenant University', type: 'university', status: 'active', membership: { id: 1, role: 'member', status: 'active', onboarding_required: false } };
    return route.fulfill(response({ active_space: space, memberships: [{ space }], available_spaces: [] }));
  }
  if (url.pathname === '/community/profile') return route.fulfill(response({ onboarding_required: false, onboarding_state: 'completed' }));
  if (url.pathname === '/health') return route.fulfill(response({ status: 'ok', application: 'ok' }));
  if (url.pathname.startsWith('/analytics/student/')) return route.fulfill(response({ readiness: [], attempts: [] }));
  if (url.pathname === '/ingest/upload/stream' && method === 'POST') {
    await new Promise(resolve => setTimeout(resolve, 1200));
    const result = {
      status: 'needs_confirmation',
      metadata: { document_title: 'Week 4 slides', document_type: 'lecture_note', course_code: 'CSC 301', course_title: 'Systems', topics_covered: [], extraction_method: 'embedded_text', extraction_confidence: .95 },
      preview: 'Authorized upload fixture preview.',
      preview_sections: [],
      preview_quality: 'high',
      extraction: { method: 'embedded_text', page_count: 2, text_char_count: 120, searchable: true },
      pipeline_steps: [
        { key: 'reading', status: 'complete' },
        { key: 'extraction', status: 'complete' },
        { key: 'metadata', status: 'complete' },
        { key: 'duplicates', status: 'complete' },
        { key: 'transcription', status: 'skipped' },
        { key: 'indexing', status: 'pending' },
      ],
    };
    const events = [
      { type: 'progress', key: 'reading', status: 'active' },
      { type: 'progress', key: 'reading', status: 'complete' },
      { type: 'progress', key: 'extraction', status: 'active' },
      { type: 'progress', key: 'extraction', status: 'complete' },
      { type: 'progress', key: 'metadata', status: 'active' },
      { type: 'progress', key: 'metadata', status: 'complete' },
      { type: 'progress', key: 'duplicates', status: 'active' },
      { type: 'progress', key: 'duplicates', status: 'complete' },
      { type: 'progress', key: 'transcription', status: 'skipped' },
      { type: 'progress', key: 'indexing', status: 'pending' },
      { type: 'result', data: result },
    ];
    return route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: events.map(event => JSON.stringify(event)).join('\n') + '\n',
    });
  }
  return route.fulfill(response(method === 'GET' ? [] : {}));
});

const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.setItem('exammind-first-upload-auth-reset-v1', 'true');
  localStorage.setItem('token', 'exammind:browser-fixture');
});
await page.goto('http://127.0.0.1:4180/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Add material', exact: true }).first().click();
await page.locator('#s-upload').waitFor();
await page.locator('input[type=file]').setInputFiles({
  name: 'week-4-slides.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 upload fixture'),
});
await page.locator('.upload-processing-panel').waitFor();

const inspect = async () => page.evaluate(() => {
  const list = document.querySelector('.upload-step-list');
  const steps = [...document.querySelectorAll('.upload-step')];
  return {
    stepCount: steps.length,
    statuses: steps.map(step => [...step.classList].find(value => ['pending', 'active', 'done', 'error', 'skipped'].includes(value)) || 'unknown'),
    columns: list ? getComputedStyle(list).gridTemplateColumns : '',
    noOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    indeterminateCopy: document.querySelector('.processing-live')?.textContent || '',
  };
});

const desktop = await inspect();
assert.equal(desktop.stepCount, 6);
assert.deepEqual(desktop.statuses, ['pending', 'pending', 'pending', 'pending', 'pending', 'pending']);
assert.equal(desktop.noOverflow, true);
assert.match(desktop.indeterminateCopy, /server confirms/i);
await mkdir(path.resolve('output/upload-progress'), { recursive: true });
await page.screenshot({ path: path.resolve('output/upload-progress/desktop.png'), fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
const mobile = await inspect();
assert.equal(mobile.stepCount, 6);
assert.equal(mobile.noOverflow, true);
assert.equal(mobile.columns.trim().split(/\s+/).length, 2);

await page.screenshot({ path: path.resolve('output/upload-progress/desktop-mobile-check.png'), fullPage: true });
await page.locator('.review-workspace').waitFor({ state: 'visible' });
assert.equal(await page.locator('.upload-processing-panel').count(), 0);
console.log(JSON.stringify({ ok: true, desktop, mobile }, null, 2));
await context.close();
await browser.close();
