// NODE_PATH points to a Playwright installation; CHROME_PATH may select a local browser.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const P=require('../session-planner');
const root=path.resolve(__dirname,'..');
const now=Date.parse('2030-10-28T10:00:00Z');
const ids=[P.fresh().hostActorId,'test-actor-2','test-actor-3','test-actor-4','test-actor-5'];
const board={state:{version:17,actors:ids.map((id,i)=>({id,name:`Test actor ${i+1}`})),roles:[]}};
const fixture={sessions:[{id:'old',startAt:P.instant('2030-10-21'),endedAt:P.instant('2030-10-21','20:00'),breaks:[]}],votes:{'2030-10-30':Object.fromEntries(ids.map((id,i)=>[id,{available:true,offset:i===4?0:-15}]))},times:{},notices:[],records:{}};
(async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/live-public-board.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(board));return;}
  const file=path.join(root,['/','/11037','/11037/'].includes(pathname)?'index.html':pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}
   res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(data);
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,timezoneId:'Europe/Copenhagen',locale:'en-GB'});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await context.addInitScript(({now,fixture})=>{Date.now=()=>now;localStorage.setItem('danganronpa-session-planner-v1',JSON.stringify(fixture));localStorage.setItem('danganronpa-schedule-collapsed','true');},{now,fixture});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const base=`http://127.0.0.1:${server.address().port}/`;
  await page.goto(base+'?mode=player&scheduleDate=2030-10-30#schedule');
  await page.waitForSelector('#scheduleTab.active [data-drop-day="2030-10-30"]');
  assert.equal(await page.locator('.tab').nth(1).getAttribute('data-tab'),'schedule');
  assert.equal(await page.locator('#nextSessionBanner').getAttribute('data-session-state'),'likely');
  assert.match(await page.locator('#nextSessionBanner').innerText(),/18:45/);
  assert.equal(await page.locator('#nextSessionBanner [data-countdown-at]').count(),1,'A unique leader may show an estimated countdown');
  assert.equal(await page.locator('#castingTab').isVisible(),false);
  assert.equal(await page.locator('.schedule-week').isVisible(),true,'Old collapsed preference cannot hide voting');
  assert.equal(await page.locator('dialog[open]').count(),0,'Discord landing should not be blocked by a picker');
  const samples=[];
  for(const width of [360,412,700,1020,1440]){
   await page.setViewportSize({width,height:915});
   for(const theme of ['original','reworked','finale']){
    await page.locator('.board-options>summary').click();
    await page.selectOption('#uiThemeSelect',theme);
    await page.locator('.board-options>summary').click();
    for(const tab of ['casting','schedule']){
     await page.locator(`.tab[data-tab="${tab}"]`).click();
     const size=await page.evaluate(()=>({header:document.querySelector('.topbar').getBoundingClientRect().height,scroll:document.documentElement.scrollWidth,width:innerWidth}));
     assert.ok(size.scroll<=width+1,`${width}/${theme}/${tab}: horizontal overflow ${size.scroll}`);
     assert.ok(size.header<300,`${width}/${theme}: header has desktop flex-basis height ${size.header}`);
     assert.equal(await page.locator('#sessionPlanner').isVisible(),tab==='schedule');
     samples.push({width,theme,tab,header:Math.round(size.header)});
    }
   }
  }
  await page.setViewportSize({width:412,height:915});
  await page.locator('.tab[data-tab="casting"]').click();
  await page.locator('#nextSessionBanner a').click();
  assert.equal(await page.locator('#scheduleTab').isVisible(),true);
  await page.waitForTimeout(2500); // Let the theme-change toast leave the preview.
  await page.screenshot({path:path.resolve(root,'../output/mobile-schedule-after.png'),fullPage:true});
  await page.locator('.tab[data-tab="casting"]').click();
  await page.screenshot({path:path.resolve(root,'../output/mobile-first-game-after.png'),fullPage:true});
  // Realtime/storage updates change the summary without changing the selected tab.
  async function update(plan){await page.evaluate(plan=>{localStorage.setItem('danganronpa-session-planner-v1',JSON.stringify(plan));dispatchEvent(new Event('storage'));},plan);}
  await update({...fixture,votes:{}});assert.equal(await page.locator('#nextSessionBanner').getAttribute('data-session-state'),'unplanned');
  assert.equal(await page.locator('#nextSessionBanner [data-countdown-at]').count(),0);
  const low=structuredClone(fixture);low.votes['2030-10-30']=Object.fromEntries(Object.entries(low.votes['2030-10-30']).slice(0,2));await update(low);
  assert.equal(await page.locator('#nextSessionBanner').getAttribute('data-session-state'),'unplanned');
  assert.equal(await page.locator('#nextSessionBanner [data-countdown-at]').count(),0);
  const tied=structuredClone(fixture);tied.votes['2030-10-31']=structuredClone(tied.votes['2030-10-30']);await update(tied);assert.equal(await page.locator('#nextSessionBanner').getAttribute('data-session-state'),'tied');
  assert.match(await page.locator('#nextSessionBanner h2').innerText(),/either .*30 October.* or .*31 October/);
  assert.equal(await page.locator('#nextSessionBanner [data-countdown-at]').count(),0);
  tied.votes['2030-11-01']=structuredClone(tied.votes['2030-10-30']);await update(tied);
  assert.equal(await page.locator('#nextSessionBanner').getAttribute('data-session-state'),'tied');
  assert.match(await page.locator('#nextSessionBanner h2').innerText(),/1 November/);
  assert.equal(await page.locator('#nextSessionBanner [data-countdown-at]').count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Tied dates wrap on phones');
  await page.screenshot({path:path.resolve(root,'../output/mobile-tied-sessions.png')});
  const confirmed={...tied,sessions:[{id:'next',source:'host',startAt:P.instant('2030-10-31','20:00'),endedAt:null,breaks:[]}]};await update(confirmed);assert.equal(await page.locator('#nextSessionBanner').getAttribute('data-session-state'),'confirmed');
  assert.equal(await page.locator('#nextSessionBanner [data-countdown-at]').count(),1,'A host-confirmed date overrides tied votes');
  const automatic=structuredClone(confirmed);automatic.sessions[0].source='poll';await update(automatic);
  assert.equal(await page.locator('#nextSessionBanner [data-countdown-at]').count(),0,'An automatic booking cannot bypass a vote tie');
  assert.equal(await page.locator('#sessionPlanner .schedule-heading h2').innerText(),'Next planned session');
  tied.votes['2030-11-02']=structuredClone(tied.votes['2030-10-30']);await update(tied);
  assert.equal(await page.locator('#nextSessionBanner').getAttribute('data-session-state'),'unplanned');
  assert.equal(await page.locator('#nextSessionBanner [data-countdown-at]').count(),0);
  const active={...fixture,sessions:[{id:'active',startAt:new Date(now-60000).toISOString(),endedAt:null,breaks:[]}]};await update(active);assert.equal(await page.locator('#nextSessionBanner').getAttribute('data-session-state'),'active');
  assert.equal(await page.locator('#castingTab').isVisible(),true);
  // Host controls remain available in the new destination on a desktop browser.
  const desktop=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-GB',timezoneId:'Europe/Copenhagen'});
  await desktop.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await desktop.addInitScript(({now,fixture})=>{Date.now=()=>now;localStorage.setItem('danganronpa-session-planner-v1',JSON.stringify(fixture));},{now,fixture});
  const host=await desktop.newPage();host.on('pageerror',e=>errors.push(e.message));
  await host.goto(base+'11037#schedule');
  await host.waitForSelector('#sessionPlanner [data-open-schedule]');
  await host.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
  await host.locator('.tab[data-tab="schedule"]').click();
  await host.locator('[data-open-schedule]').click();
  assert.equal(await host.locator('#scheduleDialog').isVisible(),true);
  await host.locator('#scheduleDialog [data-close]').click();
  await host.locator('#sessionPlanner [data-host-actor]').selectOption(ids[0]);
  await host.locator('[data-vote="2030-10-31"]').click();
  assert.equal(await host.locator('[data-vote="2030-10-31"]').getAttribute('aria-pressed'),'true');
  await host.screenshot({path:path.resolve(root,'../output/desktop-schedule-after.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify(samples));console.log('Browser checks passed: phone/desktop skins, second tab, Discord date route, old preferences, banner states and navigation.');
 }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
