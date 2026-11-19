// Player saves: a player can only change what the app lets a player change (their own actor,
// claiming or releasing characters for themselves, their own practice recordings and
// predictions). Run from the repo root with NODE_PATH pointing at a folder that has
// @electric-sql/pglite installed.
const {PGlite}=require('@electric-sql/pglite');
const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');

const schema=fs.readFileSync(path.join(__dirname,'..','supabase-schema.sql'),'utf8');
const table=name=>schema.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0];
const fn=name=>{const start=schema.indexOf(`create or replace function public.${name}(`);assert.ok(start>=0,`${name} is missing from supabase-schema.sql`);return schema.slice(start,schema.indexOf('$$;',schema.indexOf('as $$',start)+5)+3)};
const functions=['cast_state_with_password_flags','cast_state_for_public','cast_is_host','cast_merge_player_save','cast_save_board'];
const HOST='11111111-1111-4111-8111-111111111111',OWNER='22222222-2222-4222-8222-222222222222',PLAYER='33333333-3333-4333-8333-333333333333';

const role=(id,gameId,name,ownerId,extra={})=>({id,gameId,name,title:'',ownerId,dead:false,hiddenSpoiler:false,revealed:true,image:'',biography:'',personalRecordings:[],practiceLineHistory:[],...extra});
const initialState=()=>({
 version:17,
 settings:{completedGames:{},games:{
  dr1:{voiceChapter:2,gameActive:true,maxPerActor:2,voiceInTrial:false,trialByChapter:{2:false}},
  dr2x2:{voiceChapter:1,gameActive:false,maxPerActor:3,voiceInTrial:false,trialByChapter:{1:false}}}},
 secretSettings:{note:'host only'},
 actors:[
  {id:'nicher',name:'Nicher',lockedRoleIds:{dr1:'r1'},lockedAtByGame:{dr1:1},replacementToken:false,history:['Makoto'],deathCount:1},
  {id:'fae',name:'Fae',lockedRoleIds:{dr1:null},lockedAtByGame:{},replacementToken:false,history:[],deathCount:0},
  {id:'bob',name:'Bob',lockedRoleIds:{dr1:null},lockedAtByGame:{},replacementToken:false,history:[],deathCount:0}],
 roles:[
  role('r1','dr1','Makoto','nicher',{personalRecordings:[{id:'rec1',actorId:'nicher',url:'https://x/rec1',lineId:'l1'}],practiceLineHistory:[{actorId:'nicher',lineId:'l1',chapter:1}]}),
  role('r2','dr1','Sayaka','nicher'),role('r3','dr1','Leon',null),role('r4','dr1','Mondo',null),role('r5','dr1','Chihiro',null),
  role('r6','dr1','Hidden',null,{hiddenSpoiler:true,revealed:false}),role('r7','dr1','Celeste',null,{dead:true}),role('r8','dr2x2','Hajime',null)],
 customRecaps:[{id:'c1',gameId:'dr1',chapter:1,title:'Recap',text:'host text'}],
 recapOverrides:{},chapterResults:{},populationGraph:{},predictions:{}
});

