const assert=require('node:assert/strict');
process.env.TZ='Europe/Berlin';
const history=require('../activity-history.js');
const ms=value=>+new Date(value);
const now=ms('2026-10-29T18:00:00+01:00');
const record=(actor,start,end,extra={})=>({actor_id:actor,started_at:start,last_seen_at:end,ended_at:end,is_active:false,...extra});
const rows=[
  record('tiger','2026-10-28T19:14:00+01:00','2026-10-28T20:00:00+01:00'),
  record('tiger','2026-10-28T19:30:00+01:00','2026-10-28T19:50:00+01:00'),
  record('tiger','2026-10-28T20:11:00+01:00','2026-10-29T06:44:00+01:00'),
  record('tiger','2026-10-29T17:25:00+01:00','2026-10-29T17:59:30+01:00',{ended_at:null,is_active:true}),
  record('other','2026-10-28T19:14:00+01:00','2026-10-28T20:00:00+01:00')
];
const visits=history.visits(rows,{now,onlineActorIds:new Set(['tiger'])});
const tiger=visits.filter(x=>x.actor_id==='tiger');
assert.equal(tiger.length,3,'Overlap merges, but the 11-minute and daytime breaks stay separate');
assert.equal(history.duration(tiger[0].start,tiger[0].end),'46m');
assert.equal(history.duration(tiger[1].start,tiger[1].end),'10h 33m');
assert.equal(history.duration(tiger[2].start,tiger[2].end),'35m');
assert.equal(tiger[2].active,true);
const days=history.days(visits,new Date(now));
assert.equal(days.flatMap(day=>day.sessions).length,visits.length,'A midnight crossing is listed only once');
assert.equal(days[0].continuing,1);assert.equal(days[1].sessions.length,3);
assert.equal(history.timestamp(tiger[0].start,new Date(now)),'19:14 yesterday');
assert.equal(history.timestamp(tiger[1].end,new Date(now)),'06:44 today');
assert.match(history.timestamp(ms('2026-10-21T19:14:00+02:00'),new Date(now)),/21 Oct 2026/);
const stale=history.visits(rows,{now:now+120000,onlineActorIds:new Set(['tiger'])});
assert.equal(stale.find(x=>x.start===tiger[2].start).active,false,'Cached is_active cannot keep a stale visit open');
assert.equal(stale.find(x=>x.start===tiger[2].start).end,ms(rows[3].last_seen_at));
assert.equal(history.visits([record('x','invalid','invalid'),record('x','2026-11-01','2026-11-02')],{now}).length,0);
const oldest=days[6].start;
const crossing=history.visits([record('x',new Date(oldest-3600000).toISOString(),new Date(oldest+3600000).toISOString())],{now,windowStart:oldest});
assert.equal(history.days(crossing,new Date(now))[6].sessions.length,1,'Visits crossing the window boundary remain visible');
const dstDays=history.days([],new Date('2026-10-26T12:00:00+01:00'));
assert.equal(dstDays[1].end-dstDays[1].start,25*3600000,'Timeline uses actual local day length across DST');
console.log('Activity history passed: overlap union, genuine gaps, dated times, unique rows, stale sessions, durations and DST.');
