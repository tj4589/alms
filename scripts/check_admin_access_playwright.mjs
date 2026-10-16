// Isolated admin-route regression. Requires local Vite on port 5173 and the
// temporary Playwright tooling used by the repository browser checks.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tooling = path.join(process.env.TEMP, 'exammind-s8-playwright/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(tooling).href);
const source = await readFile('scripts/check_ksa_admin.mjs', 'utf8');
const fixtureMatch = source.match(/const fixture = `([\s\S]*?)`;\r?\n\r?\nawait send\('Page\.enable'\)/);
if (!fixtureMatch) throw new Error('Could not load the isolated KSA admin fixture.');

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--disable-background-networking', '--disable-component-update'],
});
const errors = [];
const scenarios = [];

try {
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '5173'
        ? route.continue()
        : route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript({ content: fixtureMatch[1] + `
      const fixtureFetch = window.fetch;
      window.__authFailure = new URL(location.href).searchParams.get('auth_failure');
      window.__collaborationAssigned = false;
      window.__failNextCollaborationAssignment = false;
      window.fetch = async (...args) => {
        const url = String(args[0]);
        const mode = new URL(location.href).searchParams;
        if (url.includes('/collaboration/admin/spaces')) {
          return new Response(JSON.stringify([{id:7,name:'Kora Sales Academy',slug:'ksa'}]), {headers:{'Content-Type':'application/json'}});
        }
        if (url.includes('/collaboration/admin/quarantine?')) {
          const items = window.__collaborationAssigned ? [] : [{content_type:'group',id:81,title:'Legacy review group',group_id:null,created_at:'2026-09-01T00:00:00Z'}];
          return new Response(JSON.stringify({items,total:items.length,offset:0,limit:100}), {headers:{'Content-Type':'application/json'}});
        }
        if (url.includes('/collaboration/admin/quarantine/group/81/assign')) {
          window.__fixtureRequests.push({url,method:args[1]?.method || 'POST',body:args[1]?.body || null});
          if (window.__failNextCollaborationAssignment) {
            window.__failNextCollaborationAssignment = false;
            return new Response(JSON.stringify({detail:'Linked record needs review.'}), {status:409,headers:{'Content-Type':'application/json'}});
          }
          await new Promise(resolve => setTimeout(resolve, 120));
          window.__collaborationAssigned = true;
          return new Response(JSON.stringify({status:'assigned',content_type:'group',id:81,learning_space_id:7}), {headers:{'Content-Type':'application/json'}});
        }
        if (url.endsWith('/auth/me') && window.__authFailure) {
          const status = Number(window.__authFailure);
          return new Response(JSON.stringify({detail:'Account service temporarily unavailable.'}), {status,headers:{'Content-Type':'application/json'}});
        }
        if (url.endsWith('/auth/me') && mode.has('role_only')) {
          return new Response(JSON.stringify({id:2,name:'Unregistered admin',email:'unregistered@example.com',role:'admin',admin_portal_access:false,account_status:'active'}), {headers:{'Content-Type':'application/json'}});
        }
        if (url.endsWith('/learning-spaces') && mode.has('no_membership')) {
          return new Response(JSON.stringify({active_space:null,memberships:[],available_spaces:[]}), {headers:{'Content-Type':'application/json'}});
        }
        return fixtureFetch(...args);
      };
    ` });

    await page.goto('http://127.0.0.1:5173/admin?unauthorized=1', { waitUntil: 'networkidle' });
    const denied = page.getByTestId('admin-access-denied');
    await denied.waitFor();
    await assert.doesNotReject(() => page.getByRole('heading', { name: 'Admins only' }).waitFor());
    assert.equal(await page.locator('.admin-dashboard-page').count(), 0, 'Unauthorized accounts must not mount admin content.');
    assert.equal(await page.locator('.workspace-shell').count(), 0, 'Unauthorized accounts must not mount the student workspace.');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Denied admin route must not overflow horizontally.');
    if (process.env.ADMIN_SCREENSHOT_DIR && viewport.width === 1366) {
      await page.screenshot({ path: path.join(process.env.ADMIN_SCREENSHOT_DIR, 'admin-access-denied.png'), fullPage: true });
    }

    await page.getByRole('button', { name: 'Return to my desk' }).click();
    await page.locator('.workspace-shell').waitFor();
    assert.equal(new URL(page.url()).pathname, '/', 'Returning to the workspace must leave the admin route.');

    await page.goto('http://127.0.0.1:5173/admin', { waitUntil: 'networkidle' });
    await page.locator('.admin-dashboard-page').waitFor();
    assert.equal(await page.getByTestId('admin-access-denied').count(), 0, 'Authorized admins must not see the denial state.');
    assert.equal(await page.getByRole('heading', { name: /Keep ExamMind/ }).count(), 1, 'Authorized admins must see the admin dashboard.');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Admin dashboard must not overflow horizontally.');
    if (process.env.ADMIN_SCREENSHOT_DIR && viewport.width === 1366) {
      await page.screenshot({ path: path.join(process.env.ADMIN_SCREENSHOT_DIR, 'admin-dashboard.png'), fullPage: true });
    }
    await page.getByRole('button', {name:'Review unassigned collaboration'}).click();
    await page.locator('.collaboration-review').waitFor();
    await page.getByText('Legacy review group').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('view'), 'collaboration');
    await page.getByRole('button', {name:'Review assignment'}).click();
    await page.getByLabel('Verified learning space').selectOption('7');
    await page.getByLabel('Evidence for assignment').fill('Confirmed KSA source');
    await page.evaluate(() => { window.__failNextCollaborationAssignment = true; });
    await page.getByRole('button', {name:'Confirm assignment'}).click();
    await page.getByRole('alert').getByText('Linked record needs review.').waitFor();
    assert.equal(await page.getByText('Legacy review group').count(), 1);
    await page.getByRole('button', {name:'Confirm assignment'}).click();
    await page.getByRole('button', {name:'Assigning…'}).waitFor();
    assert.equal(await page.getByRole('button', {name:'Assigning…'}).isDisabled(), true);
    await page.evaluate(() => document.querySelector('.collaboration-review-form-actions button:last-child')?.click());
    await page.getByRole('status').getByText('Learning space assigned and recorded in the audit history.').waitFor();
    await page.getByText('No unassigned groups in this queue.').waitFor();
    assert.equal(await page.evaluate(() => window.__fixtureRequests.filter(item => item.url.includes('/collaboration/admin/quarantine/group/81/assign')).length), 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Collaboration review must fit the viewport.');
    await page.reload({waitUntil:'networkidle'});
    await page.locator('.collaboration-review').waitFor();
    await page.getByRole('button', {name:'Admin overview'}).click();

    await page.goto('http://127.0.0.1:5173/admin?role_only=1', { waitUntil: 'networkidle' });
    await denied.waitFor();
    assert.equal(await page.locator('.admin-dashboard-page').count(), 0, 'A DB admin role without the server email gate must remain denied.');
    assert.equal(await page.evaluate(() => window.__fixtureRequests.some(item => item.url.includes('/feedback/inbox') || item.url.includes('/moderation/'))), false);

    await page.goto('http://127.0.0.1:5173/admin?no_membership=1', { waitUntil: 'networkidle' });
    await page.locator('.admin-dashboard-page').waitFor();
    await page.getByRole('button', { name: 'Open queue', exact: false }).click();
    await page.locator('.moderation-page').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('view'), 'moderation');
    assert.equal(await page.locator('.workspace-shell').count(), 0, 'Admin operations must not depend on student onboarding.');
    await page.getByRole('button', { name: 'Admin overview', exact: true }).click();
    await page.getByRole('button', { name: 'Open inbox', exact: false }).click();
    await page.locator('.feedback-inbox').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('view'), 'feedback');
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.feedback-inbox').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: 'Admin overview', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh signals' }).click();
    await page.getByRole('button', { name: 'Refresh signals' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Continue with Google', exact: false }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('token')), null);

    await page.goto('http://127.0.0.1:5173/admin?auth_failure=503', { waitUntil: 'networkidle' });
    await page.getByText('Your account could not be loaded.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('token')), 'phase-s4-3-browser-fixture', 'Transient account failures must not erase a valid session.');
    await page.evaluate(() => { window.__authFailure = null; });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.locator('.admin-dashboard-page').waitFor();

    await page.goto('http://127.0.0.1:5173/admin?auth_failure=401', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue with Google', exact: false }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('token')), null, 'Invalid sessions must be cleared.');
    scenarios.push({viewport, denied:true, roleOnlyDenied:true, queue:true, inbox:true, directReload:true, retry503:true, expired401:true, logout:true});

    await context.close();
  }

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    ok: true,
    scenarios,
    checked: [
      'unauthorized standalone denial',
      'admin content not mounted for unauthorized account',
      'return to workspace',
      'authorized /admin dashboard',
      'global-admin-only collaboration review, reason, failed and successful assignment, duplicate prevention, direct reload',
      'desktop/mobile overflow',
      'runtime and console errors',
    ],
  }, null, 2));
} finally {
  await browser.close();
}
