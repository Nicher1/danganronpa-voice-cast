const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
// Real PostgreSQL with a mocked HTTP transport: nothing is sent to Discord.
(async()=>{
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;
    create schema extensions;create schema vault;create schema cron;
    create table cast_schedules(slug text primary key,state jsonb);
    create table cast_public_boards(slug text primary key,state jsonb,initialized boolean);
    create table vault.decrypted_secrets(id uuid,decrypted_secret text);
    create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
    create function cast_schedule_instant(text,text) returns timestamptz language sql as $$select ($1||' '||$2)::timestamp at time zone 'Europe/Copenhagen'$$;
    create type extensions.http_header as (field varchar,value varchar);
    create type extensions.http_method as enum ('GET','POST','PATCH','DELETE');
    create type extensions.http_request as (method extensions.http_method,uri varchar,headers extensions.http_header[],content_type varchar,content varchar);
    create type extensions.http_response as (status integer,content_type varchar,headers extensions.http_header[],content varchar);
    create function extensions.http_header(text,text) returns extensions.http_header language sql as $$select ($1,$2)::extensions.http_header$$;
    create function extensions.http_set_curlopt(text,text) returns boolean language sql as $$select true$$;
    create sequence msg_seq start 998;create table host_flag(is_host boolean);insert into host_flag values(true);create function cast_is_host(text) returns boolean language sql as $$select is_host from host_flag$$;create table http_control(post_status integer,delete_status integer,fail_post boolean);insert into http_control values(200,204,false);
    create table http_calls(request extensions.http_request);
    create function extensions.http(r extensions.http_request) returns extensions.http_response language plpgsql as $$
      begin
        if (r).method='POST' and (select fail_post from http_control) then raise exception 'secret URL must not leak';end if;
        insert into http_calls values(r);
        if (r).method='DELETE' then return ((select delete_status from http_control),null,null,'')::extensions.http_response;end if;
        return ((select post_status from http_control),'application/json',null,'{"id":"'||nextval('msg_seq')||'"}')::extensions.http_response;
      end$$;`);
  const strip=sql=>sql.replace('create extension if not exists http with schema extensions;','').replace("notify pgrst,'reload schema';",'');
  for(const f of ['discord-schedule-migration.sql','discord-actor-links-migration.sql','discord-reminder-migration.sql'])await db.exec(strip(fs.readFileSync(f,'utf8')));
  await db.exec(strip(fs.readFileSync('discord-reminder-migration.sql','utf8'))); // re-runnable

  const actors=[{id:'a',name:'Alice'},{id:'b',name:'Bob'},{id:'c',name:'Carol'},{id:'d',name:'@everyone Dave'}];
  const plan={sessions:[{id:'s1',startAt:'2030-10-30T18:00:00Z',endedAt:null}],times:{'2030-10-30':'19:00'},
    votes:{'2030-10-30':{a:{available:true,offset:0},b:{available:true,offset:15},c:{available:false,offset:0},d:{available:true,offset:0}}}};
  await db.query('insert into cast_schedules values($1,$2)',['board',JSON.stringify(plan)]);
  await db.query('insert into cast_public_boards values($1,$2,true)',['board',JSON.stringify({actors})]);
  const secret='11111111-1111-4111-8111-111111111111';
  await db.query('insert into vault.decrypted_secrets values($1,$2)',[secret,'https://discord.com/api/webhooks/123/test-only']);
  await db.query("insert into cast_discord.connections(slug,secret_id,enabled,message_id) values('board',$1,true,'111')",[secret]);
  await db.exec("insert into cast_discord.actor_links(slug,actor_id,discord_id) values('board','a','100000000000000001'),('board','b','100000000000000002'),('board','c','100000000000000003')");
  const remind=async at=>(await db.query("select cast_discord.remind('board',$1::timestamptz) as r",[at])).rows[0].r;
  const calls=async()=>(await db.query('select (request).method as m,(request).uri as u,(request).content as c from http_calls order by 1')).rows;

  assert.equal(await remind('2030-10-30T17:31:00Z'),'Reminders off');                // off by default after install
  assert.equal((await db.query('select count(*)::int n from http_calls')).rows[0].n,0);
  const settings=async(...a)=>(await db.query(a.length?"select public.cast_set_discord_settings('board',$1,$2) r":"select public.cast_get_discord_settings('board') r",a)).rows[0].r;
  assert.deepEqual(await settings(),{configured:true,card:true,reminder:false,status:null});
  assert.equal((await settings(false,true)).reminder,false);                         // reminder cannot run without the card
  assert.equal((await settings(true,true)).reminder,true);
  await db.exec('update host_flag set is_host=false');
  await assert.rejects(settings(true,false),/Host access required/);
  await assert.rejects(settings(),/Host access required/);
  await db.exec('update host_flag set is_host=true');
  assert.equal(await remind('2030-10-30T17:00:00Z'),'No reminder due');          // 60 minutes before
  assert.equal(await remind('2030-10-30T18:01:00Z'),'No reminder due');          // already started
  assert.equal((await calls()).length,0);

  assert.equal(await remind('2030-10-30T17:31:00Z'),'Reminder sent');            // 29 minutes before
  let c=await calls();
  const post=c.find(x=>x.m==='POST'),del=c.find(x=>x.m==='DELETE');
  const body=JSON.parse(post.c);
  assert.match(post.u,/\?wait=true$/);
  assert.match(body.content,/<@100000000000000001> <@100000000000000002>/);       // yes voters with a link
  assert.ok(!body.content.includes('100000000000000003'));                        // Carol said no
  assert.match(body.content,/Also playing: ＠everyone Dave/);                      // unlinked yes voter: name only, no mention
  assert.deepEqual(body.allowed_mentions,{parse:[],users:['100000000000000001','100000000000000002']});
  assert.ok(body.embeds.length===1);
  assert.match(del.u,/\/messages\/111$/);                                         // old card removed
  let row=(await db.query('select message_id,pending_delete_id,last_status from cast_discord.connections')).rows[0];
  assert.equal(row.message_id,'998');assert.equal(row.pending_delete_id,null);

  assert.equal(await remind('2030-10-30T17:40:00Z'),'Already reminded');         // pings once
  assert.equal((await calls()).filter(x=>x.m==='POST').length,1);

  // Failed delete is retried and never re-pings.
  plan.sessions=[{id:'s2',startAt:'2030-10-31T18:00:00Z',endedAt:null}];plan.times['2030-10-31']='19:00';
  plan.votes['2030-10-31']={a:{available:true,offset:0}};
  await db.query('update cast_schedules set state=$1',[JSON.stringify(plan)]);
  await db.exec('update http_control set delete_status=500');
  assert.equal(await remind('2030-10-31T17:45:00Z'),'Reminder sent');
  assert.equal((await db.query('select pending_delete_id from cast_discord.connections')).rows[0].pending_delete_id,'998');
  assert.equal(await remind('2030-10-31T17:50:00Z'),'Cleanup pending');
  await db.exec("update http_control set delete_status=404;update cast_discord.connections set retry_after=null");
  assert.equal(await remind('2030-10-31T17:52:00Z'),'Already reminded');
  assert.equal((await db.query('select pending_delete_id from cast_discord.connections')).rows[0].pending_delete_id,null);

  // Uncertain POST is never retried (no double ping).
  plan.sessions=[{id:'s3',startAt:'2030-11-01T18:00:00Z',endedAt:null}];plan.times['2030-11-01']='19:00';
  plan.votes['2030-11-01']={a:{available:true,offset:0}};
  await db.query('update cast_schedules set state=$1',[JSON.stringify(plan)]);
  await db.exec('update http_control set fail_post=true');
  assert.equal(await remind('2030-11-01T17:45:00Z'),'Reminder uncertain');
  assert.equal(await remind('2030-11-01T17:46:00Z'),'Already reminded');
  await db.exec('update http_control set fail_post=false');

  // Rate limit: no record, retried later.
  plan.sessions=[{id:'s4',startAt:'2030-11-02T18:00:00Z',endedAt:null}];plan.times['2030-11-02']='19:00';
  plan.votes['2030-11-02']={a:{available:true,offset:0}};
  await db.query('update cast_schedules set state=$1',[JSON.stringify(plan)]);
  await db.exec('update http_control set post_status=429');
  assert.equal(await remind('2030-11-02T17:45:00Z'),'Reminder HTTP 429');
  assert.equal(await remind('2030-11-02T17:46:00Z'),'Waiting to retry');
  await db.exec('update http_control set post_status=200');
  assert.equal(await remind('2030-11-02T17:48:00Z'),'Reminder sent');

  // Nobody available: nothing is posted.
  plan.sessions=[{id:'s5',startAt:'2030-11-03T18:00:00Z',endedAt:null}];plan.times['2030-11-03']='19:00';
  await db.query('update cast_schedules set state=$1',[JSON.stringify(plan)]);
  const before=(await calls()).length;
  assert.equal(await remind('2030-11-03T17:45:00Z'),'Nobody to remind');
  assert.equal((await calls()).length,before);

  // Private to the database owner.
  await db.exec('set role anon');
  await assert.rejects(db.query("select cast_discord.remind('board')"),/permission denied/);
  await assert.rejects(db.query('select * from cast_discord.reminders'),/permission denied/);
  await db.exec('reset role');
  await db.close();
  console.log('Discord reminder passed: 30-minute window, yes-voters only, linked-only mentions, single ping, old card removal and retry, uncertain POST, rate limits, no attendees, private access.');
})().catch(e=>{console.error(e);process.exitCode=1;});
