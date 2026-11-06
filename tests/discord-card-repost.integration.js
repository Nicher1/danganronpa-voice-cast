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
    create sequence msg_seq start 998;create table host_flag(is_host boolean);insert into host_flag values(true);create function cast_is_host(text) returns boolean language sql as $$select is_host from host_flag$$;create table http_control(post_status integer,delete_status integer,fail_post boolean,omit_id boolean default false,ping_status integer default 200);insert into http_control(post_status,delete_status,fail_post) values(200,204,false);
    create table http_calls(n bigint generated always as identity,request extensions.http_request);
    create table live_cards(id text primary key);insert into live_cards values('111');
    create function extensions.http(r extensions.http_request) returns extensions.http_response language plpgsql as $$
      declare new_id text;
      begin
        if (r).method='POST' and (select fail_post from http_control) then raise exception 'secret URL must not leak';end if;
        insert into http_calls(request) values(r);
        if (r).method='DELETE' and (select delete_status from http_control) in (204,404) then delete from live_cards where id=split_part((r).uri,'/messages/',2);end if;
        if (r).method='DELETE' then return ((select delete_status from http_control),null,null,'')::extensions.http_response;end if;
        if (r).method='POST' and not ((r).content::jsonb ? 'embeds') then
          return ((select ping_status from http_control),'application/json',null,'{}')::extensions.http_response;
        end if;
        new_id:=nextval('msg_seq')::text;
        if (r).method='POST' and (select post_status from http_control)=200 and (r).content::jsonb ? 'embeds' then
          insert into live_cards values(new_id);
          if (select count(*) from live_cards)>1 then raise exception 'Duplicate live cards';end if;
        end if;
        if (select omit_id from http_control) then return (200,'application/json',null,'{}')::extensions.http_response;end if;
        return ((select post_status from http_control),'application/json',null,'{"id":"'||new_id||'"}')::extensions.http_response;
      end$$;`);
  const strip=sql=>sql.replace('create extension if not exists http with schema extensions;','').replace("notify pgrst,'reload schema';",'');
  for(const f of ['discord-schedule-migration.sql','discord-actor-links-migration.sql','discord-reminder-migration.sql','discord-card-repost-migration.sql'])await db.exec(strip(fs.readFileSync(f,'utf8')));
  await db.exec(strip(fs.readFileSync('discord-card-repost-migration.sql','utf8'))); // re-runnable

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
  const calls=async()=>(await db.query('select (request).method as m,(request).uri as u,(request).content as c from http_calls order by n')).rows;

  const settings=async(...a)=>(await db.query(a.length?"select public.cast_set_discord_settings('board',$1,$2) r":"select public.cast_get_discord_settings('board') r",a)).rows[0].r;
  const manual=async()=>(await db.query("select public.cast_repost_discord_card('board') r")).rows[0].r;
  const clear=()=>db.exec('truncate http_calls');
  const state=async()=>(await db.query("select * from cast_discord.connections where slug='board'")).rows[0];
  const update=()=>db.query('update cast_schedules set state=$1',[JSON.stringify(plan)]);
  const methods=async()=>(await calls()).map(c=>c.m);
  const setSession=async(id,start)=>{plan.sessions=[{id,startAt:start,endedAt:null}];plan.votes[start.slice(0,10)]={a:{available:true,offset:0}};await update();};
  assert.equal((await settings()).reminder,false);
  assert.equal((await settings()).repost_supported,true);
  assert.equal(await remind('2030-10-30T07:59:59Z'),'No reminder due');
  assert.equal(await remind('2030-10-30T08:00:00Z'),'Card reposted'); // exact 10h, ping OFF
  assert.deepEqual(await methods(),['DELETE','POST']);
  let c=await calls(),body=JSON.parse(c[1].c);
  assert.equal(body.embeds.length,1);assert.ok(!body.content);assert.deepEqual(body.allowed_mentions,{parse:[]});
  assert.match(c[0].u,/messages\/111$/);
  assert.equal(await remind('2030-10-30T13:00:00Z'),'No reminder due');
  assert.equal(await remind('2030-10-30T17:30:00Z'),'No reminder due'); // reminder OFF
  assert.equal((await calls()).length,2);

  await settings(true,true);await clear();
  assert.equal(await remind('2030-10-30T17:30:00Z'),'Reminder sent');
  assert.deepEqual(await methods(),['DELETE','POST','POST']);
  c=await calls();assert.ok(JSON.parse(c[1].c).embeds);body=JSON.parse(c[2].c);
  assert.ok(!body.embeds);assert.match(body.content,/<@100000000000000001> <@100000000000000002>/);
  assert.ok(!body.content.includes('100000000000000003'));
  assert.match(body.content,/Also playing: ＠everyone Dave/);
  assert.deepEqual(body.allowed_mentions,{parse:[],users:['100000000000000001','100000000000000002']});
  assert.equal(await remind('2030-10-30T17:31:00Z'),'No reminder due');

  // Every explicit click moves the single card, including outside the due window.
  await clear();assert.equal((await manual()).ok,true);const first=(await state()).message_id;
  assert.equal((await manual()).ok,true);assert.notEqual((await state()).message_id,first);
  assert.deepEqual(await methods(),['DELETE','POST','DELETE','POST']);
  assert.equal((await db.query('select count(*)::int n from live_cards')).rows[0].n,1);
  // Old cached clients cannot turn the automatic card off.
  assert.equal((await settings(false,false)).card,true);

  await setSession('catchup','2030-11-01T18:00:00Z');await clear();
  assert.equal(await remind('2030-11-01T13:00:00Z'),'Card reposted'); // restart with 5h left
  assert.equal(await remind('2030-11-01T13:01:00Z'),'No reminder due');
  assert.deepEqual(await methods(),['DELETE','POST']);
  await settings(true,true);
  await setSession('late','2030-11-02T18:00:00Z');await clear();
  assert.equal(await remind('2030-11-02T17:45:00Z'),'Reminder sent'); // missed both windows
  assert.deepEqual(await methods(),['DELETE','POST','POST']);
  assert.equal(await remind('2030-11-02T17:46:00Z'),'No reminder due');
  plan.sessions[0].startAt='2030-11-02T20:00:00Z';await update();await clear();
  assert.equal(await remind('2030-11-02T19:45:00Z'),'Reminder sent'); // reschedule
  assert.deepEqual(await methods(),['DELETE','POST','POST']);

  // Failed deletion must never be followed by a new card or ping.
  await setSession('delete-failure','2030-11-03T18:00:00Z');await clear();
  await db.exec('update http_control set delete_status=500');
  assert.equal(await remind('2030-11-03T17:45:00Z'),'Cleanup pending');
  assert.deepEqual(await methods(),['DELETE']);
  assert.equal(await remind('2030-11-03T17:46:00Z'),'Waiting to retry');
  await db.exec('update http_control set delete_status=404');await clear();
  assert.equal(await remind('2030-11-03T17:47:00Z'),'Reminder sent');
  assert.deepEqual(await methods(),['DELETE','POST','POST']);
  await db.exec('update http_control set delete_status=204');

  // A known rejected POST can retry; no old card remains after deletion.
  await setSession('rate-limit','2030-11-04T18:00:00Z');await clear();
  await db.exec('update http_control set post_status=429');
  assert.equal(await remind('2030-11-04T08:00:00Z'),'Card HTTP 429');
  assert.equal((await state()).message_id,null);assert.equal((await state()).last_payload,null);
  assert.equal(await remind('2030-11-04T08:01:00Z'),'Waiting to retry');
  await db.exec('update http_control set post_status=200');await clear();
  assert.equal(await remind('2030-11-04T08:02:00Z'),'Card reposted');
  assert.deepEqual(await methods(),['POST']);

  // An ambiguous POST stops manual, cron and normal sync creation, including
  // after toggling the ping. It cannot leave a second untracked card behind.
  await setSession('uncertain','2030-11-05T18:00:00Z');await clear();
  await db.exec('update http_control set fail_post=true');
  assert.equal(await remind('2030-11-05T08:00:00Z'),'Card outcome uncertain; check Discord');
  assert.equal((await state()).card_uncertain,true);assert.equal((await state()).enabled,false);
  await db.exec('update http_control set fail_post=false');await clear();
  await settings(true,true);
  assert.equal((await manual()).ok,false);assert.equal(await remind('2030-11-05T17:45:00Z'),'Disabled');
  assert.equal((await db.query("select cast_discord.sync('board') r")).rows[0].r,'Disabled');
  assert.equal((await calls()).length,0);
  await db.exec('update cast_discord.connections set enabled=true,card_uncertain=false'); // operator reconciliation

  // Nobody available: automatic card still posts, no ping or extra move.
  await setSession('empty','2030-11-06T18:00:00Z');plan.votes['2030-11-06']={};await update();await clear();
  assert.equal(await remind('2030-11-06T17:45:00Z'),'Card reposted');
  assert.deepEqual(await methods(),['POST']);
  assert.equal(await remind('2030-11-06T17:46:00Z'),'No reminder due');
  plan.sessions[0].endedAt='2030-11-06T17:47:00Z';await update();await clear();
  assert.equal(await remind('2030-11-06T17:48:00Z'),'No reminder due');
  assert.equal(await remind('2030-11-06T18:01:00Z'),'No reminder due');assert.equal((await calls()).length,0);

  // Upgrade cleanup removes both legacy card IDs before creating one.
  await db.exec("insert into live_cards values('legacy');update cast_discord.connections set pending_delete_id='legacy'");await clear();
  assert.equal((await manual()).ok,true);assert.deepEqual(await methods(),['DELETE','DELETE','POST']);
  assert.equal((await state()).pending_delete_id,null);
  // Normal sync edits the replacement and does not create another embed.
  await clear();await db.exec('update cast_discord.connections set last_payload=null');
  assert.equal((await db.query("select cast_discord.sync('board') r")).rows[0].r,'Synced');
  assert.deepEqual(await methods(),['PATCH']);

  // A manual click in the live 10h window satisfies cron without another move.
  const clock=(await db.query("select now() as t")).rows[0].t;
  const start=new Date(new Date(clock).getTime()+5*3600000).toISOString();
  await setSession('manual-due',start);await settings(true,false);await clear();
  assert.equal((await manual()).ok,true);
  assert.equal(await remind(new Date(clock).toISOString()),'No reminder due');
  assert.deepEqual(await methods(),['DELETE','POST']);

  // Missing successful IDs and server errors must also stop every creation path.
  for(const mode of ['missing-id','server-error']){
    await db.exec(mode==='missing-id'?'update http_control set omit_id=true':'update http_control set post_status=503');
    await clear();assert.equal((await manual()).ok,false);
    assert.equal((await state()).card_uncertain,true);assert.equal((await state()).enabled,false);
    assert.deepEqual(await methods(),['DELETE','POST']);
    await clear();assert.equal((await manual()).ok,false);assert.equal((await calls()).length,0);
    await db.exec(`update http_control set omit_id=false,post_status=200;
      update cast_discord.connections set enabled=true,card_uncertain=false,
        message_id=(select id from live_cards limit 1),retry_after=null,last_payload=null`);
    assert.equal((await manual()).ok,true); // operator reconciled the existing card
  }

  // Retriable ping failure refreshes the card again before retrying the ping.
  await setSession('ping-retry','2030-11-08T18:00:00Z');await settings(true,true);
  await db.exec('update http_control set ping_status=429');await clear();
  assert.equal(await remind('2030-11-08T17:30:00Z'),'Reminder HTTP 429');
  assert.deepEqual(await methods(),['DELETE','POST','POST']);
  await db.exec('update http_control set ping_status=200');await clear();
  assert.equal(await remind('2030-11-08T17:32:00Z'),'Reminder sent');
  assert.deepEqual(await methods(),['DELETE','POST','POST']);
  assert.equal(await remind('2030-11-08T17:33:00Z'),'No reminder due');
  // A server error on the ping must not cause a duplicate ping on retry.
  await setSession('ping-uncertain','2030-11-09T18:00:00Z');
  await db.exec('update http_control set ping_status=503');await clear();
  assert.equal(await remind('2030-11-09T17:30:00Z'),'Reminder uncertain');
  assert.equal(await remind('2030-11-09T17:32:00Z'),'No reminder due');
  assert.deepEqual(await methods(),['DELETE','POST','POST']);

  await db.exec('update host_flag set is_host=false');
  await assert.rejects(manual(),/Host access required/);await assert.rejects(settings(true,true),/Host access required/);
  await assert.rejects(settings(),/Host access required/);
  await db.exec('set role anon');
  await assert.rejects(manual(),/permission denied/);
  await assert.rejects(db.query("select cast_discord.repost('board')"),/permission denied/);
  await assert.rejects(db.query('select * from cast_discord.reminders'),/permission denied/);
  await db.exec('reset role');await db.close();
  console.log('Discord card repost passed: manual moves, default 10h posting, downtime catch-up, 30m delete/card/ping order, no duplicate live cards, retries, uncertainty stop, normal PATCH updates and host permissions.');
})().catch(e=>{console.error(e);process.exitCode=1;});
