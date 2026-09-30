// Start Vite on 5173 and headless Chrome with --remote-debugging-port=9225.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const target = await (await fetch('http://127.0.0.1:9225/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map();
const errors = [];
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
  if (message.id) {
    const promise = pending.get(message.id);
    pending.delete(message.id);
    if (promise) message.error ? promise.reject(message.error) : promise.resolve(message.result);
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
  while (Date.now() - start < 20000) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${expression}`);
};

const fillInput = async (selector, value) => {
  await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
    return true;
  })()`);
  await new Promise(resolve => setTimeout(resolve, 80));
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setBypassServiceWorker', { bypass: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
localStorage.setItem('exammind-first-upload-auth-reset-v1','true');
localStorage.setItem('token','exammind:s3-5-access-session');
window.__accessRequests = [];
const readMode = () => sessionStorage.getItem('exammind-access-fixture') || 'new';
const user = {id:1,name:'KSA Student',username:'ksa_student',email:'student@example.com',role:'student',account_status:'active'};
const cu = {id:1,slug:'cu',name:'Covenant University',description:'A university learning space.',type:'university',status:'active',membership:{id:1,role:'member',status:'active',onboarding_required:false}};
const ksa = {id:2,slug:'ksa',name:'Kora Sales Academy',description:'A focused learning space for KSA interns.',type:'academy',status:'active',membership:{id:2,role:'member',status:'active',onboarding_required:false}};
const ksaPending = {...ksa,membership:{...ksa.membership,onboarding_required:true}};
const spacesFor = mode => {
  if (mode === 'ksa_pending') return {active_space:ksaPending,memberships:[{space:ksaPending}],available_spaces:[]};
  if (mode === 'ksa_complete') return {active_space:ksa,memberships:[{space:ksa}],available_spaces:[]};
  if (mode === 'cu') return {active_space:cu,memberships:[{space:cu}],available_spaces:[]};
  if (mode === 'multi_no_active') return {active_space:null,memberships:[{space:cu},{space:ksa}],available_spaces:[]};
  if (mode === 'multi_cu') return {active_space:cu,memberships:[{space:cu},{space:ksa}],available_spaces:[]};
  if (mode === 'multi_ksa') return {active_space:ksa,memberships:[{space:cu},{space:ksa}],available_spaces:[]};
  return {active_space:null,memberships:[],available_spaces:[ksa]};
};
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}});
const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const url = String(args[0]);
  if (!url.includes(':8001')) return originalFetch(...args);
  window.__accessRequests.push({url,method:String(args[1]?.method || 'GET').toUpperCase()});
  const mode = readMode();
  if (url.includes('/auth/me')) return json(user);
  if (url.endsWith('/learning-spaces')) return json(spacesFor(mode));
  if (url.endsWith('/community/profile')) return json({preferred_name:user.name,username:user.username,onboarding_state:'completed',onboarding_required:false,onboarding_preferences:{}});
  if (url.endsWith('/learning-spaces/ksa/verify')) {
    sessionStorage.setItem('exammind-access-fixture','ksa_pending');
    return json({status:'verified',onboarding_required:true,space:ksaPending});
  }
  if (url.endsWith('/learning-spaces/ksa/onboarding')) {
    sessionStorage.setItem('exammind-access-fixture','ksa_complete');
    return json({status:'completed',space:ksa});
  }
  if (url.includes('/learning-spaces/') && url.endsWith('/activate')) {
    const slug = url.includes('/ksa/') ? 'ksa' : 'cu';
    sessionStorage.setItem('exammind-access-fixture', slug === 'ksa' ? 'multi_ksa' : 'multi_cu');
    return json({active_space:slug === 'ksa' ? ksa : cu,memberships:[{space:cu},{space:ksa}],available_spaces:[]});
  }
  if (url.endsWith('/learning-spaces/ksa/onboarding')) return json({status:'completed'});
  if (url.endsWith('/auth/logout')) return json({status:'ok'});
  if (url.includes('/analytics/student/')) return json({readiness:[],attempts:[]});
  if (url.endsWith('/courses') || url.endsWith('/community/academic-options')) return json([]);
  return json([]);
};` });

const navigate = async mode => {
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/#home' });
  await waitFor(`document.querySelector('#access-gate-title, #spaces-title, #ksa-onboarding-title, .workspace-shell')`);
  await evaluate(`sessionStorage.setItem('exammind-access-fixture', ${JSON.stringify(mode)})`);
  await send('Page.reload', { ignoreCache: true });
  await new Promise(resolve => setTimeout(resolve, 900));
  await waitFor(`document.querySelector('#access-gate-title, #spaces-title, #ksa-onboarding-title, .workspace-shell')`);
};

await navigate('new');
assert.equal(await evaluate(`Boolean(document.querySelector('.workspace-shell'))`), false, 'Protected workspace flashed before membership');
assert.equal(await evaluate(`Boolean(document.querySelector('#access-gate-title') && document.querySelector('#access-gate-title').textContent.includes('How will you learn'))`), true, 'First-access decision did not render');
await send('Page.reload', { ignoreCache: true });
await new Promise(resolve => setTimeout(resolve, 900));
await waitFor(`document.querySelector('#access-gate-title')`);
assert.equal(await evaluate(`Boolean(document.querySelector('.workspace-shell'))`), false, 'First-access refresh exposed the workspace');
await evaluate(`document.querySelector('button').textContent.includes('Yes, continue') ? document.querySelector('button').click() : [...document.querySelectorAll('button')].find(button => button.textContent.includes('Yes, continue')).click()`);
await waitFor(`document.querySelector('#ksa-id')`);
await send('Page.reload', { ignoreCache: true });
await new Promise(resolve => setTimeout(resolve, 900));
await waitFor(`document.querySelector('#access-gate-title')`);
assert.equal(await evaluate(`Boolean(document.querySelector('#ksa-id'))`), false, 'Unclaimed KSA screen incorrectly persisted across refresh');
await evaluate(` [...document.querySelectorAll('button')].find(button => button.textContent.includes('Yes, continue')).click()`);
await waitFor(`document.querySelector('#ksa-id')`);
await fillInput('#ksa-id', 'KSA-1');
await evaluate(`document.querySelector('#ksa-id').form.requestSubmit()`);
await waitFor(`document.querySelector('[role=alert]')`);
assert.ok(await evaluate(`document.querySelector('[role=alert]').textContent.includes('Check your academy ID')`), 'Invalid KSA ID was not explained');
await fillInput('#ksa-id', 'KSA-12');
await evaluate(`document.querySelector('#ksa-id').form.requestSubmit()`);
await waitFor(`document.querySelector('#ksa-onboarding-title')`);
assert.ok(await evaluate(`document.querySelector('#ksa-onboarding-title').textContent.includes('What should we call you')`), 'KSA onboarding did not open after claim');
await send('Page.reload', { ignoreCache: true });
await new Promise(resolve => setTimeout(resolve, 900));
await waitFor(`document.querySelector('#ksa-onboarding-title')`);
assert.equal(await evaluate(`Boolean(document.querySelector('#ksa-id'))`), false, 'KSA onboarding refresh returned to the claim screen');
await fillInput('#ksa-onboarding-username', 'ksa_student');
await evaluate(`document.querySelector('#ksa-onboarding-username').form.requestSubmit()`);
await waitFor(`document.querySelector('#ksa-learning-goal')`);
await evaluate(`document.querySelector('#ksa-learning-goal').form.requestSubmit()`);
await waitFor(`document.querySelector('.workspace-shell')`);
assert.equal(await evaluate(`sessionStorage.getItem('exammind-access-fixture')`), 'ksa_complete', 'KSA onboarding did not complete the fixture state');

await navigate('ksa_complete');
assert.equal(await evaluate(`Boolean(document.querySelector('.workspace-shell'))`), true, 'Returning KSA user did not reach the workspace');
assert.equal(await evaluate(`Boolean(document.querySelector('#access-gate-title'))`), false, 'Returning KSA user saw first-access decision');

await navigate('ksa_pending');
assert.ok(await evaluate(`document.querySelector('#ksa-onboarding-title')?.textContent.includes('What should we call')`), 'Pending KSA user did not resume KSA onboarding');
assert.equal(await evaluate(`Boolean(document.querySelector('#ksa-id'))`), false, 'Pending KSA user was sent back to ID claim');

await navigate('cu');
assert.equal(await evaluate(`Boolean(document.querySelector('.workspace-shell'))`), true, 'Returning CU user did not preserve the CU path');

await navigate('multi_no_active');
await waitFor(`document.querySelector('#spaces-title')`);
assert.ok(await evaluate(`document.querySelector('#spaces-title').textContent.includes('Choose where to continue')`), 'Multi-space selector did not render');
assert.equal(await evaluate(`Boolean(document.querySelector('.workspace-shell'))`), false, 'Multi-space user entered workspace without an active selection');
assert.equal(await evaluate(`document.querySelectorAll('.space-card').length`), 2, 'Multi-space selector did not show both memberships');
await evaluate(`document.querySelector('.space-card-action').click()`);
await waitFor(`document.querySelector('.workspace-shell')`);

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), 'Access flow overflows on mobile');
await mkdir('.impeccable/review', { recursive: true });
const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await writeFile('.impeccable/review/access-flow-mobile.png', Buffer.from(screenshot.data, 'base64'));

assert.equal(errors.length, 0, `Browser runtime errors: ${errors.join(' | ')}`);
console.log(JSON.stringify({
  ok: true,
  checked: ['first-access decision', 'KSA claim validation', 'KSA onboarding', 'returning KSA', 'pending KSA resume', 'returning CU', 'multi-space selection', 'mobile overflow'],
  requests: await evaluate('window.__accessRequests.length'),
}, null, 2));
ws.close();
