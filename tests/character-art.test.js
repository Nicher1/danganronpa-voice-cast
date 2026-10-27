const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');const context={window:{},monopadData:{profileImages:{},profileOverrides:{dr1:{'Custom':'original-art'}}},IMG:{mukuro:'revealed'}};
context.esc=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
vm.createContext(context);vm.runInContext(fs.readFileSync('dr2-monopad-art.js','utf8'),context);vm.runInContext(html.slice(html.indexOf('function profileImageForRole('),html.indexOf('function biographyForRole(')),context);
assert.equal(context.profileImageForRole({name:'Ibuki Mioda',gameId:'dr2x2',image:'front'}),'assets/monopad/dr2/mioda.png');
assert.equal(context.profileImageForRole({name:'Ibuki Mioda',gameId:'dr2x2',image:'front',profileImage:'custom'}),'custom');
assert.equal(context.profileImageForRole({name:'Custom',gameId:'dr1',image:'front'}),'original-art');
assert.equal(context.profileImageForRole({name:'Sakutaro Higashi',gameId:'dr2slayhem',image:'official'}),'official');
assert.equal(context.profileImageForRole({specialRole:'unconfirmed-student',profileImage:'must-not-leak'}),'assets/monopad/dr1/unconfirmed-student.svg');
for(const path of Object.values(context.window.CAST_DR2_MONOPAD_ART))assert.ok(fs.statSync(path).size>1000);
const roster=['Hajime Hinata','Nagito Komaeda','Byakuya Togami','Fuyuhiko Kuzuryu','Sonia Nevermind','Hiyoko Saionji','Ibuki Mioda','Gundham Tanaka','Teruteru Hanamura','Nekomaru Nidai','Peko Pekoyama','Kazuichi Soda','Akane Owari','Chiaki Nanami','Mahiru Koizumi','Mikan Tsumiki','Monokuma','Monomi'];
const sources=JSON.parse(fs.readFileSync('assets/monopad/dr2/sources.json','utf8'));
for(const name of roster){
  const art=context.window.CAST_DR2_MONOPAD_ART[name];
  assert.ok(art,`${name} needs a separate Monopad illustration`);
  assert.ok(sources.images.some(source=>source.name===name&&source.file===art&&source.source&&source.verifiedAgainst),`${name} needs source provenance`);
  for(const gameId of ['dr2','dr2x2','dr2slayhem'])assert.equal(context.profileImageForRole({name,gameId,image:'casting-portrait'}),art);
}
const nurse={name:'Mikan Tsumiki',gameId:'dr2x2',image:'casting-portrait'};
assert.match(context.profileArtCreditForRole(nurse),/Bitikara/);
assert.equal(context.profileArtCreditForRole({...nurse,profileImage:'host-art'}),'','Custom art must not inherit the built-in artist credit');
assert.equal(context.profileArtCreditForRole({...nurse,gameId:'dr1'}),'','Credits must not leak into another game');
assert.ok(html.includes('canvas.toDataURL("image/webp",quality)'),'Uploads must preserve transparency');
console.log('Separate artwork, custom overrides, original DR1 choices, protected portraits and all local artwork files verified.');
