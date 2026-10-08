// Isolated reminder-settings browser check. Requires a local Vite preview and
// the temporary Playwright tooling; no real API, notification provider or
// browser subscription is contacted.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tooling = path.join(process.env.TEMP, 'exammind-s8-playwright/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(tooling).href);
const baseUrl = process.env.EXAMMIND_UI_URL || 'http://127.0.0.1:4185';
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

await context.addInitScript(() => {
  localStorage.setItem('token', 'exammind:local-development-session');
  localStorage.setItem('exammind-first-upload-auth-reset-v1', 'true');
  localStorage.setItem('exammind-maxe-nudge-v1', 'seen');
  window.__reminderFixture = {
    email: false,
    browser_push: false,
    requests: [],
    delayMs: 150,
    failNext: false,
  };
  const pushSubscription = {
    endpoint: 'https://push.example.test/browser/fixture',
    toJSON: () => ({ endpoint: 'https://push.example.test/browser/fixture', keys: { p256dh: 'fixture-public', auth: 'fixture-auth' } }),
    unsubscribe: async () => { window.__reminderFixture.browser_push = false; return true; },
  };
  const registration = {
    pushManager: {
      getSubscription: async () => window.__reminderFixture.browser_push ? pushSubscription : null,
      subscribe: async () => { window.__reminderFixture.browser_push = true; return pushSubscription; },
    },
  };
  Object.defineProperty(window, 'Notification', { configurable: true, value: { requestPermission: async () => 'granted' } });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
    register: async () => registration,
    getRegistration: async () => registration,
  } });

  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = String(args[0]);
    const method = String(args[1]?.method || 'GET').toUpperCase();
    if (!url.includes(':8001')) return originalFetch(...args);
    const fixture = window.__reminderFixture;
    fixture.requests.push({ url, method, body: args[1]?.body || null });
    if (url.includes('/auth/me')) return json({ id: 1, name: 'Reminder Student', username: 'reminder_student', email: 'student@example.com', role: 'student', account_status: 'active', admin_portal_access: false });
    if (url.endsWith('/learning-spaces')) return json({ active_space: { id: 1, slug: 'cu', name: 'Covenant University', type: 'university', status: 'active', membership: { id: 1, role: 'member', status: 'active', onboarding_required: false } }, memberships: [{ space: { id: 1, slug: 'cu', name: 'Covenant University', type: 'university', status: 'active' } }], available_spaces: [] });
    if (url.endsWith('/auth/account/deletion-status')) return json({ enabled: false });
    if (url.includes('/analytics/student/')) return json({ readiness: [], attempts: [] });
    if (url.endsWith('/courses')) return json([]);
    if (url.includes('/past-questions')) return json([]);
    if (url.includes('/lecture-notes')) return json([]);
    if (url.includes('/study-sessions')) return json([]);
    if (url.endsWith('/reminders') && method === 'GET') return json({
      enabled: fixture.email || fixture.browser_push,
      channels: {
        email: { subscribed: fixture.email, status: fixture.email ? 'active' : 'not_subscribed' },
        browser_push: { subscribed: fixture.browser_push, status: fixture.browser_push ? 'active' : 'not_subscribed' },
      },
      delivery: [],
      dispatch: { enabled: false, cadence: null, scheduled_worker_required: true },
    });
    if (url.endsWith('/reminders/subscriptions') && method === 'POST') {
      await new Promise(resolve => setTimeout(resolve, fixture.delayMs));
      if (fixture.failNext) {
        fixture.failNext = false;
        return new Response(JSON.stringify({ detail: 'fixture subscription failure' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      const request = JSON.parse(args[1]?.body || '{}');
      fixture[request.channel] = true;
      return new Response(JSON.stringify({ channel: request.channel, subscription: { subscribed: true, status: 'active' } }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/reminders/subscriptions/') && method === 'DELETE') {
      const channel = url.split('/').pop();
      fixture[channel] = false;
      return json({ channel, unsubscribed: true, subscriptions_updated: 1 });
    }
    if (url.endsWith('/reminders/unsubscribe') && method === 'POST') {
      fixture.email = false;
      fixture.browser_push = false;
      return json({ unsubscribed: true, subscriptions_updated: 2 });
    }
    return json([]);
  };
});

const waitFor = async selector => page.locator(selector).waitFor({ state: 'visible', timeout: 20000 });

try {
  await page.goto(`${baseUrl}/#home`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await waitFor('#settings-reminders-title');

  const emailOn = page.getByRole('button', { name: /Turn on email/ });
  await emailOn.click();
  assert.equal(await emailOn.isDisabled(), true, 'email action was not disabled while pending');
  await page.getByText('Email reminders are on.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Turn off email/ }).count(), 1);

  await page.getByRole('button', { name: /Turn on browser/ }).click();
  await page.getByText('Browser reminders are on for this device.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Turn off browser/ }).count(), 1);

  await page.getByRole('button', { name: /Turn off browser/ }).click();
  await page.getByText('Browser reminders are off for this device.', { exact: true }).waitFor();

  await page.getByRole('button', { name: /Turn off all reminders/ }).click();
  await page.getByText('All study reminders are off.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Turn on email/ }).count(), 1);

  await page.evaluate(() => { window.__reminderFixture.failNext = true; window.__reminderFixture.delayMs = 0; });
  await page.getByRole('button', { name: /Turn on email/ }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /fixture subscription failure/i);

  for (const [width, height] of [[1366, 768], [390, 844]]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal overflow at ${width}px`);
  }
  const requests = await page.evaluate(() => window.__reminderFixture.requests);
  assert.ok(requests.some(item => item.method === 'POST' && item.url.endsWith('/reminders/subscriptions')));
  assert.ok(requests.some(item => item.method === 'DELETE' && item.url.includes('/browser_push')));
  assert.ok(requests.some(item => item.method === 'POST' && item.url.endsWith('/reminders/unsubscribe')));
  assert.deepEqual(errors, [], JSON.stringify(failedRequests));
  assert.deepEqual(failedRequests, [], JSON.stringify(failedRequests));
  console.log(JSON.stringify({ ok: true, checked: ['email consent', 'browser-push consent', 'all-channel opt-out', 'pending duplicate prevention', 'request failure feedback', 'desktop/mobile overflow'], errors, failedRequests }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    failure: error instanceof Error ? error.message : String(error),
    body: (await page.locator('body').innerText().catch(() => '')).slice(0, 3000),
    errors,
    failedRequests,
  }, null, 2));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
