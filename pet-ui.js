// Island Pet screen: stage, care buttons, shop, the Snack Catch minigame, leaderboard and the
// host-only secret switch. Rules live in pet-minigame.js (client sandbox) and the database.
(function(root){
  'use strict';
  const Pet=root.CastPet;
  const esc=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const ART='assets/monopad/dr2/monomi.png';
  const STAT_LABEL={hunger:'Belly',joy:'Mood',energy:'Energy',clean:'Fluff'};
  const MOOD_TEXT={
    happy:'Beaming and bouncing around.',content:'Relaxed and happy to see you.',
    sleepy:'Yawning. A nap would help.',hungry:'Tummy rumbling. Snack time?',
    messy:'A bit scruffy. A wash would feel nice.',grumpy:'Feeling ignored. Some playtime would help.'
  };
  const WEAR_SVG={
    straw_hat:'<svg viewBox="0 0 100 60"><ellipse cx="50" cy="42" rx="48" ry="12" fill="#e7c36a" stroke="#6a4a12" stroke-width="3"/><path d="M22 40Q24 8 50 8T78 40Z" fill="#f2d98a" stroke="#6a4a12" stroke-width="3"/><path d="M23 36Q50 44 77 36" fill="none" stroke="#d1456f" stroke-width="6"/></svg>',
    sun_visor:'<svg viewBox="0 0 100 60"><path d="M12 38Q50 6 88 38Z" fill="#46b6d8" stroke="#124a5c" stroke-width="3"/><path d="M6 40Q50 56 94 40Q50 46 6 40Z" fill="#8be0f5" stroke="#124a5c" stroke-width="3"/></svg>',
    party_hat:'<svg viewBox="0 0 100 60"><path d="M50 2L82 56H18Z" fill="#ff67ac" stroke="#7a1f4a" stroke-width="3"/><circle cx="42" cy="36" r="4" fill="#fff"/><circle cx="58" cy="44" r="4" fill="#ffe36a"/><circle cx="50" cy="22" r="4" fill="#8be0f5"/><circle cx="50" cy="4" r="5" fill="#ffe36a"/></svg>',
    star_crown:'<svg viewBox="0 0 100 60"><path d="M10 52L16 14L34 32L50 6L66 32L84 14L90 52Z" fill="#ffd45e" stroke="#7a5a08" stroke-width="3"/><circle cx="50" cy="32" r="5" fill="#ff67ac"/><circle cx="26" cy="40" r="3.5" fill="#8be0f5"/><circle cx="74" cy="40" r="3.5" fill="#8be0f5"/></svg>',
    bell:'<svg viewBox="0 0 100 40"><path d="M6 8Q50 26 94 8" fill="none" stroke="#c43b5f" stroke-width="7" stroke-linecap="round"/><circle cx="50" cy="26" r="10" fill="#ffd45e" stroke="#7a5a08" stroke-width="3"/><path d="M42 28H58" stroke="#7a5a08" stroke-width="2.5"/></svg>',
    flower_lei:'<svg viewBox="0 0 100 40"><path d="M6 8Q50 28 94 8" fill="none" stroke="#2f8f4e" stroke-width="3"/><g stroke="#7a2f55" stroke-width="1.5"><circle cx="14" cy="12" r="6" fill="#ff67ac"/><circle cx="30" cy="19" r="6" fill="#ffd45e"/><circle cx="50" cy="23" r="6" fill="#ff67ac"/><circle cx="70" cy="19" r="6" fill="#ffd45e"/><circle cx="86" cy="12" r="6" fill="#ff67ac"/></g></svg>',
    bandana:'<svg viewBox="0 0 100 40"><path d="M4 4H96L50 38Z" fill="#46b6d8" stroke="#124a5c" stroke-width="3"/><circle cx="36" cy="12" r="3" fill="#fff"/><circle cx="64" cy="12" r="3" fill="#fff"/><circle cx="50" cy="22" r="3" fill="#fff"/></svg>'
  };

  const svgUrl=svg=>'data:image/svg+xml,'+encodeURIComponent(svg);
  const SHIT_ART=svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><g fill="#8a5429" stroke="#3d2410" stroke-width="5" stroke-linejoin="round"><ellipse cx="100" cy="152" rx="82" ry="32"/><ellipse cx="100" cy="112" rx="60" ry="28"/><ellipse cx="100" cy="76" rx="38" ry="24"/><path d="M84 62Q96 14 124 58Z"/></g><path d="M52 150Q100 170 148 150" fill="none" stroke="#b8793f" stroke-width="5" stroke-linecap="round"/><circle cx="82" cy="110" r="10" fill="#fff" stroke="#3d2410" stroke-width="3"/><circle cx="118" cy="110" r="10" fill="#fff" stroke="#3d2410" stroke-width="3"/><circle cx="84" cy="112" r="4.5" fill="#3d2410"/><circle cx="116" cy="112" r="4.5" fill="#3d2410"/><path d="M84 128Q100 140 116 128" fill="none" stroke="#3d2410" stroke-width="4" stroke-linecap="round"/></svg>');
  // Original chibi-style drawing of Monomi, used for the Chibimi skin.
  const CHIBI_ART=svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 230"><defs><clipPath id="h"><circle cx="100" cy="124" r="62"/></clipPath><clipPath id="b"><ellipse cx="100" cy="204" rx="38" ry="24"/></clipPath></defs><g stroke="#3a2a3a" stroke-width="4" stroke-linejoin="round"><ellipse cx="68" cy="50" rx="17" ry="44" transform="rotate(-10 68 50)" fill="#fff"/><ellipse cx="132" cy="50" rx="17" ry="44" transform="rotate(10 132 50)" fill="#f7a8c8"/><ellipse cx="100" cy="204" rx="38" ry="24" fill="#fff"/><rect x="100" y="176" width="44" height="56" fill="#f7a8c8" stroke="none" clip-path="url(#b)"/><ellipse cx="100" cy="204" rx="38" ry="24" fill="none"/><circle cx="100" cy="124" r="62" fill="#fff"/><rect x="100" y="60" width="66" height="132" fill="#f7a8c8" stroke="none" clip-path="url(#h)"/><circle cx="100" cy="124" r="62" fill="none"/></g><ellipse cx="68" cy="52" rx="8" ry="30" transform="rotate(-10 68 52)" fill="#ffd6e6"/><ellipse cx="132" cy="52" rx="8" ry="30" transform="rotate(10 132 52)" fill="#f48db5"/><circle cx="76" cy="128" r="8" fill="#3a2a3a"/><circle cx="124" cy="128" r="9" fill="#e0314f" stroke="#3a2a3a" stroke-width="2.5"/><circle cx="127" cy="125" r="3" fill="#fff"/><circle cx="66" cy="148" r="9" fill="#ffb3cf" opacity=".8"/><circle cx="134" cy="148" r="9" fill="#ff8fb8" opacity=".8"/><ellipse cx="100" cy="142" rx="6" ry="4.5" fill="#f48db5" stroke="#3a2a3a" stroke-width="2.5"/><path d="M92 154Q100 164 108 154" fill="none" stroke="#3a2a3a" stroke-width="3" stroke-linecap="round"/><g fill="#f3e0bd" stroke="#3a2a3a" stroke-width="3" stroke-linejoin="round"><path d="M70 84L48 72L50 98Z"/><path d="M70 84L92 72L90 98Z"/><circle cx="70" cy="85" r="6"/></g></svg>');
  const FORM_ART={monokuma:'assets/pet/monokuma.png',monoshit:SHIT_ART};
  const SKIN_ART={chibimi:CHIBI_ART,monokuma_skin:'assets/pet/monokuma.png'};
  // The host's secret switch makes the pet Usami. There is no Usami artwork yet, so it keeps the Monomi picture; point this at a new image to change it.
  const USAMI_ART=ART;
  const TOMB_SVG='<svg viewBox="0 0 120 140"><path d="M20 130V50Q20 12 60 12T100 50V130Z" fill="#b9bdc6" stroke="#4a4f5c" stroke-width="5" stroke-linejoin="round"/><path d="M44 52H76M60 38V82" stroke="#4a4f5c" stroke-width="7" stroke-linecap="round"/><path d="M8 130H112" stroke="#3f7d3a" stroke-width="8" stroke-linecap="round"/></svg>';
  const FORM_LABEL={monomi:'Monomi',usami:'Usami',monokuma:'Monokuma',monoshit:'Monoshit'};
  const FORM_TEXT={
    monomi:'Grew up as a sweet little rabbit.',usami:'Grew up well loved and glowing.',
    monokuma:'Grew up a mischievous bear after a lonely, hungry childhood.',monoshit:'Grew up a mess after too many missed washes.'
  };
  const CAUSE_TEXT={hunger:'Starved',lonely:'Died of loneliness',exhausted:'Worn out',mess:'Lost in the mess'};
  const STAGE_LABEL={baby:'Baby',child:'Child',adult:'Adult'};
  const dateText=iso=>iso?new Date(iso).toLocaleDateString(undefined,{day:'numeric',month:'short'}):'';

  // Memorial section: every grave the group has reached, grouped by the chapter it happened in.
  function renderPetGraveyard(box,state,maxChapter,{revealed=false}={}){
    const graves=(state?.graves||[]).filter(g=>revealed||g.ch<=maxChapter);
    if(!graves.length){box.hidden=true;box.innerHTML='';return;}
    box.hidden=false;
    const chapters=[...new Set(graves.map(g=>g.ch))].sort((a,b)=>a-b);
    box.innerHTML=`<div class="section-kicker">PET GRAVEYARD</div><h3>Island pets we lost</h3>
      <p class="muted small">Every pet that did not make it, by chapter.</p>`+chapters.map(ch=>`<h4>Chapter ${ch}</h4><div class="pet-grave-list">${graves.filter(g=>g.ch===ch).map(g=>`<article class="pet-grave-card"><img src="${esc(FORM_ART[g.form]||ART)}" alt="" loading="lazy" draggable="false"><div><strong>${esc(g.name||FORM_LABEL[g.form]||'Monomi')}</strong><small>${esc(STAGE_LABEL[g.stage]||'Baby')} · ${esc(CAUSE_TEXT[g.cause]||'Passed away')}</small><small>${esc(dateText(g.died))}</small></div></article>`).join('')}</div>`).join('');
  }

  function makeRemoteStore(sync){
    let state=null;const listeners=new Set();
    const emit=()=>listeners.forEach(fn=>fn());
    const normalize=value=>value&&value.stats?value:null;
    return {
      sandbox:false,
      get state(){return state||Pet.defaultState(Date.now());},
      async load(){const row=await sync.getPet();state=normalize(row?.state);emit();},
      async act(action,arg,score,actor){
        const result=await sync.petAction(actor,action,arg,score);
        if(result?.state){state=result.state;emit();}
        return result;
      },
      async host(action,arg){
        const result=await sync.petHost(action,arg);
        if(result?.state){state=result.state;emit();}
        return result;
      },
      subscribe(fn){
        listeners.add(fn);
        const stop=sync.subscribePet?.(row=>{state=normalize(row?.state)||state;emit();});
        return ()=>{listeners.delete(fn);stop?.();};
      }
    };
  }
  function makeSandboxStore({persist=false,chapter=()=>1,previewChapter=null,startCoins=0,actor='preview'}={}){
    const KEY='danganronpa-island-pet-sandbox-v1';let state=null;const listeners=new Set();
    try{if(persist)state=JSON.parse(localStorage.getItem(KEY));}catch(_){}
    if(!state?.stats){
      state=Pet.defaultState(Date.now());
      if(startCoins)state.people[actor]={coins:startCoins,care:0,day:'',dayCare:0,dayGame:0,cd:{}};
    }
    let override=previewChapter;
    const commit=result=>{
      if(result.state){state=result.state;try{if(persist)localStorage.setItem(KEY,JSON.stringify(state));}catch(_){}listeners.forEach(fn=>fn());}
      return result;
    };
    return {
      sandbox:true,
      get canPickChapter(){return previewChapter!==null;},
      get chapterOverride(){return override;},
      set chapterOverride(value){override=value;listeners.forEach(fn=>fn());},
      get state(){return state;},
      async load(){},
      async act(action,arg,score,actor){return commit(Pet.apply(state,{actor,actorName:'You (preview)',action,arg,score,chapter:override||chapter(),now:Date.now()}));},
      async host(action,arg){return commit(Pet.applyHost(state,{action,arg,now:Date.now(),chapter:override||chapter()}));},
      // Preview only: pretend time has passed so the host can see growing up and dying without waiting.
      async skip(hours){
        const back=iso=>new Date(Date.parse(iso)-hours*3600e3).toISOString();
        const moved={...state,at:back(state.at),lt:back(state.lt||state.at),people:Object.fromEntries(Object.entries(state.people||{}).map(([id,p])=>[id,{...p,cd:Object.fromEntries(Object.entries(p.cd||{}).map(([k,v])=>[k,back(v)]))}]))};
        return commit({ok:true,state:Pet.decay(moved,Date.now(),override||chapter())});
      },
      subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);}
    };
  }

  function mountIslandPet({root:host,store,actors,mode,actorId,chapter:siteChapter,toast,login,sandboxActor='preview'}){
    const q=sel=>host.querySelector(sel);
    const chapter=()=>store.sandbox&&store.chapterOverride?store.chapterOverride:siteChapter();
    host.innerHTML=`
      <section class="pet-hero panel">
        <div class="pet-stage" id="petStage" aria-hidden="true"><div class="pet-sprite" id="petSprite"><img id="petImg" src="${ART}" alt="" draggable="false"><span class="pet-wear pet-hat" id="petHat"></span><span class="pet-wear pet-neck" id="petNeck"></span><span class="pet-zzz">z z</span></div><div class="pet-tomb" id="petTomb">${TOMB_SVG}</div></div>
        <div class="pet-info">
          <div class="section-kicker">ISLAND PET</div>
          <h2 id="petName">Monomi</h2>
          <p id="petGrowth" class="pet-growth muted small"></p>
          <div class="pet-level"><span id="petLevel"></span><div class="pet-bar"><i id="petXp"></i></div></div>
          <p id="petMood" class="pet-mood" role="status"></p>
          <p id="petWarn" class="pet-warn" role="alert" hidden></p>
          <div id="petStats" class="pet-stats"></div>
          <p id="petCoins" class="pet-coins"></p>
        </div>
      </section>
      <section class="pet-actions panel" aria-label="Care">
        <div id="petButtons" class="pet-buttons"></div>
        <div id="petPicker" class="pet-picker" hidden></div>
        <div id="petAsRow" class="pet-as" hidden></div>
        <p id="petNotice" class="pet-notice muted small" role="status"></p>
      </section>
      <section class="pet-game panel" aria-label="Minigames">
        <div class="section-kicker">MINIGAMES</div><h3 id="petGameTitle">Snack Catch</h3>
        <div id="petGameTabs" class="pet-game-tabs" role="group" aria-label="Choose a minigame"></div>
        <p id="petGameBlurb" class="muted small"></p>
        <canvas id="petCanvas" aria-label="Minigame play area"></canvas>
        <div class="pet-game-bar"><button type="button" class="ghost" id="petLeft" aria-label="Move left">◀</button><button type="button" class="ghost" id="petJump" aria-label="Jump">⤒ Jump</button><button type="button" id="petStart">Start</button><button type="button" class="ghost" id="petRight" aria-label="Move right">▶</button></div>
        <p id="petGameInfo" class="muted small" role="status" aria-live="polite">Ready when you are.</p>
        <p class="muted small">Coins from minigames are capped each day, so a few rounds are plenty.</p>
      </section>
      <section class="pet-shop panel"><div class="section-kicker">WARDROBE</div><h3>Shop and looks</h3><div id="petShop" class="pet-shop-grid"></div></section>
      <section class="pet-board panel"><div class="section-kicker">TOGETHER</div><h3>Caretakers</h3><ol id="petBoard" class="pet-leader"></ol><h3>Recently</h3><ul id="petLog" class="pet-log"></ul></section>
      <section class="pet-host panel" id="petHost" hidden></section>`;

    let picker=null,busy=false,gameRunning=false,gameBusy=false,gameId='snack',game=null;
    const nameOf=id=>actors().find(a=>a.id===id)?.name||'Someone';
    const HOST_KEY='danganronpa-pet-host-actor';
    const hostActor=()=>{const saved=localStorage.getItem(HOST_KEY);return actors().some(a=>a.id===saved)?saved:actors()[0]?.id||null;};
    const me=()=>store.sandbox?sandboxActor:mode()==='host'?hostActor():actorId();
    const canAct=()=>store.sandbox||(mode()==='host'?!!hostActor():mode()==='player'&&!!actorId());
    const view=()=>Pet.decay(store.state,Date.now(),chapter());
    const person=()=>store.state.people?.[me()]||{coins:0,care:0,cd:{},dayGame:0,day:''};
    const wait=cls=>{const last=person().cd?.[cls];return last?Math.max(0,Math.ceil((Date.parse(last)+Pet.COOLDOWN[cls]*1000-Date.now())/1000)):0;};
    const petName=s=>s.name||Pet.defaultName(s);
    const say=text=>{q('#petNotice').textContent=text||'';};

    function renderStage(s){
      const stage=q('#petStage'),moodName=Pet.mood(s.stats),stageName=Pet.stageOf(s.age);
      stage.dataset.mood=moodName;stage.dataset.bg=s.worn.bg||'beach';stage.dataset.revealed=store.state.revealed?'1':'0';
      stage.dataset.stage=stageName;stage.dataset.form=s.form||'monomi';stage.dataset.dead=s.dead?'1':'0';
      const skin=s.worn.skin,art=SKIN_ART[skin]||(store.state.revealed&&!FORM_ART[s.form]?USAMI_ART:FORM_ART[s.form])||ART,img=q('#petImg');stage.dataset.skin=SKIN_ART[skin]?skin:'';
      if(img.dataset.art!==art){img.dataset.art=art;img.src=art;}
      q('#petHat').innerHTML=WEAR_SVG[s.worn.hat]||'';q('#petNeck').innerHTML=WEAR_SVG[s.worn.neck]||'';
      q('#petName').textContent=petName(s);
      const grown=s.form?` · ${FORM_TEXT[s.form]}`:stageName==='adult'?'':' · Still growing up. How you treat it decides who it becomes.';
      q('#petGrowth').textContent=s.dead?`Passed away${s.cause?`: ${CAUSE_TEXT[s.cause].toLowerCase()}`:''}.`:`${STAGE_LABEL[stageName]}${s.paused?' · Resting (paused by the host)':''}${grown}`;
      q('#petMood').textContent=s.dead?Pet.DEAD_TEXT:MOOD_TEXT[moodName];
      const danger=!s.dead&&!s.paused&&Object.values(Pet.critical(s.stats)).some(Boolean);
      const warn=q('#petWarn');warn.hidden=!danger;
      warn.textContent=danger?(s.hp<=Pet.HP_MAX/2?'Your pet is in serious danger! Care for it right now.':'Your pet is struggling. Please look after it soon.'):'';
      const level=Pet.level(s.xp),base=12*(level-1)**2,next=12*level**2;
      q('#petLevel').textContent=`Bond level ${level}`;q('#petXp').style.width=Math.round((s.xp-base)/(next-base)*100)+'%';
      const hpPct=Math.round(s.hp/Pet.HP_MAX*100);
      q('#petStats').innerHTML=['hunger','joy','energy','clean'].map(key=>`<div class="pet-stat"><span>${STAT_LABEL[key]}</span><div class="pet-bar" role="img" aria-label="${STAT_LABEL[key]} ${s.stats[key]} of 100"><i data-low="${s.stats[key]<25?1:0}" style="width:${s.stats[key]}%"></i></div><b>${s.stats[key]}</b></div>`).join('')
        +`<div class="pet-stat"><span>Health</span><div class="pet-bar" role="img" aria-label="Health ${hpPct} percent"><i data-low="${hpPct<50?1:0}" style="width:${hpPct}%"></i></div><b>${hpPct}</b></div>`;
      q('#petCoins').textContent=canAct()?`Your coins: ${person().coins||0}${store.sandbox?' (preview only, nothing is saved to the shared pet)':''}`:'Log in as your voice actor to care for the pet.';
    }
    function renderButtons(){
      const dead=view().dead,can=canAct(),care=can&&!dead;
      const btn=(act,label,cls)=>{const w=cls?wait(cls):0;return `<button type="button" data-act="${act}" ${!care||w?'disabled':''}>${label}${w?` <small>${w}s</small>`:''}</button>`;};
      q('#petButtons').innerHTML=btn('open-feed','Feed','feed')+btn('open-play','Play','play')+btn('wash','Wash','wash')+btn('pet','Cuddle','pet')+btn('rest','Nap','rest')
        +(dead&&can?'<button type="button" data-act="hatch">Hatch a new egg</button>':'')+(can?'':'<button type="button" class="ghost" data-act="login">Log in</button>');
      const asRow=q('#petAsRow');
      if(mode()==='host'&&!store.sandbox){
        const current=hostActor(),sig=JSON.stringify([current,actors().map(a=>a.id)]);
        asRow.hidden=false;
        if(asRow.dataset.sig!==sig){
          asRow.dataset.sig=sig;
          asRow.innerHTML=`<label>Caring as <select id="petAs">${actors().map(a=>`<option value="${esc(a.id)}" ${a.id===current?'selected':''}>${esc(a.name)}</option>`).join('')}</select></label>`;
        }
      }else if(store.sandbox&&store.canPickChapter){
        asRow.hidden=false;
        const sig='preview-'+store.chapterOverride;
        if(asRow.dataset.sig!==sig){
          asRow.dataset.sig=sig;
          asRow.innerHTML=`<label>Preview as chapter <select id="petPreviewChapter">${[1,2,3,4,5].map(n=>`<option value="${n}" ${n===store.chapterOverride?'selected':''}>${n}</option>`).join('')}</select></label> <span class="muted small">Host preview: unlocks games and items up to that chapter. You start with 100 coins.</span>`;
        }
      }else asRow.hidden=true;
      const start=q('#petStart'),w=wait('game');
      start.disabled=!can||view().dead||gameRunning||gameBusy||w>0;start.textContent=w?`Ready in ${w}s`:gameRunning?'Playing…':`Start (${game.seconds} s)`;
      const controls=game.controls;
      q('#petLeft').hidden=q('#petRight').hidden=controls!=='lr';q('#petJump').hidden=controls!=='jump';
      q('#petLeft').disabled=q('#petRight').disabled=q('#petJump').disabled=!gameRunning;
      renderGameTabs();
    }
    function renderGameTabs(){
      const ch=chapter(),box=q('#petGameTabs');
      if(Pet.GAMES.find(g=>g.id===gameId).ch>ch)selectGame('snack');
      const sig=JSON.stringify([gameId,ch,gameRunning||gameBusy]);
      if(box.dataset.sig!==sig){
        box.dataset.sig=sig;
        box.innerHTML=Pet.GAMES.map(g=>g.ch>ch
          ?`<button type="button" class="pet-item locked" disabled><strong>???</strong><small>Unlocks in chapter ${g.ch}</small></button>`
          :`<button type="button" class="pet-item" data-game="${g.id}" aria-pressed="${g.id===gameId}" ${gameRunning||gameBusy?'disabled':''}><strong>${esc(g.name)}</strong><small>${root.CastPetGames.INFO[g.id].seconds} s</small></button>`).join('');
      }
    }
    function selectGame(id){
      if(gameRunning||gameBusy||!Pet.GAMES.some(g=>g.id===id))return;
      game?.destroy();gameId=id;
      game=root.CastPetGames.create(id,q('#petCanvas'),{chapter,art:ART,onTick,onEnd:onGameEnd});
      q('#petGameTitle').textContent=Pet.GAMES.find(g=>g.id===id).name;
      q('#petGameBlurb').textContent=root.CastPetGames.INFO[id].blurb;
      q('#petGameInfo').textContent='Ready when you are.';
    }
    function renderPicker(){
      const box=q('#petPicker');
      if(!picker){box.hidden=true;box.innerHTML='';return;}
      const ch=chapter(),kind=picker==='feed'?'food':'toy',p=person();
      box.hidden=false;
      box.innerHTML=Pet.CATALOG.filter(item=>item.kind===kind).map(item=>{
        const locked=item.ch>ch,poor=(p.coins||0)<item.price;
        return `<button type="button" class="pet-item" data-act="${picker}" data-arg="${item.id}" ${locked||poor?'disabled':''}><strong>${locked?'???':esc(item.name)}</strong><small>${locked?`Unlocks in chapter ${item.ch}`:item.price?item.price+' coins':'Free'}</small></button>`;
      }).join('')+'<button type="button" class="ghost" data-act="close-picker">Close</button>';
    }
    function renderShop(){
      const s=store.state,ch=chapter(),p=person(),can=canAct();
      const groups=[['skin','Skins'],['hat','Hats'],['neck','Neckwear'],['bg','Backgrounds']];
      q('#petShop').innerHTML=groups.map(([kind,label])=>`<div class="pet-shop-group"><h4>${label}</h4>${Pet.CATALOG.filter(item=>item.kind===kind).map(item=>{
        const owned=!!s.owned[item.id],worn=s.worn[kind]===item.id,locked=item.ch>ch;
        if(locked)return `<div class="pet-item locked"><strong>???</strong><small>Unlocks in chapter ${item.ch}</small></div>`;
        const act=owned?(worn?'unwear':'wear'):'buy',text=owned?(worn?'Take off':'Wear'):`Buy · ${item.price}`;
        return `<button type="button" class="pet-item" data-act="${act}" data-arg="${act==='unwear'?kind:item.id}" ${!can||(!owned&&(p.coins||0)<item.price)?'disabled':''} aria-pressed="${worn}"><strong>${esc(item.name)}</strong><small>${text}</small></button>`;
      }).join('')}</div>`).join('');
    }
    function renderBoard(){
      const s=store.state,rows=Object.entries(s.people||{}).filter(([,v])=>v.care>0).sort((a,b)=>b[1].care-a[1].care).slice(0,8);
      q('#petBoard').innerHTML=rows.length?rows.map(([id,v])=>`<li><span>${esc(id===sandboxActor&&store.sandbox?'You (preview)':nameOf(id))}</span><b>${v.care} ${v.care===1?'care':'cares'}</b></li>`).join(''):'<li class="muted">Nobody has cared for the pet yet.</li>';
      q('#petLog').innerHTML=(s.log||[]).length?s.log.map(entry=>`<li><b>${esc(entry.who)}</b> ${esc(entry.text.replace(/: ([a-z_]+)$/,(m,id)=>': '+(Pet.CATALOG.find(i=>i.id===id)?.name||id)).replace(/in: ([a-z_]+)$/,(m,id)=>'in: '+(Pet.CATALOG.find(i=>i.id===id)?.name||id)))}</li>`).join(''):'<li class="muted">Quiet so far.</li>';
    }
    function renderHost(){
      const box=q('#petHost');
      if(mode()!=='host'){box.hidden=true;box.innerHTML='';return;}
      const s=store.state;
      if(box.dataset.built!=='1'){
        box.hidden=false;box.dataset.built='1';
        box.innerHTML=`<div class="section-kicker">HOST ONLY</div><h3>Pet settings</h3>
          <label class="discord-switch"><input type="checkbox" id="petReveal"> Secret switch: the pet is Usami</label>
          <p class="muted small">Only you can see this. It renames the pet to Usami for everyone, so leave it off until the story has revealed her.</p>
          <div class="pet-rename"><input id="petRename" maxlength="20" placeholder="Rename the pet (optional)" aria-label="Pet name"><button type="button" class="ghost" data-act="rename">Rename</button></div>
          <div class="pet-rename"><button type="button" class="ghost" data-act="pause" id="petPause"></button><button type="button" class="ghost" data-act="revive" id="petRevive">Bring the pet back</button></div>
          <p class="muted small">Pausing stops hunger, ageing and death, for example between seasons. Bringing it back removes its latest grave.</p>
          <div class="pet-rename" id="petSkip" hidden><span class="muted small">Preview only:</span><button type="button" class="ghost" data-act="skip" data-arg="12">+12 hours</button><button type="button" class="ghost" data-act="skip" data-arg="48">+2 days</button><button type="button" class="ghost" data-act="skip" data-arg="120">+5 days</button></div>
          <button type="button" class="ghost danger" data-act="reset">Start over with a new pet</button>`;
        q('#petSkip').hidden=!store.sandbox;
      }
      q('#petReveal').checked=!!s.revealed;
      q('#petPause').textContent=s.paused?'Resume the pet':'Pause the pet';
      q('#petRevive').hidden=!view().dead;
    }
    function render(){
      const s=view();
      renderStage(s);renderButtons();renderPicker();renderShop();renderBoard();renderHost();
    }

    async function run(action,arg,score){
      if(busy)return null;
      if(!canAct()){login?.();return null;}
      busy=true;
      try{
        const result=await store.act(action,arg,score,me());
        say(result.ok?'':result.error);
        if(!result.ok&&result.error)toast?.(result.error);
        return result;
      }catch(error){
        const message=root.CastSupabaseSync?.errorMessage?.(error)||'The pet could not be reached. Try again in a moment.';
        say(message);toast?.(message);return null;
      }finally{busy=false;render();}
    }

    host.addEventListener('click',async event=>{
      const el=event.target.closest('[data-act]');if(!el||el.disabled||!host.contains(el))return;
      const act=el.dataset.act,arg=el.dataset.arg;
      if(act==='open-feed'||act==='open-play'){picker=picker===act.slice(5)?null:act.slice(5);renderPicker();return;}
      if(act==='close-picker'){picker=null;renderPicker();return;}
      if(act==='login'){login?.();return;}
      if(['rename','reset','pause','revive','skip'].includes(act)){
        if(act==='reset'&&!confirm('Start over with a new pet? Coins, outfits and bond level will be reset. Graves are kept.'))return;
        try{
          const value=act==='rename'?q('#petRename').value:act==='pause'?String(!store.state.paused):null;
          const result=act==='skip'?await store.skip(Number(arg)):await store.host(act,value);
          if(!result.ok)toast?.(result.error);
          else toast?.({reset:'A new pet has arrived.',rename:'Name saved.',pause:store.state.paused?'The pet is resting.':'The pet is awake again.',revive:'The pet is back.',skip:'Time moved on.'}[act]);
        }catch(error){toast?.(root.CastSupabaseSync?.errorMessage?.(error)||'Could not save.');}
        render();return;
      }
      const result=await run(act,arg);
      if(result?.ok&&(act==='feed'||act==='play'))picker=null;
      if(result?.ok&&act==='hatch')say('A new egg hatched. Take good care of it.');
      render();
    });
    host.addEventListener('change',async event=>{
      if(event.target.id==='petAs'){localStorage.setItem(HOST_KEY,event.target.value);render();return;}
      if(event.target.id==='petPreviewChapter'){store.chapterOverride=Number(event.target.value);return;}
      if(event.target.id!=='petReveal')return;
      const box=event.target;box.disabled=true;
      try{const result=await store.host('reveal',box.checked?'true':'false');if(!result.ok)toast?.(result.error);}
      catch(error){toast?.(root.CastSupabaseSync?.errorMessage?.(error)||'Could not save.');box.checked=!box.checked;}
      finally{box.disabled=false;render();}
    });

    function onTick(score,left){q('#petGameInfo').textContent=`Score ${score} · ${Math.ceil(left)} s left`;}
    async function onGameEnd(score){
      gameRunning=false;gameBusy=true;renderButtons();
      q('#petGameInfo').textContent=`Time! You scored ${score}. Saving…`;
      const before=person().coins||0;
      const result=await run('game',gameId,score);
      gameBusy=false;
      q('#petGameInfo').textContent=result?.ok?`You scored ${score} and earned ${(person().coins||0)-before} coins.`:`You scored ${score}. ${result?.error||'It could not be saved.'}`;
      render();
    }
    host.addEventListener('click',event=>{
      const tab=event.target.closest('[data-game]');
      if(tab&&!tab.disabled&&host.contains(tab)){selectGame(tab.dataset.game);renderButtons();}
    });
    q('#petStart').onclick=()=>{if(!canAct()){login?.();return;}gameRunning=true;renderButtons();game.start();};
    q('#petJump').addEventListener('pointerdown',event=>{game.act();event.preventDefault();});
    q('#petJump').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){game.act();event.preventDefault();}});
    selectGame('snack');

    for(const [id,dir] of [['#petLeft',-1],['#petRight',1]]){
      const button=q(id);
      button.addEventListener('pointerdown',()=>game.steer(dir));
      for(const type of ['pointerup','pointerleave','pointercancel','blur'])button.addEventListener(type,()=>game.steer(0));
      button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){game.steer(dir);event.preventDefault();}});
      button.addEventListener('keyup',()=>game.steer(0));
    }

    store.subscribe(render);
    let signature='';
    const timer=setInterval(()=>{
      if(!host.isConnected||!host.closest('.tab-panel')?.classList.contains('active')||gameRunning)return;
      const s=view(),next=JSON.stringify([s.stats,s.hp,s.dead,s.form,Pet.stageOf(s.age),['feed','play','wash','pet','rest','game'].map(wait)]);
      if(next===signature)return;
      signature=next;renderStage(s);renderButtons();
    },1000);
    render();
    return {render,stop(){clearInterval(timer);game?.destroy();}};
  }

  root.CastPetUI={mountIslandPet,makeRemoteStore,makeSandboxStore,renderPetGraveyard,WEAR_SVG};
})(window);
