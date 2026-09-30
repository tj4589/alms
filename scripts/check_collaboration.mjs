// Local browser verification for Phase Group G. The API fixture is injected
// only into this browser page; no production endpoint is modified.
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
localStorage.setItem('token', 'phase-g-browser-fixture');
window.__fixtureRequests = [];
const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const url = String(args[0]);
  if (!url.includes(':8001')) return originalFetch(...args);
  window.__fixtureRequests.push(url);
  if (url.endsWith('/auth/me')) return new Response(JSON.stringify({id:104,name:'KSA Moderator',username:'ksa_moderator',email:'moderator@example.com',role:'student',account_status:'active'}), {status:200,headers:{'Content-Type':'application/json'}});
  if (url.endsWith('/learning-spaces')) {
    const ksa = {id:1,slug:'ksa',name:'Kora Sales Academy',type:'academy',status:'active',membership:{id:1,role:'moderator',status:'active',onboarding_required:false}};
    return new Response(JSON.stringify({active_space:ksa,memberships:[{space:ksa}],available_spaces:[]}), {status:200,headers:{'Content-Type':'application/json'}});
  }
  if (url.includes('/courses')) return new Response(JSON.stringify([{id:1,code:'KSA 101',name:'Prospecting Fundamentals'}]), {status:200,headers:{'Content-Type':'application/json'}});
  if (url.includes('/study-groups')) return new Response(JSON.stringify([]), {status:200,headers:{'Content-Type':'application/json'}});
  if (url.includes('/lecture-notes') || url.includes('/past-questions')) return new Response(JSON.stringify([]), {status:200,headers:{'Content-Type':'application/json'}});
  if (url.includes('/ingest/upload')) return new Response(JSON.stringify({status:'needs_confirmation',metadata:{document_type:'lecture_note',document_title:'Prospecting fundamentals',course_code:'KSA 101',course_title:'Prospecting Fundamentals',instructor_names:[],academic_year:'',year:null,semester:'First',department:'Sales',faculty:'',college:'',exam_type:'unknown',topics_covered:['qualification'],extraction_method:'embedded_text',extraction_confidence:.95,metadata_evidence:{},needs_review:false},preview:'Qualify a prospect before proposing a solution.',preview_snippets:['Qualify a prospect before proposing a solution.'],preview_sections:[],content_preview:{},preview_quality:'high',raw_ocr_text:'',extraction:{page_count:2,method:'embedded_text',extraction_confidence:.95,text_char_count:52,ocr_used:false}}), {status:200,headers:{'Content-Type':'application/json'}});
  if (url.includes('/collaboration/moderation/contributions/') && url.includes('/decision')) return new Response(JSON.stringify({status:'approved'}), {status:200,headers:{'Content-Type':'application/json'}});
  if (url.includes('/collaboration/moderation/contributions')) return new Response(JSON.stringify([{id:7,material_type:'lecture_note',material_id:501,moderation_status:'pending_review',requested_visibility:'space_shared',submitted_at:'2026-09-29T10:00:00Z',uploader:{name:'Student contributor',username:'student'},learning_space:{name:'Kora Sales Academy'},material:{title:'Prospecting fundamentals',file_name:'prospecting.pdf',preview:'Qualify a prospect before proposing a solution.',metadata:{course_code:'KSA 101'}}}]), {status:200,headers:{'Content-Type':'application/json'}});
  return new Response(JSON.stringify({}), {status:200,headers:{'Content-Type':'application/json'}});
};`;

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: fixture });
await send('Page.navigate', { url: 'http://127.0.0.1:5173/#home' });
await clickWhenAvailable('button[aria-label="Add material"]');
await waitFor(`document.querySelector('#file-input')`);

const documentResult = await send('DOM.getDocument');
const inputNode = await send('DOM.querySelector', { nodeId: documentResult.root.nodeId, selector: '#file-input' });
await send('DOM.setFileInputFiles', {
  nodeId: inputNode.nodeId,
  files: ['C:\\Users\\HP\\Pictures\\Screenshots\\Screenshot (243).png'],
});
await waitFor(`document.querySelector('#sharing-choice-title')`);
assert.ok(await evaluate(`document.querySelector('#sharing-choice-title').textContent.includes('Where should this material be available?')`));
assert.ok(await evaluate(`document.body.textContent.includes('Contribute to KSA')`));
assert.ok(await evaluate(`document.body.textContent.includes('Only me')`));
assert.equal(await evaluate(`document.querySelector('input[value="private"]').checked`), true, 'Safe private default is missing');
await evaluate(`document.querySelector('input[value="space_shared"]').click()`);
await waitFor(`document.querySelector('.sharing-consent')`);
assert.ok(await evaluate(`document.querySelector('.sharing-consent').textContent.includes('review')`));

await mkdir('.impeccable/review', { recursive: true });
async function capture(width, height, name) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), `Overflow at ${width}`);
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(`.impeccable/review/${name}.png`, Buffer.from(screenshot.data, 'base64'));
}
await capture(1440, 1000, 'phase-g-upload-sharing-desktop');
await capture(390, 844, 'phase-g-upload-sharing-mobile');

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await clickWhenAvailable('button[aria-label="Review contributions"]');
await waitFor(`document.querySelector('.moderation-page')`);
assert.ok(await evaluate(`document.querySelector('.moderation-page').textContent.includes('Pending review')`));
assert.ok(await evaluate(`document.querySelector('.moderation-page').textContent.includes('Approve archive')`));
await capture(1440, 1000, 'phase-g-moderation-desktop');
await capture(390, 844, 'phase-g-moderation-mobile');

console.log(JSON.stringify({
  upload: 'sharing choice, KSA recommendation, safe private default, explicit consent',
  moderation: 'pending queue, contribution detail, decision controls',
  screenshots: 4,
}, null, 2));
ws.close();
