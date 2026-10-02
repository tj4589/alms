// Local browser UI checks. Fixtures exist only inside this test browser.
// Start Vite on 5173 and headless Chrome with --remote-debugging-port=9225.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const cdpEndpoint = 'http://127.0.0.1:9225';
const cdpTimeoutMs = 5000;
const withTimeout = (promise, label, timeoutMs = cdpTimeoutMs) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)),
]);
const targetResponse = await withTimeout(fetch(`${cdpEndpoint}/json/new?about:blank`, { method: 'PUT' }), 'CDP target creation');
if (!targetResponse.ok) throw new Error(`CDP target creation failed with HTTP ${targetResponse.status}`);
const target = await withTimeout(targetResponse.json(), 'CDP target response');
if (target.type !== 'page' || typeof target.webSocketDebuggerUrl !== 'string') {
  throw new Error(`CDP returned an invalid page target: ${JSON.stringify({ id: target.id, type: target.type, url: target.url })}`);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await withTimeout(new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', () => reject(new Error('CDP WebSocket emitted an error before opening')), { once: true });
}), 'CDP WebSocket open');
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = e => {
  const msg = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data));
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  if (msg.id) { const promise = pending.get(msg.id); pending.delete(msg.id); if (msg.error) promise.reject(msg.error); else promise.resolve(msg.result); }
};
ws.onclose = () => {
  for (const { reject } of pending.values()) reject(new Error('CDP WebSocket closed while a command was pending'));
  pending.clear();
};
const send = (method, params = {}) => withTimeout(new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => {
    pending.delete(id);
    reject(new Error(`CDP command ${method}#${id} timed out for target ${target.id}`));
  }, cdpTimeoutMs);
  pending.set(id, {
    resolve: value => { clearTimeout(timer); resolve(value); },
    reject: error => { clearTimeout(timer); reject(error); },
  });
  try { ws.send(JSON.stringify({ id, method, params })); } catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
}), `CDP command ${method}`);
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
try {
  await send('Page.enable');
} catch (error) {
  throw new Error(`CDP Page.enable failed for target ${target.id} (${target.type}, ${target.url || 'blank'}): ${error instanceof Error ? error.message : String(error)}`);
}
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setBypassServiceWorker', { bypass: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
if (sessionStorage.getItem('exammind-workspace-public-check') !== 'true') {
  localStorage.setItem('exammind-first-upload-auth-reset-v1','true');
  localStorage.setItem('token','exammind:local-development-session');
  localStorage.setItem('exammind-maxe-nudge-v1','seen');
}
window.__workspaceFixture = 'empty';
window.__fixtureRequests = [];
window.__learningAttemptRecorded = 0;
window.__shareLinks = [];
window.__shareLinkId = 40;
window.__copiedShareLink = '';
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copiedShareLink = text; } } });
const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const url = String(args[0]);
  const method = String(args[1]?.method || 'GET').toUpperCase();
  if (!url.includes(':8001')) return originalFetch(...args);
  window.__fixtureRequests.push(url);
  if (window.__workspaceFixture === 'error') return new Response(JSON.stringify({detail:'Test offline'}),{status:503,headers:{'Content-Type':'application/json'}});
  const populated = window.__workspaceFixture === 'populated';
  let data = [];
  if (url.includes('/auth/me')) data = {id:1,name:'Test Student',username:'test_student',email:'test@example.com',role:'student',account_status:'active'};
  else if (url.includes('/collaboration/materials/') && url.includes('/export')) {
    const format = new URL(url).searchParams.get('format') || 'md';
    return new Response('Test source\n\nExported ' + format + ' content.\n',{status:200,headers:{'Content-Type':format === 'md' ? 'text/markdown' : 'text/plain','Content-Disposition':'attachment; filename="test-source.' + format + '"'}});
  }
  else if (url.endsWith('/collaboration/exports') && method === 'POST') {
    const request = JSON.parse(args[1]?.body || '{}');
    const format = request.format || 'md';
    return new Response('ExamMind export\n\n' + (request.payload?.answer || request.payload?.body || '') + '\n',{status:200,headers:{'Content-Type':format === 'md' ? 'text/markdown' : 'text/plain','Content-Disposition':'attachment; filename="maxe-export.' + format + '"'}});
  }
  else if (url.includes('/collaboration/share-links/') && method === 'DELETE') {
    const linkId = Number(url.split('/').pop());
    const link = window.__shareLinks.find(item => item.id === linkId);
    if (link) link.revoked_at = new Date().toISOString();
    data = {status:'revoked',id:linkId};
  }
  else if (url.endsWith('/collaboration/share-links') && method === 'GET') data = window.__shareLinks;
  else if (url.endsWith('/collaboration/share-links') && method === 'POST') {
    const request = JSON.parse(args[1]?.body || '{}');
    const linkId = ++window.__shareLinkId;
    const expiresInHours = request.expires_in_hours == null ? null : Number(request.expires_in_hours);
    const link = {id:linkId,content_type:'resource',access_policy:request.access_policy || 'owner',expires_at:expiresInHours == null ? null : new Date(Date.now() + expiresInHours * 3600000).toISOString(),revoked_at:null,created_at:new Date().toISOString()};
    window.__shareLinks.unshift(link);
    data = {...link,token:'fixture-share-token-'+linkId};
  }
  else if (url.endsWith('/learning-spaces')) {
    const cu = {id:1,slug:'cu',name:'Covenant University',type:'university',status:'active',membership:{id:1,role:'member',status:'active',onboarding_required:false}};
    data = {active_space:cu,memberships:[{space:cu}],available_spaces:[]};
  }
  else if (url.includes('/understand')) { const request = JSON.parse(args[1]?.body || '{}'); data = {intent:'academic_explanation',student_state:'focused',should_call_rag:true,should_search:true,should_ask_clarifying_question:false,interpreted_topic:request.message || 'the uploaded source',related_terms:[],possible_course:null,possible_person:null,confidence:0.95,response_strategy:'answer from the current source',clarifying_question:null}; }
  else if (url.includes('/maxe/chat')) {
    const request = JSON.parse(args[1]?.body || '{}');
    const activeId = Number(request.active_resource_id || 0);
    const mode = request.mode || 'source';
    const isGap = String(request.question || '').toLowerCase().includes('unknown topic');
    const citation = activeId === 1
      ? {source:'Week 4 slides',material_type:'lecture_note',resource_type:'lecture_note',resource_id:1,resource_title:'Week 4 slides',label:'Week 4 slides · Slide 8',slide_from:8,slide_to:8,target:{screen:'workspace',resource_type:'lecture_note',resource_id:1,slide_from:8}}
      : activeId === 3
      ? {source:'Week 4 recording',material_type:'audio',resource_type:'audio',resource_id:3,resource_title:'Week 4 recording',label:'Week 4 recording · 14:02',timestamp_start:842,timestamp_end:906,target:{screen:'workspace',resource_type:'audio',resource_id:3,start_time:842,end_time:906}}
      : {source:'Week 2 reading',material_type:'lecture_note',resource_type:'lecture_note',resource_id:2,resource_title:'Week 2 reading',label:'Week 2 reading · Page 4',page_from:4,page_to:4,target:{screen:'workspace',resource_type:'lecture_note',resource_id:2,page_from:4,page_to:4}};
    data = isGap
      ? {answer:"I couldn't find a source in the current knowledge base that answers this.",sources:[],past_question_sources:[],lecture_note_sources:[],source_citations:[],insufficient_sources:true,no_past_questions_found:true,no_lecture_notes_found:true,understanding:null,mode:'source',knowledge_gap:true,knowledge_gap_message:"I couldn't find a source in the current knowledge base that answers this.",context:{mode:'source',active_resource:null,selected_text_used:false,selected_text_source:null,recent_context_used:false}}
      : {answer:mode === 'beyond_materials' ? 'FROM YOUR MATERIALS:\\nThe selected source provides the study context.\\n\\nBEYOND YOUR MATERIALS:\\nHere is a general explanation kept separate from the uploaded source.' : 'This answer is grounded in the authorized uploaded source.',sources:[citation.source],past_question_sources:[],lecture_note_sources:[citation.source],source_citations:[citation],insufficient_sources:false,no_past_questions_found:false,no_lecture_notes_found:false,understanding:{interpreted_topic:'the uploaded source',related_terms:[],possible_courses:[],possible_people:[],intent:'academic_explanation',confidence:0.95,needs_clarification:false,clarifying_question:null},mode,knowledge_gap:false,learning_suggestion:window.__learningAttemptRecorded ? {message:'You have missed Market structures questions twice. Review these sections, then try again.',topic:'Market structures',action:'practice',evidence:{answers:5,missed:2}} : null,context:{mode,active_resource:activeId ? {resource_type:activeId === 3 ? 'audio' : 'lecture_note',resource_id:activeId,title:citation.resource_title} : null,selected_text_used:Boolean(request.selected_text),selected_text_source:request.selected_text_source || null,recent_context_used:false}};
  }
  else if (url.endsWith('/learning/profile')) data = {explicit_preferences:{},inferred_preferences:{}};
  else if (url.endsWith('/learning/readiness')) {
    const attemptCount = Number(window.__learningAttemptRecorded || 0);
    if (attemptCount >= 2) data = {available:true,score:60,formula:'correct graded answers ÷ total graded answers × 100',thresholds:{minimum_answers_for_readiness:10,minimum_attempts_for_readiness:2,minimum_answers_for_topic:4,minimum_topics_for_readiness:2,strong:80,weak_below:60},evidence_used:{answered_questions:10,graded_answers:10,correct_answers:6,attempts:2,distinct_topics:2,known_topics:2,latest_answered_at:'2026-09-29T10:00:00Z'},topics:[{topic:'Market structures',score:60,classification:'weak',answers:5,required_answers:4,correct:3,missed:2,attempts:2,last_answered_at:'2026-09-29T10:00:00Z'},{topic:'Opportunity cost',score:60,classification:'developing',answers:5,required_answers:4,correct:3,missed:2,attempts:2,last_answered_at:'2026-09-29T10:00:00Z'}],assessed_topics:['Market structures','Opportunity cost'],unassessed_topics:[],recommended_next_action:'You have missed Market structures questions twice. Review these sections, then try again.'};
    else if (attemptCount === 1) data = {available:false,score:null,formula:'correct graded answers ÷ total graded answers × 100',thresholds:{minimum_answers_for_readiness:10,minimum_attempts_for_readiness:2,minimum_answers_for_topic:4,minimum_topics_for_readiness:2,strong:80,weak_below:60},evidence_used:{answered_questions:4,graded_answers:4,correct_answers:2,attempts:1,distinct_topics:1,known_topics:2,latest_answered_at:'2026-09-29T10:00:00Z'},topics:[{topic:'Market structures',score:null,classification:'insufficient_evidence',answers:4,required_answers:4,correct:2,missed:2,attempts:1,last_answered_at:'2026-09-29T10:00:00Z'}],assessed_topics:[],unassessed_topics:['Opportunity cost'],recommended_next_action:'Readiness is still gathering evidence. Complete 6 more questions across another quiz.'};
    else data = {available:false,score:null,formula:'correct graded answers ÷ total graded answers × 100',thresholds:{minimum_answers_for_readiness:10,minimum_attempts_for_readiness:2,minimum_answers_for_topic:4,minimum_topics_for_readiness:2,strong:80,weak_below:60},evidence_used:{answered_questions:0,graded_answers:0,correct_answers:0,attempts:0,distinct_topics:0,known_topics:2,latest_answered_at:null},topics:[],assessed_topics:[],unassessed_topics:['Market structures','Opportunity cost'],recommended_next_action:'Readiness is still gathering evidence. Complete 10 more questions across another quiz.'};
  }
  else if (url.includes('/learning/attempts')) {
    const attemptCount = Number(window.__learningAttemptRecorded || 0);
    if (attemptCount >= 2) data = [{id:2,quiz_id:1,score:3,total_questions:5,graded_questions:5,needs_review_count:0,percentage:60,topic:'Market structures',completed_at:'2026-09-29T10:05:00Z',review:[{question_id:1,position:1,prompt:'Which structure has many competing firms?',answer:'0',correct_answer:'Many competing firms',is_correct:true,status:'correct',explanation:'The source describes this structure as having many competing firms.',citation:{label:'Week 4 slides - Slide 8',source:'Week 4 slides',slide_from:8},topic:'Market structures'}]},{id:1,quiz_id:1,score:3,total_questions:5,graded_questions:5,needs_review_count:0,percentage:60,topic:'Market structures',completed_at:'2026-09-29T10:00:00Z',review:[{question_id:1,position:1,prompt:'Which structure has many competing firms?',answer:'0',correct_answer:'Many competing firms',is_correct:true,status:'correct',explanation:'The source describes this structure as having many competing firms.',citation:{label:'Week 4 slides - Slide 8',source:'Week 4 slides',slide_from:8},topic:'Market structures'}]}];
    else if (attemptCount === 1) data = [{id:1,quiz_id:1,score:2,total_questions:5,graded_questions:5,needs_review_count:0,percentage:40,topic:'Market structures',completed_at:'2026-09-29T10:00:00Z',review:[{question_id:1,position:1,prompt:'Which structure has many competing firms?',answer:'0',correct_answer:'Many competing firms',is_correct:true,status:'correct',explanation:'The source describes this structure as having many competing firms.',citation:{label:'Week 4 slides - Slide 8',source:'Week 4 slides',slide_from:8},topic:'Market structures'}]}];
    else data = [];
  }
  else if (url.endsWith('/learning/quizzes') && String(args[1]?.method || 'GET').toUpperCase() === 'POST') data = {id:1,topic:'Market structures',source_scope:'workspace',resource_type:null,resource_id:null,difficulty:'mixed',question_type:'multiple_choice',question_count:5,questions:[1,2,3,4,5].map((position) => ({id:position,position,question_type:'multiple_choice',prompt:'Which statement is supported by the authorized source? ('+position+')',options:['Many competing firms','One exclusive seller','No firms compete','The source does not discuss firms'],topic:'Market structures',difficulty:'mixed',citation:{source:'Week 4 slides',resource_type:'lecture_note',resource_id:1,resource_title:'Week 4 slides',label:'Week 4 slides · Slide '+(position + 3),slide_from:position + 3,slide_to:position + 3}}))};
  else if (url.includes('/learning/quizzes/') && url.endsWith('/attempts')) {
    window.__learningAttemptRecorded = Number(window.__learningAttemptRecorded || 0) + 1;
    data = {id:1,quiz_id:1,score:3,total_questions:5,percentage:60,topic:'Market structures',completed_at:'2026-09-29T10:00:00Z',review:[1,2,3,4,5].map((questionId) => ({question_id:questionId,position:questionId,prompt:'Which statement is supported by the authorized source? ('+questionId+')',answer:'0',correct_answer:'Many competing firms',is_correct:questionId <= 3,explanation:questionId <= 3 ? 'The source supports this answer.' : 'Review the source section before trying this question again.',citation:{label:'Week 4 slides · Slide '+(questionId + 3),source:'Week 4 slides',slide_from:questionId + 3},topic:'Market structures'})),readiness:{available:true,score:60}};
  }
  else if (url.includes('/analytics/student/')) data = populated ? {readiness:[{id:1,topic:'Opportunity cost',score:62,course_id:1}],attempts:[{id:1,score:70,total_questions:10,topic:'Demand and supply',course_id:1,completed_at:'2026-09-15T14:00:00Z'}]} : {readiness:[],attempts:[]};
  else if (url.includes('/courses')) data = [{id:1,code:'ECO 101',name:'Introduction to Economics'},{id:2,code:'BIO 102',name:'Cell Biology'}];
  else if (url.includes('/lecture-notes/1')) data = {id:1,title:'Week 4 slides',file_name:'week-4-slides.pptx',has_file:true,file_size:123,uploaded_by:1,course_id:1,content_text:'Market structures and competitive strategy.',metadata_json:{document_type:'lecture_note',document_title:'Week 4 slides',course_code:'ECO 101'},sections:[{id:11,heading:'Market structure',body:'Market structures describe how firms compete in an industry.',page_from:null,page_to:null}]};
  else if (url.includes('/lecture-notes/2')) data = {id:2,title:'Week 2 reading',file_name:'week-2-reading.pdf',has_file:true,file_size:123,uploaded_by:1,course_id:1,content_text:'Opportunity cost explains the value of the next best alternative.',metadata_json:{document_type:'lecture_note',document_title:'Week 2 reading',course_code:'ECO 101'},sections:[{id:12,heading:'Opportunity cost',body:'Opportunity cost is the value of the next best alternative forgone.',page_from:4,page_to:4}]};
  else if (url.includes('/lecture-notes/3')) data = {id:3,title:'Week 4 recording',file_name:'week-4-recording.mp3',has_file:true,file_size:123,uploaded_by:1,course_id:1,content_text:'The recording explains market structures.',metadata_json:{document_type:'audio',document_title:'Week 4 recording',course_code:'ECO 101'}};
  else if (url.includes('/lecture-notes')) data = populated ? [{id:1,title:'Week 4 slides',file_name:'week-4-slides.pptx',has_file:true,file_size:123,uploaded_by:1,course_id:1,created_at:'2026-09-16T10:00:00Z',metadata_json:{document_type:'lecture_note',document_title:'Week 4 slides',course_code:'ECO 101'}},{id:2,title:'Week 2 reading',file_name:'week-2-reading.pdf',has_file:true,file_size:123,uploaded_by:1,course_id:1,created_at:'2026-09-15T10:00:00Z',metadata_json:{document_type:'lecture_note',document_title:'Week 2 reading',course_code:'ECO 101'}},{id:3,title:'Week 4 recording',file_name:'week-4-recording.mp3',has_file:true,file_size:123,uploaded_by:1,course_id:1,created_at:'2026-09-14T10:00:00Z',metadata_json:{document_type:'audio',document_title:'Week 4 recording',course_code:'ECO 101'}}] : [];
  else if (url.includes('/materials/audio/3/transcript')) data = {resource_id:3,title:'Week 4 recording',transcription_status:'completed',segments:[{id:31,segment_index:0,start_time:842,end_time:906,text:'The recording explains market structures.',topic:'Market structures'}]};
  else if (url.includes('/past-questions')) data = populated ? [{id:1,title:'First semester past questions',uploaded_by:2,course_id:2,year:2025,created_at:'2026-09-15T10:00:00Z'}] : [];
  else if (url.includes('/study-groups')) data = populated ? [{id:9,name:'Economics revision group',is_member:true,status:'active'}] : [];
  else if (url.includes('/study-sessions')) data = populated ? [{id:1,title:'Let’s work through economics',topic:'Demand and supply',starts_at:new Date(Date.now()+86400000).toISOString()}] : [];
  else if (url.endsWith(':8001/')) data = {status:'ok'};
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};` });
await send('Page.navigate', { url: 'http://127.0.0.1:5173/#home' });
await waitFor(`document.querySelector('.desk-course-empty') && !document.querySelector('.desk-loading')`);
const authFixture = await evaluate(`fetch('http://127.0.0.1:8001/auth/me').then(response => response.json())`);
assert.equal(authFixture.id, 1, 'Authenticated fixture user id is missing');
assert.equal(authFixture.account_status, 'active', 'Authenticated fixture account status is missing');
assert.equal(typeof authFixture.name, 'string', 'Authenticated fixture name is missing');
assert.equal(typeof authFixture.email, 'string', 'Authenticated fixture email is missing');
await evaluate(`document.fonts.ready.then(()=>true)`);
await evaluate(`Promise.all([...document.querySelectorAll('#s-dashboard img')].map(i=>i.decode()))`);
await mkdir('.impeccable/review', { recursive: true });
const results = [];
async function capture(width, name, height = 1000) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:false });
  await evaluate('window.scrollTo(0,0)');
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await new Promise(r=>setTimeout(r,500));
  const dims = await evaluate(`({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,sidebar:document.querySelector('.sidebar')?getComputedStyle(document.querySelector('.sidebar')).display:'none',heading:(document.querySelector('#s-dashboard h1')||document.querySelector('#s-assistant .assistant-title'))?.textContent||'unknown'})`);
  assert.ok(dims.scroll <= width, 'Overflow at '+width+': '+JSON.stringify(dims));
  const {contentSize} = await send('Page.getLayoutMetrics');
  const shot = await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:Math.max(height,contentSize.height),scale:1}});
  await writeFile('.impeccable/review/'+name+'.png',Buffer.from(shot.data,'base64'));
  results.push({width,...dims});
}
async function captureViewport(width, name, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:false });
  await evaluate('window.scrollTo(0,0)');
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await new Promise(r=>setTimeout(r,500));
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'),'Overflow at '+width);
  const shot = await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('.impeccable/review/'+name+'.png',Buffer.from(shot.data,'base64'));
}
await capture(1440,'workspace-desktop');
await capture(1920,'workspace-user-1920',1080);
await capture(390,'workspace-mobile',844);
assert.equal(await evaluate(`getComputedStyle(document.querySelector('.maxe-figure')).animationName`),'none','Reduced motion did not stop Maxe');
assert.ok(await evaluate(`(() => {
  const maxe = document.querySelector('.maxe-trigger').getBoundingClientRect();
  const nav = document.querySelector('.mob-nav').getBoundingClientRect();
  return maxe.bottom <= nav.top;
})()`),'Maxe overlaps the mobile navigation');
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
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await evaluate(`window.__workspaceFixture='empty';document.querySelector('.desk-error button').click()`);
await waitFor(`!document.querySelector('.desk-error') && document.querySelector('.desk-course-empty')`);
await evaluate(`document.querySelector('button[aria-label="Open Maxe"]').click()`);
await waitFor(`document.querySelector('.maxe-workspace-dialog')`);
await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
await waitFor(`!document.querySelector('.maxe-workspace-dialog')`);
assert.match(await evaluate(`document.querySelector('.desk-course-empty h3').textContent`),/home for every course/);
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await evaluate(`document.querySelector('button[aria-label="Open Maxe"]').click()`);
await waitFor(`document.querySelector('.maxe-workspace-dialog')`);
assert.ok(await evaluate(`document.querySelector('.maxe-workspace-dialog .ai-inp') !== null`),'Maxe input missing');
assert.ok(await evaluate(`document.querySelector('.maxe-workspace-dialog [role="log"]') !== null`),'Maxe conversation log missing');
const maxeMessageCount = await evaluate(`document.querySelectorAll('.maxe-workspace-dialog .msg').length`);
await captureViewport(1440,'maxe-workspace-desktop',1000);
await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
await waitFor(`!document.querySelector('.maxe-workspace-dialog')`);
assert.equal(await evaluate(`document.activeElement?.getAttribute('aria-label')`),'Open Maxe','Escape did not return focus to Maxe');
assert.equal(await evaluate(`document.activeElement instanceof HTMLButtonElement && !document.activeElement.disabled`),true,'Maxe trigger is not keyboard activatable');
await evaluate(`document.activeElement.click()`);
await waitFor(`document.querySelector('.maxe-workspace-dialog')`);
assert.equal(await evaluate(`document.querySelectorAll('.maxe-workspace-dialog .msg').length`),maxeMessageCount,'Conversation did not persist after reopen');
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),'Maxe overflows on mobile');
await evaluate(`document.querySelector('.maxe-workspace-menu').click()`);
await waitFor(`document.querySelector('.maxe-workspace-history.is-open')`);
await captureViewport(390,'maxe-workspace-mobile',844);
await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
await waitFor(`!document.querySelector('.maxe-workspace-dialog')`);
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await evaluate(`window.__workspaceFixture='populated';document.querySelector('button[aria-label="My Materials"]').click()`);
await waitFor(`document.querySelector('#s-workspace .ws-source-list') && document.querySelectorAll('#s-workspace .ws-source-row').length === 4`);
assert.equal(await evaluate(`document.querySelector('#s-workspace .ai-mode-toggle button[aria-pressed="true"]').textContent`),'From sources');
assert.equal(await evaluate(`document.querySelectorAll('#s-workspace .ws-source-row').length`),4,'Workspace fixture resources did not load');

async function selectWorkspaceSource(title) {
  await evaluate(`(() => { const row = [...document.querySelectorAll('#s-workspace .ws-source-row')].find(item => item.textContent.includes(${JSON.stringify(title)})); if (!row) throw new Error('Missing workspace source: '+${JSON.stringify(title)}); row.click(); })()`);
  await waitFor(`document.querySelector('#s-workspace .ws-reader-content h1')?.textContent.includes(${JSON.stringify(title)})`);
}
async function askWorkspaceMaxe(question) {
  const before = await evaluate(`document.querySelectorAll('#s-workspace .msg').length`);
  await evaluate(`(() => { const input = document.querySelector('#s-workspace .ai-inp'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(question)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await waitFor(`document.querySelectorAll('#s-workspace .msg').length >= ${before + 2}`);
}

await selectWorkspaceSource('Week 2 reading');
await waitFor(`document.querySelector('#s-workspace .ws-native-preview')`);
assert.ok(await evaluate(`document.querySelector('#s-workspace .ws-maxe-context')?.textContent.includes('Week 2 reading')`),'Active-resource context did not reach Maxe');
await evaluate(`(() => { const paragraph = document.querySelector('#s-workspace .ws-reading-section p'); const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(paragraph); selection.removeAllRanges(); selection.addRange(range); document.querySelector('#s-workspace .ws-reader-content').dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); })()`);
await waitFor(`document.querySelector('#s-workspace .ws-selection-note')`);
assert.ok(await evaluate(`document.querySelector('#s-workspace .ai-context-strip')?.textContent.includes('Selected text in context')`),'Selected-text context did not reach Maxe');
await askWorkspaceMaxe('Explain this source');
await waitFor(`document.querySelectorAll('#s-workspace .ai-citation').length > 0`);
assert.equal(await evaluate(`document.querySelector('#s-workspace .ai-citation').textContent.includes('Page 4')`),true,'PDF citation did not render');
await evaluate(`document.querySelectorAll('#s-workspace .ai-citation').item(document.querySelectorAll('#s-workspace .ai-citation').length - 1).click()`);
await waitFor(`document.querySelector('#s-workspace .ws-native-preview')?.src.includes('#page=4')`);

await evaluate(`document.querySelector('#s-workspace .ws-reader-actions .sv-trigger').click()`);
await waitFor(`document.querySelector('.sv-menu')`);
assert.ok(await evaluate(`document.querySelector('.sv-menu').textContent.includes('Export Markdown')`),'Resource Markdown export action did not render');
assert.ok(await evaluate(`document.querySelector('.sv-menu').textContent.includes('Export plain text')`),'Resource text export action did not render');
await evaluate(`document.querySelector('.sv-menu [role="menuitem"]').click()`);
await waitFor(`window.__fixtureRequests.some(url => url.includes('/collaboration/materials/lecture_note/2/export?format=md'))`);

await evaluate(`document.querySelector('#s-workspace .ws-share-button').click()`);
await waitFor(`document.querySelector('#s-workspace .ws-share-panel')`);
await waitFor(`document.querySelector('#s-workspace .ws-share-state')?.textContent.includes('No share links yet')`);
assert.ok(await evaluate(`document.querySelector('#s-workspace .ws-share-state')?.textContent.includes('No share links yet')`),'Share-link empty state did not render');
await evaluate(`document.querySelector('#s-workspace .ws-share-form').requestSubmit()`);
await waitFor(`document.querySelector('#s-workspace .ws-share-latest')`);
assert.ok(await evaluate(`document.querySelector('#s-workspace .ws-share-alert.is-success')?.textContent.includes('Share link created')`),'Share-link success state did not render');
const createdShareUrl = await evaluate(`document.querySelector('#s-workspace .ws-share-latest input')?.value`);
assert.ok(String(createdShareUrl).includes('/collaboration/share/'),'Created share link did not use the supported resolve endpoint');
await evaluate(`document.querySelector('#s-workspace button[aria-label="Copy new share link"]').click()`);
await waitFor(`document.querySelector('#s-workspace .ws-share-alert.is-success')?.textContent.includes('copied')`);
assert.equal(await evaluate(`window.__copiedShareLink`),createdShareUrl,'Share link copy action did not reach the clipboard fixture');
await evaluate(`navigator.clipboard.writeText = async () => { throw new Error('clipboard blocked'); }; document.querySelector('#s-workspace button[aria-label="Copy new share link"]').click()`);
await waitFor(`document.querySelector('#s-workspace .ws-share-alert.is-error')?.textContent.includes('Clipboard access is unavailable')`);
await evaluate(`navigator.clipboard.writeText = async text => { window.__copiedShareLink = text; };`);
await evaluate(`document.querySelector('#s-workspace .ws-share-inline-action.is-danger').click()`);
await waitFor(`document.querySelector('#s-workspace .ws-share-status.is-revoked')`);
assert.ok(await evaluate(`document.querySelector('#s-workspace .ws-share-status.is-revoked')?.textContent.includes('Revoked')`),'Revoked share-link status did not refresh');
await captureViewport(1440,'workspace-sharing-desktop',1000);
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),'Sharing panel has horizontal overflow on mobile');
await captureViewport(390,'workspace-sharing-mobile',844);
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});

