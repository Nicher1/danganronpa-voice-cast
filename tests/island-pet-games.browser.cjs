// NODE_PATH points to Playwright; CHROME_PATH may select a local browser. SHOTS=<dir> saves screenshots.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..');
(async()=>{
  const server=http.createServer((req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.join(root,['/','/11037'].includes(pathname)?'index.html':pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,data)=>{
      if(error){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/11037?previewGame=dr2x2`);
    await page.waitForSelector('#petTabBtn:not(.hidden)');
    await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
    await page.locator('#petTabBtn').click();
    await page.waitForSelector('#petGameTabs [data-game]');

    // The host preview unlocks every game, and the chapter picker locks them again
    assert.equal(await page.locator('#petGameTabs [data-game]').count(),4);
    await page.selectOption('#petPreviewChapter','2');
    assert.equal(await page.locator('#petGameTabs [data-game]').count(),2,'chapter 2 shows two games');
    assert.equal(await page.locator('#petGameTabs .locked').count(),2);
    await page.selectOption('#petPreviewChapter','5');

    // Every game runs, accepts input and reports a finite score
    const results=await page.evaluate(async()=>{
      const out={};
      for(const id of ['snack','memory','bubble','run']){
        const canvas=document.createElement('canvas');document.body.appendChild(canvas);
        out[id]=await new Promise(resolve=>{
          const game=CastPetGames.create(id,canvas,{chapter:()=>5,seconds:1.5,art:'assets/monopad/dr2/monomi.png',onEnd:score=>{canvas.remove();resolve(score);}});
          game.start();
          for(const key of ['ArrowLeft','ArrowRight','ArrowDown',' ','Enter'])window.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
          canvas.dispatchEvent(new PointerEvent('pointerdown',{clientX:60,clientY:100,bubbles:true}));
        });
      }
      return out;
    });
    for(const [id,score] of Object.entries(results))assert.ok(Number.isFinite(score)&&score>=0,`${id} score ${score}`);

    // Running a round from the UI saves a score through the preview pet
    await page.selectOption('#petPreviewChapter','5');
    for(const id of ['snack','memory','bubble','run']){
      await page.locator(`#petGameTabs [data-game="${id}"]`).click();
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#petStart').isVisible(),true);
      assert.equal(await page.locator('#petJump').isVisible(),id==='run');
      assert.equal(await page.locator('#petLeft').isVisible(),id==='snack');
    }

    // One real round through the UI: the score is saved and the shared 60 s cooldown starts
    await page.locator('#petGameTabs [data-game="snack"]').click();
    await page.evaluate(()=>{});
    await page.locator('#petStart').click();
    await page.waitForFunction(()=>/earned/.test(document.querySelector('#petGameInfo').textContent),null,{timeout:60000});
    assert.match(await page.locator('#petStart').textContent(),/Ready in/);

    if(process.env.SHOTS){
      for(const id of ['snack','memory','bubble','run']){
        await page.evaluate(({id})=>{
          const old=document.getElementById('shotCanvas');if(old)old.remove();
          const canvas=document.createElement('canvas');canvas.id='shotCanvas';canvas.style.cssText='position:fixed;left:10px;top:10px;z-index:99999;width:360px';document.body.appendChild(canvas);
          window.shotGame?.destroy();window.shotGame=CastPetGames.create(id,canvas,{chapter:()=>5,seconds:20,art:'assets/monopad/dr2/monomi.png',onEnd(){}});window.shotGame.start();
        },{id});
        await page.waitForTimeout(id==='run'?1800:2500);
        if(id==='run')await page.keyboard.press('Space');
        if(id==='bubble')await page.mouse.click(120,120);
        await page.waitForTimeout(200);
        await page.locator('#shotCanvas').screenshot({path:path.join(process.env.SHOTS,`game-${id}.png`)});
      }
    }    assert.deepEqual(errors,[]);
  }finally{
    if(browser)await browser.close();
    server.close();
  }
})().catch(error=>{console.error(error);process.exit(1)});
