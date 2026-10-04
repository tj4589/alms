// Isolated browser regressions. Start Vite preview on 4175 and Vite dev on
// 4176; use temporary Playwright tooling, never application dependencies.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const out = path.resolve('output/audit-fixes');
await mkdir(out, { recursive: true });
const tooling = path.join(process.env.TEMP, 'exammind-s8-playwright/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(tooling).href);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-background-networking', '--disable-component-update'] });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  return ['127.0.0.1', 'localhost'].includes(url.hostname) && ['4175', '4176'].includes(url.port) ? route.continue() : route.abort('blockedbyclient');
});
const errors = [];
const results = [];
try {
  // Test actual offline APIs in an empty local document, not mocked persistence.
  const storage = await context.newPage();
  await storage.route('**/__offline_test__', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Isolated storage tests</body></html>' }));
  await storage.goto('http://127.0.0.1:4176/__offline_test__');
  const offline = await storage.evaluate(async () => {
    const api = await import('/src/offline.ts');
    const expect = (condition, message) => { if (!condition) throw new Error(message); };
    const pack = { id: 'same-id', courseCode: 'PRIVATE', title: 'User A private pack', savedAt: new Date().toISOString(), questions: [] };
    api.setOfflineScope(null, null);
    let denied = false;
    try { await api.saveStudyPack(pack); } catch { denied = true; }
    expect(denied, 'Unverified offline writes must fail');
    api.setOfflineScope(101, 1);
    await api.saveStudyPack(pack);
    expect(await api.countRecords('studyPacks') === 1, 'Owner record is missing');
    api.setOfflineScope(102, 1);
    expect(await api.countRecords('studyPacks') === 0, 'Cross-user count leak');
    await api.saveStudyPack({ ...pack, title: 'User B private pack' });
    api.setOfflineScope(101, 2);
    expect((await api.listRecords('studyPacks')).length === 0, 'Cross-space content leak');
    api.setOfflineScope(101, 1);
    expect((await api.listRecords('studyPacks'))[0].title === pack.title, 'Colliding IDs overwrote another owner');
    const pptMime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    await api.queuePendingUpload({ id: 'ppt', fileName: 'test.pptx', fileSize: 4, queuedAt: new Date().toISOString(), status: 'waiting_to_sync' }, new File(['test'], 'test.pptx', { type: pptMime }));
    const upload = (await api.listRecords('pendingUploads'))[0];
    expect(upload.mimeType === pptMime && new TextDecoder().decode(upload.fileData) === 'test', 'MIME/bytes changed in queue');
    let release;
    const slow = { type: pptMime, arrayBuffer: () => new Promise(resolve => { release = resolve; }) };
    const pending = api.queuePendingUpload({ id: 'race', fileName: 'race.pptx', fileSize: 4, queuedAt: new Date().toISOString(), status: 'waiting_to_sync' }, slow).then(() => false, () => true);
    api.setOfflineScope(102, 1); release(new ArrayBuffer(4));
    expect(await pending, 'Account-switch write race was not rejected');
    expect(await api.countRecords('pendingUploads') === 0, 'Upload reassigned to new owner');
    api.setOfflineScope(101, 1);
    // Unattributed legacy data is retained but cannot be adopted/read/synced.
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('exammind-offline');
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('studyPacks', 'readwrite');
        tx.objectStore('studyPacks').put({ ...pack, id: 'legacy', title: 'UNOWNED_SENTINEL' });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
    expect(await api.hasLegacyOfflineData(), 'Legacy warning missing');
    expect((await api.listRecords('studyPacks')).length === 1, 'Legacy ownership was inferred');
    await api.clearOfflineAccountData();
    expect(await api.countRecords('studyPacks') === 0, 'Owner cleanup failed');
    api.setOfflineScope(102, 1);
    expect(await api.countRecords('studyPacks') === 1, 'Cleanup deleted another owner');
    expect(await api.hasLegacyOfflineData(), 'Cleanup silently deleted legacy data');
    api.setOfflineScope(null, null);
    expect((await api.listRecords('studyPacks')).length === 0, 'Logout storage exposure');
    return 'owner/space isolation, ID collisions, MIME/bytes, write races, legacy quarantine, scoped cleanup and logout passed';
  });
  results.push({ offline });
  await storage.close();

  const source = await readFile('scripts/check_workspace.mjs', 'utf8');
  const marker = "await send('Page.addScriptToEvaluateOnNewDocument', { source: `";
  const start = source.indexOf(marker) + marker.length;
  let fixture = vm.runInNewContext('`' + source.slice(start, source.indexOf('};` });', start) + 2).replace(/(?<!\\)\\n/g, '\\\\n') + '`');
  fixture = fixture.replaceAll('uploaded_by:1,', 'uploaded_by:1,is_owner:true,').replaceAll('uploaded_by:2,', 'uploaded_by:2,is_owner:false,');
  const identity = id => fixture + `
window.__workspaceFixture='populated';
window.__auditReady=false; window.__auditPreferenceFailure=true; window.__auditPosts=[]; window.__auditUploads=[]; window.__auditUploadFailure=true;
const fixtureFetch=window.fetch;
window.fetch=async (...args)=>{
 const url=String(args[0]), method=String(args[1]?.method||'GET').toUpperCase();
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 if(url.includes('/auth/me')) return json({id:${id},name:'Audit Student ${id}',username:'audit_${id}',email:'audit${id}@example.com',role:'student',account_status:'active'});
 if(url.includes('/analytics/student/')) return json({readiness:[{id:1,topic:'Topic A',course_id:null,score:100}],attempts:[{id:1,score:100,total_questions:4,topic:'Topic A',completed_at:'2026-10-03T12:00:00Z'}],overall_readiness:{available:window.__auditReady,score:window.__auditReady?70:null,recommended_next_action:'Complete another quiz.'}});
 if(url.endsWith('/learning/profile') && method==='PATCH') {window.__auditPosts.push(JSON.parse(args[1].body)); if(window.__auditPreferenceFailure) return json({detail:'Controlled preference error'},503); const body=JSON.parse(args[1].body); return json({explicit_preferences:Object.fromEntries(Object.entries(body).map(([key,value])=>[key,{value,source:'explicit'}])),inferred_preferences:{}});}
 if(url.endsWith('/ingest/upload') && method==='POST') {
  const form=args[1].body; window.__auditUploads.push({confirm:form.get('confirm'),type:form.get('file').type,visibility:form.get('visibility')});
  if(window.__auditUploadFailure) return json({detail:'Controlled analysis failure'},503);
  const metadata={document_title:'Queued slides',document_type:'lecture_note',course_code:'ECO 101',course_title:'Economics',topics_covered:['Market structure'],confidence_score:0.9,extraction_method:'embedded_text',extraction_confidence:0.95};
  return json(form.get('confirm')==='true'?{status:'success',document_id:17,document_type:'lecture_note',chunks_indexed:2,indexed:true,metadata,sharing:{visibility:'private',moderation_status:'not_submitted'}}:{status:'analyzed',metadata,preview:'Synthetic queue preview',extraction:{pages_read:2,extraction_method:'embedded_text'},preview_quality:'high'});
 }
 if(url.includes('/search?')) return json({query:'Audit source',past_questions:[{id:1,title:'First semester past questions',content_text:'Synthetic authorized question text'}],lecture_notes:[{id:2,title:'Week 2 reading'}],threads:[],related_topics:[],study_groups:[],study_sessions:[]});
 return fixtureFetch(...args);
};`;
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript({ content: identity(1) });
  await page.goto('http://127.0.0.1:4175/');
  await page.locator('#s-dashboard .desk-summary').waitFor();
  assert.ok(!(await page.locator('.desk-summary').innerText()).includes('100%'));
  await page.getByRole('button', { name: 'Progress', exact: true }).first().click();
  await page.locator('.learning-profile-grid select').first().selectOption('concise');
  await page.locator('#s-progress [role=alert]').waitFor();
  assert.equal(await page.locator('.learning-profile-grid select').first().inputValue(), '');
  await page.evaluate(() => { window.__auditPreferenceFailure = false; });
  await page.getByRole('button', { name: 'Try saving again' }).click();
  await page.getByRole('status').filter({ hasText: 'Preference saved.' }).waitFor();
  assert.equal(await page.locator('.learning-profile-grid select').first().inputValue(), 'concise');
  assert.equal(await page.evaluate(() => window.__auditPosts.length), 2);
  await page.evaluate(() => { window.__auditReady = true; });
  await page.getByRole('button', { name: 'My desk', exact: true }).first().click();
  await page.getByText('overall readiness', { exact: false }).waitFor();
  assert.match(await page.locator('.desk-summary').innerText(), /70%/);
  results.push({ readiness: 'insufficient evidence hidden; canonical 70% preserved', preferences: '503 handled, old value preserved, explicit retry succeeds, no unhandled errors' });

  // Exercise the expanded search view through the real Enter/navigation flow.
  const globalSearch = page.locator('.global-search > input');
  await globalSearch.fill('Audit source');
  await globalSearch.press('Enter');
  await page.locator('.search-page').waitFor();
  await page.getByRole('button', { name: 'Open Week 2 reading', exact: true }).first().click();
  await page.locator('.ws-reader-header h1').filter({ hasText: 'Week 2 reading' }).waitFor();
  await globalSearch.fill('Audit source');
  await globalSearch.press('Enter');
  await page.locator('.search-page').waitFor();
  await page.getByRole('button', { name: 'Open First semester past questions', exact: true }).first().click();
  await page.locator('.ws-reader-header h1').filter({ hasText: 'First semester past questions' }).waitFor();
  results.push({ search: 'note and past-question results open the correct canonical kind/ID in Reader' });

  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('exammind-offline');
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('pendingUploads', 'readwrite');
      tx.objectStore('pendingUploads').put({ id: '1:1|queued-ppt', _scope: '1:1', _recordId: 'queued-ppt', fileName: 'queued.pptx', fileSize: 4, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', fileData: new TextEncoder().encode('test').buffer, queuedAt: new Date().toISOString(), status: 'waiting_to_sync' });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    }; request.onerror = () => reject(request.error);
  }));
  await page.getByRole('button', { name: 'Saved library', exact: true }).click();
  await page.getByRole('button', { name: 'Review upload', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__auditUploads.length), 0, 'Reconnection must not auto-upload');
  await page.getByRole('button', { name: 'Review queued file', exact: true }).evaluate(el => { el.click(); el.click(); });
  await page.getByText('Controlled analysis failure', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.__auditUploads.length), 1, 'Duplicate analysis executed');
  await page.evaluate(() => { window.__auditUploadFailure = false; });
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('button', { name: 'Add to library', exact: true }).waitFor();
  assert.equal(await page.locator('input[type=radio][value=private]').isChecked(), true);
  assert.ok((await page.locator('#s-upload').innerText()).includes('Contribute to CU'));
  await page.getByRole('button', { name: 'Add to library', exact: true }).evaluate(el => { el.click(); el.click(); });
  await page.getByText('Saved to your workspace', { exact: true }).waitFor();
  const uploads = await page.evaluate(() => window.__auditUploads);
  assert.equal(uploads.length, 3);
  assert.ok(uploads.every(upload => upload.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'));
  assert.equal(uploads.at(-1).visibility, 'private');
  await page.getByRole('button', { name: 'Keep visible only to me' }).click();
  await page.getByRole('button', { name: 'My Materials', exact: true }).first().click();
  await page.getByRole('button', { name: 'Saved library', exact: true }).click();
  await page.getByText('Nothing queued.', { exact: false }).waitFor();
  results.push({ queuedUpload: 'no automatic submission; analysis failure retains bytes; retry preserves PPTX MIME; explicit private confirmation; duplicates prevented; stored queue entry removed' });

  await page.getByRole('button', { name: 'My Materials', exact: true }).first().click();
  await page.getByRole('button', { name: 'Saved library', exact: true }).click();
  await page.getByRole('button', { name: 'Find more materials' }).click();
  const search = page.locator('#s-questions input').first();
  await search.fill('Audit source');
  await search.press('Enter');
  await page.getByRole('button', { name: 'Save offline', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Save offline', exact: true }).click();
  await page.getByText(/saved for offline study/).waitFor();
  await page.getByRole('button', { name: 'My Materials', exact: true }).first().click();
  await page.getByRole('button', { name: 'Saved library', exact: true }).click();
  await page.locator('#s-offline').getByRole('button', { name: 'Open', exact: true }).first().click();
  await page.getByText('Synthetic authorized question text', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await page.locator('.lp-nav').waitFor();
  const second = await context.newPage();
  second.on('pageerror', error => errors.push(error.message));
  await second.addInitScript({ content: identity(2) });
  await second.goto('http://127.0.0.1:4175/');
  await second.locator('#s-dashboard').waitFor();
  await second.getByRole('button', { name: 'My Materials', exact: true }).first().click();
  await second.getByRole('button', { name: 'Saved library', exact: true }).click();
  await second.locator('#mat-docs-title').locator('..').getByText('Nothing saved yet.', { exact: false }).waitFor();
  assert.ok(!(await second.locator('#s-offline').innerText()).includes('Synthetic authorized question text'));
  assert.equal(await second.locator('#s-offline .shelf-list li').count(), 0);
  results.push({ accountSwitch: 'actual UI-saved private pack remains invisible to second account after normal logout' });

  await second.getByRole('button', { name: 'Back to study materials' }).click();
  for (const width of [1366, 390, 320]) {
    await second.setViewportSize({ width, height: width === 1366 ? 768 : 844 });
    await second.locator('.ws-source-row').first().waitFor();
    assert.equal(await second.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await second.screenshot({ path: path.join(out, `workspace-${width}.png`), fullPage: true });
  }
  await second.setViewportSize({ width: 1366, height: 768 });
  await second.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await second.screenshot({ path: path.join(out, 'workspace-dark.png'), fullPage: true });
  assert.equal(await second.locator('.ws-reader-panel').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(29, 32, 35)');
  assert.equal(await second.locator('.rail-button').first().evaluate(el => getComputedStyle(el).color), 'rgb(185, 189, 178)');
  assert.ok(await second.getByRole('textbox', { name: 'Message Maxe' }).count());
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'regressions.json'), JSON.stringify({ results, errors, fixtures: true }, null, 2));
  console.log(JSON.stringify({ results, errors }, null, 2));
} catch (error) {
  await writeFile(path.join(out, 'regressions-failure.json'), JSON.stringify({ results, errors, failure: error.message }, null, 2));
  const page = context.pages().at(-1);
  if (page) await page.screenshot({ path: path.join(out, 'regressions-failure.png'), fullPage: true });
  throw error;
} finally { await context.close(); await browser.close(); }
