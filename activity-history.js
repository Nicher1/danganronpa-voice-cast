(function(root){
  "use strict";
  const FRESH_MS=90000;

  function sessionEnd(session,now,onlineActorIds){
    const lastSeen=new Date(session.last_seen_at||session.started_at).getTime();
    const active=!session.ended_at&&session.is_active===true&&onlineActorIds.has(String(session.actor_id))
      &&Number.isFinite(lastSeen)&&lastSeen<=now&&now-lastSeen<FRESH_MS;
    return {end:active?now:Math.min(now,new Date(session.ended_at||session.last_seen_at||session.started_at).getTime()),active};
  }

  // Count the union of an actor's connections, keeping every recorded gap.
  function visits(records,{now=Date.now(),onlineActorIds=new Set(),windowStart=-Infinity}={}){
    now=Number(now);
    const byActor=new Map();
    for(const record of records){
      const start=new Date(record.started_at).getTime();
      const {end,active}=sessionEnd(record,now,onlineActorIds);
      if(!record.actor_id||!Number.isFinite(start)||!Number.isFinite(end)||start>now||end<start||end<windowStart)continue;
      const actorId=String(record.actor_id);
      if(!byActor.has(actorId))byActor.set(actorId,[]);
      byActor.get(actorId).push({actor_id:actorId,start,end,active});
    }
    const result=[];
    for(const connections of byActor.values()){
      connections.sort((a,b)=>a.start-b.start||a.end-b.end);
      let previous;
      for(const connection of connections){
        if(previous&&connection.start<=previous.end){
          previous.end=Math.max(previous.end,connection.end);
          previous.active||=connection.active;
        }else{
          previous={...connection};result.push(previous);
        }
      }
    }
    return result.sort((a,b)=>a.start-b.start||a.actor_id.localeCompare(b.actor_id));
  }

  function days(visits,now=new Date()){
    return Array.from({length:7},(_,index)=>{
      const date=new Date(now);date.setHours(0,0,0,0);date.setDate(date.getDate()-index);
      const next=new Date(date);next.setDate(next.getDate()+1);
      const start=+date,end=+next;
      const segments=visits.filter(visit=>visit.start<end&&(visit.end>start||visit.start===start));
      // A visit gets one row, on its start day (or the earliest visible day).
      const sessions=segments.filter(visit=>visit.start>=start||index===6);
      return {date,start,end,segments,sessions,continuing:segments.length-sessions.length};
    });
  }

  function timestamp(value,now=new Date()){
    const date=new Date(value),today=new Date(now),yesterday=new Date(now);
    today.setHours(0,0,0,0);yesterday.setHours(0,0,0,0);yesterday.setDate(yesterday.getDate()-1);
    const day=new Date(date);day.setHours(0,0,0,0);
    const clock=date.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
    const label=+day===+today?"today":+day===+yesterday?"yesterday":date.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
    return `${clock} ${label}`;
  }

  function duration(start,end){
    const minutes=Math.max(0,Math.round((end-start)/60000));
    if(minutes<1)return "under 1m";
    const hours=Math.floor(minutes/60),rest=minutes%60;
    return hours?`${hours}h${rest?` ${rest}m`:""}`:`${rest}m`;
  }

  const api={visits,days,timestamp,duration};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  else root.CastActivityHistory=api;
})(typeof window!=="undefined"?window:globalThis);
