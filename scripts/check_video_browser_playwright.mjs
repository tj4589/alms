// Isolated local video workflow check. Requires a local Vite preview and the
// temporary Playwright tooling used by the other browser fixtures.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tooling = path.join(process.env.TEMP, 'exammind-s8-playwright/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(tooling).href);
const baseUrl = process.env.EXAMMIND_UI_URL || 'http://127.0.0.1:4185';
const fixturePath = process.argv[2];
if (!fixturePath) throw new Error('Usage: node scripts/check_video_browser_playwright.mjs <video-fixture>');

const videoBase64 = (await readFile(fixturePath)).toString('base64');

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--disable-background-networking', '--disable-component-update'],
});
const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  serviceWorkers: 'block',
  reducedMotion: 'reduce',
});
const errors = [];
const failedRequests = [];
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', request => failedRequests.push({ url: request.url(), failure: request.failure()?.errorText || 'unknown' }));
await context.addInitScript(({ encodedVideo }) => {
  localStorage.setItem('exammind-first-upload-auth-reset-v1', 'true');
  localStorage.setItem('token', 'exammind:local-development-session');
  localStorage.setItem('exammind-maxe-nudge-v1', 'seen');
  const resources = [
    { id: 1, title: 'Week 4 slides', file_name: 'week-4-slides.pptx', has_file: true, file_size: 123, uploaded_by: 1, course_id: 1, metadata_json: { document_type: 'lecture_note', document_title: 'Week 4 slides', course_code: 'ECO 101' } },
    { id: 2, title: 'Week 2 reading', file_name: 'week-2-reading.pdf', has_file: true, file_size: 123, uploaded_by: 1, course_id: 1, metadata_json: { document_type: 'lecture_note', document_title: 'Week 2 reading', course_code: 'ECO 101' } },
    { id: 3, title: 'Week 4 recording', file_name: 'week-4-recording.mp4', has_file: true, file_size: 45879, uploaded_by: 1, course_id: 1, content_text: 'The recording explains market structures.', metadata_json: { document_type: 'video', document_title: 'Week 4 recording', course_code: 'ECO 101' } },
  ];
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const originalFetch = window.fetch.bind(window);
  window.__fixtureRequests = [];
  window.fetch = async (...args) => {
    const url = String(args[0]);
    const method = String(args[1]?.method || 'GET').toUpperCase();
    if (!url.includes(':8001')) return originalFetch(...args);
    window.__fixtureRequests.push(url);
    if (url.includes('/materials/audio/3/download')) {
      const raw = atob(encodedVideo);
      const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'video/mp4' } });
    }
    if (url.includes('/auth/me')) return json({ id: 1, name: 'Test Student', username: 'test_student', email: 'test@example.com', role: 'student', account_status: 'active' });
    if (url.endsWith('/learning-spaces')) return json({ active_space: { id: 1, slug: 'cu', name: 'Covenant University', type: 'university', status: 'active', membership: { id: 1, role: 'member', status: 'active', onboarding_required: false } }, memberships: [{ space: { id: 1, slug: 'cu', name: 'Covenant University', type: 'university', status: 'active' } }], available_spaces: [] });
    if (url.endsWith('/lecture-notes')) return json(resources);
    if (url.includes('/lecture-notes/3')) return json(resources[2]);
    if (url.endsWith('/past-questions')) return json([]);
    if (url.includes('/materials/audio/3/transcript')) return json({ resource_id: 3, title: 'Week 4 recording', transcription_status: 'completed', segments: [{ id: 31, segment_index: 0, start_time: 0.4, end_time: 1.2, text: 'The recording explains market structures.', topic: 'Market structures' }] });
    if (url.includes('/understand')) return json({ intent: 'academic_explanation', student_state: 'focused', should_call_rag: true, should_search: true, should_ask_clarifying_question: false, interpreted_topic: 'the recording', related_terms: [], possible_course: null, possible_person: null, confidence: 0.95, response_strategy: 'answer from the current source' });
    if (url.includes('/maxe/chat')) return json({ answer: 'This answer is grounded in the authorized video transcript.', sources: ['Week 4 recording'], past_question_sources: [], lecture_note_sources: ['Week 4 recording'], source_citations: [{ source: 'Week 4 recording', material_type: 'audio', resource_type: 'audio', resource_id: 3, resource_title: 'Week 4 recording', label: 'Week 4 recording · 0:00', timestamp_start: 0.4, timestamp_end: 1.2, target: { screen: 'workspace', resource_type: 'audio', resource_id: 3, start_time: 0.4, end_time: 1.2 } }], insufficient_sources: false, no_past_questions_found: false, no_lecture_notes_found: false, understanding: null, mode: 'source', knowledge_gap: false, context: { mode: 'source', active_resource: { resource_type: 'audio', resource_id: 3, title: 'Week 4 recording' }, selected_text_used: false, recent_context_used: false } });
    if (url.endsWith('/learning/profile')) return json({ explicit_preferences: {}, inferred_preferences: {} });
    if (url.endsWith('/learning/readiness')) return json({ available: false, score: null, evidence_used: { answered_questions: 0, graded_answers: 0, correct_answers: 0, attempts: 0, distinct_topics: 0, known_topics: 1 }, topics: [], assessed_topics: [], unassessed_topics: ['Market structures'] });
    if (url.includes('/learning/attempts')) return json([]);
    if (url.endsWith('/learning/quizzes') && method === 'POST') return json({ id: 1, topic: 'Market structures', source_scope: 'workspace', resource_type: 'audio', resource_id: 3, difficulty: 'mixed', question_type: 'multiple_choice', question_count: 5, questions: [1, 2, 3, 4, 5].map(position => ({ id: position, position, question_type: 'multiple_choice', prompt: 'Which statement is supported by the recording?', options: ['The recording explains market structures', 'The recording is silent', 'The source is unavailable', 'The topic is not discussed'], topic: 'Market structures', difficulty: 'mixed', citation: { source: 'Week 4 recording', resource_type: 'audio', resource_id: 3, resource_title: 'Week 4 recording', label: 'Week 4 recording · 0:00', timestamp_start: 0.4, timestamp_end: 1.2 } })) });
    if (url.includes('/learning/quizzes/1/attempts')) return json({ id: 1, quiz_id: 1, score: 5, total_questions: 5, percentage: 100, review: [] });
    if (url.includes('/courses')) return json([{ id: 1, code: 'ECO 101', name: 'Introduction to Economics' }]);
    if (url.includes('/analytics/student/')) return json({ readiness: [], attempts: [] });
    return json([]);
  };
}, { encodedVideo: videoBase64 });

