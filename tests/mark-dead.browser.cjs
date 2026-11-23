// NODE_PATH points to Playwright; CHROME_PATH may select a local browser.
// Regression: marking a character dead must work and credit the actor who held it.
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
      if(file.endsWith('index.html'))data=data.toString().replace('  function reviveRole(roleId){',`  window.deathTest={
    hold(actorIndex,roleName,lock){while(state.actors.length<=actorIndex)state.actors.push({id:'test-actor-'+state.actors.length,name:'Actor '+state.actors.length,hasPassword:false,lockedRoleIds:emptyLockedRoleIds(),lockedAtByGame:{},replacementToken:false,history:[],deathCount:0});const actor=state.actors[actorIndex];if(!gameRoles().some(r=>r.name===roleName))state.roles.push(mkRole(roleName,'Ultimate Test','',false,{gameId:activeGameId}));const role=gameRoles().find(r=>r.name===roleName);
      role.ownerId=actor.id;if(lock)setLockedRoleIdFor(actor,role.id);return {actorId:actor.id,roleId:role.id};},
    kill(roleId){killRole(roleId);},
    read(actorId,roleId){const actor=actorById(actorId),role=roleById(roleId);
      return {dead:role.dead,owner:role.ownerId,deathActorId:role.deathActorId,count:actor.deathCount,token:!!actor.replacementToken,history:actor.history};}
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
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/11037`);
    await page.waitForSelector('#sessionPlanner',{state:'attached'});
    await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));

    // A character held by an actor: dies, leaves the actor and counts as that actor's death.
    const held=await page.evaluate(()=>window.deathTest.hold(0,'Junko Enoshima',false));
    await page.evaluate(id=>window.deathTest.kill(id),held.roleId);
    await page.locator('#actionConfirmYes').click();
    await page.waitForFunction(({actorId,roleId})=>window.deathTest.read(actorId,roleId).dead,held,{timeout:3000});
    const after=await page.evaluate(({actorId,roleId})=>window.deathTest.read(actorId,roleId),held);
    assert.equal(after.dead,true,'the character is marked dead');
    assert.equal(after.owner,null,'the character leaves its actor');
    assert.equal(after.deathActorId,held.actorId,'the death is credited to the actor');
    assert.equal(after.count,1,'the actor gets a death point');
    assert.ok(after.history.includes('Junko Enoshima'),'the actor history remembers the character');

    // A locked character also hands out a replacement token.
    const locked=await page.evaluate(()=>window.deathTest.hold(1,'Test Student',true));
    await page.evaluate(id=>window.deathTest.kill(id),locked.roleId);
    await page.locator('#actionConfirmYes').click();
    await page.waitForFunction(({actorId,roleId})=>window.deathTest.read(actorId,roleId).dead,locked);
    const lockedAfter=await page.evaluate(({actorId,roleId})=>window.deathTest.read(actorId,roleId),locked);
    assert.deepEqual([lockedAfter.count,lockedAfter.token],[1,true]);
    assert.deepEqual(errors,[]);
    console.log('mark dead ok');
  }finally{await browser?.close();server.close();}
})().catch(error=>{console.error(error);process.exit(1);});
