// Browser-only regression for the review surface. The backend extraction and
// topic-grounding path is exercised separately by the Python fixture; this
// script checks the real React screen, KSA form, evidence copy and layout.
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
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  serviceWorkers: 'block',
  reducedMotion: 'reduce',
});
const apiOrigin = 'http://127.0.0.1:8001';
let uploadStreamCalls = 0;
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
    return route.fulfill(response({ id: 2, name: 'KSA Upload Fixture', username: 'ksa_upload_fixture', email: 'ksa@example.com', role: 'student', account_status: 'active' }));
  }
  if (url.pathname === '/learning-spaces') {
    const space = { id: 2, slug: 'ksa', name: 'Kora Sales Academy', type: 'program', status: 'active', membership: { id: 2, role: 'member', status: 'active', onboarding_required: false } };
    return route.fulfill(response({ active_space: space, memberships: [{ space }], available_spaces: [] }));
  }
  if (url.pathname === '/community/profile') return route.fulfill(response({ onboarding_required: false, onboarding_state: 'completed' }));
  if (url.pathname === '/health') return route.fulfill(response({ status: 'ok', application: 'ok' }));
  if (url.pathname.startsWith('/analytics/student/')) return route.fulfill(response({ readiness: [], attempts: [] }));
  if (url.pathname === '/ingest/upload/stream' && method === 'POST') {
    uploadStreamCalls += 1;
    const result = {
      status: 'needs_confirmation',
      metadata: {
        document_title: 'Prospecting & Pipeline Generation',
        document_type: 'lecture_note',
        course_code: '',
        course_title: '',
        topics_covered: [
          'prospecting',
          'inbound and outbound prospecting',
          'targeted prospect lists and ICP',
          'cold email: Hook, Value, CTA',
          'cold calls',
          'prospect qualification',
        ],
        topic_evidence: [
          { topic: 'prospecting', evidence: 'Prospecting & Pipeline Generation', page_number: 1, source: 'document_text' },
          { topic: 'inbound and outbound prospecting', evidence: 'inbound and outbound prospecting', page_number: 1, source: 'document_text' },
          { topic: 'targeted prospect lists and ICP', evidence: 'targeted prospect lists and ICP', page_number: 1, source: 'document_text' },
          { topic: 'cold email: Hook, Value, CTA', evidence: 'cold email using Hook -> Value -> CTA', page_number: 1, source: 'document_text' },
          { topic: 'cold calls', evidence: 'cold calls', page_number: 1, source: 'document_text' },
          { topic: 'prospect qualification', evidence: 'prospect qualification', page_number: 1, source: 'document_text' },
        ],
        topics_grounding_status: 'grounded',
        extraction_method: 'embedded_text',
        extraction_confidence: .95,
        searchable: true,
        needs_review: false,
      },
      preview: 'Prospecting & Pipeline Generation. Prospecting, inbound and outbound, targeted prospect lists and ICP, cold email Hook -> Value -> CTA, cold calls, and prospect qualification.',
      preview_sections: [{ title: 'Page 1', items: [{ label: 'Source', text: 'Prospecting & Pipeline Generation' }, { label: 'Topics', text: 'Prospecting, inbound and outbound, targeted prospect lists and ICP, cold email Hook -> Value -> CTA, cold calls, and prospect qualification.' }] }],
      preview_quality: 'high',
      extraction: { method: 'embedded_text', page_count: 1, text_char_count: 238, searchable: true },
      pipeline_steps: [
        { key: 'reading', status: 'complete' },
        { key: 'extraction', status: 'complete' },
        { key: 'metadata', status: 'complete' },
        { key: 'duplicates', status: 'complete' },
        { key: 'transcription', status: 'skipped' },
        { key: 'indexing', status: 'pending' },
      ],
    };
    if (uploadStreamCalls === 2) {
      result.status = 'success';
      result.document_id = 42;
      result.document_type = 'lecture_note';
      result.chunks_indexed = 4;
      result.indexed = true;
      result.sharing = { visibility: 'private', requested_visibility: 'space_shared', moderation_status: 'pending_review' };
      result.pipeline_steps = result.pipeline_steps.map(step => ({ ...step, status: step.key === 'transcription' ? 'skipped' : 'complete' }));
    } else if (uploadStreamCalls === 3) {
      result.status = 'duplicate';
      result.message = 'Already uploaded as Prospecting & Pipeline Generation.';
      result.existing_document = { id: 42, type: 'lecture_note', title: 'Prospecting & Pipeline Generation', match_type: 'exact_checksum' };
    }
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
    return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: `${events.map(event => JSON.stringify(event)).join('\n')}\n` });
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
  name: 'week 4 slides.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 representative prospecting fixture'),
});
await page.locator('.review-workspace').waitFor();

