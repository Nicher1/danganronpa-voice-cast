// NODE_PATH points to Playwright; CHROME_PATH may select a local browser. SHOTS=<dir> saves screenshots.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..');
(async()=>{
  const server=http.createServer((req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/live-public-board.json'){
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state:{version:17,actors:[],roles:[]}}));return;
    }
    const file=path.join(root,['/','/11037','/11037/'].includes(pathname)?'index.html':pathname);
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
    const base=`http://127.0.0.1:${server.address().port}`;

    // The first game never shows the pet tab.
    await page.goto(`${base}/11037`);
    await page.waitForSelector('#sessionPlanner',{state:'attached'});
    assert.equal(await page.locator('#petTabBtn').isVisible(),false,'pet tab hidden in the first game');

    await page.goto(`${base}/11037?previewGame=dr2x2`);
    await page.waitForSelector('#petTabBtn:not(.hidden)');
    await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
    await page.locator('#petTabBtn').click();
    await page.waitForSelector('#petName');
    assert.equal(await page.locator('#petName').textContent(),'Monomi');

    const hunger=async()=>Number(await page.locator('#petStats .pet-stat').first().locator('b').textContent());
    const before=await hunger();
    await page.locator('#petTab [data-act="pet"]').first().click().catch(()=>{});
    const hasButtons=await page.locator('.pet-buttons button').count();
    assert.ok(hasButtons>=5,'care buttons render');
    assert.ok(before>0);

    // Skins unlock in chapter 2 and replace the picture; the secret switch only changes the name.
    assert.equal(await page.locator('#petShop [data-arg="chibimi"]').count(),1,'chibimi skin in the shop');
    await page.locator('#petShop [data-arg="chibimi"]').click();
    await page.waitForSelector('#petStage[data-skin="chibimi"]');
    await page.locator('#petReveal').check();
    await page.waitForFunction(()=>document.querySelector('#petName').textContent==='Usami');
    assert.equal(await page.locator('#petStage').getAttribute('data-skin'),'chibimi','the skin stays when the switch is on');
    await page.locator('#petShop [data-act="unwear"][data-arg="skin"]').click();
    await page.waitForSelector('#petStage[data-skin=""]');
    await page.locator('#petReveal').uncheck();
    await page.waitForFunction(()=>document.querySelector('#petName').textContent==='Monomi');

    // Life cycle in the host preview: neglect kills the pet, the grave reaches the Memorial, a new egg hatches.
    assert.equal(await page.locator('#petHost').isVisible(),true,'host controls in the preview');
    assert.match(await page.locator('#petGrowth').textContent(),/Baby/);
    for(let i=0;i<3;i++)await page.locator('[data-act="skip"][data-arg="120"]').click();
    await page.waitForSelector('#petStage[data-dead="1"]');
    assert.match(await page.locator('#petGrowth').textContent(),/Passed away/);
    assert.equal(await page.locator('#petTab [data-act="feed"],#petTab [data-act="open-feed"]').first().isDisabled(),true,'cannot feed a dead pet');
    assert.equal(await page.locator('#petRevive').isVisible(),true);
    await page.locator('#memorialTabBtn,[data-tab="memorial"]').first().click();
    await page.waitForSelector('#petGraveyard:not([hidden]) .pet-grave-card');
    await page.locator('#petTabBtn').click();
    await page.locator('[data-act="hatch"]').click();
    await page.waitForSelector('#petStage[data-dead="0"]');
    assert.equal(await page.locator('#petWarn').isHidden(),true);

    for(const [w,h] of [[1920,1080],[1280,900],[390,844]]){

      await page.setViewportSize({width:w,height:h});
      await page.waitForTimeout(150);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      assert.ok(overflow<=1,`no horizontal overflow at ${w}px (${overflow})`);
      if(process.env.SHOTS)await page.screenshot({path:path.join(process.env.SHOTS,`pet-${w}.png`),fullPage:true});
    }
    assert.deepEqual(errors,[]);
  }finally{
    if(browser)await browser.close();
    server.close();
  }
})().catch(error=>{console.error(error);process.exit(1)});
