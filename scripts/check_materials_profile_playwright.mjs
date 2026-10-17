// Isolated local UI regression for the materials/workspace and profile layout.
// The API responses below exist only inside this browser context.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const baseUrl = process.env.EXAMMIND_UI_URL || 'http://127.0.0.1:5173';
const appOrigin = new URL(baseUrl);
const tooling = path.join(process.env.TEMP, 'exammind-s8-playwright/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(tooling).href);
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--disable-background-networking', '--disable-component-update'],
});

const errors = [];
try {
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname === appOrigin.hostname && url.port === appOrigin.port
        ? route.continue()
        : route.abort('blockedbyclient');
    });
    await context.addInitScript(() => {
      localStorage.setItem('exammind-first-upload-auth-reset-v1', 'true');
      localStorage.setItem('token', 'exammind:materials-profile-fixture');
      const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const url = String(args[0]);
        if (!url.includes(':8001')) return originalFetch(...args);
        if (url.endsWith('/auth/me')) return json({ id: 1, name: 'Test Student', username: 'test_student', email: 'test@example.com', role: 'student', account_status: 'active' });
        if (url.endsWith('/learning-spaces')) {
          const space = { id: 1, slug: 'ksa', name: 'Kora Sales Academy', type: 'academy', status: 'active', membership: { id: 1, role: 'member', status: 'active', onboarding_required: false } };
          return json({ active_space: space, memberships: [{ space }], available_spaces: [] });
        }
        if (url.endsWith('/community/profile')) return json({ username: 'test_student', onboarding_completed: true, onboarding_required: false });
        if (url.endsWith('/profiles/test_student')) return json({ id: 1, username: 'test_student', name: 'Test Student', is_self: true, past_questions_uploaded: 1, lecture_notes_uploaded: 1, materials_uploaded: 2, groups_joined: 0, rooms_joined: 0, practice_attempts: 0, courses: [] });
        if (url.endsWith('/courses')) return json([{ id: 1, code: 'KSA-01', name: 'Prospecting' }]);
        if (url.includes('/lecture-notes?') || url.endsWith('/lecture-notes')) return json([{ id: 1, title: 'Prospecting notes', file_name: 'prospecting.pdf', has_file: false, file_size: 0, is_owner: true, course_id: 1, topic: 'Qualification', visibility: 'private', created_at: '2026-10-10T10:00:00Z', metadata_json: { document_type: 'lecture_note', document_title: 'Prospecting notes', course_code: 'KSA-01', indexed_status: 'indexed' } }]);
        if (url.includes('/past-questions?') || url.endsWith('/past-questions')) return json([{ id: 2, title: 'Qualification practice', content_text: 'Explain qualification.', file_name: null, has_file: false, file_size: 0, is_owner: true, course_id: 1, year: 2026, visibility: 'private', created_at: '2026-10-09T10:00:00Z', metadata_json: { document_type: 'past_question', course_code: 'KSA-01', indexed_status: 'indexed' } }]);
        if (url.endsWith('/lecture-notes/1')) return json({ id: 1, title: 'Prospecting notes', has_file: false, file_size: 0, content_text: 'Qualification notes.', metadata_json: { document_type: 'lecture_note', course_code: 'KSA-01' }, sections: [{ id: 1, heading: 'Qualification', body: 'Qualification notes.' }] });
        if (url.includes('/analytics/student/')) return json({ readiness: [], attempts: [] });
        if (url.endsWith('/study-sessions?active_only=true')) return json([]);
        return json([]);
      };
    });

    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    let ingestRequests = 0;
    page.on('request', request => { if (request.url().includes('/ingest/upload')) ingestRequests += 1; });
    page.setDefaultTimeout(10_000);
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.locator('.workspace-shell').waitFor();

    if (viewport.width < 760) {
      await page.getByRole('button', { name: 'Open all navigation', exact: true }).click();
    }
    assert.equal(await page.getByRole('button', { name: 'View all materials', exact: false }).count(), 1, 'Dashboard materials list must open My Materials');
    await page.getByRole('button', { name: 'My Materials', exact: true }).click();
    await page.locator('#s-materials').waitFor();
    assert.equal(await page.locator('#s-workspace').count(), 0, 'My Materials must not mount Workspace');
    assert.equal(await page.getByRole('heading', { name: 'My Materials', exact: false }).count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Materials overflow at ${viewport.width}px`);

    await page.locator('.materials-row').first().click();
    await page.locator('#s-workspace').waitFor();
    assert.equal(await page.locator('#s-materials').count(), 0, 'Opening a material must switch to Workspace');

    await page.getByRole('button', { name: 'Open your profile', exact: true }).click();
    await page.locator('#s-profile').waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Test Student', exact: true }).count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Profile overflow at ${viewport.width}px`);
    if (viewport.width >= 760) {
      const bounds = await page.locator('#s-profile').evaluate(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }));
      assert.ok(bounds.left > 90 && bounds.right < viewport.width - 20, `Profile is not centered: ${JSON.stringify(bounds)}`);
    }

    if (viewport.width < 760) {
      await page.getByRole('button', { name: 'Open all navigation', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Add material', exact: true }).click();
    await page.locator('#s-upload').waitFor();
    await page.locator('#file-input').setInputFiles({ name: 'voice-note.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('not-a-real-audio-file') });
    await page.getByText('Audio and video transcription is not supported yet. Coming soon.', { exact: true }).waitFor();
    assert.equal(ingestRequests, 0, 'Unsupported media must not call the upload API');
    await context.close();
  }
  assert.deepEqual(errors, [], 'Materials/profile browser runtime errors');
  console.log(JSON.stringify({ ok: true, checked: ['separate My Materials screen', 'material opens in Workspace', 'centered Profile column', 'audio/video coming-soon guard', 'desktop/mobile overflow'] }, null, 2));
} finally {
  await browser.close();
}
