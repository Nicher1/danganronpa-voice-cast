// NODE_PATH points to Playwright; CHROME_PATH may select a local browser.
// 2×2 before Chapter 1: first-game closing quotes, every talent shown as ???, and "Chapter 0" in the host selector.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..');
(async()=>{
  const server=http.createServer((req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/live-public-board.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state:{version:17,actors:[],roles:[]}}));return;}
    const file=path.join(root,['/','/11037','/11037/'].includes(pathname)?'index.html':pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,data)=>{
      if(error){res.writeHead(404).end();return;}
      if(file.endsWith('index.html'))data=data.toString().replace('  function reviveRole(roleId){',`  window.nsTest={game:id=>selectGame(id,{announce:false}),settings:()=>state.settings.games.dr2x2,bio:name=>biographyForRole(state.roles.find(r=>r.gameId==='dr2x2'&&r.name===name))};
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
    const errors=[];
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/11037`);await page.waitForSelector('#sessionPlanner',{state:'attached'});
    await page.evaluate(()=>window.nsTest.game('dr2x2'));
    const pick=value=>page.evaluate(v=>{const s=document.querySelector('#voiceChapterSelect');s.value=v;s.dispatchEvent(new Event('change',{bubbles:true}));},value);
    const titles=()=>page.locator('.role-title').allTextContents();
    const quotes=()=>page.locator('.finale-aside').textContent();

    // A board that has not started: closing lines of the first game, talents hidden.
    assert.equal(await page.evaluate(()=>window.nsTest.settings().notStarted),true,'untouched 2×2 counts as not started');
    assert.match(await quotes(),/then so is hope/);
    assert.match(await quotes(),/Since I have hope/);
    let list=await titles();
    assert.ok(list.length>5,'role cards are listed');
    assert.deepEqual([...new Set(list)],['???'],'every talent is hidden');
    assert.equal(await page.evaluate(()=>window.nsTest.bio('Chiaki Nanami')),'This file stays sealed until Chapter 1 begins.');
    assert.equal(await page.locator('#voiceChapterSelect option').first().textContent(),'Chapter 0 · Not started');
    assert.equal(await page.locator('#themeProgressLabel').textContent(),'CH. 00 · NOT STARTED');
    assert.equal(await page.evaluate(()=>window.nsTest.settings().voiceChapter),1,'chapter data stays on chapter 1');

    // Marking Chapter 1 reveals the talents and ends the closing quotes.
    await pick('1');
    assert.equal(await page.evaluate(()=>window.nsTest.settings().notStarted),false);
    assert.doesNotMatch(await quotes(),/then so is hope/);
    list=await titles();
    assert.ok(list.some(title=>/^Ultimate /.test(title)),'talents show once Chapter 1 is marked');
    assert.match(await page.evaluate(()=>window.nsTest.bio('Chiaki Nanami')),/Ultimate Gamer/);

    // Back to Chapter 0 hides them again; other games never show Chapter 0 behaviour.
    await pick('0');
    assert.deepEqual([...new Set(await titles())],['???']);
    await page.evaluate(()=>window.nsTest.game('dr1'));
    assert.notEqual(await page.locator('#voiceChapterSelect option').first().textContent(),'Chapter 0 · Not started');
    assert.deepEqual(errors,[]);
    console.log('not started ok');
  }finally{await browser?.close();server.close();}
})().catch(error=>{console.error(error);process.exit(1);});
