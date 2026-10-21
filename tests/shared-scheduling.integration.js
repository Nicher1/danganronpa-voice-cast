// NODE_PATH=<directory containing @electric-sql/pglite> node tests/shared-scheduling.integration.js
// Runs real PostgreSQL/PLpgSQL in WASM; no production credentials or writes.
const {PGlite}=require('@electric-sql/pglite');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const P=require('../session-planner');
const {randomUUID}=require('node:crypto');
(async()=>{
  const db=new PGlite();
  const host='11111111-1111-4111-8111-111111111111',player='22222222-2222-4222-8222-222222222222';
  const hostActor=P.fresh().hostActorId;
  const actors=[{id:hostActor,name:'Nicher'},{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}];
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    create table cast_boards(slug text primary key,state jsonb,initialized boolean default true);
    create table cast_public_boards(slug text primary key,initialized boolean default true);
    grant select on cast_public_boards to anon,authenticated;
    create table cast_host_sessions(board_slug text,user_id uuid);
    create table cast_actor_sessions(board_slug text,actor_id text,user_id uuid);
    create function cast_is_host(p_slug text) returns boolean language sql security definer set search_path=public as $$select exists(select 1 from cast_host_sessions where board_slug=p_slug and user_id=auth.uid())$$;
    insert into cast_public_boards values('danganronpa-main',true);`);
  const board={actors,roles:[{id:'unchanged-role',ownerId:'a'}],predictions:{a:{victim:'unchanged-role'}},secretSettings:{private:true}};
  await db.query('insert into cast_boards values($1,$2,true)',['danganronpa-main',JSON.stringify(board)]);
  await db.query('insert into cast_host_sessions values($1,$2)',['danganronpa-main',host]);
  await db.query('insert into cast_actor_sessions values($1,$2,$3)',['danganronpa-main','a',player]);
  const migration=fs.readFileSync('shared-scheduling-migration.sql','utf8');
  await db.exec(migration);
  await db.exec(migration); // Safe rerun preserves seeded state.
  async function user(id,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec(`set role ${role}`);}
  const get=async()=> (await db.query("select * from cast_schedules where slug='danganronpa-main'")).rows[0];
  const action=async(a,p,id=randomUUID())=>(await db.query("select cast_schedule_action('danganronpa-main',$1,$2,$3) as result",[a,JSON.stringify(p),id])).rows[0].result;
  const now=Date.now();let day=P.addDays(P.day(now),9);while(P.weekday(day)===2)day=P.addDays(day,1);
  await user('', 'anon');assert.equal((await get()).revision,1);
  await assert.rejects(action('vote',{date:day,actorId:'a',available:true}),/permission denied/);
  await assert.rejects(db.query("update cast_schedules set state='{}'"),/permission denied/);
  await user(player);
  await assert.rejects(action('schedule',{date:day,time:'19:00'}),/Host access/);
  await assert.rejects(action('vote',{date:day,actorId:'b',available:true}),/own availability/);
  await assert.rejects(db.query('select cast_schedule_tick()'),/permission denied/);
  await assert.rejects(db.query('select * from cast_schedule_requests'),/permission denied/);
  let tue=day;while(P.weekday(tue)!==2)tue=P.addDays(tue,1);
  await assert.rejects(action('vote',{date:tue,actorId:'a',available:true}),/Tuesday/);
  await assert.rejects(action('vote',{date:day,actorId:'a',available:'yes'}),/true or false/);
  await action('vote',{date:day,actorId:'a',available:true});
  const request=randomUUID(),payload={date:day,actorId:'a',available:true,delta:15};
  await action('vote',payload,request);const revision=(await get()).revision;
  await action('vote',payload,request);assert.equal((await get()).revision,revision);
  await assert.rejects(action('vote',{...payload,delta:-15},request),/already used/);
  // Concurrent actions preserve both increments under row locking.
  await Promise.all([action('vote',payload),action('vote',payload)]);
  assert.equal((await get()).state.votes[day].a.offset,45);
  await user(host);
  await action('vote',{date:day,actorId:hostActor,available:true});
  let row=await action('vote',{date:day,actorId:'b',available:true});
  assert.equal(row.state.notices.length,1);assert.equal(row.state.notices[0].count,3);
  row=await action('vote',{date:day,actorId:'b',available:true});assert.equal(row.state.notices.length,1);
  row=await action('vote',{date:day,actorId:'c',available:true});assert.equal(row.state.notices.length,2);
  row=await action('schedule',{date:day,time:'19:15'});
  const scheduled=row.state.sessions.at(-1);
  assert.equal(row.state.votes[day].a.offset,30);
  assert.equal(row.state.votes[day].b.offset,-15);
  await assert.rejects(action('schedule',{id:scheduled.id,date:day,time:'19:30',expectedStartAt:P.instant(day,'19:00')}),/changed/);
  await assert.rejects(action('cancel',{id:scheduled.id}),/changed/);
  await action('cancel',{id:scheduled.id,expectedStartAt:scheduled.startAt});
  await db.exec('reset role');
  // Server helper uses exactly the same DST boundary rules as the browser.
  for(const [date,time] of [['2026-10-25','02:30'],['2026-10-26','19:00'],['2026-07-01','19:00']]){
    const r=await db.query('select cast_schedule_instant($1,$2) as t',[date,time]);
    assert.equal(new Date(r.rows[0].t).toISOString(),P.instant(date,time));
  }
  await assert.rejects(db.query("select cast_schedule_instant('2026-03-29','02:30')"),/does not exist/);
  // 48-hour cutoff includes the weighted time suggestion, independent of browsers.
  const before=(await get()).state;
  assert.equal(before.autoSelectionDisabled[P.monday(day)],true,'Host cancellation suppresses automatic recreation');
  delete before.autoSelectionDisabled;
  const adjusted=Date.parse(P.instant(day,before.times[day]))+P.suggestion(before,day,actors)*P.MIN;
  const run=async(time)=>(await db.query('select cast_schedule_reconcile($1,$2,$3) as state',['danganronpa-main',JSON.stringify(before),new Date(time).toISOString()])).rows[0].state;
  assert.equal((await run(adjusted-48*P.HOUR-1)).sessions.length,before.sessions.length);
  const chosen=await run(adjusted-48*P.HOUR);assert.equal(chosen.sessions.length,before.sessions.length+1);
  assert.equal(new Date(chosen.sessions.at(-1).startAt).getTime(),adjusted);
  // Pause/resume/end applies only to the active session, preserving older history.
  const active={id:'active-test',startAt:new Date(Date.now()-P.HOUR).toISOString(),endedAt:null,breaks:[],source:'host'};
  await db.query("update cast_schedules set state=jsonb_set(state,'{sessions}',jsonb_build_array($1::jsonb))",[JSON.stringify(active)]);
  await user(host);
  await assert.rejects(action('end',{id:'old-session'}),/changed/);
  row=await action('break',{id:active.id});assert.equal(row.state.sessions[0].breaks.length,1);
  row=await action('break',{id:active.id});assert.equal(row.state.sessions[0].breaks.length,1);
  row=await action('resume',{id:active.id});assert.ok(row.state.sessions[0].breaks[0].endAt);
  row=await action('end',{id:active.id});assert.ok(row.state.sessions[0].endedAt);
  await assert.rejects(action('break',{id:active.id}),/no current session/);
  await db.exec('reset role');
  assert.deepEqual((await db.query('select state from cast_boards')).rows[0].state,board,'Scheduling must not write cast data');
  const saved=(await get()).state;await db.exec(migration);assert.deepEqual((await get()).state,saved);
  await db.close();
  console.log('PostgreSQL scheduling passed: grants/RLS, actor ownership, host controls, retries, independent votes, DST, 48h selection, breaks, preserved cast data and safe migration reruns.');
})().catch(e=>{console.error(e.message,e.where||'');process.exitCode=1;});