await selectWorkspaceSource('First semester past questions');
assert.equal(await evaluate(`document.querySelector('#s-workspace .ws-share-button')`),null,'Share controls were shown for a resource the current user does not own');

await evaluate(`document.querySelector('#s-workspace .ai-mode-toggle button:nth-child(2)').click()`);
assert.equal(await evaluate(`document.querySelector('#s-workspace .ai-mode-toggle button:nth-child(2)').getAttribute('aria-pressed')`),'true');
await askWorkspaceMaxe('Explain beyond this material');
await waitFor(`document.querySelector('#s-workspace .ai-mode-note')`);
assert.ok(await evaluate(`document.querySelector('#s-workspace .ai-msgs').textContent.includes('FROM YOUR MATERIALS:')`),'Beyond Materials response lost source heading');
assert.ok(await evaluate(`document.querySelector('#s-workspace .ai-msgs').textContent.includes('BEYOND YOUR MATERIALS:')`),'Beyond Materials response lost general-knowledge heading');

await evaluate(`document.querySelector('#s-workspace .ai-mode-toggle button:first-child').click()`);
await askWorkspaceMaxe('unknown topic');
await waitFor(`document.querySelector('#s-workspace .ai-gap-actions')`);
assert.ok(await evaluate(`document.querySelector('#s-workspace .ai-gap-actions').textContent.includes('Upload privately')`),'Knowledge-gap recovery action missing');

