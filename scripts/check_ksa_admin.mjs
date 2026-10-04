// Local browser verification for S5.3. The API fixture is injected only into
// this browser page; no production endpoint or database is modified.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const target = await (await fetch('http://127.0.0.1:9225/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map();
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(message.error);
    else request.resolve(message.result);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const waitFor = async expression => {
  const start = Date.now();
  while (Date.now() - start < 20_000) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${expression}`);
};
const clickWhenAvailable = async selector => {
  const start = Date.now();
  while (Date.now() - start < 20_000) {
    if (await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element || !element.isConnected) return false; element.click(); return true; })()`)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out clicking: ${selector}`);
};
const fixture = `
localStorage.setItem('exammind-first-upload-auth-reset-v1', 'true');
localStorage.setItem('token', 'phase-s4-3-browser-fixture');
window.__fixtureRequests = [];
window.__claimReleased = false;
window.__ksaRole = 'member';
window.__failNextRolePost = false;
window.__delayNextRolePost = false;
const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const url = String(args[0]);
  if (!url.includes(':8001')) return originalFetch(...args);
  window.__fixtureRequests.push({url, method: args[1]?.method || 'GET', body: args[1]?.body || null});
  if (url.endsWith('/auth/me')) return new Response(JSON.stringify({id:2,name:'Global Admin',username:'admin',email:'admin@example.com',role:'admin',admin_portal_access:true,account_status:'active'}), {status:200,headers:{'Content-Type':'application/json'}});
  if (url.endsWith('/learning-spaces')) {
    const ksa = {id:1,slug:'ksa',name:'Kora Sales Academy',type:'academy',status:'active',membership:{id:1,role:'admin',status:'active',onboarding_required:false}};
    return new Response(JSON.stringify({active_space:ksa,memberships:[{space:ksa}],available_spaces:[]}), {status:200,headers:{'Content-Type':'application/json'}});
  }
  if (url.includes('/community/profile')) return new Response(JSON.stringify({onboarding_completed:true}), {status:200,headers:{'Content-Type':'application/json'}});
  if (url.includes('/collaboration/moderation/contributions')) return new Response(JSON.stringify([]), {status:200,headers:{'Content-Type':'application/json'}});
  if (url.includes('/learning-spaces/ksa/admin/moderators/44') && (args[1]?.method || 'GET') === 'POST') {
    if (window.__failNextRolePost) {
      window.__failNextRolePost = false;
      return new Response(JSON.stringify({detail:'409 role changed'}), {status:409,headers:{'Content-Type':'application/json'}});
    }
    if (window.__delayNextRolePost) {
      window.__delayNextRolePost = false;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    window.__ksaRole = url.endsWith('/demote') ? 'member' : 'moderator';
    return new Response(JSON.stringify({status:window.__ksaRole === 'moderator' ? 'promoted' : 'demoted'}), {status:200,headers:{'Content-Type':'application/json'}});
  }
  if (url.includes('/learning-spaces/ksa/admin/claims/KSA-78') && (args[1]?.method || 'GET') === 'POST') {
    window.__claimReleased = true;
    return new Response(JSON.stringify({ksa_id:'KSA-78',status:'released',previous_user_id:44}), {status:200,headers:{'Content-Type':'application/json'}});
  }
  if (url.includes('/learning-spaces/ksa/admin/claims/KSA-78')) {
    const released = window.__claimReleased;
    const history = [{id:1,action:'CLAIMED',current_user_id:44,previous_user_id:null,performed_by_user_id:44,reason:'self_service_claim',created_at:'2026-09-30T10:15:00Z'}];
    if (released) history.push({id:2,action:'RELEASED',current_user_id:null,previous_user_id:44,performed_by_user_id:2,reason:'Duplicate registry record',created_at:'2026-09-30T10:20:00Z'});
    return new Response(JSON.stringify({ksa_id:'KSA-78',claimed:!released,claim_status:released?'released':'active',claimed_at:released?null:'2026-09-30T10:15:00Z',claimant:released?null:{id:44,name:'Student A',username:'student_a',email:'student@example.com'},membership:{status:released?'inactive':'active',role:released?'member':window.__ksaRole,onboarding_state:'completed',external_member_id:released?null:'KSA-78'},active_space:released?null:{slug:'ksa',name:'Kora Sales Academy'},audit_history:history}), {status:200,headers:{'Content-Type':'application/json'}});
  }
  return new Response(JSON.stringify({}), {status:200,headers:{'Content-Type':'application/json'}});
};`;

await send('Page.enable');
await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: fixture });
await send('Page.navigate', { url: 'http://127.0.0.1:5173/#home' });
await clickWhenAvailable('button[aria-label="Review contributions"]');
await waitFor(`document.querySelector('.moderation-page')`);
await clickWhenAvailable('[data-testid="ksa-access-tab"]');
await waitFor(`document.querySelector('#ksa-search')`);

await evaluate(`(() => { const input = document.querySelector('#ksa-search'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'ksa-78'); input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true})); document.querySelector('.moderation-search').requestSubmit(); })()`);
await waitFor(`document.querySelector('[data-testid="ksa-claim-result"]')`);
assert.ok(await evaluate(`document.querySelector('[data-testid="ksa-claim-result"]').textContent.includes('Student A')`));
assert.ok(await evaluate(`document.querySelector('[data-testid="ksa-claim-result"]').textContent.includes('Kora Sales Academy')`));
await waitFor(`document.querySelector('[data-testid="promote-ksa-moderator"]')`);
await evaluate(`window.__failNextRolePost = true`);
await clickWhenAvailable('[data-testid="promote-ksa-moderator"]');
await waitFor(`document.querySelector('[role="dialog"]')`);
assert.equal(await evaluate(`document.querySelector('[role="dialog"] button[type="submit"]').disabled`), true, 'Role changes must require a reason');
await evaluate(`(() => { const textarea = document.querySelector('[role="dialog"] textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(textarea, 'Assigned to support KSA contributions'); textarea.dispatchEvent(new Event('input', {bubbles:true})); textarea.dispatchEvent(new Event('change', {bubbles:true})); })()`);
await waitFor(`document.querySelector('[role="dialog"] button[type="submit"]').disabled === false`);
await clickWhenAvailable('[role="dialog"] button[type="submit"]');
await waitFor(`document.querySelector('[data-testid="promote-ksa-moderator"]')`);
assert.equal(await evaluate(`document.querySelector('.moderation-role-state strong').textContent.trim()`), 'member', 'Rejected role changes must leave the displayed role unchanged');
assert.ok(await evaluate(`document.querySelector('[role="alert"]').textContent.includes('role changed')`), 'Rejected role changes should explain the conflict');

await clickWhenAvailable('[data-testid="promote-ksa-moderator"]');
await waitFor(`document.querySelector('[role="dialog"]')`);
await evaluate(`(() => { const textarea = document.querySelector('[role="dialog"] textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(textarea, 'Assigned to support KSA contributions'); textarea.dispatchEvent(new Event('input', {bubbles:true})); textarea.dispatchEvent(new Event('change', {bubbles:true})); window.__delayNextRolePost = true; })()`);
await waitFor(`document.querySelector('[role="dialog"] button[type="submit"]').disabled === false`);
await evaluate(`document.querySelector('[role="dialog"] button[type="submit"]').click()`);
await waitFor(`document.querySelector('[role="dialog"] button[type="submit"]').disabled === true`);
await evaluate(`document.querySelector('[role="dialog"] button[type="submit"]').click()`);
await waitFor(`document.querySelector('[data-testid="demote-ksa-moderator"]')`);
assert.equal(await evaluate(`window.__fixtureRequests.filter(item => item.method === 'POST' && item.url.endsWith('/learning-spaces/ksa/admin/moderators/44')).length`), 2, 'One rejected and one successful promotion must submit exactly two requests');

await clickWhenAvailable('[data-testid="demote-ksa-moderator"]');
await waitFor(`document.querySelector('[role="dialog"]')`);
await evaluate(`(() => { const textarea = document.querySelector('[role="dialog"] textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(textarea, 'Moderator responsibilities ended'); textarea.dispatchEvent(new Event('input', {bubbles:true})); textarea.dispatchEvent(new Event('change', {bubbles:true})); })()`);
await clickWhenAvailable('[role="dialog"] button[type="submit"]');
await waitFor(`document.querySelector('[data-testid="promote-ksa-moderator"]')`);
assert.equal(await evaluate(`window.__fixtureRequests.filter(item => item.method === 'POST' && item.url.endsWith('/learning-spaces/ksa/admin/moderators/44/demote')).length`), 1, 'Demotion must submit exactly once');
await clickWhenAvailable('[data-testid="history-toggle"]');
assert.ok(await evaluate(`document.querySelector('.moderation-timeline').textContent.includes('Claim recorded')`));

await clickWhenAvailable('[data-testid="release-claim-button"]');
await waitFor(`document.querySelector('[role="dialog"]')`);
assert.equal(await evaluate(`document.querySelector('[role="dialog"] button[type="submit"]').disabled`), true, 'Release must require a reason');
await evaluate(`(() => { const textarea = document.querySelector('[role="dialog"] textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(textarea, 'Duplicate registry record'); textarea.dispatchEvent(new Event('input', {bubbles:true})); textarea.dispatchEvent(new Event('change', {bubbles:true})); })()`);
await waitFor(`document.querySelector('[role="dialog"] button[type="submit"]').disabled === false`);
await clickWhenAvailable('[role="dialog"] button[type="submit"]');
await waitFor(`document.querySelector('[data-testid="ksa-claim-result"]').textContent.includes('Released / Available')`);
assert.equal(await evaluate(`window.__fixtureRequests.filter(item => item.method === 'POST' && item.url.includes('/release')).length`), 1, 'Release must submit exactly once');
assert.ok(await evaluate(`document.querySelector('[data-testid="ksa-claim-result"]').textContent.includes('Inactive')`));
assert.ok(await evaluate(`document.querySelector('.moderation-notice').textContent.includes('can now be claimed again')`));
assert.equal(await evaluate(`document.querySelector('[role="dialog"]')`), null, 'Dialog should close after success');

await mkdir('.impeccable/review', { recursive: true });
async function capture(width, height, name) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), `Overflow at ${width}`);
  assert.ok(await evaluate('document.querySelectorAll("button, input, textarea").length > 0'), `No controls at ${width}`);
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(`.impeccable/review/${name}.png`, Buffer.from(screenshot.data, 'base64'));
}
await capture(1440, 1000, 'phase-s4-3-ksa-admin-desktop');
await capture(390, 844, 'phase-s4-3-ksa-admin-mobile');

const runtimeErrors = await evaluate('window.__runtimeErrors || []');
assert.deepEqual(runtimeErrors, [], 'Unexpected runtime errors were reported');
console.log(JSON.stringify({
  search: 'claimed KSA record and safe claimant details',
  history: 'audit timeline rendered',
  role: 'reason-required promotion and demotion, one POST each, refreshed role state',
  release: 'reason-required confirmation, one POST, refreshed released/inactive state',
  responsive: 'desktop/mobile overflow and control checks passed',
  screenshots: 2,
}, null, 2));
ws.close();
