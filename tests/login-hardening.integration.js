// Login hardening: existing actors cannot be re-registered, wrong passwords are rate limited,
// and old sha256 passwords are upgraded to bcrypt. Run from the repo root with NODE_PATH
// pointing at a folder that has @electric-sql/pglite installed.
const {PGlite}=require('@electric-sql/pglite');
const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');

const schema=fs.readFileSync(path.join(__dirname,'..','supabase-schema.sql'),'utf8');
const table=name=>schema.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0];
const fn=name=>{const start=schema.indexOf(`create or replace function public.${name}(`);assert.ok(start>=0,`${name} is missing from supabase-schema.sql`);return schema.slice(start,schema.indexOf('$$;',schema.indexOf('as $$',start)+5)+3)};
const functions=['cast_check_login_lockout','cast_record_login_failure','cast_login_host','cast_claim_actor','cast_register_actor'];
const OWNER='11111111-1111-4111-8111-111111111111',STRANGER='33333333-3333-4333-8333-333333333333';

(async()=>{
 const db=new PGlite({extensions:{pgcrypto}});
 await db.exec(`create role anon; create role authenticated;
  create schema auth; create schema extensions; create extension pgcrypto schema extensions;
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to anon, authenticated;`);
 for(const name of ['cast_boards','cast_board_secrets','cast_host_sessions','cast_actor_passwords','cast_actor_sessions','cast_login_failures'])await db.exec(table(name));
 await db.exec(schema.match(/create index if not exists cast_login_failures_recent[\s\S]*?;/)[0]);
 for(const line of schema.split('\n').filter(l=>/^(alter table|revoke all on) public\.cast_login_failures /.test(l)))await db.exec(line);
 for(const name of functions)await db.exec(fn(name));
 for(const line of schema.split('\n').filter(l=>new RegExp(`^(revoke|grant) .* function public\\.(${functions.join('|')})\\(`).test(l)))await db.exec(line);

 let user=null;
 const as=id=>{user=id};
 const call=async(sql,params)=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  await db.exec('set role authenticated');
  try{return (await db.query(sql,params)).rows[0].r}finally{await db.exec('reset role')}
 };
 const claim=(actor,password)=>call("select public.cast_claim_actor('test',$1,$2) r",[actor,password]);
 const register=(actor,password)=>call("select public.cast_register_actor('test',$1,$2) r",[actor,password]);
 const loginHost=password=>call("select public.cast_login_host('test',$1) r",[password]);
 const sessions=async(actor,id)=>Number((await db.query('select count(*) n from cast_actor_sessions where actor_id=$1 and user_id=$2',[actor,id])).rows[0].n);
 await db.exec(`insert into cast_boards(slug,state,revision,initialized) values('test','{"actors":[{"id":"nicher","name":"Nicher"},{"id":"fae","name":"Fae"},{"id":"legacy","name":"Legacy"}]}',1,true);
  insert into cast_board_secrets(board_slug,host_password_hash) values('test',extensions.crypt('host-secret',extensions.gen_salt('bf')));
  insert into cast_actor_passwords values('test','nicher',extensions.crypt('correct-horse',extensions.gen_salt('bf')),'bcrypt');
  insert into cast_actor_passwords values('test','legacy',encode(extensions.digest('old-pw','sha256'),'hex'),'sha256');`);
 await db.query('insert into cast_actor_sessions(board_slug,actor_id,user_id) values($1,$2,$3)',['test','nicher',OWNER]);

 as(STRANGER);
 await assert.rejects(register('nicher',''),/Actor already exists/,'An existing actor cannot be registered again');
 await assert.rejects(register('nicher','new-password'),/Actor already exists/,'Registering cannot overwrite a password');
 assert.equal(await sessions('nicher',STRANGER),0);
 as(OWNER);assert.equal(await claim('nicher','correct-horse'),true,'The owner password still works');

 as(STRANGER);
 assert.equal(await register('brand-new','pw123456'),true);
 assert.equal(await register('new-no-password',''),true);
 assert.equal(await register('new-no-password',''),true,'The creator may retry a registration without a password');
 assert.match((await db.query("select password_hash h from cast_actor_passwords where actor_id='brand-new'")).rows[0].h,/^\$2a\$10\$/);
 as(OWNER);
 await assert.rejects(register('brand-new','x'),/Actor already exists/);
 await assert.rejects(register('new-no-password',''),/Actor already exists/,'Nobody else can take over a new actor');

 as(STRANGER);
 for(let i=0;i<12;i++)assert.equal(await claim('fae',''),true,'Actors without a password are never locked');
 for(let i=0;i<10;i++)assert.equal(await claim('nicher','guess'+i),false,'A wrong password returns false so the failure is kept');
 await assert.rejects(claim('nicher','guess-11'),/Too many failed attempts/);
 as(OWNER);await assert.rejects(claim('nicher','correct-horse'),/Too many failed attempts/,'The lock applies to the actor, not the user');
 await db.exec("update cast_login_failures set failed_at=now()-interval '16 minutes'");
 assert.equal(await claim('nicher','correct-horse'),true,'The lock ends after 15 minutes');

 for(let i=0;i<10;i++)assert.equal(await loginHost('guess'+i),false);
 await assert.rejects(loginHost('host-secret'),/Too many failed attempts/);
 await db.exec("update cast_login_failures set failed_at=now()-interval '16 minutes'");
 assert.equal(await loginHost('host-secret'),true);

 as(STRANGER);
 assert.equal(await claim('legacy','wrong'),false);
 assert.equal(await claim('legacy','old-pw'),true);
 const legacy=(await db.query("select scheme,password_hash h from cast_actor_passwords where actor_id='legacy'")).rows[0];
 assert.equal(legacy.scheme,'bcrypt');assert.match(legacy.h,/^\$2a\$10\$/);
 assert.equal(await claim('legacy','old-pw'),true,'The upgraded password still works');

 await assert.rejects(call("select public.cast_record_login_failure('test','host') r"),/permission denied/);
 await assert.rejects(call("select public.cast_check_login_lockout('test','host') r"),/permission denied/);
 await assert.rejects(call('select count(*) r from public.cast_login_failures'),/permission denied/);
 await db.close();
 console.log('Login hardening SQL passed: no re-registering existing actors, lockout after 10 wrong passwords for 15 minutes, bcrypt cost 10, sha256 upgrade and private helpers.');
})().catch(e=>{console.error(e);process.exitCode=1});