const desktop = await page.evaluate(() => {
  const left = document.querySelector('.review-document-column')?.getBoundingClientRect();
  const right = document.querySelector('.review-details-panel')?.getBoundingClientRect();
  return {
    bodyText: document.body.innerText,
    leftWidth: left?.width || 0,
    rightWidth: right?.width || 0,
    rightOffset: right?.left || 0,
    noOverflow: document.documentElement.scrollWidth <= window.innerWidth,
  };
});
assert.match(desktop.bodyText, /Prospecting & Pipeline Generation/);
assert.match(desktop.bodyText, /Supported by this file.*page 1/s);
assert.match(desktop.bodyText, /prospect qualification/);
assert.doesNotMatch(desktop.bodyText, /stakeholder management/i);
assert.doesNotMatch(desktop.bodyText, /Course code|Course title|Academic session/);
assert.ok(desktop.leftWidth > desktop.rightWidth, `left review column should be wider (${desktop.leftWidth} > ${desktop.rightWidth})`);
assert.equal(desktop.noOverflow, true);

await mkdir(path.resolve('output/upload-review'), { recursive: true });
await page.screenshot({ path: path.resolve('output/upload-review/ksa-review-desktop.png'), fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
const mobile = await page.evaluate(() => ({
  noOverflow: document.documentElement.scrollWidth <= window.innerWidth,
  columns: getComputedStyle(document.querySelector('.review-workspace')).gridTemplateColumns,
}));
assert.equal(mobile.noOverflow, true);
assert.equal(mobile.columns.trim().split(/\s+/).length, 1);
await page.screenshot({ path: path.resolve('output/upload-review/ksa-review-mobile.png'), fullPage: true });

await page.setViewportSize({ width: 1440, height: 1000 });
await page.locator('input[value="space_shared"]').check();
await page.locator('.sharing-consent input[type="checkbox"]').check();
const addToLibrary = page.getByRole('button', { name: 'Add to library', exact: true });
await addToLibrary.hover();
const hoverStyle = await addToLibrary.evaluate(button => {
  const style = getComputedStyle(button);
  return { backgroundColor: style.backgroundColor, color: style.color };
});
assert.equal(hoverStyle.backgroundColor, 'rgb(255, 255, 255)');
assert.equal(hoverStyle.color, 'rgb(37, 43, 36)');
await addToLibrary.click();
await page.locator('.success-modal').waitFor();
const successText = await page.locator('.success-modal').innerText();
assert.match(successText, /ready in My Materials now/i);
assert.doesNotMatch(successText, /Share to KSA archive|Where should this material be available\?|Confirm sharing/i);

await page.getByRole('button', { name: 'Upload Another', exact: true }).click();
await page.locator('input[type=file]').setInputFiles({
  name: 'week 4 slides.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 duplicate prospecting fixture'),
});
await page.locator('.duplicate-card').waitFor();
const duplicateText = await page.locator('.duplicate-card').innerText();
assert.match(duplicateText, /already in your library/i);
assert.match(duplicateText, /Prospecting & Pipeline Generation/);
assert.match(duplicateText, /Save as newer version/);
assert.equal(await page.locator('.upload-alert').count(), 0);
await page.screenshot({ path: path.resolve('output/upload-review/duplicate-upload-desktop.png'), fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
const duplicateMobile = await page.evaluate(() => ({
  noOverflow: document.documentElement.scrollWidth <= window.innerWidth,
  columns: getComputedStyle(document.querySelector('.duplicate-card')).gridTemplateColumns,
}));
assert.equal(duplicateMobile.noOverflow, true);
assert.equal(duplicateMobile.columns.trim().split(/\s+/).length, 1);
await page.screenshot({ path: path.resolve('output/upload-review/duplicate-upload-mobile.png'), fullPage: true });

console.log(JSON.stringify({ ok: true, desktop: { leftWidth: Math.round(desktop.leftWidth), rightWidth: Math.round(desktop.rightWidth), rightOffset: Math.round(desktop.rightOffset), noOverflow: desktop.noOverflow }, mobile, duplicateMobile }, null, 2));
await context.close();
await browser.close();
