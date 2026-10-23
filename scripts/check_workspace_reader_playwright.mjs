// Focused browser regression for the purpose-built workspace slide reader.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tooling = path.join(process.env.TEMP, 'exammind-s8-playwright/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(tooling).href);
const apiOrigin = process.env.EXAMMIND_READER_API_ORIGIN || 'http://127.0.0.1:8001';
const webOrigin = process.env.EXAMMIND_READER_WEB_ORIGIN || 'http://127.0.0.1:5173';
const expectAdaptiveRender = process.env.EXAMMIND_READER_EXPECT_ADAPTIVE !== 'false';
const pointerReaderEvents = process.env.EXAMMIND_READER_POINTER_EVENTS === 'true';
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const slidePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const fixturePath = process.env.EXAMMIND_READER_FIXTURE_PATH;
const fileFixture = fixturePath ? JSON.parse(await readFile(fixturePath, 'utf8')) : null;
const space = { id: 1, slug: 'cu', name: 'Covenant University', type: 'university', status: 'active', membership: { id: 1, role: 'member', status: 'active', onboarding_required: false } };
const defaultResources = [
  { id: 1, title: 'Week 2 reading', file_name: 'week-2-reading.pdf', has_file: true, is_owner: true, course_id: 1, metadata_json: { document_type: 'lecture_note', document_title: 'Week 2 reading', course_code: 'ECO 101' } },
  { id: 2, title: 'Week 3 handout', file_name: 'week-3-handout.docx', has_file: true, is_owner: true, course_id: 1, metadata_json: { document_type: 'lecture_note', document_title: 'Week 3 handout', course_code: 'ECO 101' } },
];
const resources = fileFixture?.resources?.length
  ? [...fileFixture.resources, ...defaultResources.slice(fileFixture.resources.length)]
  : defaultResources;
