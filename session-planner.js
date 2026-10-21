(function(root){
  'use strict';
  const ZONE='Europe/Copenhagen',MIN=60000,HOUR=60*MIN;
  const format=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  function parts(time=Date.now()){return Object.fromEntries(format.formatToParts(new Date(time)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));}
  function day(time=Date.now()){const p=parts(time);return `${p.year}-${p.month}-${p.day}`;}
  function clock(time){const p=parts(time);return `${p.hour}:${p.minute}`;}
  function addDays(date,n){return new Date(Date.parse(date+'T12:00:00Z')+n*24*HOUR).toISOString().slice(0,10);}
  function weekday(date){return new Date(date+'T12:00:00Z').getUTCDay();}
  function monday(date){return addDays(date,-((weekday(date)+6)%7));}
  function nextWeek(date){return addDays(monday(date),7);}
  // Resolve a civil time by verifying candidates on both sides of a DST transition.
  // An ambiguous autumn time uses the first occurrence; a nonexistent spring time is rejected.
  function instant(date,time='19:00'){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))throw Error('Choose a valid date and time.');
    const civil=Date.parse(`${date}T${time}:00Z`);if(!Number.isFinite(civil))throw Error('Invalid time.');
    const matches=[];
    for(let offset=-180;offset<=180;offset+=15){const candidate=civil+offset*MIN;if(day(candidate)===date&&clock(candidate)===time)matches.push(candidate);}
    if(!matches.length)throw Error('That time does not exist in Denmark because the clocks change.');
    return new Date(Math.min(...matches)).toISOString();
  }
  function fresh(){return {version:1,hostActorId:'b252e57d-7370-4c59-a898-fd381593cb33',sessions:[{id:'session-2026-10-21',startAt:instant('2026-10-21','19:45'),endedAt:null,breaks:[],source:'host'}],votes:{},times:{'2026-10-21':'19:45'},notices:[],records:{}};}
  function normalise(value){
    const s=value&&typeof value==='object'?value:fresh();s.version=1;s.sessions=Array.isArray(s.sessions)?s.sessions:[];s.votes||={};s.times||={};s.notices=Array.isArray(s.notices)?s.notices:[];s.records||={};s.hostActorId||=fresh().hostActorId;
    s.sessions=s.sessions.filter(x=>x&&Number.isFinite(Date.parse(x.startAt))).map(x=>({...x,breaks:Array.isArray(x.breaks)?x.breaks:[]}));return s;
  }
  function stopAt(s){return Math.min(Date.parse(s.startAt)+10*HOUR,s.endedAt?Date.parse(s.endedAt):Infinity);}
  function current(s,now=Date.now()){const x=latest(s,now);return x&&stopAt(x)>now?x:null;}
  function upcoming(s,now=Date.now()){return s.sessions.filter(x=>!x.endedAt&&Date.parse(x.startAt)>now).sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt))[0]||null;}
  function latest(s,now=Date.now()){return s.sessions.filter(x=>Date.parse(x.startAt)<=now).sort((a,b)=>Date.parse(b.startAt)-Date.parse(a.startAt))[0]||null;}
  function pollWeek(s,now=Date.now(),ahead=false){const next=upcoming(s,now),last=latest(s,now);return nextWeek(ahead&&next?day(next.startAt):last?day(last.startAt):day(now));}
  function voters(s,date,actors){const ids=new Set(actors.map(a=>a.id));return Object.entries(s.votes[date]||{}).filter(([id,v])=>ids.has(id)&&v.available).map(([actorId,v])=>({actorId,...v}));}
  function suggestion(s,date,actors){const vs=voters(s,date,actors);const average=vs.reduce((n,v)=>n+v.offset,0)/(vs.length+1);return Math.ceil(average/15)*15;}
  function label(offset){return offset===0?'On time':`${Math.abs(offset)} minutes ${offset<0?'early':'late'}`;}
  function rebase(s,date,time){const difference=(Date.parse(instant(date,s.times[date]||'19:00'))-Date.parse(instant(date,time)))/MIN;for(const vote of Object.values(s.votes[date]||{}))vote.offset+=difference;s.times[date]=time;}
  function duration(session,now=Date.now()){
    const start=Date.parse(session.startAt),end=Math.min(stopAt(session),now);if(end<=start)return {total:0,breaks:0,play:0};
    const intervals=session.breaks.map(b=>[Math.max(start,Date.parse(b.startAt)),Math.min(end,b.endAt?Date.parse(b.endAt):end)]).filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>a).sort((a,b)=>a[0]-b[0]);
    let paused=0,lastEnd=start;for(const [a,b] of intervals){paused+=Math.max(0,b-Math.max(a,lastEnd));lastEnd=Math.max(lastEnd,b);}return {total:end-start,breaks:paused,play:end-start-paused};
  }
  function ranked(s,week,actors,now){return Array.from({length:7},(_,i)=>addDays(week,i)).filter(d=>weekday(d)!==2).map(date=>({date,voters:voters(s,date,actors),startAt:instant(date,s.times[date]||'19:00')})).filter(x=>Date.parse(x.startAt)>now&&x.voters.length>=3&&x.voters.some(v=>v.actorId===s.hostActorId)).sort((a,b)=>b.voters.length-a.voters.length||a.date.localeCompare(b.date));}
  function reconcile(s,actors,now=Date.now()){
    let changed=false;
    const weeks=new Set(Object.keys(s.votes).map(monday));
    for(const week of weeks){
      const best=ranked(s,week,actors,now)[0];if(!best)continue;
      const record=s.records[week]||0;
      if(best.voters.length>record){s.records[week]=best.voters.length;s.notices.push({id:`${week}-${best.voters.length}`,week,date:best.date,count:best.voters.length,createdAt:new Date(now).toISOString(),status:'Email pending connection'});changed=true;}
      // A host-selected session always wins over automatic selection for that week.
      const adjusted=new Date(Date.parse(best.startAt)+suggestion(s,best.date,actors)*MIN).toISOString();
      if(!s.autoSelectionDisabled?.[week]&&!s.sessions.some(x=>monday(day(x.startAt))===week)&&Date.parse(adjusted)>now&&now>=Date.parse(adjusted)-48*HOUR){
        rebase(s,best.date,clock(adjusted));s.sessions.push({id:`auto-${best.date}`,startAt:adjusted,endedAt:null,breaks:[],source:'poll'});changed=true;
      }
    }
    return changed;
  }
  function change(s,action,p,now=Date.now()){
    if(action==='vote'){
      if(weekday(p.date)===2)throw Error('Tuesday is unavailable.');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||p.date<day(now))throw Error('Choose today or a future date.');
      s.votes[p.date]||={};
      const offset=p.delta!==undefined?(s.votes[p.date][p.actorId]?.offset||0)+Number(p.delta):p.offset!==undefined?Number(p.offset):(s.votes[p.date][p.actorId]?.offset||0);
      s.votes[p.date][p.actorId]={available:!!p.available,offset:Math.max(-1440,Math.min(1440,Math.round((offset||0)/15)*15))};
    }else if(action==='schedule'){
      if(weekday(p.date)===2)throw Error('Tuesday is unavailable.');
      if(p.date<day(now))throw Error('Choose today or a future date.');
      const startAt=instant(p.date,p.time);const existing=p.id?s.sessions.find(x=>x.id===p.id):null;
      if(existing&&Date.parse(existing.startAt)<=now)throw Error('A started session cannot be rescheduled.');
      rebase(s,p.date,p.time);
      if(existing){existing.startAt=startAt;existing.source='host';}
      else if(!s.sessions.some(x=>x.startAt===startAt))s.sessions.push({id:p.id||`session-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,startAt,endedAt:null,breaks:[],source:'host'});
    }else if(action==='cancel'){
      const x=s.sessions.find(x=>x.id===p.id);if(!x||Date.parse(x.startAt)<=now)throw Error('Only future sessions can be removed.');s.sessions=s.sessions.filter(x=>x.id!==p.id);
      s.autoSelectionDisabled||={};s.autoSelectionDisabled[monday(day(x.startAt))]=true;
    }else{
      if(!['end','break','resume'].includes(action))throw Error('Unknown scheduling action.');
      const x=current(s,now);if(!x)throw Error('There is no current session.');
      if(p.id&&p.id!==x.id)throw Error('The current session changed. Refresh and try again.');
      if(action==='end'){x.endedAt=new Date(now).toISOString();x.breaks.forEach(b=>{if(!b.endAt)b.endAt=x.endedAt;});}
      else if(action==='break'){if(!x.breaks.some(b=>!b.endAt))x.breaks.push({startAt:new Date(now).toISOString(),endAt:null});}
      else if(action==='resume'){const b=x.breaks.find(b=>!b.endAt);if(b)b.endAt=new Date(now).toISOString();}
    }
    return s;
  }
  const api={ZONE,MIN,HOUR,day,clock,addDays,weekday,monday,nextWeek,instant,fresh,normalise,current,upcoming,latest,pollWeek,voters,suggestion,label,duration,ranked,reconcile,change,stopAt};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;root.CastSessionPlanner=api;
})(typeof window==='undefined'?globalThis:window);
