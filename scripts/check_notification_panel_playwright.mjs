// Isolated local regression for the notification bell. The API is mocked with
// a persistent, account/learning-space-scoped server fixture; this does not
// claim to verify a live deployment or a real push provider.
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

  const notificationFixtureKey = 'notification-fixture-v2';
  const fixture = JSON.parse(localStorage.getItem(notificationFixtureKey) || JSON.stringify({
    readAll: 0,
    notifications: [{
      id: 101,
      event_type: 'discussion_reply',
      title: 'New reply in your discussion',
      body: 'A student replied to a discussion you started.',
      target_screen: 'discussions',
      target_id: 42,
      created_at: new Date().toISOString(),
      read_at: null,
    }],
  }));
  const persistFixture = () => localStorage.setItem(notificationFixtureKey, JSON.stringify(fixture));
  persistFixture();

  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = String(args[0]);
    const init = args[1] || {};
    const method = String(init.method || 'GET').toUpperCase();
    if (!url.includes(':8001')) return originalFetch(...args);
    if (url.includes('/auth/me')) return json({
      id: 1,
      name: 'Notification Student',
      username: 'notification_student',
      email: 'student@example.com',
      role: 'student',
      account_status: 'active',
      admin_portal_access: false,
    });
    if (url.endsWith('/learning-spaces')) return json({
      active_space: {
        id: 1,
        slug: 'cu',
        name: 'Covenant University',
        type: 'university',
        status: 'active',
        membership: { id: 1, role: 'member', status: 'active', onboarding_required: false },
      },
      memberships: [{ space: { id: 1, slug: 'cu', name: 'Covenant University', type: 'university', status: 'active' } }],
      available_spaces: [],
    });
    if (url.endsWith('/auth/account/deletion-status')) return json({ enabled: false });
    if (url.includes('/analytics/student/')) return json({ readiness: [], attempts: [] });
    if (url.endsWith('/notifications') && method === 'GET') {
      return json({
        items: fixture.notifications,
        unread_count: fixture.notifications.filter(item => item.read_at === null).length,
      });
    }
    if (url.includes('/notifications/101/read') && method === 'PATCH') {
      fixture.notifications = fixture.notifications.map(item => item.id === 101 ? { ...item, read_at: new Date().toISOString() } : item);
      persistFixture();
      return json(fixture.notifications.find(item => item.id === 101));
    }
    if (url.endsWith('/notifications/read-all') && method === 'POST') {
      fixture.notifications = fixture.notifications.map(item => ({ ...item, read_at: item.read_at || new Date().toISOString() }));
      fixture.readAll += 1;
      persistFixture();
      return json({ updated_count: fixture.notifications.length, unread_count: 0 });
    }
    if (url.endsWith('/courses') || url.includes('/past-questions') || url.includes('/lecture-notes') || url.includes('/study-sessions')) return json([]);
    return json([]);
  };
});

async function seedOfflineQueue() {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('exammind-offline', 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ['studyPacks', 'pendingUploads', 'practiceAttempts', 'savedItems']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        const store = request.transaction.objectStore(name);
        if (!store.indexNames.contains('scope')) store.createIndex('scope', '_scope');
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['pendingUploads', 'practiceAttempts'], 'readwrite');
      tx.objectStore('pendingUploads').put({
        id: '1:1|upload-1',
        _scope: '1:1',
        _recordId: 'upload-1',
        fileName: 'notes.pdf',
        fileSize: 1,
        queuedAt: new Date().toISOString(),
        status: 'waiting_to_sync',
        fileData: new ArrayBuffer(0),
      });
      tx.objectStore('practiceAttempts').put({
        id: '1:1|attempt-1',
        _scope: '1:1',
        _recordId: 'attempt-1',
        queuedAt: new Date().toISOString(),
        score: 1,
        total_questions: 1,
      });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
}

try {
  await page.goto(`${baseUrl}/#home`, { waitUntil: 'networkidle' });
  await page.locator('#s-dashboard').waitFor({ state: 'visible', timeout: 20000 });
  await seedOfflineQueue();
  await page.getByRole('button', { name: 'Open notifications' }).click();
  await page.getByRole('dialog', { name: 'Notifications' }).waitFor({ state: 'visible' });
  await page.getByText('3 unread', { exact: true }).waitFor();
  await page.getByText('New reply in your discussion', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Mark all as read' }).count(), 1);

  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await page.waitForTimeout(250);
  const localReadKeys = await page.evaluate(() => JSON.parse(localStorage.getItem('exammind-notifications-read-v1:1%3A1') || '[]'));
  assert.deepEqual(localReadKeys.sort(), ['attempts:1', 'uploads:1']);
  await page.getByText('All caught up', { exact: true }).waitFor();
  assert.equal(await page.getByText('Unread', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('notification-fixture-v2') || '{}').readAll), 1);

  await page.keyboard.press('Escape');
  // Remove only the local queue read marker. The next open must still be
  // caught up because the server fixture persisted its read_at values.
  await page.evaluate(() => localStorage.removeItem('exammind-notifications-read-v1:1%3A1'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#s-dashboard').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByRole('button', { name: 'Open notifications' }).click();
  await page.getByText('2 unread', { exact: true }).waitFor();
  const serverRow = page.locator('.notif-item').filter({ hasText: 'New reply in your discussion' });
  assert.equal(await serverRow.evaluate(row => row.className.includes('is-read')), true);
  assert.equal(await page.getByText('Unread', { exact: true }).count(), 2);

  for (const [width, height] of [[1366, 768], [390, 844]]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal overflow at ${width}px`);
  }

  assert.deepEqual(errors, [], JSON.stringify(failedRequests));
  assert.deepEqual(failedRequests, [], JSON.stringify(failedRequests));
  console.log(JSON.stringify({
    ok: true,
    checked: ['server discussion event', 'scoped queue items', 'unread state', 'mark all as read', 'server read-state persistence after reload', 'desktop/mobile overflow'],
    errors,
    failedRequests,
  }, null, 2));
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
