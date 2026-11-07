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
votes(s,date,[-60,-60,-60,-60,0]); // Four can join at 18:00, one at 19:00.
votes(s,'2030-10-31',[0,0,0,0]);
assert.equal(P.clock(P.likelySession(s,week,actors,now).startAt),'19:00','Wait until all available players can join');
assert.equal(P.likelySession(s,week,actors,now).date,date);
assert.equal(P.likelySession(s,week,actors,now).count,5);
votes(s,'2030-10-31',[0,0,0,0,0]);assert.equal(P.likelySession(s,week,actors,now),null,'No arbitrary winner on tied days');
assert.equal(P.likelySessions(s,week,actors,now).length,2,'Ties above the threshold also qualify');
delete s.votes['2030-10-31'];s.times[date]='18:55';votes(s,date,[0,0,0,0,15]);
assert.equal(P.clock(P.likelySession(s,week,actors,now).startAt),'19:10','Do not round before the last arrival, even for a non-quarter base time');
votes(s,date,[0,15,30]);s.times[date]='19:00';
assert.equal(P.clock(P.likelySession(s,week,actors,now).startAt),'19:30','Use the latest of different arrival times');
s.votes[date]['3']={available:false,offset:1440};s.votes[date].deleted={available:true,offset:1440};
assert.equal(P.likelySession(s,week,actors,now).count,3,'Unavailable and deleted actors do not contribute');
assert.equal(P.clock(P.likelySession(s,week,actors,now).startAt),'19:30');
const copy=JSON.stringify(s);P.likelySession(s,week,actors,now);assert.equal(JSON.stringify(s),copy,'Forecast never books or rebases a session');
votes(s,'2030-10-29',[0,0,0,0,0]);assert.equal(P.likelySession(s,week,actors,now).date,date,'Tuesday cannot lead');
assert.equal(P.likelySession(s,week,actors,Date.parse('2030-11-01T10:00Z')),null,'Past arrivals cannot be suggested');
s.sessions=[{startAt:P.instant('2030-10-07'),endedAt:P.instant('2030-10-07','20:00')}];
assert.equal(P.pollWeek(s,now),week,'Old session history cannot strand planning in a past week');
// Arrival offsets can cross midnight; the banner must use the adjusted date and DST offset.
s=plan();s.times[date]='00:00';votes(s,date,[-30,-15,-15]);
assert.equal(P.day(P.likelySession(s,week,actors,now).startAt),'2030-10-29');
assert.equal(P.clock(P.likelySession(s,week,actors,now).startAt),'23:45');
// Positive offsets can move the start into the following day.
s=plan();s.times[date]='23:45';votes(s,date,[0,15,30]);
assert.equal(P.likelySession(s,week,actors,now).startAt,P.instant('2030-10-31','00:15'));
// The latest actual arrival remains valid across the autumn clock change.
s=plan();s.times['2030-10-27']='02:30';votes(s,'2030-10-27',[0,30,60]);
assert.equal(P.likelySession(s,'2030-10-21',actors,Date.parse('2030-10-21T10:00Z')).startAt,'2030-10-27T01:30:00.000Z');
console.log('Forecast passed: latest available arrival, day ties, excluded voters, exact times, midnight, DST and read-only state.');
