// Student integration regressions against an isolated local frontend.
// API persistence and providers are fixtures; real browser storage is used.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const baseUrl = process.env.EXAMMIND_UI_URL || 'http://127.0.0.1:5173';
const source = await readFile('scripts/check_workspace.mjs', 'utf8');
const marker = "await send('Page.addScriptToEvaluateOnNewDocument', { source: `";
const start = source.indexOf(marker) + marker.length;
const end = source.indexOf('};` });', start);
assert.ok(start >= marker.length && end > start, 'Workspace fixture not found');
const fixture = vm.runInNewContext('`' + source.slice(start, end + 2) + '`');
new vm.Script(fixture); // Catch invalid injected JavaScript before opening a browser.
const { chromium } = await import(pathToFileURL(path.join(process.env.TEMP, 'exammind-s8-playwright/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true,
  args:['--disable-background-networking', '--disable-component-update'] });
const errors = [];
let currentPage;
try {
  for (const width of [1366, 390]) {
    const context = await browser.newContext({viewport:{width,height:width === 1366 ? 768 : 844}, serviceWorkers:'block', reducedMotion:'reduce'});
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseUrl).origin ? route.continue() : route.abort('blockedbyclient'));
    await context.addInitScript({content:fixture + `
      window.__workspaceFixture='populated';
      window.__integrityPosts=[]; window.__preferenceFailure=true; window.__historyFailure=false; window.__searchFailure=false;
      const preferences=()=>JSON.parse(localStorage.getItem('fixture-ksa-preferences') || '{}');
      const profile=()=>JSON.parse(localStorage.getItem('fixture-learning-profile') || '{}');
      const fixtureFetch=window.fetch;
      const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
      window.fetch=async(...args)=>{
        const url=String(args[0]),method=String(args[1]?.method || 'GET').toUpperCase();
        if(!url.includes(':8001')) return fixtureFetch(...args);
        if(method!=='GET') window.__integrityPosts.push({url,method,body:JSON.parse(args[1]?.body || '{}')});
        const empty=new URL(location.href).searchParams.has('first_access');
        const ksa={id:1,slug:'ksa',name:'Kora Sales Academy',type:'academy',status:'active',membership:{id:1,role:'member',status:'active',onboarding_required:false}};
        if(url.endsWith('/learning-spaces')) return json({active_space:empty?null:ksa,memberships:empty?[]:[{space:ksa}],available_spaces:empty?[ksa]:[]});
        if(url.endsWith('/community/profile')) return json({preferred_name:'Test Student',username:'test_student',onboarding_completed:true,onboarding_state:'completed',onboarding_required:false,onboarding_preferences:preferences()});
        if(url.endsWith('/reminders')) return json({enabled:false,channels:{email:{subscribed:false,status:'inactive'},browser_push:{subscribed:false,status:'inactive'}},delivery:[],dispatch:{enabled:false,cadence:null,scheduled_worker_required:true}});
        if(url.endsWith('/learning-spaces/ksa/preferences')){
          if(window.__preferenceFailure) return json({detail:'Controlled KSA preference failure'},503);
          localStorage.setItem('fixture-ksa-preferences',args[1].body); return json({status:'saved'});
        }
        if(url.endsWith('/learning/profile')){
          if(method==='PATCH'){
            const data=profile();
            for(const [key,value] of Object.entries(JSON.parse(args[1].body))) data[key]={value,source:'explicit student choice'};
            localStorage.setItem('fixture-learning-profile',JSON.stringify(data));
          }
          return json({explicit_preferences:profile(),inferred_preferences:{}});
        }
        if(url.includes('/learning/attempts')) return window.__historyFailure?json({detail:'Controlled history failure'},503):json([]);
        if(url.includes('/search?') && window.__searchFailure) return json({detail:'Controlled search failure'},503);
        if(url.includes('/search?')) return json({query:'prospecting',understanding:null,past_questions:[],lecture_notes:[{id:1,title:'Prospecting notes',course_id:1}],threads:[],study_groups:[],study_sessions:[],related_topics:[]});
        if(url.includes('/rag/related-questions')){
          if(window.__relatedFailure) return json({detail:'Controlled related-question failure'},503);
          if(window.__relatedEmpty) return json([]);
          return json([{id:7,title:'Authorized review questions',preview:'Explain prospect qualification.',citation:{label:'Sales practice · Page 2'}}]);
        }
        if(url.includes('/maxe/chat') && window.__globalCitation){
          const response=await fixtureFetch(...args),data=await response.json();
          const citation=window.__globalCitation==='slides'
            ? {source:'Week 4 slides',resource_type:'lecture_note',resource_id:1,label:'Week 4 slides · Slide 8',slide_from:8,target:{resource_type:'lecture_note',resource_id:1,slide_from:8}}
            : {source:'Week 4 recording',resource_type:'audio',resource_id:3,label:'Week 4 recording · 14:02',timestamp_start:842,target:{resource_type:'audio',resource_id:3,start_time:842}};
          data.source_citations=[citation]; data.sources=[citation.source]; return json(data);
        }
        if(url.endsWith('/learning-spaces/early-access-requests')){
          await new Promise(resolve=>setTimeout(resolve,150));
          localStorage.setItem('fixture-early-access','requested'); return json({status:'requested'},201);
        }
        if(url.endsWith('/learning/quizzes') && method==='POST'){
          const response=await fixtureFetch(...args),data=await response.json();
          const request=JSON.parse(args[1].body);
          data.question_type=request.question_type;
          data.questions=data.questions.map(question=>({...question,question_type:request.question_type,options:request.question_type==='short_answer'?[]:question.options}));
          return json(data);
        }
        return fixtureFetch(...args);
      };
    `});
    const page = await context.newPage();
    currentPage = page;
    page.setDefaultTimeout(10000);
    const navigate = async name => {
      if (width < 760) await page.getByRole('button',{name:'Open all navigation',exact:true}).click();
      await page.getByRole('button',{name,exact:true}).filter({visible:true}).first().click();
    };
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseUrl, {waitUntil:'networkidle'});
    await page.locator('.workspace-shell').waitFor();
    await navigate('Settings');
    await page.getByRole('button', {name:/Edit KSA learning preferences/}).click();
    await page.getByRole('button',{name:'Back',exact:true}).click();
    await page.getByRole('button', {name:/Edit KSA learning preferences/}).click();
    const goal = page.locator('#ksa-learning-goal');
    await goal.selectOption({index:1});
    const chosenGoal = await goal.inputValue();
    await page.locator('#ksa-help-topics').fill('prospect qualification, follow-up');
    await page.locator('#ksa-explanation').selectOption('examples_first');
    await page.locator('#ksa-notifications').check();
    await page.getByRole('button', {name:'Enter my KSA desk'}).click();
    await page.getByRole('alert').filter({hasText:'Controlled KSA preference failure'}).waitFor();
    assert.equal(await page.locator('#ksa-explanation').inputValue(), 'examples_first');
    await page.evaluate(()=>{window.__preferenceFailure=false;});
    await page.getByRole('button', {name:'Enter my KSA desk'}).click();
    await page.locator('.workspace-shell').waitFor();
    const stored = await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture-ksa-preferences')));
    assert.deepEqual(stored.learning_goals,[chosenGoal]);
    assert.deepEqual(stored.help_topics,['prospect qualification','follow-up']);
    assert.equal(stored.explanation_preference,'examples_first');
    assert.equal(stored.notifications_enabled,true);
    await page.reload({waitUntil:'networkidle'});
    await navigate('Settings');
    await page.getByRole('button', {name:/Edit KSA learning preferences/}).click();
    assert.equal(await goal.inputValue(),chosenGoal);
    assert.equal(await page.locator('#ksa-notifications').isChecked(),true);
    await page.evaluate(()=>{window.__preferenceFailure=false;});
    await page.getByRole('button', {name:'Enter my KSA desk'}).click();
    await page.locator('.workspace-shell').waitFor();
    await navigate('Progress');
    await page.locator('.learning-profile-grid select').first().selectOption('concise');
    await page.getByRole('status').filter({hasText:'Preference saved.'}).waitFor();
    await page.locator('.learning-profile-grid select').nth(1).selectOption('short_answer');
    await page.getByRole('status').filter({hasText:'Preference saved.'}).waitFor();
    await page.evaluate(()=>{window.__historyFailure=true;});
    if (width < 760) await page.getByRole('button',{name:'Practice',exact:true}).filter({visible:true}).first().click();
    else await navigate('Practice');
    await page.waitForFunction(()=>document.querySelector('#practice-type')?.value==='short_answer');
    await page.getByRole('alert').filter({hasText:'Controlled history failure'}).waitFor();
    assert.equal(await page.getByText('No quiz attempts yet.',{exact:false}).count(),0);
    await page.evaluate(()=>{window.__historyFailure=false;});
    await page.getByRole('button',{name:'Retry quiz history'}).click();
    await page.getByText('No quiz attempts yet.',{exact:false}).waitFor();
    await page.getByRole('button',{name:'Create cited quiz'}).click();
    await page.locator('.quiz-short-answer').first().waitFor();
    assert.equal(await page.evaluate(()=>window.__integrityPosts.find(item=>item.url.endsWith('/learning/quizzes')).body.question_type),'short_answer');
    await page.evaluate(()=>{window.__searchFailure=true;});
    const search = page.locator('.global-search > input');
    await search.fill('prospecting'); await search.press('Enter');
    await page.getByRole('heading',{name:'Search could not be completed'}).waitFor();
    assert.equal(await page.getByText('No best matches yet.',{exact:true}).count(),0);
    await page.evaluate(()=>{window.__searchFailure=false;});
    await page.getByRole('button',{name:'Retry search'}).click();
    await page.getByRole('button',{name:'Learn more with AI'}).first().click();
    await page.getByRole('button',{name:'View related questions'}).waitFor();
    await page.evaluate(()=>{window.__relatedFailure=true;});
    await page.getByRole('button',{name:'View related questions'}).click();
    await page.getByRole('alert').filter({hasText:'Controlled related-question failure'}).waitFor();
    await page.evaluate(()=>{window.__relatedFailure=false;window.__relatedEmpty=true;});
    await page.getByRole('button',{name:'View related questions'}).click();
    await page.getByText('No related past questions were found in your authorized workspace.',{exact:true}).waitFor();
    await page.evaluate(()=>{window.__relatedEmpty=false;});
    await page.getByRole('button',{name:'View related questions'}).click();
    await page.getByText('Authorized review questions',{exact:true}).waitFor();
    const citation = page.getByRole('button',{name:'Week 2 reading · Page 4',exact:true});
    await citation.click();
    await page.locator('#s-workspace').waitFor();
    await page.getByText('Opened at Page 4',{exact:false}).waitFor();
    for (const [kind,label] of [['slides','Week 4 slides · Slide 8'],['audio','Week 4 recording · 14:02']]) {
      await page.evaluate(value=>{window.__globalCitation=value;},kind);
      await search.fill('prospecting '+kind); await search.press('Enter');
      await page.getByRole('button',{name:'Learn more with AI'}).first().click();
      // Timed citation buttons also include a separate visible time badge in
      // their accessible name; locate the verified label without dropping it.
      await page.getByRole('button').filter({hasText:label}).last().click();
      await page.locator('#s-workspace').waitFor();
      if(kind==='slides') await page.getByText('Opened at Slide 8',{exact:false}).waitFor();
      else await page.waitForFunction(()=>document.querySelector('#s-workspace audio')?.currentTime>=842);
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
    await page.goto(baseUrl+'/?first_access=1',{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'No, request early access'}).click();
    await page.getByRole('button',{name:'Request early access',exact:true}).evaluate(button=>{button.click();button.click();});
    await page.getByRole('status').filter({hasText:'Your early-access request was saved.'}).waitFor();
    assert.equal(await page.evaluate(()=>window.__integrityPosts.filter(item=>item.url.endsWith('/early-access-requests')).length),1);
    assert.equal(await page.locator('.workspace-shell').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
    await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,desktop:1366,mobile:390,checked:['KSA edit Back/save/reload and failed-save retention','reminder consent preserved','explicit quiz-format consumer','history error/retry','search error/retry','authorized related-question rendering/error/empty','global page/slide/audio citation click-through','early-access request duplicate prevention','no runtime errors/overflow']},null,2));
} catch (error) {
  if (currentPage) console.error(JSON.stringify({url:currentPage.url(),visibleText:await currentPage.locator('body').innerText(),errors},null,2));
  throw error;
} finally { await browser.close(); }
