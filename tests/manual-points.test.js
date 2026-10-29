const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const source=(start,end)=>html.slice(html.indexOf(`function ${start}(`),html.indexOf(`function ${end}(`));
const context={mode:'host',state:{actors:[{id:'a',name:'Alice'},{id:'b',name:'Bob'}],settings:{games:{dr1:{},dr2x2:{},dr3anime:{}},completedGames:{}},chapterResults:{'dr1:5':{victimCorrectActorIds:['a'],blackenedCorrectActorIds:['a']},'dr3anime:1':{victimCorrectActorIds:['a'],hiddenBlackenedCorrectActorIds:['a']}}},
 gameDefinition:id=>({kind:id==='dr3anime'?'anime':'killing',short:id}),availableGameIds:()=>['dr1','dr2x2','dr3anime'],countRecordedDeathsForActor:()=>7,
 saveState:()=>{context.saves++},render:()=>{},saves:0,esc:x=>String(x).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')};
vm.createContext(context);vm.runInContext(source('predictionScoreAdjustment','seriesCountsForActor')+source('predictionScoreMarkup','renderStatistics'),context);
const count=(actor='a',game='dr1')=>context.predictionCountsForActorGame(actor,game);
const adjust=(kind,delta,actor='a',game='dr1')=>context.adjustPredictionScore(actor,game,kind,delta);
const results=JSON.stringify(context.state.chapterResults);
assert.equal(count().total,2);assert.equal(adjust('victim',1),true);assert.equal(count().victim,2);assert.equal(count().total,3);
assert.equal(adjust('blackened',-1),true);assert.equal(count().blackened,0);assert.equal(count().total,2);
assert.equal(adjust('blackened',-1),false);assert.equal(count().deaths,7);
assert.equal(adjust('deaths',1),false);assert.equal(adjust('victim',4),false);assert.equal(adjust('victim',1,'missing'),false);
assert.equal(count('b').total,0);assert.equal(count('a','dr2x2').total,0);
assert.equal(JSON.stringify(context.state.chapterResults),results,'Manual scoring must not rewrite chapter awards');
const saved=JSON.stringify(context.state);context.state=JSON.parse(saved);assert.equal(count().total,2,'Adjustment survives reload');
// Later automatic awards add normally; corrections remain relative to earned points.
context.state.chapterResults['dr1:6']={victimCorrectActorIds:['a'],blackenedCorrectActorIds:['a']};assert.equal(count().total,4);
assert.equal(adjust('victim',-1),true);assert.equal(adjust('victim',-1),true);assert.equal(adjust('victim',-1),true);assert.equal(count().victim,0);
delete context.state.chapterResults['dr1:6'];assert.equal(count().victim,0);
assert.equal(adjust('victim',1),true);assert.equal(count().victim,1,'Plus adds one even when a removed result left an overly negative adjustment');
context.mode='player';const before=JSON.stringify(context.state);assert.equal(adjust('victim',1),false);assert.equal(JSON.stringify(context.state),before);
assert.doesNotMatch(context.predictionScoreMarkup({id:'a',name:'Alice'},'dr1','victim',1),/button|data-score/);
context.mode='viewer';assert.equal(adjust('victim',1),false);context.mode='host';
const markup=context.predictionScoreMarkup({id:'a',name:'Alice'},'dr1','victim',0);assert.match(markup,/aria-label="Add 1 to Alice/);assert.match(markup,/data-score-delta="-1"[^>]*disabled/);
assert.equal(adjust('blackened',1,'a','dr3anime'),true);assert.equal(count('a','dr3anime').pendingBlackened,2);assert.equal(count('a','dr3anime').blackened,0);assert.equal(count('a','dr3anime').total,1);
context.state.settings.completedGames.dr3anime=true;assert.equal(count('a','dr3anime').blackened,2);assert.equal(count('a','dr3anime').total,3);
context.state.settings.completedGames.dr3anime=false;assert.equal(count('a','dr3anime').pendingBlackened,2);
console.log('Manual points passed: host-only edits, zero floor, automatic totals, independent actors/games, reload, later awards and hidden anime scoring.');
