// NODE_PATH points to Playwright; CHROME_PATH may select a local browser.
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
      if(file.endsWith('index.html'))data=data.toString().replace('  let discordSettingsBusy=false;',
        '  window.discordTest={loadDiscordSettings,runDiscordAction,setup(mock){remoteReady=true;remoteSync=mock;}};\n  let discordSettingsBusy=false;');
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(data);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
    const context=await browser.newContext();
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/11037`);
    await page.waitForSelector('#sessionPlanner [data-open-schedule]',{state:'attached'});
    await page.evaluate(()=>{
      document.querySelectorAll('dialog[open]').forEach(d=>d.close());
      window.mockSettings={configured:true,card:true,reminder:false,repost_supported:true};
      window.reposts=0;window.saved=[];
      window.discordTest.setup({
        getDiscordSettings:async()=>window.mockSettings,
        repostDiscordCard:async()=>{window.reposts++;return window.repostResponse||{ok:true};},
        setDiscordSettings:async reminder=>{window.saved.push(reminder);window.mockSettings.reminder=reminder;},
        getPresenceActivity:async()=>[]
      });
    });
    await page.locator('.tab[data-tab="admin"]').click();
    const button=page.locator('#discordCardRepostBtn'),toggle=page.locator('#discordReminderToggle');
    await page.waitForFunction(()=>!document.querySelector('#discordCardRepostBtn').disabled);
    assert.equal(await page.locator('#discordCardToggle').count(),0);
    assert.equal(await toggle.isChecked(),false);
    await button.click();await page.waitForFunction(()=>window.reposts===1&&!document.querySelector('#discordCardRepostBtn').disabled);
    await button.click();await page.waitForFunction(()=>window.reposts===2);
    await toggle.check();await page.waitForFunction(()=>window.saved.length===1);
    assert.deepEqual(await page.evaluate(()=>window.saved),[true]);
    await page.evaluate(()=>window.repostResponse={ok:false,status:'Cleanup pending'});await button.click();
    await page.waitForFunction(()=>document.querySelector('#discordSettingsResult').textContent==='Cleanup pending');
    // Migration mismatch must disable both controls, with a clear explanation.
    await page.evaluate(async()=>{window.mockSettings.repost_supported=false;await window.discordTest.loadDiscordSettings();});
    assert.equal(await button.isDisabled(),true);assert.equal(await toggle.isDisabled(),true);
    await page.evaluate(async()=>{window.mockSettings.repost_supported=true;window.repostResponse=null;await window.discordTest.loadDiscordSettings();});
    // A second click while a request is in flight must not enqueue a duplicate.
    assert.equal(await page.evaluate(async()=>{
      const before=window.reposts;
      window.discordTest.setup({getDiscordSettings:async()=>window.mockSettings,repostDiscordCard:async()=>{
        window.reposts++;await new Promise(resolve=>window.finishRepost=resolve);return {ok:true};
      }});
      const pending=window.discordTest.runDiscordAction(true);
      await window.discordTest.runDiscordAction(true);window.finishRepost();await pending;
      return window.reposts-before;
    }),1);
    for(const [width,height] of [[1920,1080],[1280,800],[390,844],[844,390]]){
      await page.setViewportSize({width,height});await button.scrollIntoViewIfNeeded();
      const size=await page.evaluate(()=>{
        const b=document.querySelector('#discordCardRepostBtn').getBoundingClientRect();
        return {scroll:document.documentElement.scrollWidth,width:innerWidth,left:b.left,right:b.right};
      });
      assert.ok(size.scroll<=width+1,`Overflow at ${width}x${height}`);
      assert.ok(size.left>=0&&size.right<=width,`Button clipped at ${width}x${height}`);
      await button.locator('..').screenshot({path:path.resolve(root,`../output/discord-card-panel-${width}.png`)});
    }
    assert.deepEqual(errors,[]);
    console.log('Discord panel browser checks passed: repeat clicks, ping toggle, error feedback, migration gating, busy guard, and four screen sizes.');
  }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
