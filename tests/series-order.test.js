const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const order=['dr1','dr2x2','dr2slayhem','udg','dr3anime','v3','hundredline'];
const board={settings:{completedGames:{}},roles:[{id:'legacy',gameId:'dr2',ownerId:'actor',image:'custom.webp'}],predictions:{actor:{'dr2:1':{victimRoleId:'legacy'}}}};
const context={state:board,activeGameId:'dr1',isLocalPreview:false,mode:'host',toast:()=>{},saveState:()=>{},render:()=>{},showGamePicker:()=>{},createRolesForGame:()=>[]};
vm.createContext(context);
vm.runInContext(html.slice(html.indexOf('const GAME_DEFINITIONS ='),html.indexOf('const ANIME_WATCH_ORDER =')),context);
vm.runInContext(html.slice(html.indexOf('const isGameUnlocked ='),html.indexOf('const currentSettings ='))+'\nglobalThis.unlocked=isGameUnlocked;globalThis.available=availableGameIds;',context);
vm.runInContext(html.slice(html.indexOf('async function setGameCompleted('),html.indexOf('function renderAdminTools(')),context);
(async()=>{
  assert.deepEqual(Array.from(context.available()),['dr1']);
  assert.equal(context.unlocked('dr2'),false,'Legacy DR2 is archived, not part of the active order');
  assert.equal(context.unlocked('missing'),false);
  await context.setGameCompleted('dr2slayhem',true);
  assert.equal(board.settings.completedGames.dr2slayhem,undefined,'Cannot complete a locked route');
  for(let i=0;i<order.length;i++){
    assert.equal(context.unlocked(order[i]),true);
    if(i+1<order.length)assert.equal(context.unlocked(order[i+1]),false);
    await context.setGameCompleted(order[i],true);
  }
  assert.deepEqual(Array.from(context.available()),order);
  context.activeGameId='hundredline';
  await context.setGameCompleted('dr2x2',false);
  assert.equal(board.settings.completedGames.dr1,true);
  for(const id of order.slice(1))assert.equal(board.settings.completedGames[id],false);
  assert.equal(context.activeGameId,'dr1');
  assert.equal(board.roles[0].ownerId,'actor');
  assert.equal(board.roles[0].image,'custom.webp');
  assert.equal(board.predictions.actor['dr2:1'].victimRoleId,'legacy');
  context.isLocalPreview=true;
  assert.equal(context.unlocked('dr2slayhem'),true,'Local route preview remains available');
  assert.equal(context.unlocked('dr2slayhem',false),false,'Preview does not change completion prerequisites');
  context.mode='player';
  await context.setGameCompleted('dr2x2',true);
  assert.equal(board.settings.completedGames.dr2x2,false,'Only hosts change completion');
  console.log('Sequential unlocks, completion rollback, archive preservation and host-only changes passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
