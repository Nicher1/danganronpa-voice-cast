// NODE_PATH points to Playwright; CHROME_PATH may select a local browser.
// Each player opens the newest unlocked game, is asked once after a new game unlocks, and the choice is remembered.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..');
(async()=>{
  const server=http.createServer((req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/live-public-board.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state:{version:17,actors:[],roles:[]}}));return;}
    const file=path.join(root,pathname==='/'?'index.html':pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,data)=>{
      if(error){res.writeHead(404).end();return;}
      if(file.endsWith('index.html'))data=data.toString().replace('  function reviveRole(roleId){',`  window.gameTest={
    setup(unlocked){['a1','a2'].forEach(id=>state.actors.push({id,name:'Player '+id,hasPassword:false,lockedRoleIds:emptyLockedRoleIds(),lockedAtByGame:{},replacementToken:false,history:[],deathCount:0}));
      state.settings.completedGames.dr1=unlocked>=2;state.settings.completedGames.dr2x2=unlocked>=3;render();},
    login:id=>completeLogin(id),logout:()=>logout(),active:()=>activeGameId,newest:()=>newestGameId(),title:id=>gameDefinition(id).title
  };
  function reviveRole(roleId){`);
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const url=`http://127.0.0.1:${server.address().port}/?mode=player&shared=1`;
    const errors=[];
    const open=async unlocked=>{
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
      await page.goto(url);await page.waitForSelector('#sessionPlanner',{state:'attached'});
      await page.waitForTimeout(500); // the player login opens by itself shortly after load
      await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
      await page.evaluate(n=>window.gameTest.setup(n),unlocked);
      return page;
    };
    const pickerOpen=page=>page.evaluate(()=>document.querySelector('#gamePickerDialog').open);
    const login=async(page,id)=>{await page.evaluate(i=>window.gameTest.login(i),id);await page.waitForTimeout(250);};

    // Only the first game is unlocked: no question, first game.
    let page=await open(1);await login(page,'a1');
    assert.equal(await pickerOpen(page),false,'no question with one game');
    assert.equal(await page.evaluate(()=>window.gameTest.active()),'dr1');
    await page.close();

    // The second game unlocks: the newest game is the default and the player is asked once.
    page=await open(2);await login(page,'a1');
    assert.equal(await page.evaluate(()=>window.gameTest.active()),'dr2x2','newest unlocked game is the default');
    assert.equal(await pickerOpen(page),true,'asked once after a new unlock');
    await page.locator('#gamePickerGrid .game-choice').first().click();
    assert.equal(await page.evaluate(()=>window.gameTest.active()),'dr1');
    await page.close();

    // Next visit: no question, the remembered choice is kept; the button still opens the menu.
    page=await open(2);await login(page,'a1');
    assert.equal(await pickerOpen(page),false,'not asked again');
    assert.equal(await page.evaluate(()=>window.gameTest.active()),'dr1','remembered choice');
    await page.locator('summary',{hasText:'Game, appearance'}).click();
    await page.locator('#gameSwitcherBtn').click();
    assert.equal(await pickerOpen(page),true,'button opens the menu manually');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>window.gameTest.active()),'dr1','closing keeps the board');

    // Another player has not been asked yet and gets the newest game with the question.
    await page.evaluate(()=>window.gameTest.logout());await login(page,'a2');
    assert.equal(await page.evaluate(()=>window.gameTest.active()),'dr2x2');
    assert.equal(await pickerOpen(page),true,'each player is asked once');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('#gamePickerDialog').open);
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));
    await page.close();

    // Closing the question without choosing keeps the newest game next time too.
    page=await open(2);await login(page,'a2');
    assert.equal(await pickerOpen(page),false);
    assert.equal(await page.evaluate(()=>window.gameTest.active()),'dr2x2');
    await page.close();

    // A third game unlocks: asked once more.
    page=await open(3);await login(page,'a1');
    assert.equal(await pickerOpen(page),true,'asked again after another unlock');
    assert.equal(await page.evaluate(()=>window.gameTest.active()),'dr2slayhem');
    assert.deepEqual(errors,[]);
    console.log('game default ok');
  }finally{await browser?.close();server.close();}
})().catch(error=>{console.error(error);process.exit(1);});
