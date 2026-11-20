// Island Pet: a shared pet for the second game's island routes.
// The same rules run on the server (island-pet-migration.sql) and here. Here they only power
// the local sandbox used in previews, so a preview can never touch the real shared pet.
// tests/island-pet.integration.js checks that both sides agree.
(function(root){
  'use strict';
  const CATALOG=[
    {id:'biscuit',kind:'food',name:'Biscuit',price:0,ch:1,fx:{hunger:14}},
    {id:'rice_ball',kind:'food',name:'Rice ball',price:6,ch:1,fx:{hunger:26,joy:3}},
    {id:'peach_juice',kind:'food',name:'Peach juice',price:8,ch:1,fx:{hunger:8,joy:10}},
    {id:'island_curry',kind:'food',name:'Island curry',price:14,ch:2,fx:{hunger:40}},
    {id:'fruit_parfait',kind:'food',name:'Fruit parfait',price:20,ch:3,fx:{hunger:12,joy:26}},
    {id:'beach_feast',kind:'food',name:'Beach feast',price:32,ch:5,fx:{hunger:50,joy:20,energy:6}},
    {id:'beach_ball',kind:'toy',name:'Beach ball',price:0,ch:1,fx:{joy:14,energy:-6}},
    {id:'bubbles',kind:'toy',name:'Bubbles',price:12,ch:1,fx:{joy:18,clean:-4,energy:-5}},
    {id:'kite',kind:'toy',name:'Kite',price:10,ch:2,fx:{joy:22,energy:-9}},
    {id:'hide_and_seek',kind:'toy',name:'Hide and seek',price:16,ch:4,fx:{joy:30,energy:-12}},
    {id:'straw_hat',kind:'hat',name:'Straw hat',price:15,ch:1},
    {id:'sun_visor',kind:'hat',name:'Sun visor',price:20,ch:2},
    {id:'party_hat',kind:'hat',name:'Party hat',price:25,ch:3},
    {id:'star_crown',kind:'hat',name:'Star crown',price:60,ch:5},
    {id:'bell',kind:'neck',name:'Little bell',price:12,ch:1},
    {id:'flower_lei',kind:'neck',name:'Flower lei',price:20,ch:1},
    {id:'bandana',kind:'neck',name:'Bandana',price:18,ch:2},
    {id:'sunset',kind:'bg',name:'Sunset beach',price:30,ch:2},
    {id:'garden',kind:'bg',name:'Garden',price:40,ch:3},
    {id:'night_sky',kind:'bg',name:'Night sky',price:50,ch:4},
    {id:'chibimi',kind:'skin',name:'Chibimi',price:40,ch:2},
    {id:'monokuma_skin',kind:'skin',name:'Monokuma',price:60,ch:2}
  ];
  const COOLDOWN={feed:25,play:25,wash:45,pet:15,rest:90,game:60};
  const GAMES=[
    {id:'snack',name:'Snack Catch',ch:1},
    {id:'memory',name:'Island Memory',ch:1},
    {id:'bubble',name:'Hope Bubbles',ch:3},
    {id:'run',name:'Jabberwock Dash',ch:5}
  ];
  const RATE={hunger:2.5,joy:2,energy:1.5,clean:1.5};
  const STAT_KEYS=['hunger','joy','energy','clean'];
  const ZONE='Europe/Copenhagen';
  const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
  const dayKey=ms=>dayFormat.format(new Date(ms));
  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
  const find=(id,kinds)=>CATALOG.find(item=>item.id===id&&kinds.includes(item.kind));

  const HP_MAX=300,HOUR=3600000,MAX_TICKS=240;
  const LIFE_DEFAULTS={hp:HP_MAX,age:0,dirty:0,sad:0,hungry:0,cares:0,form:null,dead:false,died:null,cause:null,gen:1,paused:false,graves:[]};
  function freshLife(nowMs,gen=1){
    const iso=new Date(nowMs).toISOString();
    return {...LIFE_DEFAULTS,graves:[],gen,lt:iso,born:iso};
  }
  function defaultState(nowMs){
    return {v:1,name:null,revealed:false,xp:0,stats:{hunger:70,joy:70,energy:80,clean:80},at:new Date(nowMs).toISOString(),owned:{},worn:{},people:{},log:[],...freshLife(nowMs)};
  }
  // Stats drift down while nobody is around and never go below 10.
  function statsAt(old,atMs,tMs){
    const hours=clamp((tMs-atMs)/HOUR,0,48),stats={};
    for(const key of STAT_KEYS)stats[key]=Math.round(Math.max(Math.min(old[key],10),old[key]-RATE[key]*hours));
    return stats;
  }
  const stageOf=age=>age<24?'baby':age<72?'child':'adult';
  function formFor({dirty,sad,hungry,cares}){
    if(dirty>=12&&dirty>=sad&&dirty>=hungry)return 'monoshit';
    if(sad+hungry>=12)return 'monokuma';
    if(cares>=30&&dirty+sad+hungry<=4)return 'usami';
    return 'monomi';
  }
  const defaultName=s=>s.form==='monokuma'?'Monokuma':s.form==='monoshit'?'Monoshit':s.revealed?'Usami':'Monomi';
  const critical=stats=>({hunger:stats.hunger<=20,joy:stats.joy<=15,energy:stats.energy<=15,clean:stats.clean<=15});
  // One step per hour: age, care habits, health, growing up and, if nobody helps, death.
  function decay(state,nowMs,chapter=1){
    const at=Date.parse(state.at);
    const s={...LIFE_DEFAULTS,graves:[],lt:state.at,born:state.at,...state};
    const iso=new Date(nowMs).toISOString();
    if(s.dead||s.paused)return {...s,at:iso,lt:iso};
    const lt=Date.parse(s.lt),elapsed=Math.max(0,Math.floor((nowMs-lt)/HOUR)),n=Math.min(elapsed,MAX_TICKS);
    let {hp,age,dirty,sad,hungry,form}=s,dead=false,died=null,cause=null;
    for(let i=1;i<=n;i++){
      const t=lt+i*HOUR,st=statsAt(state.stats,at,t);
      age++;
      if(st.clean<=20)dirty++;
      if(st.hunger<=25)hungry++;
      if(st.joy<=25)sad++;
      const crit=Object.values(critical(st)).filter(Boolean).length;
      if(crit)hp=Math.max(0,hp-crit);
      else if(Math.min(st.hunger,st.joy,st.energy,st.clean)>=40)hp=Math.min(HP_MAX,hp+3);
      if(!form&&age>=72)form=formFor({dirty,sad,hungry,cares:s.cares});
      if(hp===0){
        dead=true;died=new Date(t).toISOString();
        const low=['hunger','joy','energy','clean'].reduce((a,b)=>st[b]<st[a]?b:a);
        cause={hunger:'hunger',joy:'lonely',energy:'exhausted',clean:'mess'}[low];
        break;
      }
    }
    const next={...s,stats:statsAt(state.stats,at,nowMs),at:iso,lt:elapsed>MAX_TICKS?iso:new Date(lt+n*HOUR).toISOString(),hp,age,dirty,sad,hungry,form,dead,died,cause};
    if(dead)next.graves=[{name:s.name||defaultName(next),form,stage:stageOf(age),died,cause,ch:clamp(Math.floor(chapter)||1,1,6),age},...s.graves].slice(0,40);
    return next;
  }
  function emptyPerson(){return {coins:0,care:0,day:'',dayCare:0,dayGame:0,cd:{}};}
  function level(xp){return 1+Math.floor(Math.sqrt(Math.max(0,xp)/12));}
  function mood(stats){
    if(stats.energy<25)return 'sleepy';
    if(stats.hunger<25)return 'hungry';
    if(stats.clean<25)return 'messy';
    if(stats.joy>=75)return 'happy';
    if(stats.joy<30)return 'grumpy';
    return 'content';
  }
  function fail(error){return {ok:false,error};}

  const DEAD_TEXT='The pet has passed away. Hatch a new egg to start again.';
  // Returns {ok:true,state} or {ok:false,error}. `now` is milliseconds.
  function apply(previous,{actor,actorName='Someone',action,arg=null,score=0,chapter=1,now}){
    let s=decay(previous,now,chapter);
    const ch=clamp(Math.floor(chapter)||1,1,6),stats={...s.stats},today=dayKey(now);
    if(s.dead&&action!=='hatch')return {ok:false,error:DEAD_TEXT,state:s};
    if(action==='hatch'){
      if(!s.dead)return fail('Your pet is alive and well.');
      s={...s,...freshLife(now,s.gen+1),graves:s.graves,stats:{hunger:70,joy:70,energy:80,clean:80},at:new Date(now).toISOString()};
      s.log=[{t:new Date(now).toISOString(),who:String(actorName).slice(0,40),text:'hatched a new pet'},...s.log].slice(0,12);
      return {ok:true,state:s};
    }
    let person={...emptyPerson(),...(s.people[actor]||{}),cd:{...(s.people[actor]?.cd||{})}};
    if(person.day!==today){person.day=today;person.dayCare=0;person.dayGame=0;}
    let item=null,game=null,cls=null,cd=0,line='',care=false,xpGain=0;
    s={...s,owned:{...s.owned},worn:{...s.worn},people:{...s.people}};
    if(action==='feed'||action==='play'){
      item=find(arg,[action==='feed'?'food':'toy']);
      if(!item)return fail('Pick something from the list.');
      if(item.ch>ch)return fail('That is not unlocked yet.');
      if(person.coins<item.price)return fail('Not enough coins.');
      if(action==='feed'&&stats.hunger>=95)return fail('Not hungry right now.');
      if(action==='play'&&stats.energy<15)return fail('Too sleepy to play. Let it rest first.');
      cls=action;cd=COOLDOWN[action];
    }else if(action==='wash'||action==='pet'||action==='rest'){cls=action;cd=COOLDOWN[action];}
    else if(action==='game'){
      game=GAMES.find(g=>g.id===(arg||'snack'));
      if(!game)return fail('Pick a game from the list.');
      if(game.ch>ch)return fail('That game is not unlocked yet.');
      cls='game';cd=COOLDOWN.game;
    }
    else if(action==='buy'){
      item=find(arg,['hat','neck','bg','skin']);
      if(!item)return fail('Pick something from the shop.');
      if(item.ch>ch)return fail('That is not unlocked yet.');
      if(s.owned[arg])return fail('Already owned.');
      if(person.coins<item.price)return fail('Not enough coins.');
      person.coins-=item.price;s.owned[arg]=true;s.worn[item.kind]=arg;
      line='bought and dressed the pet in: '+arg;
    }else if(action==='wear'){
      item=find(arg,['hat','neck','bg','skin']);
      if(!item||!s.owned[arg])return fail('You can only wear things the pet owns.');
      s.worn[item.kind]=arg;line='changed the look: '+arg;
    }else if(action==='unwear'){
      if(!['hat','neck','bg','skin'].includes(arg))return fail('Choose hat, neck, background or skin.');
      delete s.worn[arg];line='took off the '+arg;
    }else return fail('Unknown pet action.');

    if(cls){
      const last=person.cd[cls]?Date.parse(person.cd[cls]):null;
      if(last!==null&&now<last+cd*1000)return fail(`Wait ${Math.ceil((last+cd*1000-now)/1000)} more seconds.`);
      person.cd[cls]=new Date(now).toISOString();
      if(cls==='feed'||cls==='play'){
        for(const [key,delta] of Object.entries(item.fx))stats[key]=clamp(stats[key]+delta,0,100);
        person.coins-=item.price;care=true;xpGain=3;
        line=(cls==='feed'?'fed the pet: ':'played with the pet: ')+arg;
      }else if(cls==='wash'){stats.clean=Math.min(100,stats.clean+35);stats.joy=Math.min(100,stats.joy+2);care=true;xpGain=3;line='gave the pet a wash';}
      else if(cls==='pet'){stats.joy=Math.min(100,stats.joy+6);care=true;xpGain=3;line='cuddled the pet';}
      else if(cls==='rest'){stats.energy=Math.min(100,stats.energy+28);stats.hunger=Math.max(0,stats.hunger-4);care=true;xpGain=3;line='tucked the pet in for a nap';}
      else if(cls==='game'){
        const points=clamp(Math.floor(Number(score))||0,0,40),gain=Math.min(Math.floor(points/4),Math.max(60-person.dayGame,0));
        person.coins+=gain;person.dayGame+=gain;
        stats.joy=Math.min(100,stats.joy+Math.min(15,Math.floor(points/3)));
        stats.energy=Math.max(0,stats.energy-5);xpGain=Math.floor(points/5);
        line='scored '+points+' in '+game.name;
      }
    }
    if(care&&person.dayCare<20){person.coins+=1;person.dayCare+=1;}
    if(care)person.care+=1;
    s.stats=stats;s.xp+=xpGain;s.people[actor]=person;
    if(care)s.cares+=1;
    s.log=[{t:new Date(now).toISOString(),who:String(actorName).slice(0,40),text:line},...s.log].slice(0,12);
    return {ok:true,state:s};
  }
  function applyHost(previous,{action,arg=null,now,chapter=1}){
    let s=decay(previous,now,chapter);
    if(action==='reveal')s={...s,revealed:arg==='true'};
    else if(action==='rename'){
      const name=String(arg??'').trim()||null;
      if(name&&!/^[A-Za-z0-9 .'-]{1,20}$/.test(name))return fail('Use up to 20 letters, numbers, spaces, dots, dashes or apostrophes.');
      s={...s,name};
    }else if(action==='reset')s={...defaultState(now),revealed:s.revealed,name:s.name,graves:s.graves};
    else if(action==='pause')s={...s,paused:arg==='true'};
    else if(action==='revive'){
      if(!s.dead)return fail('The pet is alive.');
      s={...s,dead:false,died:null,cause:null,hp:HP_MAX/2,stats:{hunger:60,joy:60,energy:60,clean:60},lt:new Date(now).toISOString(),graves:s.graves.slice(1)};
    }
    else return fail('Unknown host action.');
    return {ok:true,state:s};
  }

  const api={CATALOG,GAMES,COOLDOWN,defaultState,decay,apply,applyHost,level,mood,dayKey,find,stageOf,critical,defaultName,HP_MAX,DEAD_TEXT};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.CastPet=api;
})(typeof window!=='undefined'?window:globalThis);
