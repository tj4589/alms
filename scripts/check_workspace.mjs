// Local browser UI checks. Fixtures exist only inside this test browser.
// Start Vite on 5173 and headless Chrome with --remote-debugging-port=9225.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const target = await (await fetch('http://127.0.0.1:9225/json/new?about:blank', {method:'PUT'})).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = e => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
  if (msg.id) { const promise = pending.get(msg.id); pending.delete(msg.id); if (msg.error) promise.reject(msg.error); else promise.resolve(msg.result); }
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const waitFor = async expression => {
  const start = Date.now();
  while (Date.now() - start < 20000) {
    if (await evaluate('Boolean(' + expression + ')')) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Timed out: ' + expression);
};
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setBypassServiceWorker', { bypass: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
localStorage.setItem('exammind-first-upload-auth-reset-v1','true');
localStorage.setItem('token','exammind:local-development-session');
window.__workspaceFixture = 'empty';
window.__fixtureRequests = [];
const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const url = String(args[0]);
  if (!url.includes(':8001')) return originalFetch(...args);
  window.__fixtureRequests.push(url);
  if (window.__workspaceFixture === 'error') return new Response(JSON.stringify({detail:'Test offline'}),{status:503,headers:{'Content-Type':'application/json'}});
  const populated = window.__workspaceFixture === 'populated';
  let data = [];
  if (url.includes('/analytics/student/')) data = populated ? {readiness:[{id:1,topic:'Opportunity cost',score:62,course_id:1}],attempts:[{id:1,score:70,total_questions:10,topic:'Demand and supply',course_id:1,completed_at:'2026-09-15T14:00:00Z'}]} : {readiness:[],attempts:[]};
  else if (url.includes('/courses')) data = [{id:1,code:'ECO 101',name:'Introduction to Economics'},{id:2,code:'BIO 102',name:'Cell Biology'}];
  else if (url.includes('/lecture-notes')) data = populated ? [{id:1,title:'Demand, supply & the market',course_id:1,created_at:'2026-09-16T10:00:00Z'},{id:2,title:'Inside the cell',course_id:2,created_at:'2026-09-14T10:00:00Z'}] : [];
  else if (url.includes('/past-questions')) data = populated ? [{id:1,title:'First semester past questions',course_id:1,year:2025,created_at:'2026-09-15T10:00:00Z'}] : [];
  else if (url.includes('/study-sessions')) data = populated ? [{id:1,title:'Let’s work through economics',topic:'Demand and supply',starts_at:new Date(Date.now()+86400000).toISOString()}] : [];
  else if (url.endsWith(':8001/')) data = {status:'ok'};
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};` });
await send('Page.navigate', { url: 'http://127.0.0.1:5173/#home' });
await waitFor(`document.querySelector('.desk-course-empty') && !document.querySelector('.desk-loading')`);
await evaluate(`document.fonts.ready.then(()=>true)`);
await evaluate(`Promise.all([...document.querySelectorAll('#s-dashboard img')].map(i=>i.decode()))`);
await mkdir('.impeccable/review', { recursive: true });
const results = [];
async function capture(width, name, height = 1000) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:false });
  await evaluate('window.scrollTo(0,0)');
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const dims = await evaluate(`({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,sidebar:getComputedStyle(document.querySelector('.sidebar')).display,heading:document.querySelector('#s-dashboard h1').textContent})`);
  assert.ok(dims.scroll <= width, 'Overflow at '+width+': '+JSON.stringify(dims));
  const {contentSize} = await send('Page.getLayoutMetrics');
  const shot = await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:Math.max(height,contentSize.height),scale:1}});
  await writeFile('.impeccable/review/'+name+'.png',Buffer.from(shot.data,'base64'));
  results.push({width,...dims});
}
await capture(1440,'workspace-desktop');
await capture(1920,'workspace-user-1920',1080);
await capture(390,'workspace-mobile',844);
for (const width of [320,768,1024]) {
  await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'),'Overflow at '+width);
}
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
await evaluate(`document.querySelector('.mob-menu').click()`);
await waitFor(`document.querySelector('.mobile-nav-sheet')`);
assert.ok(await evaluate(`document.querySelector('.mobile-nav-sheet').getBoundingClientRect().right <= innerWidth`),'Mobile menu overflow');
await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
await waitFor(`!document.querySelector('.mobile-nav-sheet')`);
await evaluate(`document.querySelector('.desk-primary').click()`);
await waitFor(`!document.querySelector('#s-dashboard')`);
assert.ok(await evaluate(`document.querySelector('.rail-button[aria-current=page]').getAttribute('aria-label').includes('Add material')`),'Upload did not open');
await evaluate(`document.querySelector('button[aria-label="My desk"]').click()`);
await waitFor(`document.querySelector('.desk-course-empty')`);
await evaluate(`document.querySelector('.desk-together-copy button').click()`);
await waitFor(`!document.querySelector('#s-dashboard')`);
assert.ok(await evaluate(`document.querySelector('.rail-button[aria-current=page]').getAttribute('aria-label').includes('Study Groups')`),'Groups did not open');
await evaluate(`window.__workspaceFixture='populated';document.querySelector('button[aria-label="My desk"]').click()`);
await waitFor(`document.querySelectorAll('.desk-course').length === 2`);
await capture(1440,'workspace-populated');
await evaluate(`document.querySelectorAll('.desk-filters button')[1].click()`);
assert.equal(await evaluate(`document.querySelectorAll('.desk-material').length`),1);
await evaluate(`document.querySelector('.desk-course').click()`);
await waitFor(`!document.querySelector('#s-dashboard')`);
assert.ok(await evaluate(`document.querySelector('.workspace-location').textContent.includes('Search')`),'Course did not open search');
await evaluate(`window.__workspaceFixture='error';document.querySelector('button[aria-label="My desk"]').click()`);
await waitFor(`document.querySelector('.desk-error')`);
await capture(1440,'workspace-error');
await evaluate(`window.__workspaceFixture='empty';document.querySelector('.desk-error button').click()`);
await waitFor(`!document.querySelector('.desk-error') && document.querySelector('.desk-course-empty')`);
assert.match(await evaluate(`document.querySelector('.desk-course-empty h3').textContent`),/home for every course/);
assert.deepEqual(errors,[], 'Browser errors');
await writeFile('.impeccable/review/workspace-checks.json',JSON.stringify({results,interactions:'upload, groups, course search, archive filter, mobile menu Escape, error retry passed',errors,fixtures:true},null,2));
console.log(JSON.stringify({results,interactions:'passed',errors},null,2));
ws.close();
