(function(root){
  'use strict';
  // Serialize action requests, never whole-board snapshots. Realtime revisions
  // are authoritative; pending actions are replayed only for the local display.
  class CastScheduleStore {
    constructor(sync,planner,onError=()=>{}) {
      this.sync=sync;this.P=planner;this.onError=onError;this.row=null;
      this.pending=[];this.listeners=new Set();this.running=false;
      this.status='Connecting schedule…';this.ready=false;this.refreshing=null;
    }
    get state(){
      if(!this.row)return null;
      const s=structuredClone(this.row.state);
      for(const item of this.pending){
        // An acknowledged action may already have arrived through Realtime.
        if(item.ackRevision&&this.row.revision>=item.ackRevision)continue;
        try{this.P.change(s,item.action,item.optimistic,item.now);}catch(_){}
      }
      return s;
    }
    subscribe(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
    emit(){for(const listener of this.listeners)listener();}
    receive(row){if(row?.state&&(!this.row||Number(row.revision)>Number(this.row.revision))){
      const acknowledged=this.pending.find(item=>item.id===row.last_request_id);
      if(acknowledged)acknowledged.ackRevision=Number(row.revision);
      this.row=row;this.ready=true;this.emit();
    }}
    async refresh(){
      if(this.refreshing)return this.refreshing;
      this.refreshing=(async()=>{
        try{
          const row=await this.sync.getSchedule();
          if(!row)throw Error('Shared schedule is not installed yet.');
          this.receive(row);this.ready=true;this.status=this.pending.length?'Saving schedule…':'Shared schedule · live';
        }catch(error){
          this.ready=false;this.status=this.row?'Schedule offline · reconnecting':'Shared schedule unavailable · waiting for setup';
        }finally{this.refreshing=null;this.emit();}
      })();
      return this.refreshing;
    }
    async start(){
      await this.refresh();
      this.unsubscribe=this.sync.subscribeSchedule(row=>this.receive(row),status=>{
        if(status==='SUBSCRIBED')this.refresh();
        else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){this.status='Schedule reconnecting…';this.emit();}
      });
      // Polling also catches missed events, resumed phones and a new migration.
      this.interval=setInterval(()=>this.refresh(),20000);
      this.interval?.unref?.();
    }
    dispatch(action,payload){
      if(!this.ready)return Promise.reject(Error('Shared scheduling is disconnected. Please try again when it reconnects.'));
      const id=root.crypto.randomUUID(),now=Date.now();
      const optimistic={...payload};
      if(action==='schedule'&&!optimistic.id)optimistic.id=id;
      // Validate before showing a change as pending.
      this.P.change(structuredClone(this.state),action,optimistic,now);
      return new Promise((resolve,reject)=>{
        this.pending.push({id,action,payload,optimistic,now,resolve,reject});
        this.status='Saving schedule…';this.emit();this.drain();
      });
    }
    async drain(){
      if(this.running)return;this.running=true;
      while(this.pending.length){
        const item=this.pending[0];
        try{
          let result;
          try{result=await this.sync.scheduleAction(item.action,item.payload,item.id);}
          catch(error){
            // An interrupted response may follow a committed write: same key.
            if(error?.code||!/fetch|network|timeout|abort/i.test(error?.message||''))throw error;
            result=await this.sync.scheduleAction(item.action,item.payload,item.id);
          }
          item.ackRevision=Number(result.revision);
          this.pending.shift();this.receive(result);item.resolve(result.state);
        }catch(error){
          this.pending.shift();this.status='Change not saved';this.onError(error);item.reject(error);
          await this.refresh();
        }
        this.status=this.pending.length?'Saving schedule…':this.ready?'Shared schedule · live':'Schedule offline · reconnecting';
        this.emit();
      }
      this.running=false;
    }
    dispose(){clearInterval(this.interval);this.unsubscribe?.();this.listeners.clear();}
  }
  if(typeof module!=='undefined'&&module.exports)module.exports=CastScheduleStore;
  root.CastScheduleStore=CastScheduleStore;
})(typeof window==='undefined'?globalThis:window);
