const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
const Pet=require('../pet-minigame.js');
// Island Pet: the SQL rules are the authority, the JS engine (local preview sandbox) must agree with them.
(async()=>{
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.cast_boards(slug text primary key);
    create table public.cast_public_boards(slug text primary key,state jsonb,initialized boolean);
    create table public.cast_actor_sessions(board_slug text,actor_id text,user_id uuid);
    create table host_flag(is_host boolean);insert into host_flag values(false);
    create function public.cast_is_host(text) returns boolean language sql as $$select is_host from host_flag$$;`);
  const mig=fs.readFileSync('island-pet-migration.sql','utf8').replace("notify pgrst, 'reload schema';",'');
  await db.exec(mig);await db.exec(mig); // re-runnable

  const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
  const board=chapter=>JSON.stringify({actors:[{id:'a',name:'Alice'},{id:'b',name:'Bob'},{id:'c',name:'Carol'}],settings:{games:{dr2x2:{voiceChapter:chapter}}}});
  await db.exec("insert into public.cast_boards values('board')");
  await db.query("insert into public.cast_public_boards values('board',$1,true)",[board(1)]);
  await db.exec(`insert into public.cast_actor_sessions values('board','a','${alice}'),('board','b','${bob}')`);
  const as=async(uid,host=false)=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);
    await db.query('update host_flag set is_host=$1',[host]);
  };
  const act=async(actor,action,arg=null,score=null)=>(await db.query('select public.cast_pet_action($1,$2,$3,$4,$5) r',['board',actor,action,arg,score])).rows[0].r;
  const fails=async(fn,pattern)=>{await assert.rejects(fn,pattern);};

  // Catalog stays identical in SQL and JS
  const sqlCatalog=(await db.query('select public.cast_pet_catalog() c')).rows[0].c;
  assert.deepEqual(sqlCatalog,Pet.CATALOG.map(({name,...rest})=>rest));

  // Only the owner of an actor (or the host) can care as that actor; chapter comes from the board
  await as(null);
  await fails(()=>act('a','pet'),/Sign in first/);
  await as(alice);
  await fails(()=>act('b','pet'),/your own actor/);
  await fails(()=>act('zzz','pet'),/actor not found/);
  await fails(()=>act('a','pet','x'.repeat(41)),/Invalid pet request/);
  assert.equal((await act('a','pet')).ok,true);
  assert.equal((await act('a','pet')).error.startsWith('Wait '),true,'cooldown holds');
  assert.equal((await   act('a','feed','rice_ball')).error,'Not enough coins.');
  await db.query("update public.cast_pets set state=jsonb_set(state,'{people,a,coins}','50')");
  assert.equal((await act('a','feed','island_curry')).error,'That is not unlocked yet.','chapter 2 food locked in chapter 1');
  await db.query("update public.cast_public_boards set state=$1 where slug='board'",[board(2)]);
  assert.equal((await act('a','feed','island_curry')).ok,true,'unlocks in chapter 2');
  await as(bob,true);
  assert.equal((await act('a','wash')).ok,true,'host can act as any actor');

  // Table rows are not writable by players
  assert.equal((await db.query("select has_table_privilege('authenticated','public.cast_pets','insert') w")).rows[0].w,false);
  assert.equal((await db.query("select has_table_privilege('anon','public.cast_pets','select') w")).rows[0].w,true);
  for(const fn of ['cast_pet_apply(text,text,text,text,text,integer,integer,timestamptz)','cast_pet_decay(jsonb,timestamptz)']){
    for(const role of ['anon','authenticated'])
      assert.equal((await db.query(`select has_function_privilege('${role}','public.${fn}','execute') x`)).rows[0].x,false,`${role} cannot run ${fn}`);
  }
  assert.equal((await db.query("select has_function_privilege('anon','public.cast_pet_action(text,text,text,text,integer)','execute') x")).rows[0].x,false);
  assert.equal((await db.query("select has_function_privilege('authenticated','public.cast_pet_action(text,text,text,text,integer)','execute') x")).rows[0].x,true);

  // Host controls
  const host=async(action,arg=null)=>(await db.query("select public.cast_pet_host('board',$1,$2) r",[action,arg])).rows[0].r;
  await as(alice,false);
  await fails(()=>host('reveal','true'),/Host access required/);
  await as(bob,true);
  assert.equal((await host('reveal','true')).state.revealed,true);
  assert.equal((await host('rename',' Mochi ')).state.name,'Mochi');
  await fails(()=>host('rename','<b>x</b>'),/Use up to 20/);
  await fails(()=>host('nope'),/Unknown host action/);
  const reset=(await host('reset')).state;
  assert.deepEqual([reset.revealed,reset.name,reset.xp,reset.owned],[true,'Mochi',0,{}]);
  assert.equal((await host('rename','')).state.name,null);

  // JS engine and SQL rules agree over a long, seeded run of actions
  await db.exec('delete from public.cast_pets');
  let seed=20261120;const rnd=()=>(seed=(seed*1664525+1013904223)%4294967296)/4294967296;
  const pick=list=>list[Math.floor(rnd()*list.length)];
  const items=Pet.CATALOG.map(item=>item.id);
  const actions=['feed','play','wash','pet','rest','game','buy','wear','unwear'];
  let now=Date.parse('2030-06-01T10:00:00Z'),js=Pet.defaultState(now),okCount=0;
  const people=[['a','Alice'],['b','Bob']];
  const clean=state=>JSON.parse(JSON.stringify(state,(key,value)=>
    ['at','t'].includes(key)||(typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value))?new Date(value).toISOString():value));
  for(let i=0;i<500;i++){
    now+=rnd()<.04?20*3600e3:Math.floor(rnd()*400)*1000;
    const [actor,actorName]=pick(people),action=pick(actions),chapter=1+Math.floor(rnd()*5);
    const arg=action==='unwear'?pick(['hat','neck','bg']):action==='game'?pick([null,'snack','memory','bubble','run','nope']):action==='wash'||action==='pet'||action==='rest'?null:pick(items);
    const score=action==='game'?Math.floor(rnd()*60)-5:null;
    if(i%25===0)await db.query("update public.cast_pets set state=jsonb_set(state,'{people}',(select coalesce(jsonb_object_agg(k,jsonb_set(v,'{coins}','40')),'{}') from jsonb_each(state->'people') e(k,v)))");
    if(i%25===0)for(const [id] of people)if(js.people[id])js.people[id]={...js.people[id],coins:40};
    const sql=(await db.query('select public.cast_pet_apply($1,$2,$3,$4,$5,$6,$7,$8::timestamptz) r',
      ['board',actor,actorName,action,arg,score,chapter,new Date(now).toISOString()])).rows[0].r;
    const local=Pet.apply(js,{actor,actorName,action,arg,score:score??0,chapter,now});
    assert.equal(local.ok,sql.ok,`step ${i} ${action} ${arg}: ok mismatch (${local.error} vs ${sql.error})`);
    if(sql.ok){
      okCount++;js=local.state;
      assert.deepEqual(clean(js),clean(sql.state),`step ${i} ${action} ${arg}: state mismatch`);
    }else assert.equal(local.error.replace(/\d+/,'N'),sql.error.replace(/\d+/,'N'));
  }
  assert.ok(okCount>80,`random run exercised the rules (${okCount} accepted)`);

  // Daily limits: game coins stop at 60, care coins at 20, then reset on the next Copenhagen day
  await db.exec('delete from public.cast_pets');
  let t=Date.parse('2030-07-01T08:00:00Z');
  const run=async(action,arg=null,score=null,actor='a')=>{t+=100e3;
    return (await db.query('select public.cast_pet_apply($1,$2,$3,$4,$5,$6,$7,$8::timestamptz) r',['board',actor,'Alice',action,arg,score,1,new Date(t).toISOString()])).rows[0].r;};
  let last;for(let i=0;i<12;i++)last=await run('game',null,40);
  assert.equal(last.state.people.a.dayGame,60,'game coins capped per day');
  t=Date.parse('2030-07-02T08:00:00Z');
  assert.equal((await run('game',null,40)).state.people.a.dayGame,10,'cap resets the next day');
  assert.equal((await run('game',null,999)).state.people.a.dayGame,20,'score is clamped to 40');
  console.log('island pet ok');
})().catch(error=>{console.error(error);process.exit(1);});