const detail = fileFixture?.detail || { ...resources[0], content_text: 'Opportunity cost is the value of the next best alternative forgone.', sections: [{ id: 12, heading: 'Opportunity cost', body: 'Opportunity cost is the value of the next best alternative forgone.', page_from: 4, page_to: 4 }, { id: 13, heading: 'Decision context', body: 'The next best alternative provides the comparison point.', page_from: 5, page_to: 5 }] };
const handoutDetail = { ...(resources[1] || defaultResources[1]), content_text: 'A market is a group of buyers and sellers. Demand describes how much buyers are willing to purchase.', sections: [{ id: 22, heading: 'Markets and demand', body: 'A market is a group of buyers and sellers. Demand describes how much buyers are willing to purchase.', page_from: 1, page_to: 1 }] };
const readerPages = fileFixture?.pages || [
  { page: 1, width: 640, height: 360, text: detail.sections[0].body, spans: [{ text: detail.sections[0].body, x: 48, y: 72, width: 360, height: 24 }] },
  { page: 2, width: 640, height: 360, text: detail.sections[1].body, spans: [{ text: detail.sections[1].body, x: 48, y: 72, width: 360, height: 24 }] },
];
const pageImages = fileFixture?.images || {};
const expectedText = fileFixture?.expected_text || 'Opportunity cost';
const imageScales = [];

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
  else if (url.pathname.endsWith('/lecture-notes/2')) body = handoutDetail;
  else if (url.pathname.endsWith('/lecture-notes/1/pages')) body = { page_count: readerPages.length, pages: readerPages };
  else if (url.pathname.includes('/lecture-notes/1/pages/') && url.pathname.endsWith('/image')) {
    imageScales.push(Number(url.searchParams.get('scale')));
    const pageNumber = url.pathname.match(/pages\/(\d+)\/image$/)?.[1] || '1';
    return route.fulfill({ status: 200, contentType: 'image/png', body: pageImages[pageNumber] ? Buffer.from(pageImages[pageNumber], 'base64') : slidePng });
  }
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
await page.goto(`${webOrigin}/#home`, { waitUntil: 'networkidle' });
await page.locator('.desk-course-empty, .desk-course').first().waitFor();
await page.getByRole('button', { name: 'My desk', exact: true }).click();
await page.locator('.desk-space-primary').waitFor();
await page.locator('.desk-space-primary').click();
await page.locator('#s-workspace .ws-source-list').waitFor();
await page.getByText(resources[0].title, { exact: true }).first().click();
await page.locator('#s-workspace .ws-slide-reader').waitFor();
await page.locator('#s-workspace .ws-slide-visual img').waitFor();
const normalRenderScale = imageScales.at(-1);
if (expectAdaptiveRender) assert.ok(normalRenderScale >= 1.25 && normalRenderScale <= 4, 'Reader did not request a bounded adaptive render scale');
assert.equal(await page.locator('#s-workspace .ws-slide-text-hit').first().evaluate(node => getComputedStyle(node).userSelect), 'text');
const selectionBackground = await page.locator('#s-workspace .ws-slide-text-hit').first().evaluate(node => getComputedStyle(node, '::selection').backgroundColor);
assert.match(selectionBackground, /172, 64, 30/, 'Selected slide text has no visible highlight color');
const overlayAlignment = await page.locator('#s-workspace .ws-slide-text-hit').first().evaluate(node => {
  const hit = node.getBoundingClientRect();
  const image = node.closest('.ws-slide-visual-page')?.querySelector('img')?.getBoundingClientRect();
  return image ? { within: hit.left >= image.left - 1 && hit.top >= image.top - 1 && hit.right <= image.right + 1 && hit.bottom <= image.bottom + 1 } : { within: false };
});
assert.equal(overlayAlignment.within, true, 'Slide text overlay is misaligned with the rendered page');
if (pointerReaderEvents) {
  await page.locator('#s-workspace .ws-slide-text-hit').first().click();
  assert.equal(await page.getByRole('button', { name: 'Ask Maxe about this' }).count(), 0, 'A normal click on a line opened Ask Maxe without a text selection');
}
await page.locator('#s-workspace .ws-slide-text-hit').first().selectText();
assert.match(await page.evaluate(() => window.getSelection()?.toString().trim() || ''), new RegExp(expectedText));
await page.locator('#s-workspace .ws-slide-reader').dispatchEvent(pointerReaderEvents ? 'pointerup' : 'mouseup');
await page.getByRole('button', { name: 'Ask Maxe about this' }).waitFor();
await page.locator('#s-workspace .ws-slide-toolbar-copy').click();
assert.equal(await page.getByRole('button', { name: 'Ask Maxe about this' }).count(), 0, 'Ask Maxe action did not dismiss after clicking outside the selected text');
assert.equal(await page.locator('#s-workspace .ws-selection-note').count(), 0, 'Selected-text context remained after dismissing the action');
await page.locator('#s-workspace .ws-slide-text-hit').first().selectText();
await page.locator('#s-workspace .ws-slide-reader').dispatchEvent(pointerReaderEvents ? 'pointerup' : 'mouseup');
await page.getByRole('button', { name: 'Ask Maxe about this' }).waitFor();
await page.getByRole('button', { name: 'Ask Maxe about this' }).click();
assert.match(await page.locator('#s-workspace .ai-context-strip').textContent(), /Selected text in context/i);
await page.locator('#s-workspace .ws-reader-header h1').selectText();
await page.locator('#s-workspace .ws-reader-content').dispatchEvent('mouseup');
assert.equal(await page.getByRole('button', { name: 'Ask Maxe about this' }).count(), 0, 'Text outside the slide opened Ask Maxe');
assert.equal(await page.locator('#s-workspace iframe.ws-native-preview').count(), 0, 'Native browser PDF viewer leaked into the reader');
assert.match(await page.locator('#s-workspace .ws-slide-count').textContent(), new RegExp(`1\\s+of\\s+${readerPages.length}`));
assert.equal(await page.locator('#s-workspace .ws-slide-nav[aria-label="Next slide"]').count(), 1);
assert.equal(await page.locator('#s-workspace .ws-slide-fullscreen').count(), 1);
const highScaleResponse = expectAdaptiveRender ? page.waitForResponse(response => {
  const url = new URL(response.url());
  return url.pathname.includes('/lecture-notes/1/pages/') && url.pathname.endsWith('/image') && Number(url.searchParams.get('scale')) > normalRenderScale;
}) : null;
await page.locator('#s-workspace .ws-slide-fullscreen').click();
const highRenderScale = highScaleResponse ? Number(new URL((await highScaleResponse).url()).searchParams.get('scale')) : null;
if (expectAdaptiveRender) assert.ok(highRenderScale > normalRenderScale, 'Fullscreen did not request a higher-resolution slide render');
const fullscreenChecked = await page.evaluate(() => Boolean(document.fullscreenElement));
if (fullscreenChecked) {
  const fullscreenMetrics = await page.locator('#s-workspace .ws-slide-sheet').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
  });
  assert.ok(fullscreenMetrics.width <= fullscreenMetrics.viewportWidth + 1, 'Fullscreen slide exceeds viewport width');
  assert.ok(fullscreenMetrics.height <= fullscreenMetrics.viewportHeight + 1, 'Fullscreen slide exceeds viewport height');
  await page.keyboard.press('Escape');
}
await page.locator('#s-workspace .ws-slide-nav[aria-label="Next slide"]').click();
assert.match(await page.locator('#s-workspace .ws-slide-count').textContent(), new RegExp(`2\\s+of\\s+${readerPages.length}`));
await page.locator('#s-workspace .ws-slide-nav[aria-label="Previous slide"]').click();
assert.match(await page.locator('#s-workspace .ws-slide-count').textContent(), new RegExp(`1\\s+of\\s+${readerPages.length}`));
await page.locator('#s-workspace .ws-slide-view-toggle').click();

