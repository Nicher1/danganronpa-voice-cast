const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

test('several listeners share one realtime channel, which closes with the last one',()=>{
  const window={};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','pet-ui.js'),'utf8'),{window});
  let open=0,closed=0;
  const sync={subscribePet(){
    if(open>closed)throw new Error('cannot add `postgres_changes` callbacks after `subscribe()`');
    open++;return ()=>{closed++;};
  }};
  const store=window.CastPetUI.makeRemoteStore(sync);
  const stopRender=store.subscribe(()=>{});
  const stopGraveyard=store.subscribe(()=>{});
  assert.equal(open,1);
  stopRender();
  assert.equal(closed,0,'still needed by the other listener');
  stopGraveyard();
  assert.equal(closed,1);
  store.subscribe(()=>{});
  assert.equal(open,2,'opens again after everyone left');
});
