const assert=require('node:assert/strict');
const P=require('../session-planner');
const now=Date.parse('2030-10-28T10:00:00Z'),week='2030-10-28',date='2030-10-30';
const actors=Array.from({length:5},(_,i)=>({id:String(i)}));
const plan=()=>P.normalise({sessions:[],votes:{},times:{},records:{},notices:[]});
function votes(s,d,offsets){s.votes[d]=Object.fromEntries(offsets.map((offset,i)=>[String(i),{available:true,offset}]));}
let s=plan();assert.equal(P.likelySession(s,week,actors,now),null);
for(const count of [1,2]){
  votes(s,date,Array(count).fill(0));
  assert.deepEqual(P.likelySessions(s,week,actors,now),[],'At least three votes are required');
  votes(s,'2030-10-31',Array(count).fill(0));
  assert.deepEqual(P.likelySessions(s,week,actors,now),[],'Low-vote ties are not likely dates');
}
s=plan();votes(s,date,[0,0,0]);
assert.equal(P.likelySession(s,week,actors,now).count,3,'Three votes qualify');
votes(s,'2030-10-31',[0,0,0]);
assert.deepEqual(P.likelySessions(s,week,actors,now).map(x=>x.date),[date,'2030-10-31']);
votes(s,'2030-11-01',[0,0,0]);assert.equal(P.likelySessions(s,week,actors,now).length,3);
votes(s,'2030-11-02',[0,0,0]);assert.deepEqual(P.likelySessions(s,week,actors,now),[],'Do not truncate a four-way tie to three dates');
s=plan();
votes(s,date,[-15,-15,-15,-15,0]); // 18:48 -> 18:45, all five votes counted equally
votes(s,'2030-10-31',[0,0,0,0]);
assert.equal(P.clock(P.likelySession(s,week,actors,now).startAt),'18:45');
assert.equal(P.likelySession(s,week,actors,now).date,date);
assert.equal(P.likelySession(s,week,actors,now).count,5);
votes(s,'2030-10-31',[0,0,0,0,0]);assert.equal(P.likelySession(s,week,actors,now),null,'No arbitrary winner on tied days');
assert.equal(P.likelySessions(s,week,actors,now).length,2,'Ties above the threshold also qualify');
delete s.votes['2030-10-31'];s.times[date]='18:55';votes(s,date,[0,0,0,0,15]);
assert.equal(P.clock(P.likelySession(s,week,actors,now).startAt),'18:45','18:58 rounds down on the clock, not relative to the base');
votes(s,date,[0,15,30]);s.times[date]='19:00';
assert.equal(P.clock(P.likelySession(s,week,actors,now).startAt),'19:15','Exact quarters stay unchanged');
s.votes[date]['3']={available:false,offset:1440};s.votes[date].deleted={available:true,offset:1440};
assert.equal(P.likelySession(s,week,actors,now).count,3,'Unavailable and deleted actors do not contribute');
assert.equal(P.clock(P.likelySession(s,week,actors,now).startAt),'19:15');
const copy=JSON.stringify(s);P.likelySession(s,week,actors,now);assert.equal(JSON.stringify(s),copy,'Forecast never books or rebases a session');
votes(s,'2030-10-29',[0,0,0,0,0]);assert.equal(P.likelySession(s,week,actors,now).date,date,'Tuesday cannot lead');
assert.equal(P.likelySession(s,week,actors,Date.parse('2030-11-01T10:00Z')),null,'Past arrivals cannot be suggested');
s.sessions=[{startAt:P.instant('2030-10-07'),endedAt:P.instant('2030-10-07','20:00')}];
assert.equal(P.pollWeek(s,now),week,'Old session history cannot strand planning in a past week');
// Arrival offsets can cross midnight; the banner must use the adjusted date and DST offset.
s=plan();s.times[date]='00:00';votes(s,date,[-15,0,0]);
assert.equal(P.day(P.likelySession(s,week,actors,now).startAt),'2030-10-29');
assert.equal(P.clock(P.likelySession(s,week,actors,now).startAt),'23:45');
console.log('Forecast passed: unique winner, ties, actual-voter mean, floor quarters, stale weeks, midnight and read-only state.');
