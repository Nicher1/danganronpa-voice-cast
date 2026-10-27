const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const preview=require('../admin-preview-safety.js');
(async()=>{
  let writes=0;
  const client={value:'read',getBoard(){return this.value},isHost:async()=>true,loginHost:async()=>true,saveBoard(){writes++},uploadVoiceClip(){writes++},removeVoiceClip(){writes++},setActorPassword(){writes++},setActorDiscordId(){writes++},subscribe(){writes++},futureMutation(){writes++},client:{private:'hidden'}};
  const safe=preview.connection(client);
  assert.equal(safe.getBoard(),'read');assert.equal(await safe.isHost(),true);
  for(const name of ['saveBoard','uploadVoiceClip','removeVoiceClip','setActorPassword','setActorDiscordId','subscribe','futureMutation'])await assert.rejects(safe[name](),/unavailable in admin preview/);
  assert.equal(safe.client,undefined);assert.equal(writes,0);
  const html=fs.readFileSync('index.html','utf8');
  const stored=[],context={state:{preview:true},isAdminPreview:true,PREVIEW_STORAGE_KEY:'preview',STORAGE_KEY:'live',sessionStorage:{setItem:(...args)=>stored.push(args)},localStorage:{setItem:()=>{throw Error('Live cache modified')}},synchroniseActorDeathCounts:()=>{},alert:assert.fail};
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('function cacheState()'),html.indexOf('function remoteSafeState(')),context);
  vm.runInContext(html.slice(html.indexOf('function saveState()'),html.indexOf('function requestHostAuth(')),context);
  context.saveState();assert.deepEqual(stored,[['preview','{"preview":true}']]);
  assert.ok(html.includes('if(!isAdminPreview&&!isLocalPreview&&remoteSync)'),'Preview must never start the shared schedule store');
  console.log('Admin preview blocks remote mutations and subscriptions, hides the underlying client, and saves only to its session copy.');
})().catch(error=>{console.error(error);process.exitCode=1});
