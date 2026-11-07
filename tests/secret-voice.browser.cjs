// Real page and audio decoding; mocked playback keeps this test silent.
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
      if(file.endsWith('index.html'))data=data.toString().replace('  function canPlaySecretVoice(role){',`  window.secretTest={setup(chapter,completed=false){
        activeGameId='dr1';state.settings.games.dr1.voiceChapter=chapter;state.settings.games.dr1.completedUnits={4:completed};
        state.secretSettings.games.dr1.junkoMukuroRevealed=false;
        window.CastUnconfirmedStudent.ensure(state,mkRole);render();
      },rerender:render,otherGame(){activeGameId='dr2x2';render();}};
  function canPlaySecretVoice(role){`);
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.mp3':'audio/mpeg'})[path.extname(file)]||'application/octet-stream');res.end(data);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
    const context=await browser.newContext();
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    await context.addInitScript(()=>{
      window.audioInstances=[];window.rejectAudio=false;
      window.Audio=class extends EventTarget{
        constructor(url){super();this.src=url;this.paused=true;window.audioInstances.push(this);}
        play(){if(window.rejectAudio)return Promise.reject(new Error('Blocked'));this.paused=false;return Promise.resolve();}
        pause(){this.paused=true;}
      };
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=viewer#monopad`);
    await page.waitForSelector('#sessionPlanner .schedule-heading',{state:'attached'});
    await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());window.secretTest.setup(5);});
    await page.locator('[data-tab="monopad"]').click();
    const badge=page.locator('#monopadDossierGrid [data-action="play-secret"]');
    assert.equal(await badge.count(),1);
    assert.equal(await page.evaluate(()=>audioInstances.length),0,'No autoplay');
    for(const [width,height] of [[360,800],[915,412],[1024,768],[1440,900]]){
      await page.setViewportSize({width,height});
      await badge.scrollIntoViewIfNeeded();
      assert.ok(await badge.isVisible());
      const box=await badge.boundingBox();assert.ok(box.width>=44&&box.height>=44);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
    }
    await badge.click();assert.equal(await badge.getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>audioInstances.at(-1).src),'assets/audio/secret-student.mp3');
    assert.equal(await page.locator('#dossierDialog').isVisible(),false,'Badge does not open the profile');
    await badge.click();assert.equal(await badge.innerText(),'???');
    assert.equal(await page.evaluate(()=>audioInstances.at(-1).paused),true);
    await badge.focus();await page.keyboard.press('Enter');assert.equal(await badge.getAttribute('aria-pressed'),'true');
    await page.evaluate(()=>audioInstances.at(-1).dispatchEvent(new Event('ended')));
    assert.equal(await badge.getAttribute('aria-pressed'),'false');
    await page.keyboard.press('Space');assert.equal(await badge.getAttribute('aria-pressed'),'true');
    await badge.locator('xpath=ancestor::article').locator('[data-read-description]').click();
    const dialogBadge=page.locator('#dossierDialog [data-action="play-secret"]');
    await dialogBadge.click();assert.equal(await badge.getAttribute('aria-pressed'),'false','Only one sample plays');
    assert.equal(await dialogBadge.getAttribute('aria-pressed'),'true');
    await page.locator('#dossierDialog [data-close]').click();
    await page.waitForFunction(()=>audioInstances.at(-1).paused);
    await page.evaluate(()=>window.rejectAudio=true);await badge.click();
    await page.waitForFunction(()=>document.querySelector('#monopadDossierGrid [data-action="play-secret"]').getAttribute('aria-pressed')==='false');
    await page.evaluate(()=>window.rejectAudio=false);
    await badge.click();await page.evaluate(()=>window.secretTest.rerender());
    assert.equal(await page.evaluate(()=>audioInstances.at(-1).paused),true,'Rerender stops a detached control');
    await page.evaluate(()=>window.secretTest.setup(4));assert.equal(await page.locator('[data-action="play-secret"]').count(),0,'Earlier progress hides even a saved entry');
    await page.evaluate(()=>window.secretTest.setup(4,true));assert.equal(await badge.count(),1,'Completed chapter four unlocks it');
    await page.evaluate(()=>window.secretTest.otherGame());assert.equal(await page.locator('[data-action="play-secret"]').count(),0);
    const duration=await page.evaluate(async()=>{
      const bytes=await (await fetch('assets/audio/secret-student.mp3')).arrayBuffer();
      const context=new AudioContext();const buffer=await context.decodeAudioData(bytes);await context.close();return buffer.duration;
    });
    assert.ok(duration>7&&duration<10,'Bundled audio decodes as the short clip');
    assert.deepEqual(errors,[]);
    console.log('Secret badge passed: chapter gate, click/keyboard, stop/end/error, single playback, dialog, screen sizes and MP3 decoding.');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