(async()=>{
 const db=new PGlite({extensions:{pgcrypto}});
 await db.exec(`create role anon; create role authenticated;
  create schema auth; create schema extensions; create extension pgcrypto schema extensions;
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to anon, authenticated;`);
 for(const name of ['cast_boards','cast_public_boards','cast_board_secrets','cast_host_sessions','cast_actor_passwords','cast_actor_sessions'])await db.exec(table(name));
 for(const name of functions)await db.exec(fn(name));
 for(const line of schema.split('\n').filter(l=>new RegExp(`^(revoke|grant) .* function public\\.(${functions.join('|')})\\(`).test(l)))await db.exec(line);
 const start=initialState();
 await db.query('insert into cast_boards(slug,state,revision,initialized) values($1,$2,1,true)',['test',JSON.stringify(start)]);
 await db.query('insert into cast_public_boards(slug,state,revision,initialized) values($1,public.cast_state_for_public($2),1,true)',['test',JSON.stringify(start)]);
 await db.exec("insert into cast_actor_passwords values('test','nicher',extensions.crypt('pw',extensions.gen_salt('bf')),'bcrypt');");
 await db.query('insert into cast_host_sessions(board_slug,user_id) values($1,$2)',['test',HOST]);
 await db.query('insert into cast_actor_sessions(board_slug,actor_id,user_id) values($1,$2,$3)',['test','nicher',OWNER]);

 const call=async(user,sql,params)=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  await db.exec('set role authenticated');
  try{return (await db.query(sql,params)).rows[0].r}finally{await db.exec('reset role')}
 };
 const stored=async()=>(await db.query("select state,revision from cast_boards where slug='test'")).rows[0];
 const save=async(user,state,gameId)=>{
  const body=structuredClone(state);if(gameId)body.clientGameId=gameId;
  return call(user,'select public.cast_save_board($1,$2,$3) r',['test',JSON.stringify(body),(await stored()).revision]);
 };
 // Players edit the public board, as the app shows it to them.
 const playerSave=async(edit,gameId='dr1')=>{const s=structuredClone((await db.query("select state from cast_public_boards where slug='test'")).rows[0].state);edit(s);return save(PLAYER,s,gameId)};
 const hostSave=async edit=>{const s=structuredClone((await stored()).state);edit(s);return save(HOST,s)};
 const roleById=async id=>(await stored()).state.roles.find(x=>x.id===id);
 const actorById=async id=>(await stored()).state.actors.find(x=>x.id===id);
 // The session row that cast_claim_actor or cast_register_actor writes for a passwordless actor.
 const signInAs=actorId=>db.query('insert into cast_actor_sessions(board_slug,actor_id,user_id) values($1,$2,$3)',['test',actorId,PLAYER]);
 await signInAs('fae');

 const before=(await stored()).state;
 await playerSave(s=>{
  s.actors=s.actors.filter(x=>x.id!=='nicher');
  s.actors.find(x=>x.id==='bob').name='lol';
  s.actors.find(x=>x.id==='fae').replacementToken=true;
  Object.assign(s.roles.find(x=>x.id==='r2'),{name:'HACKED',ownerId:null});
  s.roles.find(x=>x.id==='r7').dead=false;
  s.roles.find(x=>x.id==='r1').personalRecordings=[];
  s.roles=s.roles.filter(x=>x.id!=='r3');
  s.roles.push(role('r99','dr1','Fake','fae'));
  s.customRecaps=[];s.recapOverrides={dr1:{1:{pretrial:'vandalised'}}};
 });
 const comparable=s=>JSON.stringify({...s,actors:s.actors.map(({hasPassword,...x})=>x),predictions:undefined});
 assert.equal(comparable((await stored()).state),comparable(before),'A player cannot delete, rename, revive or add other people\'s data');

 await playerSave(s=>{s.roles.find(x=>x.id==='r3').ownerId='fae'});
 await playerSave(s=>{s.roles.find(x=>x.id==='r4').ownerId='fae'});
 await playerSave(s=>{s.roles.find(x=>x.id==='r5').ownerId='fae'});
 assert.equal((await roleById('r3')).ownerId,'fae');assert.equal((await roleById('r4')).ownerId,'fae');
 assert.equal((await roleById('r5')).ownerId,null,'maxPerActor is enforced');
 await playerSave(s=>{s.roles.find(x=>x.id==='r4').ownerId=null});
 assert.equal((await roleById('r4')).ownerId,null,'A player can release their own character');
 await playerSave(s=>{s.roles.find(x=>x.id==='r7').ownerId='fae'});
 assert.equal((await roleById('r7')).ownerId,null,'Dead characters cannot be claimed');

 await playerSave(s=>{s.roles.find(x=>x.id==='r2').ownerId='fae'});
 assert.equal((await roleById('r2')).ownerId,'nicher','No stealing during live play without a replacement token');
 await hostSave(s=>{s.actors.find(x=>x.id==='fae').replacementToken=true});
 await playerSave(s=>{s.roles.find(x=>x.id==='r1').ownerId='fae'});
 assert.equal((await roleById('r1')).ownerId,'nicher','A locked character cannot be stolen');
 await playerSave(s=>{s.roles.find(x=>x.id==='r2').ownerId='fae'});
 assert.equal((await roleById('r2')).ownerId,'fae');
 assert.equal((await actorById('fae')).replacementToken,false,'Stealing spends the token');

 await playerSave(s=>{
  Object.assign(s.actors.find(x=>x.id==='fae'),{name:'  Fae 2 ',history:['Leon','Sayaka'],lockedRoleIds:{dr1:'r3'},replacementToken:true,deathCount:0});
  s.actors.find(x=>x.id==='nicher').name='renamed';
 });
 const fae=await actorById('fae');
 assert.equal(fae.name,'Fae 2');assert.deepEqual(fae.history,['Leon','Sayaka']);assert.equal(fae.lockedRoleIds.dr1,'r3');
 assert.equal(fae.replacementToken,false,'A player cannot grant themselves a token');
 assert.equal((await actorById('nicher')).name,'Nicher');

 await playerSave(s=>{
  s.roles.find(x=>x.id==='r1').personalRecordings=[];
  const mine=s.roles.find(x=>x.id==='r3');
  mine.personalRecordings=Array.from({length:50},(_,i)=>({id:'f'+i,actorId:'fae',url:'https://x/f'+i,lineId:'l'+i}));
  mine.practiceLineHistory=[{actorId:'fae',lineId:'l1',chapter:1},{actorId:'nicher',lineId:'forged',chapter:1}];
 });
 assert.deepEqual((await roleById('r1')).personalRecordings.map(x=>x.id),['rec1'],'Other actors\' recordings are kept');
 assert.equal((await roleById('r3')).personalRecordings.length,20,'Own recordings are capped at 20 per character');
 assert.deepEqual((await roleById('r3')).practiceLineHistory.map(x=>x.lineId),['l1'],'Practice history for other actors cannot be forged');

 await playerSave(s=>{s.roles.push({...initialState().roles[5],ownerId:'fae',revealed:true})});
 assert.deepEqual(await roleById('r6'),initialState().roles[5],'Hidden spoiler characters stay host-only');

 await signInAs('newbie');
 await playerSave(s=>{
  s.actors.push({id:'newbie',name:'Newbie',lockedRoleIds:{},lockedAtByGame:{},replacementToken:true,history:['x'],deathCount:0});
  s.actors.push({id:'ghost',name:'Ghost',lockedRoleIds:{},lockedAtByGame:{},replacementToken:false,history:[],deathCount:0});
 });
 const newbie=await actorById('newbie');
 assert.equal(newbie.name,'Newbie');assert.equal(newbie.replacementToken,false);assert.deepEqual(newbie.history,[]);
 assert.equal(await actorById('ghost'),undefined,'Only actors registered by this user can be added');

 await playerSave(p=>{p.predictions.fae={'dr2x2:1':{victimRoleId:'r8',blackenedRoleId:''}}},'dr2x2');
 assert.equal((await stored()).state.predictions.fae['dr2x2:1'].victimRoleId,'r8','DR 2x2 predictions are saved');
 await playerSave(p=>{p.predictions.nicher={'dr1:2':{victimRoleId:'r8',blackenedRoleId:''}}});
 assert.equal((await stored()).state.predictions.nicher,undefined,'Predictions for other actors are ignored');

 await hostSave(s=>{s.actors=s.actors.filter(x=>x.id!=='bob');s.roles.find(x=>x.id==='r2').name='Sayaka M.'});
 assert.equal(await actorById('bob'),undefined);assert.equal((await roleById('r2')).name,'Sayaka M.','Host saves are unchanged');
 await assert.rejects(call(PLAYER,'select public.cast_save_board($1,$2,$3) r',['test','{}',(await stored()).revision-1]),/REVISION_CONFLICT/);
 await assert.rejects(call(PLAYER,"select public.cast_merge_player_save('test','{}','{}') r"),/permission denied/);
 await db.close();
 console.log('Player save SQL passed: no vandalism, Library claims, maxPerActor, locks, replacement tokens, own actor edits, practice recordings, hidden spoilers, new actors, DR 2x2 predictions and host saves.');
})().catch(e=>{console.error(e);process.exitCode=1});
