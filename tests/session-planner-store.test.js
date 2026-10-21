const assert=require('node:assert/strict');
const Store=require('../session-planner-store');
const P=require('../session-planner');
global.crypto||=require('node:crypto').webcrypto;
(async()=>{
  const day=P.addDays(P.day(),(8-P.weekday(P.day()))%7+7);
  let row={state:P.fresh(),revision:1},calls=0,release;
  const applied=new Set();
  const sync={getSchedule:async()=>structuredClone(row),scheduleAction:async(action,payload,id)=>{
    calls++;
    if(!applied.has(id)){
      P.change(row.state,action,payload);row.revision++;row.last_request_id=id;applied.add(id);
      store.receive(structuredClone(row));
    }
    if(calls===1){await new Promise(resolve=>release=resolve);throw Error('Network response lost');}
    return structuredClone(row);
  }};
  const store=new Store(sync,P);await store.refresh();
  const first=store.dispatch('vote',{date:day,actorId:'a',available:true,delta:15});
  assert.equal(store.state.votes[day].a.offset,15,'Realtime before RPC must not double-apply');
  const second=store.dispatch('vote',{date:day,actorId:'a',available:true,delta:15});
  assert.equal(store.state.votes[day].a.offset,30);
  release();await Promise.all([first,second]);
  assert.equal(row.state.votes[day].a.offset,30);assert.equal(calls,3);
  store.receive({state:P.fresh(),revision:1});assert.equal(store.state.votes[day].a.offset,30);
  sync.scheduleAction=async()=>{throw Object.assign(Error('Host access required'),{code:'P0001'});};
  await assert.rejects(store.dispatch('vote',{date:day,actorId:'a',available:true,delta:15}),/Host access/);
  assert.equal(store.state.votes[day].a.offset,30,'Rejected optimistic write must roll back');
  sync.getSchedule=async()=>{throw Error('offline');};await store.refresh();
  await assert.rejects(store.dispatch('vote',{}),/disconnected/);
  assert.match(store.status,/offline/);
  console.log('Shared schedule client passed: queued clicks, lost-response retry, realtime ordering, rollback and offline reporting.');
})().catch(e=>{console.error(e);process.exitCode=1;});