await page.locator('#s-workspace .ws-slide-sheet-body p').first().selectText();
await page.locator('#s-workspace .ws-slide-reader').dispatchEvent(pointerReaderEvents ? 'pointerup' : 'mouseup');
await page.getByRole('button', { name: 'Ask Maxe about this' }).waitFor();
await page.getByRole('button', { name: 'Ask Maxe about this' }).click();
assert.match(await page.locator('#s-workspace .ai-context-strip').textContent(), /Selected text in context/i);

// Ordinary reading text uses a separate selection action; clicking away must
// dismiss that action and clear the browser selection and Maxe context.
if (!fileFixture && resources.some(resource => resource.title === 'Week 3 handout')) {
  await page.locator('#s-workspace .ws-source-row').filter({ hasText: 'Week 3 handout' }).click({ force: true });
  await page.locator('#s-workspace .ws-reading-section p').waitFor();
  await page.locator('#s-workspace .ws-reading-section p').selectText();
  await page.locator('#s-workspace .ws-reader-content').dispatchEvent('pointerup');
  await page.locator('#s-workspace .ws-selection-action').waitFor();
  await page.locator('#s-workspace .ws-reader-header h1').click();
  assert.equal(await page.locator('#s-workspace .ws-selection-action').count(), 0, 'Ask Maxe action did not dismiss after clicking outside it');
  assert.equal(await page.locator('#s-workspace .ws-selection-note').count(), 0, 'Selected-text context remained after dismissing the text action');
}

await page.setViewportSize({ width: 390, height: 844 });
assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Workspace reader overflows on mobile');
console.log(JSON.stringify({ ok: true, native_pdf_viewer: false, selection_to_maxe: true, selection_action_click_away: true, slide_only_ask_maxe: true, fullscreen_checked: fullscreenChecked, mobile_overflow: true, normal_render_scale: normalRenderScale, fullscreen_render_scale: highRenderScale, page_count: await page.locator('#s-workspace .ws-slide-count').textContent() }));
await context.close();
await browser.close();
