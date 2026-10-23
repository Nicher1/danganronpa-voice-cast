(function(){
  'use strict';
  window.mountSessionPlanner=function(options){
    const P=window.CastSessionPlanner,root=document.querySelector('#sessionPlanner'),dialog=document.querySelector('#scheduleDialog');
    let plan=P.normalise(options.load()||(options.local()?null:{sessions:[],votes:{},times:{},notices:[],records:{}})),ahead=false,selectedDate=P.day(),month=P.day().slice(0,7),editingId='',hostActor='',viewWeek='',lastPhase='',busy=false,historyOpen=false;
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let collapsed=false,focusedDate='';
    try{collapsed=localStorage.getItem('danganronpa-schedule-collapsed')==='true';}catch(_){}
    const names=()=>Object.fromEntries(options.actors().map(a=>[a.id,a.name]));
    const isHost=()=>options.mode()==='host';
    const canUse=()=>options.local()||!!options.store?.ready;
    const dateLabel=d=>new Intl.DateTimeFormat(undefined,{weekday:'short',day:'numeric',month:'short',timeZone:P.ZONE}).format(new Date(d+'T12:00Z'));
    const localDate=t=>new Intl.DateTimeFormat(undefined,{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(t));
    const localTime=t=>`<time datetime="${t}">${new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(t))}</time>`;
    const timeLabel=n=>{
      const minutes=Math.max(0,Math.floor(n/P.MIN)),hours=Math.floor(minutes/60),days=Math.floor(hours/24);
      return `${days?`${days}d `:''}${hours?`${hours%24}h `:''}${minutes%60}m`;
    };
    function save(){options.save(plan);}
    async function act(action,p){
      if(!canUse())return options.toast('Shared scheduling is not connected. Your change has not been saved.');
      if(action!=='vote'&&!isHost())return;
      if(action==='vote'&&!isHost()&&p.actorId!==options.actorId())return;
      p={...p};
      if(['end','break','resume'].includes(action))p.id=P.current(plan)?.id;
      if(['schedule','cancel'].includes(action)&&p.id)p.expectedStartAt=plan.sessions.find(s=>s.id===p.id)?.startAt;
      try{
        if(options.store)await options.store.dispatch(action,p);
        else{P.change(plan,action,p);if(isHost())P.reconcile(plan,options.actors());save();}
        render();if(dialog.open)renderDialog();
      }catch(e){options.toast('Not saved: '+e.message);}
    }
    function vote(date,actorId,offset,available){if(!actorId)return options.toast('Choose your voice actor first.');act('vote',{date,actorId,offset,available});}
    function votersHtml(date){const ns=names();return P.voters(plan,date,options.actors()).map(v=>`<span class="schedule-person">${esc(ns[v.actorId])}${v.offset?` <small>${P.label(v.offset)}</small>`:''}</span>`).join('')||'<small class="muted">No replies yet</small>';}
    function controls(date){const actorId=isHost()?hostActor:options.actorId(),v=plan.votes[date]?.[actorId];if(options.mode()==='viewer'||!canUse())return '';
      if(!actorId)return isHost()?'':'<button type="button" data-vote-login>Choose your voice actor to vote</button>';
      return `<div class="vote-controls"><button data-vote="${date}" aria-pressed="${!!v?.available}">${v?.available?'✓ Available':'I can play'}</button><button data-no="${date}" aria-pressed="${v?.available===false}">Cannot attend</button>${v?.available?`<div class="vote-offset"><button data-offset="${date}|-15" aria-label="15 minutes earlier on ${date}">−15</button><output>${P.label(v.offset)}</output><button data-offset="${date}|15" aria-label="15 minutes later on ${date}">+15</button></div>`:''}</div>`;}
    function bindVotes(scope){
      scope.querySelectorAll('[data-vote-login]').forEach(b=>b.onclick=()=>options.login?.());
      const id=()=>isHost()?hostActor:options.actorId();
      scope.querySelectorAll('[data-vote]').forEach(b=>b.onclick=()=>vote(b.dataset.vote,id(),undefined,true));
      scope.querySelectorAll('[data-no]').forEach(b=>b.onclick=()=>vote(b.dataset.no,id(),0,false));
      scope.querySelectorAll('[data-offset]').forEach(b=>b.onclick=()=>{const [d,n]=b.dataset.offset.split('|');act('vote',{date:d,actorId:id(),delta:Number(n),available:true});});
      scope.querySelector('[data-host-actor]')?.addEventListener('change',e=>{hostActor=e.target.value;render();if(dialog.open)renderDialog();});
    }
    function hostSelector(){if(!isHost()||!canUse())return '';return `<label class="schedule-assign">Reply on behalf of <select data-host-actor aria-label="Voice actor to assign"><option value="">Choose voice actor</option>${options.actors().map(a=>`<option value="${esc(a.id)}" ${hostActor===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select></label>`;}
    function poll(week){const today=P.day();return `<div class="schedule-week">${Array.from({length:7},(_,i)=>{const date=P.addDays(week,i),disabled=P.weekday(date)===2||date<today,count=P.voters(plan,date,options.actors()).length,v=plan.votes[date]?.[isHost()?hostActor:options.actorId()];return `<article class="schedule-day ${disabled?'unavailable':''} ${v?.available?'chosen':''}" data-drop-day="${date}"><span class="attendance-count" aria-label="${count} available">${count}</span><h4>${dateLabel(date)}</h4><p>${localTime(P.instant(date,plan.times[date]||'19:00'))}</p>${P.weekday(date)===2?'<strong class="day-cross" aria-label="Tuesday unavailable">×</strong><small>Tuesday is unavailable</small>':`${votersHtml(date)}${disabled?'':controls(date)}`}${isHost()&&canUse()&&!disabled?`<button class="ghost" data-pick="${date}">Schedule this day</button>`:''}</article>`;}).join('')}</div>`;}
    function bindPick(scope){scope.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{selectedDate=b.dataset.pick;month=selectedDate.slice(0,7);editingId='';renderDialog();if(!dialog.open)dialog.showModal();});}
    function render(){
      if(busy)return;busy=true;
      const now=Date.now(),active=P.current(plan,now),next=P.upcoming(plan,now),phase=active?'active':'planning';
      if(lastPhase==='active'&&phase==='planning'){ahead=false;viewWeek='';}lastPhase=phase;
      const elapsed=active?now-Date.parse(active.startAt):0;
      let headline=active?(elapsed<5*P.MIN?'DANGANRONPA NOW':`Current session began ${timeLabel(elapsed)} ago`):next?`Next Danganronpa in ${timeLabel(Date.parse(next.startAt)-now)}`:'Choose our next Danganronpa day';
      const attendance=next&&!active?dayVotes(next):'';
      const week=viewWeek||P.pollWeek(plan,now,ahead);
      root.innerHTML=`<header class="schedule-heading"><div><div class="section-kicker">SESSION SCHEDULE</div><h2 class="${active&&elapsed<5*P.MIN?'session-now':''}">${headline}</h2><p>${active?localDate(active.startAt):next?localDate(next.startAt):`Vote for the days you can play. Default: ${localTime(P.instant(week<P.day()?P.day():week))}.`}</p>${active?.breaks.some(b=>!b.endAt)?'<span class="case-status">ON A BREAK</span>':''}</div><div class="schedule-actions">${isHost()&&canUse()?'<button data-open-schedule>Set / adjust schedule</button>':''}${active&&isHost()&&canUse()?`<button data-break>${active.breaks.some(b=>!b.endAt)?'Resume session':'Pause session'}</button><button data-end>End current session</button>`:''}${next&&!active?`<button data-ahead>${ahead?'Back to next session':'Plan ahead'}</button>`:''}<button data-history>Session statistics</button></div></header>${attendance}<small class="schedule-local" role="status" data-shared-revision="${options.store?.row?.revision||''}">${options.local()?'Schedule saved on this device · preview':esc(options.store?.status||'Shared schedule unavailable')}</small>
      ${!active||focusedDate?`${hostSelector()}${next&&!ahead?`<section class="scheduled-rsvp"><h3>${dateLabel(P.day(next.startAt))} · attendance</h3>${controls(P.day(next.startAt))}</section>`:`<div class="week-navigation"><button data-week="-7" aria-label="Previous planning week">←</button><strong>Week of ${dateLabel(week)} · Monday–Sunday</strong><button data-week="7" aria-label="Next planning week">→</button></div>${poll(week)}`}`:''}
      <section id="sessionHistory" class="${historyOpen?'':'hidden'}"><h3>Session statistics</h3><div class="session-history">${plan.sessions.filter(s=>Date.parse(s.startAt)<=now).sort((a,b)=>Date.parse(b.startAt)-Date.parse(a.startAt)).map(s=>{const d=P.duration(s,now);return `<article><strong>${localDate(s.startAt)}</strong><span>${s.endedAt?'Ended by host':P.stopAt(s)<=now?'Automatic 10h end':'In progress'}</span><dl><dt>Elapsed</dt><dd>${timeLabel(d.total)}</dd><dt>Breaks</dt><dd>${timeLabel(d.breaks)}</dd><dt>Play time</dt><dd>${timeLabel(d.play)}</dd></dl></article>`;}).join('')||'<p>No sessions yet.</p>'}</div></section>`;
      const heading=root.querySelector('.schedule-heading');
      if(isHost()&&options.copyVotingLink){
        const shareButton=document.createElement('button');
        shareButton.type='button';shareButton.textContent='Copy voting link';
        shareButton.onclick=()=>options.copyVotingLink(focusedDate||(next?P.day(next.startAt):''));
        heading.querySelector('.schedule-actions').append(shareButton);
      }
      const body=document.createElement('div');
      body.id='sessionScheduleBody';
      while(heading.nextSibling)body.append(heading.nextSibling);
      root.append(body);
      const collapseButton=document.createElement('button');
      collapseButton.type='button';
      collapseButton.className='schedule-collapse';
      collapseButton.setAttribute('aria-controls',body.id);
      heading.append(collapseButton);
      function applyCollapsed(){
        body.hidden=collapsed;
        heading.querySelector('.schedule-actions').hidden=collapsed;
        collapseButton.setAttribute('aria-expanded',String(!collapsed));
        collapseButton.textContent=collapsed?'Expand schedule':'Collapse schedule';
      }
      applyCollapsed();
      collapseButton.onclick=()=>{
        collapsed=!collapsed;applyCollapsed();
        try{localStorage.setItem('danganronpa-schedule-collapsed',String(collapsed));}catch(_){}
      };
      root.querySelector('[data-open-schedule]')?.addEventListener('click',()=>{renderDialog();dialog.showModal();});
      root.querySelector('[data-break]')?.addEventListener('click',()=>act(active.breaks.some(b=>!b.endAt)?'resume':'break',{}));
      root.querySelector('[data-end]')?.addEventListener('click',()=>act('end',{}));
      root.querySelector('[data-ahead]')?.addEventListener('click',()=>{ahead=!ahead;viewWeek='';render();});
      root.querySelector('[data-history]').onclick=()=>{historyOpen=!historyOpen;root.querySelector('#sessionHistory').classList.toggle('hidden',!historyOpen);};
      root.querySelectorAll('[data-week]').forEach(b=>b.onclick=()=>{viewWeek=P.addDays(week,Number(b.dataset.week));render();});
      bindVotes(root);bindPick(root);busy=false;
    }
    function dayVotes(session){const date=P.day(session.startAt),ns=names(),base=Date.parse(P.instant(date,plan.times[date]||'19:00'));return `<div class="scheduled-attendees">${P.voters(plan,date,options.actors()).map(v=>{const offset=Math.round((base+v.offset*P.MIN-Date.parse(session.startAt))/P.MIN);return `<span class="schedule-person">${esc(ns[v.actorId])} <small>${P.label(offset)}</small></span>`;}).join('')||'Attendance not confirmed yet.'}</div>`;}
    function renderDialog(){
      const first=month+'-01',start=P.monday(first),today=P.day(),cw=P.monday(today),week=viewWeek||P.pollWeek(plan,Date.now(),ahead);
      dialog.innerHTML=`<div class="modal-card schedule-editor"><header class="schedule-heading"><div><div class="section-kicker">MASTER CONTROL</div><h2>Set schedule</h2><p>Dates and times below use Denmark time, including summer/winter time.</p></div><button data-close aria-label="Close schedule">×</button></header><div class="month-navigation"><button data-month="-1" aria-label="Previous month">←</button><h3>${new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(first+'T12:00Z'))}</h3><button data-month="1" aria-label="Next month">→</button></div><div class="month-grid">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<strong>${d}</strong>`).join('')}${Array.from({length:42},(_,i)=>{const d=P.addDays(start,i),blocked=P.weekday(d)===2,past=d<today,has=plan.sessions.some(s=>P.day(s.startAt)===d);return `<button class="calendar-day ${d===today?'today':''} ${P.monday(d)===cw?'current-week':''} ${d>=today&&d<=P.addDays(cw,6)?'week-remaining':''} ${d===selectedDate?'selected':''} ${has?'has-session':''} ${d.slice(0,7)!==month?'other-month':''}" data-date="${d}" ${blocked||past?'disabled':''} aria-label="${d}${blocked?' Tuesday unavailable':''}" aria-pressed="${d===selectedDate}">${Number(d.slice(-2))}${blocked?'<span class="calendar-cross">×</span>':has?'<span class="calendar-dot">●</span>':''}</button>`;}).join('')}</div><form id="scheduleForm"><label>Date<input name="date" type="date" value="${selectedDate}" min="${today}" required></label><label>Time in Denmark<input name="time" type="time" step="900" value="${editingId?P.clock(plan.sessions.find(s=>s.id===editingId).startAt):P.clock(new Date(Date.parse(P.instant(selectedDate,plan.times[selectedDate]||'19:00'))+P.suggestion(plan,selectedDate,options.actors())*P.MIN))}" required></label><button type="submit">${editingId?'Save new time':'Schedule session'}</button>${editingId?'<button type="button" data-new>New session</button>':''}</form><p class="muted small">Today may be scheduled in the past for testing. Tuesday is always unavailable. Multiple sessions can be scheduled in advance.</p><div class="scheduled-list">${plan.sessions.filter(s=>Date.parse(s.startAt)>Date.now()).sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt)).map(s=>`<article><strong>${localDate(s.startAt)}</strong><button data-edit="${esc(s.id)}">Adjust</button><button data-cancel="${esc(s.id)}">Remove</button></article>`).join('')}</div><h3>Assign availability</h3><p class="small muted">Select a voice actor, then tap days. Or drag a name onto a day. Replies save immediately.</p>${hostSelector()}<div class="schedule-actor-bank">${options.actors().map(a=>`<button type="button" draggable="true" data-drag-actor="${esc(a.id)}" class="${hostActor===a.id?'selected':''}">${esc(a.name)}</button>`).join('')}</div><div class="week-navigation"><button data-editor-week="-7">←</button><strong>Week of ${dateLabel(week)}</strong><button data-editor-week="7">→</button></div>${poll(week)}<details><summary>Poll notifications</summary><p>Three or more players, including Nicher, qualify. Only a new weekly attendance record creates another notification.</p>${plan.notices.map(n=>`<p>${dateLabel(n.date)} · ${n.count} players · ${esc(n.status)}</p>`).join('')||'<p>No qualifying votes yet.</p>'}<p>Email delivery to nl@hldata.dk is not connected yet. Poll results are shared; email setup comes afterward.</p></details></div>`;
      dialog.querySelector('[data-close]').onclick=()=>dialog.close();
      dialog.querySelectorAll('[data-month]').forEach(b=>b.onclick=()=>{const date=new Date(first+'T12:00Z');date.setUTCMonth(date.getUTCMonth()+Number(b.dataset.month));month=date.toISOString().slice(0,7);renderDialog();});
      dialog.querySelectorAll('[data-date]').forEach(b=>b.onclick=()=>{selectedDate=b.dataset.date;editingId='';renderDialog();});
      dialog.querySelector('#scheduleForm').onsubmit=e=>{e.preventDefault();const data=new FormData(e.target);const id=editingId||undefined;editingId='';act('schedule',{id,date:data.get('date'),time:data.get('time')});};
      dialog.querySelector('[data-new]')?.addEventListener('click',()=>{editingId='';renderDialog();});
      dialog.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{editingId=b.dataset.edit;selectedDate=P.day(plan.sessions.find(s=>s.id===editingId).startAt);month=selectedDate.slice(0,7);renderDialog();});
      dialog.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>act('cancel',{id:b.dataset.cancel}));
      dialog.querySelectorAll('[data-editor-week]').forEach(b=>b.onclick=()=>{viewWeek=P.addDays(week,Number(b.dataset.editorWeek));renderDialog();});
      bindVotes(dialog);bindPick(dialog);
      dialog.querySelectorAll('[data-drag-actor]').forEach(b=>{
        b.onclick=()=>{hostActor=b.dataset.dragActor;renderDialog();};
        b.ondragstart=e=>e.dataTransfer.setData('text/actor',b.dataset.dragActor);
        let drag=null;
        b.onpointerdown=e=>{if(e.pointerType==='mouse')return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};b.setPointerCapture(e.pointerId);};
        b.onpointermove=e=>{if(drag&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>8){drag.moved=true;b.classList.add('dragging');}};
        b.onpointerup=e=>{if(!drag)return;const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-drop-day]');if(drag.moved&&target&&!target.classList.contains('unavailable'))vote(target.dataset.dropDay,b.dataset.dragActor,0,true);drag=null;b.classList.remove('dragging');};
        b.onpointercancel=()=>{drag=null;b.classList.remove('dragging');};
      });
      dialog.querySelectorAll('[data-drop-day]').forEach(el=>{el.ondragover=e=>{if(!el.classList.contains('unavailable'))e.preventDefault();};el.ondrop=e=>{e.preventDefault();const id=e.dataTransfer.getData('text/actor');if(id&&options.actors().some(a=>a.id===id)&&!el.classList.contains('unavailable'))vote(el.dataset.dropDay,id,0,true);};});
    }
    function tick(){if(isHost()&&options.local()&&P.reconcile(plan,options.actors()))save();render();}
    function openVoting(date=''){
      focusedDate='';
      if(/^\d{4}-\d{2}-\d{2}$/.test(date)){
        try{P.instant(date);focusedDate=date;}catch(_){}
      }
      collapsed=false;
      if(focusedDate){ahead=true;viewWeek=P.monday(focusedDate);}
      render();
      requestAnimationFrame(()=>{
        const target=(focusedDate&&root.querySelector(`[data-drop-day="${focusedDate}"]`))||root;
        target.setAttribute('tabindex','-1');target.focus({preventScroll:true});target.scrollIntoView({block:'start'});
      });
    }
    const receive=()=>{const stored=options.load();if(stored)plan=P.normalise(stored);render();if(dialog.open&&!dialog.contains(document.activeElement))renderDialog();};
    const unsubscribe=options.store?.subscribe(receive);
    if(options.local())window.addEventListener('storage',receive);
    if(options.local()&&!options.load())save();
    const interval=setInterval(tick,15000);tick();
    return {render,tick,openVoting,dispose(){unsubscribe?.();options.store?.dispose();clearInterval(interval);window.removeEventListener('storage',receive);},getPlan:()=>plan};
  };
})();
