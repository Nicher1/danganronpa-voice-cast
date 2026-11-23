// NODE_PATH points to Playwright; CHROME_PATH may select a local browser.
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
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
    const context=await browser.newContext();
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const base=`http://127.0.0.1:${server.address().port}`,errors=[];
    const open=async(url,size)=>{
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
      await page.setViewportSize(size);await page.goto(base+url);await page.waitForSelector('#sessionPlanner',{state:'attached'});
      return page;
    };
    const digits=(page,unit)=>page.locator(`[data-unit="${unit}"] .cd-digit`).allTextContents().then(list=>list.join(''));

    // Front page for a viewer, at wide, normal and phone sizes, without sideways scrolling.
    for(const size of [{width:1280,height:900},{width:390,height:844},{width:320,height:700}]){
      const page=await open('/?mode=viewer',size);
      assert.equal(await page.locator('#releaseCountdown').isVisible(),true,'countdown is on the front page');
      assert.match(await page.locator('#releaseCountdown').textContent(),/GOODBYE DESPAIR/);
      assert.match(await page.locator('#releaseCountdown').textContent(),/14 January 2027/);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`no overflow at ${size.width}px`);
      await page.close();
    }

    // The host can preview other dates; players cannot.
    let page=await open('/11037?countdownPreview='+encodeURIComponent('2027-01-13T23:59:50+01:00'),{width:1280,height:900});
    assert.equal(await page.locator('#releaseCountdown').getAttribute('data-phase'),'hour');
    assert.equal(await digits(page,'days')+await digits(page,'hours')+await digits(page,'minutes'),'000000');
    await page.waitForFunction(()=>document.querySelector('#releaseCountdown').dataset.phase==='released',null,{timeout:15000});
    assert.equal(await digits(page,'seconds'),'00');
    await page.close();
    page=await open('/?mode=player&countdownPreview='+encodeURIComponent('2027-01-14T08:00:00+01:00'),{width:1280,height:900});
    assert.notEqual(await page.locator('#releaseCountdown').getAttribute('data-phase'),'released','players cannot change the date');
    await page.close();
    page=await open('/11037?countdownPreview='+encodeURIComponent('2027-01-15T01:00:00+01:00'),{width:1280,height:900});
    assert.equal(await page.locator('#releaseCountdown').isVisible(),false,'hidden after release day');
    await page.close();
    assert.deepEqual(errors,[]);
    console.log('release countdown ok');
  }finally{await browser?.close();server.close();}
})().catch(error=>{console.error(error);process.exit(1);});