await selectWorkspaceSource('Week 4 slides');
await waitFor(`document.querySelector('#s-workspace .ws-format-note')`);
await askWorkspaceMaxe('Explain the slides');
await waitFor(`Array.from(document.querySelectorAll('#s-workspace .ai-citation')).some(item => item.textContent.includes('Slide 8'))`);
await evaluate(`Array.from(document.querySelectorAll('#s-workspace .ai-citation')).find(item => item.textContent.includes('Slide 8')).click()`);
await waitFor(`document.querySelector('#s-workspace .ws-citation-target')?.textContent.includes('Slide 8')`);
assert.ok(await evaluate(`document.querySelector('#s-workspace .ws-format-note')?.textContent.includes('PowerPoint')`),'PowerPoint source did not remain visible after citation click');

await selectWorkspaceSource('Week 4 recording');
await waitFor(`document.querySelector('#s-workspace .ws-transcript-segment')`);
await askWorkspaceMaxe('Explain the recording');
await waitFor(`Array.from(document.querySelectorAll('#s-workspace .ai-citation')).some(item => item.textContent.includes('14:02'))`);
await evaluate(`Array.from(document.querySelectorAll('#s-workspace .ai-citation')).find(item => item.textContent.includes('14:02')).click()`);
await waitFor(`document.querySelector('#s-workspace audio')?.currentTime >= 842`);
assert.ok(await evaluate(`document.querySelector('#s-workspace .ws-transcript-time')?.textContent.includes('14:02')`),'Audio timestamp citation did not render');

