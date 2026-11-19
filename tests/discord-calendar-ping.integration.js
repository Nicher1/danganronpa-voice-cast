const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
// Mocked HTTP transport: nothing is sent to Discord.
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
    create sequence msg_seq start 998;create table host_flag(is_host boolean);insert into host_flag values(true);
    create function cast_is_host(text) returns boolean language sql as $$select is_host from host_flag$$;
    create table ping_status(code integer);insert into ping_status values(200);
    create table http_calls(n bigint generated always as identity,request extensions.http_request);
    create function extensions.http(r extensions.http_request) returns extensions.http_response language plpgsql as $$
      begin
        insert into http_calls(request) values(r);
        if (r).method='DELETE' then return (204,null,null,'')::extensions.http_response;end if;
        if not ((r).content::jsonb ? 'embeds') then return ((select code from ping_status),'application/json',null,'{}')::extensions.http_response;end if;
        return (200,'application/json',null,'{"id":"'||nextval('msg_seq')||'"}')::extensions.http_response;
      end$$;`);
  const strip=sql=>sql.replace('create extension if not exists http with schema extensions;','').replace("notify pgrst, 'reload schema';",'').replace("notify pgrst,'reload schema';",'');
  for(const f of ['discord-schedule-migration.sql','discord-actor-links-migration.sql','discord-reminder-migration.sql','discord-card-repost-migration.sql'])await db.exec(strip(fs.readFileSync(f,'utf8')));
  await db.exec(fs.readFileSync('discord-likely-days-migration.sql','utf8'));
  const mig=strip(fs.readFileSync('discord-calendar-ping-migration.sql','utf8'));
  await db.exec(mig);await db.exec(mig); // re-runnable

  const actors=[{id:'a',name:'Alice'},{id:'b',name:'Bob'},{id:'c',name:'Carol'},{id:'d',name:'@everyone Dave'}];
  const plan={sessions:[{id:'s1',startAt:'2030-10-30T18:00:00Z',endedAt:null}],times:{'2030-10-30':'19:00'},
    votes:{'2030-10-30':{a:{available:true,offset:0},b:{available:true,offset:15},c:{available:false,offset:0},d:{available:true,offset:0}}}};
  await db.query('insert into cast_schedules values($1,$2)',['board',JSON.stringify(plan)]);
  await db.query('insert into cast_public_boards values($1,$2,true)',['board',JSON.stringify({actors})]);
  const secret='11111111-1111-4111-8111-111111111111';
  await db.query('insert into vault.decrypted_secrets values($1,$2)',[secret,'https://discord.com/api/webhooks/123/test-only']);
  await db.query("insert into cast_discord.connections(slug,secret_id,enabled,message_id) values('board',$1,true,'111')",[secret]);
  await db.exec("insert into cast_discord.actor_links(slug,actor_id,discord_id) values('board','a','100000000000000001'),('board','b','100000000000000002')");
  const ping=async at=>(await db.query("select cast_discord.ping_now('board',$1::timestamptz) r",[at])).rows[0].r;
  const calls=async()=>(await db.query('select (request).method m,(request).content c from http_calls order by n')).rows;

  // Calendar link on the confirmed-session card
  const p=(await db.query("select cast_discord.payload('board','https://example.test/app/','2030-10-30T10:00:00Z') p")).rows[0].p;
  const desc=p.embeds[0].description;
  assert.match(desc,/\[Add to Google Calendar\]\(https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=Danganronpa\+session&dates=20301030T180000Z\/20301030T210000Z&details=https%3A%2F%2Fexample\.test%2Fapp%2F\)/);
  // No calendar link while only polling
  plan.sessions=[];await db.query('update cast_schedules set state=$1',[JSON.stringify(plan)]);
  const poll=(await db.query("select cast_discord.payload('board','https://example.test/','2030-10-30T10:00:00Z') p")).rows[0].p;
  assert.ok(!poll.embeds[0].description.includes('Calendar'));
  assert.equal(await ping('2030-10-30T10:00:00Z'),'No confirmed session to ping');
  assert.equal((await calls()).length,0);
  plan.sessions=[{id:'s1',startAt:'2030-10-30T18:00:00Z',endedAt:null}];await db.query('update cast_schedules set state=$1',[JSON.stringify(plan)]);

  // Manual ping: card moves first, then only linked yes-voters are pinged
  assert.equal(await ping('2030-10-30T10:00:00Z'),'Group pinged (3)');
  const c=await calls();
  assert.deepEqual(c.map(x=>x.m),['DELETE','POST','POST']);
  const body=JSON.parse(c[2].c);
  assert.deepEqual(body.allowed_mentions,{parse:[],users:['100000000000000001','100000000000000002']});
  assert.match(body.content,/<@100000000000000001> <@100000000000000002>/);
  assert.ok(!/@everyone|@here/.test(body.content));
  // Cooldown
  assert.equal(await ping('2030-10-30T10:01:00Z'),'Wait 2 minutes between pings');
  assert.equal((await calls()).length,3);
  assert.equal(await ping('2030-10-30T10:02:01Z'),'Group pinged (3)');
  // Failed ping still starts the cooldown and is reported
  await db.exec('update ping_status set code=500');
  assert.equal(await ping('2030-10-30T10:10:00Z'),'Ping outcome uncertain; check Discord');
  assert.equal(await ping('2030-10-30T10:10:30Z'),'Wait 2 minutes between pings');
  // Nobody said yes
  await db.exec('update ping_status set code=200');
  plan.votes['2030-10-30']={};await db.query('update cast_schedules set state=$1',[JSON.stringify(plan)]);
  const before=(await calls()).length;
  assert.equal(await ping('2030-10-30T11:00:00Z'),'Nobody has said yes for this session');
  assert.equal((await calls()).length,before);
  // Host only, and the automatic reminder state is untouched
  await db.exec('update host_flag set is_host=false');
  await assert.rejects(db.query("select public.cast_ping_discord_group('board')"),/Host access required/);
  await db.exec('update host_flag set is_host=true');
  assert.equal((await db.query("select count(*)::int n from cast_discord.reminders where kind='ping'")).rows[0].n,0);
  console.log('Discord calendar link and manual ping passed.');
})().catch(e=>{console.error(e);process.exit(1)});
