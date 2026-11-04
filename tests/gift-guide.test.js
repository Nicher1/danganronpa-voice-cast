const assert=require('node:assert/strict'),fs=require('node:fs');
global.window={};require('../gift-guide-data.js');
const guide=window.CAST_GIFT_GUIDE,html=fs.readFileSync('index.html','utf8');
const dr1=guide.games.dr1;
// Each guide must belong to a student the app really creates for the first game.
for(const [name,gifts] of Object.entries(dr1)){
  assert.ok(html.includes(`mkRole("${name}"`),`${name} is not a first-game student`);
  assert.ok(gifts.length>0);
  assert.equal(new Set(gifts.map(g=>g.n)).size,gifts.length,`${name} repeats a gift`);
  for(const g of gifts){assert.ok(Number.isInteger(g.n)&&g.n>=1&&g.n<=90,`${name} #${g.n} is not a Machine item`);assert.ok(g.name.trim());}
}
// The unconfirmed student and the hidden identity never get a guide.
assert.ok(!dr1['Mukuro Ikusaba']);
assert.match(guide.source.url,/^https:\/\/danganronpa\.fandom\.com\//);
// The profile skips hidden roles.
assert.match(html,/\["real-junko","unconfirmed-student"\]\.includes\(role\.specialRole\)/);
console.log('Gift guide passed:',Object.keys(dr1).length,'students, source credited, hidden roles excluded.');