const sourceDividerBefore = await evaluate(`document.querySelector('#s-workspace .ws-divider[aria-label="Resize sources panel"]').getAttribute('aria-valuenow')`);
await evaluate(`(() => { const divider = document.querySelector('#s-workspace .ws-divider[aria-label="Resize sources panel"]'); divider.dispatchEvent(new KeyboardEvent('keydown', { key: Number(divider.getAttribute('aria-valuenow')) >= 420 ? 'ArrowLeft' : 'ArrowRight', bubbles: true })); })()`);
assert.notEqual(await evaluate(`document.querySelector('#s-workspace .ws-divider[aria-label="Resize sources panel"]').getAttribute('aria-valuenow')`),sourceDividerBefore,'Workspace panel resize did not respond');
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
assert.equal(await evaluate(`document.querySelectorAll('#s-workspace .ws-mobile-tabs button').length`),3,'Mobile workspace tabs missing');
await evaluate(`document.querySelector('#s-workspace .ws-mobile-tabs button:nth-child(3)').click()`);
assert.ok(await evaluate(`document.querySelector('#s-workspace .ws-maxe-panel').classList.contains('is-mobile-active')`),'Maxe mobile tab did not open Maxe');
await evaluate(`document.querySelector('#s-workspace .ws-mobile-tabs button:nth-child(2)').click()`);
assert.ok(await evaluate(`document.querySelector('#s-workspace .ws-reader-panel').classList.contains('is-mobile-active')`),'Reader mobile tab did not open Reader');
assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),'Workspace has horizontal overflow on mobile');
assert.equal(await evaluate(`document.querySelectorAll('#s-workspace .ai-msgs script, #s-workspace .ai-msgs iframe').length`),0,'Maxe rendered unsafe embedded HTML');
assert.equal(await evaluate(`document.querySelector('#s-workspace .ai-msgs').textContent.includes('**')`),false,'Maxe exposed raw Markdown markers');
assert.equal(await evaluate(`Array.from(document.querySelectorAll('#s-workspace button')).filter(button => !button.disabled && !button.getAttribute('aria-label') && !button.textContent.trim()).length`),0,'Workspace contains an inaccessible unlabeled control');
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await evaluate(`document.querySelector('#s-workspace .ws-mobile-tabs button:nth-child(3)').click()`);
await captureViewport(1440,'maxe-source-aware-workspace-desktop',1000);
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
await captureViewport(390,'maxe-source-aware-workspace-mobile',844);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Performance.enable');
await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
const beforeMotion = Object.fromEntries((await send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
await new Promise(resolve => setTimeout(resolve, 2200));
const afterMotion = Object.fromEntries((await send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
assert.ok((afterMotion.LayoutCount - beforeMotion.LayoutCount) <= 2,`Maxe idle motion triggered repeated layout (delta ${afterMotion.LayoutCount - beforeMotion.LayoutCount})`);
assert.ok((afterMotion.TaskDuration - beforeMotion.TaskDuration) < 0.5,'Maxe idle motion consumed meaningful main-thread time');
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await evaluate(`document.querySelector('button[aria-label="Progress"]').click()`);
await waitFor(`document.querySelector('#s-progress .progress-decision')`);
assert.ok(await evaluate(`document.querySelector('#s-progress').textContent.includes('Readiness is still gathering evidence')`),'Insufficient-evidence readiness guidance missing');
assert.equal(await evaluate(`document.querySelector('#s-progress .progress-primary-measure strong').textContent.trim()`),'—','Readiness percentage appeared without evidence');
await captureViewport(1440,'phase-f-progress-insufficient',1000);

await evaluate(`document.querySelector('button[aria-label="Practice"]').click()`);
await waitFor(`document.querySelector('#s-practice #practice-scope')`);
assert.ok(await evaluate(`document.querySelector('#s-practice .practice-primary').textContent.includes('Create cited quiz')`),'Quiz creation surface did not mount');
await evaluate(`document.querySelector('#s-practice .practice-primary').click()`);
await waitFor(`document.querySelector('#s-practice .paper')`);
assert.ok(await evaluate(`document.querySelectorAll('#s-practice .quiz-option').length >= 4`),'Grounded quiz options did not render');
assert.ok(await evaluate(`document.querySelector('#s-practice .question-tags').textContent.includes('Slide')`),'Quiz citation did not render');
await evaluate(`document.querySelectorAll('#s-practice .quiz-options').forEach(group => group.querySelector('button').click())`);
await evaluate(`document.querySelector('#s-practice .paper-foot .practice-primary').click()`);
await waitFor(`document.querySelector('#s-practice .practice-result')`);
assert.ok(await evaluate(`document.querySelectorAll('#s-practice .answer-review').length === 5`),'Answer review did not render for every question');
assert.ok(await evaluate(`document.querySelector('#s-practice .practice-result').textContent.includes('Private attempt stored')`),'Attempt storage confirmation missing');
await captureViewport(1440,'phase-f-practice-desktop',1000);
await evaluate(`document.querySelector('button[aria-label="Progress"]').click()`);
await waitFor(`document.querySelector('#s-progress .progress-decision')`);
assert.ok(await evaluate(`document.querySelector('#s-progress').textContent.includes('Complete 6 more questions')`),'Evidence progress message missing after the first quiz');
await evaluate(`document.querySelector('button[aria-label="Practice"]').click()`);
await waitFor(`document.querySelector('#s-practice #practice-scope')`);
await evaluate(`document.querySelector('#s-practice .practice-primary').click()`);
await waitFor(`document.querySelector('#s-practice .paper')`);
await evaluate(`document.querySelectorAll('#s-practice .quiz-options').forEach(group => group.querySelector('button').click())`);
await evaluate(`document.querySelector('#s-practice .paper-foot .practice-primary').click()`);
await waitFor(`document.querySelector('#s-practice .practice-result')`);
assert.ok(await evaluate(`document.querySelector('#s-practice .practice-result').textContent.includes('Private attempt stored')`),'Second attempt storage confirmation missing');
await evaluate(`document.querySelector('#s-practice .paper-foot .mark').click()`);
await waitFor(`document.querySelector('#s-practice .practice-history-row')`);
await evaluate(`document.querySelector('#s-practice .practice-history-row .mark').click()`);
await waitFor(`document.querySelector('#s-practice .history-review')`);
assert.ok(await evaluate(`document.querySelector('#s-practice .history-review').textContent.includes('Week 4 slides')`),'Quiz history review citation missing');

await evaluate(`document.querySelector('button[aria-label="Progress"]').click()`);
await waitFor(`document.querySelector('#s-progress [aria-label*="evidence-based readiness"]')`);
assert.equal(await evaluate(`document.querySelector('#s-progress .progress-primary-measure strong').textContent.trim()`),'60%','Supported readiness percentage missing');
assert.ok(await evaluate(`document.querySelector('#s-progress .topic-signal-weak') !== null`),'Weak-topic classification missing');
assert.ok(await evaluate(`document.querySelector('#s-progress').textContent.includes('Practice this topic')`),'Weak-topic recommendation missing');
assert.ok(await evaluate(`document.querySelector('#s-progress .progress-review-button') !== null`),'Progress quiz history review control missing');
await captureViewport(1440,'phase-f-progress-supported',1000);

await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
await evaluate(`document.querySelector('button[aria-label="Practice"]').click()`);
await waitFor(`document.querySelector('#s-practice #practice-scope')`);
assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),'Practice has horizontal overflow on mobile');
await captureViewport(390,'phase-f-practice-mobile',844);
await evaluate(`document.querySelector('button[aria-label="Progress"]').click()`);
await waitFor(`document.querySelector('#s-progress .progress-decision')`);
assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),'Progress has horizontal overflow on mobile');
assert.equal(await evaluate(`Array.from(document.querySelectorAll('#s-practice button,#s-progress button')).filter(button => !button.disabled && !button.getAttribute('aria-label') && !button.textContent.trim()).length`),0,'Learning surfaces contain an inaccessible unlabeled control');
assert.equal(await evaluate(`document.querySelectorAll('#s-progress script,#s-progress iframe,#s-practice script,#s-practice iframe').length`),0,'Learning surfaces rendered unsafe embedded HTML');
assert.equal(await evaluate(`Boolean(document.querySelector('#s-progress')?.textContent.includes('**') || document.querySelector('#s-practice')?.textContent.includes('**'))`),false,'Learning surfaces exposed raw Markdown markers');
await captureViewport(390,'phase-f-progress-mobile',844);
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await evaluate(`document.querySelector('.maxe-trigger').click()`);
await waitFor(`document.querySelector('.maxe-workspace-dialog')`);
await evaluate(`(() => { const input = document.querySelector('.maxe-workspace-dialog .ai-inp'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'Explain market structures'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
await waitFor(`document.querySelector('.maxe-workspace-dialog .ai-learning-suggestion')`);
assert.ok(await evaluate(`document.querySelector('.maxe-workspace-dialog .ai-learning-suggestion').textContent.includes('missed Market structures')`),'Maxe learning suggestion did not use stored evidence');
await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
await waitFor(`!document.querySelector('.maxe-workspace-dialog')`);
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await evaluate(`window.__workspaceFixture='empty';document.querySelector('button[aria-label="My desk"]').click()`);
await waitFor(`document.querySelectorAll('.desk-shortcuts button').length >= 2`);
await evaluate(`document.querySelectorAll('.desk-shortcuts button')[1].click()`);
await waitFor(`document.querySelector('#s-questions')`);
assert.ok(await evaluate(`document.querySelector('button[aria-label="Open Maxe"]') !== null`),'Maxe missing from list-heavy screen');
await evaluate(`sessionStorage.setItem('exammind-workspace-public-check','true'); localStorage.removeItem('token'); location.hash=''; location.reload()`);
await waitFor(`document.querySelector('.lp-nav')`);
assert.equal(await evaluate(`document.querySelector('button[aria-label="Open Maxe"]')`),null,'Maxe should not mount on the public landing page');
assert.deepEqual(errors,[], 'Browser errors');
await writeFile('.impeccable/review/workspace-checks.json',JSON.stringify({results,interactions:'upload, groups, course search, archive filter, Maxe open-close-focus-persistence, reduced motion, compositor-only idle motion, list screen and landing regression passed',errors,fixtures:true},null,2));
console.log(JSON.stringify({results,interactions:'passed',errors},null,2));
ws.close();
