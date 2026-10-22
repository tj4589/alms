// Focused browser regression for the purpose-built workspace slide reader.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tooling = path.join(process.env.TEMP, 'exammind-s8-playwright/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(tooling).href);
const apiOrigin = 'http://127.0.0.1:8001';
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const space = { id: 1, slug: 'cu', name: 'Covenant University', type: 'university', status: 'active', membership: { id: 1, role: 'member', status: 'active', onboarding_required: false } };
const resources = [
  { id: 1, title: 'Week 2 reading', file_name: 'week-2-reading.pdf', has_file: true, is_owner: true, course_id: 1, metadata_json: { document_type: 'lecture_note', document_title: 'Week 2 reading', course_code: 'ECO 101' } },
];
const detail = { ...resources[0], content_text: 'Opportunity cost is the value of the next best alternative forgone.', sections: [{ id: 12, heading: 'Opportunity cost', body: 'Opportunity cost is the value of the next best alternative forgone.', page_from: 4, page_to: 4 }, { id: 13, heading: 'Decision context', body: 'The next best alternative provides the comparison point.', page_from: 5, page_to: 5 }] };

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-background-networking', '--disable-component-update'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
await context.route('**/*', async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== apiOrigin) return route.continue();
  let body = [];
  if (url.pathname === '/auth/me') body = { id: 1, name: 'Reader Fixture', username: 'reader_fixture', email: 'reader@example.com', role: 'student', account_status: 'active' };
  else if (url.pathname === '/learning-spaces') body = { active_space: space, memberships: [{ space }], available_spaces: [] };
  else if (url.pathname === '/community/profile') body = { onboarding_required: false, onboarding_state: 'completed' };
  else if (url.pathname.endsWith('/lecture-notes')) body = resources;
  else if (url.pathname.endsWith('/lecture-notes/1')) body = detail;
  else if (url.pathname.endsWith('/past-questions')) body = [];
  else if (url.pathname === '/learning/profile') body = { explicit_preferences: {}, inferred_preferences: {} };
  else if (url.pathname === '/learning/readiness') body = { available: false, score: null, topics: [] };
  else if (url.pathname.startsWith('/analytics/student/')) body = { readiness: [], attempts: [] };
  else if (url.pathname === '/courses') body = [{ id: 1, code: 'ECO 101', name: 'Introduction to Economics' }];
  else if (url.pathname === '/health') body = { status: 'ok' };
  return route.fulfill(json(body));
});

const page = await context.newPage();
page.setDefaultTimeout(10000);
page.on('console', message => { if (message.type() === 'error') console.error('[browser]', message.text()); });
page.on('pageerror', error => console.error('[pageerror]', error.message));
await page.addInitScript(() => { localStorage.setItem('token', 'exammind:reader-fixture'); localStorage.setItem('exammind-first-upload-auth-reset-v1', 'true'); });
await page.goto('http://127.0.0.1:5173/#home', { waitUntil: 'networkidle' });
await page.locator('.desk-course-empty, .desk-course').first().waitFor();
await page.getByRole('button', { name: 'My desk', exact: true }).click();
await page.locator('.desk-space-primary').waitFor();
await page.locator('.desk-space-primary').click();
await page.locator('#s-workspace .ws-source-list').waitFor();
await page.getByText('Week 2 reading', { exact: true }).first().click();
await page.locator('#s-workspace .ws-slide-reader').waitFor();
assert.equal(await page.locator('#s-workspace iframe.ws-native-preview').count(), 0, 'Native browser PDF viewer leaked into the reader');
assert.match(await page.locator('#s-workspace .ws-slide-count').textContent(), /1\s+of\s+2/);
assert.equal(await page.locator('#s-workspace .ws-slide-nav[aria-label="Next slide"]').count(), 1);
assert.equal(await page.locator('#s-workspace .ws-slide-fullscreen').count(), 1);
await page.locator('#s-workspace .ws-slide-nav[aria-label="Next slide"]').click();
assert.match(await page.locator('#s-workspace .ws-slide-count').textContent(), /2\s+of\s+2/);
await page.locator('#s-workspace .ws-slide-nav[aria-label="Previous slide"]').click();
assert.match(await page.locator('#s-workspace .ws-slide-count').textContent(), /1\s+of\s+2/);

await page.locator('#s-workspace .ws-slide-sheet-body p').selectText();
await page.locator('#s-workspace .ws-reader-content').dispatchEvent('mouseup');
await page.locator('#s-workspace .ws-selection-action').waitFor();
await page.locator('#s-workspace .ws-selection-action').click();
assert.match(await page.locator('#s-workspace .ai-context-strip').textContent(), /Selected text in context/i);

await page.setViewportSize({ width: 390, height: 844 });
assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Workspace reader overflows on mobile');
console.log(JSON.stringify({ ok: true, native_pdf_viewer: false, selection_to_maxe: true, mobile_overflow: true, page_count: await page.locator('#s-workspace .ws-slide-count').textContent() }));
await context.close();
await browser.close();