const waitFor = async (selector, timeout = 20000) => page.locator(selector).waitFor({ state: 'visible', timeout });
const waitForFunction = async (expression, timeout = 20000) => page.waitForFunction(expression, undefined, { timeout });

try {
  await page.goto(`${baseUrl}/#home`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'My Materials', exact: true }).click();
  await waitFor('#s-workspace .ws-source-list');
  await page.locator('#s-workspace .ws-source-search input').fill('recording');
  assert.equal(await page.locator('#s-workspace .ws-source-row').count(), 1, 'video was not searchable in the source list');
  await page.locator('#s-workspace .ws-source-row').click();
  await waitFor('#s-workspace .ws-reader-content h1');
  await waitFor('#s-workspace video');
  await waitForFunction("document.querySelector('#s-workspace video')?.readyState >= 1");
  const media = await page.locator('#s-workspace video').evaluate(video => ({ duration: video.duration, label: video.getAttribute('aria-label') }));
  assert.ok(media.duration >= 5.5 && media.duration <= 6.5, `unexpected video duration: ${media.duration}`);
  assert.equal(media.label, 'Play Week 4 recording');

  const input = page.locator('#s-workspace .ai-inp');
  await input.fill('Explain the recording');
  await input.press('Enter');
  await page.getByText('0:00', { exact: false }).last().waitFor();
  const citation = page.locator('#s-workspace .ai-citation').filter({ hasText: '0:00' }).last();
  await citation.click();
  await waitForFunction("Math.abs((document.querySelector('#s-workspace video')?.currentTime || 0) - 0.4) < 0.2");
  assert.ok(await page.locator('#s-workspace .ws-transcript-segment').count() > 0, 'video transcript did not render');

  await page.getByRole('button', { name: 'Practice', exact: true }).click();
  await waitFor('#s-practice #practice-scope');
  await page.locator('#s-practice .practice-primary').click();
  await waitFor('#s-practice .paper');
  assert.ok(await page.locator('#s-practice .quiz-option').count() >= 4, 'practice did not create a quiz');

  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${width}px`);
  }
  assert.deepEqual(errors, [], JSON.stringify(failedRequests));
  assert.deepEqual(failedRequests, [], JSON.stringify(failedRequests));
  console.log(JSON.stringify({
    ok: true,
    checked: ['video playback', 'video source filtering', 'timestamp citation click-through', 'timestamp transcript', 'practice integration', 'desktop/mobile overflow'],
    duration_seconds: media.duration,
    failedRequests,
    errors,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    failure: error instanceof Error ? error.message : String(error),
    body: (await page.locator('body').innerText().catch(() => '')).slice(0, 2000),
    errors,
    failedRequests,
  }, null, 2));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
