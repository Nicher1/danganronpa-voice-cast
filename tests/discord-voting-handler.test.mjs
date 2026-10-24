import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createHandler} from '../supabase/functions/discord-voting/handler.mjs';
const keys=await webcrypto.subtle.generateKey('Ed25519',true,['sign','verify']);
const publicKey=Buffer.from(await webcrypto.subtle.exportKey('raw',keys.publicKey)).toString('hex');
const applicationId='111111111111111111';
const tasks=[],calls=[];
const opts={publicKey,applicationId,supabaseUrl:'https://example.supabase.co',serviceKey:'test-service-key',cryptoImpl:webcrypto,waitUntil:task=>tasks.push(task),log:()=>{},fetchImpl:async(url,options)=>{
 calls.push({url,options});return new Response(JSON.stringify(url.includes('cast_discord_interaction')?{content:'Saved',allowed_mentions:{parse:[]}}:'Synced'),{status:200});
}};
const handler=createHandler(opts);
async function request(body,timestamp=String(Math.floor(Date.now()/1000)),tamper=false){
 const raw=typeof body==='string'?body:JSON.stringify(body);
 const signature=Buffer.from(await webcrypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(timestamp+raw))).toString('hex');
 return new Request('https://example.com/discord-voting',{method:'POST',headers:{'x-signature-timestamp':timestamp,'x-signature-ed25519':signature},body:tamper?raw+' ':raw});
}
assert.equal((await handler(new Request('https://example.com/'))).status,405);
assert.equal((await handler(new Request('https://example.com/',{method:'POST',body:'{}'}))).status,401);
assert.deepEqual(await (await handler(await request({application_id:applicationId,type:1}))).json(),{type:1});
assert.equal((await handler(await request({application_id:applicationId,type:1},undefined,true))).status,401);
assert.equal((await handler(await request({application_id:applicationId,type:1},String(Math.floor(Date.now()/1000)-301)))).status,401);
assert.equal((await handler(await request({application_id:'222222222222222222',type:1}))).status,403);
assert.equal((await handler(await request('invalid json'))).status,400);
assert.equal((await handler(await request('x'.repeat(65537)))).status,413);
const event={type:3,id:'222222222222222222',application_id:applicationId,guild_id:'333333333333333333',channel_id:'444444444444444444',member:{user:{id:'555555555555555555'}},message:{id:'666666666666666666'},data:{custom_id:'cast:v:2030-01-01:test:yes'},token:'private-interaction-token'};
assert.deepEqual(await (await handler(await request(event))).json(),{type:5,data:{flags:64}});
await Promise.all(tasks);
assert.equal(calls.length,3);
const submitted=JSON.parse(calls[0].options.body).p_event;
assert.equal(submitted.discord_id,event.member.user.id);assert.equal(submitted.token,undefined);assert.equal(submitted.member,undefined);
assert.equal(calls[0].options.headers.Authorization,'Bearer test-service-key');
assert.match(calls[1].url,/discord.com\/api\/v10\/webhooks/);assert.equal(calls[1].options.headers.Authorization,undefined,'Never send Supabase credentials to Discord');
assert.equal((await handler(await request({...event,member:undefined}))).status,400);
assert.equal((await handler(await request({...event,data:{custom_id:'x',values:[{},{}]}}))).status,400);
for(const custom_id of ['cast:p:11111111-1111-4111-8111-111111111111:later','cast:s:11111111-1111-4111-8111-111111111111:2030-01-02:key']){
 assert.deepEqual(await (await handler(await request({...event,data:{custom_id}}))).json(),{type:6},'Private day and arrival controls must update the same private message');
}
await Promise.all(tasks);
let release;const pending=new Promise(resolve=>release=resolve),deferred=[];
const slow=createHandler({...opts,waitUntil:task=>deferred.push(task),fetchImpl:async()=>{await pending;return new Response('{}');}});
const ack=await slow(await request(event));assert.equal(ack.status,200,'Acknowledgement must not wait for the database');release();await Promise.all(deferred);
console.log('Discord HTTP handler passed: real signatures, tampering, freshness, app identity, input limits, private confirmations, credential isolation and immediate acknowledgement.');
