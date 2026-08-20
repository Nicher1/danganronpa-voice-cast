
(() => {
  const STORAGE_KEY = "danganronpa-cast-board-v4";
  const SESSION_ACTOR_KEY = "danganronpa-cast-active-actor-v4";
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") === "viewer" ? "viewer" : (params.get("mode") === "player" ? "player" : "host");

  const IMG = {
    monokuma:"https://static.wikia.nocookie.net/danganronpa/images/9/99/Monokuma_VA_ID.png/revision/latest/scale-to-width-down/75?cb=20170217164015",
    makoto:"https://static.wikia.nocookie.net/danganronpa/images/5/58/Makoto_Naegi_VA_ID.png/revision/latest?cb=20170217165255",
    aoi:"https://static.wikia.nocookie.net/danganronpa/images/1/1a/Aoi_Asahina_VA_ID.png/revision/latest?cb=20170217205925",
    byakuya:"https://static.wikia.nocookie.net/danganronpa/images/8/88/Byakuya_Togami_VA_ID.png/revision/latest?cb=20200523073632",
    celeste:"https://static.wikia.nocookie.net/danganronpa/images/a/a3/Celestia_Ludenberg_VA_ID.png/revision/latest?cb=20170217203839",
    chihiro:"https://static.wikia.nocookie.net/danganronpa/images/f/f2/Chihiro_Fujisaki_VA_ID.png/revision/latest?cb=20170217202828",
    hifumi:"https://static.wikia.nocookie.net/danganronpa/images/6/6c/Hifumi_Yamada_VA_ID.png/revision/latest?cb=20170217211552",
    junko:"https://static.wikia.nocookie.net/danganronpa/images/5/5b/Guide_Project_Junko_Disguise_10.png/revision/latest?cb=20171012011045",
    taka:"https://static.wikia.nocookie.net/danganronpa/images/a/ac/Kiyotaka_Ishimaru_VA_ID.png/revision/latest?cb=20170217203233",
    kyoko:"https://static.wikia.nocookie.net/danganronpa/images/9/91/Kyoko_Kirigiri_VA_ID.png/revision/latest?cb=20170217165232",
    leon:"https://static.wikia.nocookie.net/danganronpa/images/d/d7/Leon_Kuwata_VA_ID.png/revision/latest?cb=20170217221855",
    mondo:"https://static.wikia.nocookie.net/danganronpa/images/e/e3/Mondo_Owada_VA_ID.png/revision/latest?cb=20170217212542",
    sakura:"https://static.wikia.nocookie.net/danganronpa/images/b/b5/Sakura_Ogami_VA_ID.png/revision/latest?cb=20170217210845",
    sayaka:"https://static.wikia.nocookie.net/danganronpa/images/6/61/Sayaka_Maizono_VA_ID.png/revision/latest?cb=20170217165331",
    toko:"https://static.wikia.nocookie.net/danganronpa/images/5/50/Toko_Fukawa_VA_ID.png/revision/latest?cb=20170217205255",
    yasuhiro:"https://static.wikia.nocookie.net/danganronpa/images/e/e3/Yasuhiro_Hagakure_VA_ID.png/revision/latest?cb=20170217212331"
  };

  function id() {
    return window.crypto?.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2) + Date.now();
  }

  function mkRole(name, title, image = "", hiddenSpoiler = false) {
    return {
      id:id(), name, title, modifier:"", image,
      ownerId:null, dead:false, lastActorName:"", deathTime:null,
      hiddenSpoiler, revealed:!hiddenSpoiler
    };
  }

  function defaultState() {
    return {
      version:4,
      settings:{ maxPerActor:3, gameActive:true },
      actors:[
        {id:id(),name:"Bossu Nicher",passwordHash:"",lockedRoleId:null,replacementToken:false},
        {id:id(),name:"Milotic - Fu Xuan",passwordHash:"",lockedRoleId:null,replacementToken:false},
        {id:id(),name:"Witch Bitch",passwordHash:"",lockedRoleId:null,replacementToken:false},
        {id:id(),name:"MDicious",passwordHash:"",lockedRoleId:null,replacementToken:false},
        {id:id(),name:"Angel",passwordHash:"",lockedRoleId:null,replacementToken:false},
        {id:id(),name:"Taiga",passwordHash:"",lockedRoleId:null,replacementToken:false}
      ],
      roles:[
        mkRole("Monokuma","Headmaster",IMG.monokuma),
        mkRole("Makoto Naegi","Ultimate Lucky Student",IMG.makoto),
        mkRole("Aoi Asahina","Ultimate Swimming Pro",IMG.aoi),
        mkRole("Byakuya Togami","Ultimate Affluent Progeny",IMG.byakuya),
        mkRole("Celestia Ludenberg","Ultimate Gambler",IMG.celeste),
        mkRole("Chihiro Fujisaki","Ultimate Programmer",IMG.chihiro),
        mkRole("Hifumi Yamada","Ultimate Fanfic Creator",IMG.hifumi),
        mkRole("Junko Enoshima","Ultimate Fashionista",IMG.junko),
        mkRole("Kiyotaka Ishimaru","Ultimate Moral Compass",IMG.taka),
        mkRole("Kyoko Kirigiri","Ultimate ???",IMG.kyoko),
        mkRole("Leon Kuwata","Ultimate Baseball Star",IMG.leon),
        mkRole("Mondo Owada","Ultimate Biker Gang Leader",IMG.mondo),
        mkRole("Sakura Ogami","Ultimate Martial Artist",IMG.sakura),
        mkRole("Sayaka Maizono","Ultimate Pop Sensation",IMG.sayaka),
        mkRole("Toko Fukawa","Ultimate Writing Prodigy",IMG.toko),
        mkRole("Yasuhiro Hagakure","Ultimate Clairvoyant",IMG.yasuhiro),
        mkRole("Narrator","Narrator",""),
        mkRole("Mukuro Ikusaba","Ultimate Soldier","",true),
        mkRole("Genocide Jack","Ultimate Murderous Fiend","",true)
      ]
    };
  }

  let state = loadState();
  let expanded = new Set();
  let pendingImage = "";
  let pendingLoginActorId = null;
  let confirmResolver = null;
  let choiceResolver = null;
  let actionConfirmResolver = null;
  let activeActorId = mode === "player" ? sessionStorage.getItem(SESSION_ACTOR_KEY) : null;

  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];

  document.body.classList.add(mode + "-mode");
  $("#modeBadge").textContent = mode.toUpperCase();
  $("#modeBadge").classList.add(mode);

  function normaliseState(s) {
    s.version = 4;
    s.settings ||= {};
    if (!Number.isFinite(s.settings.maxPerActor)) s.settings.maxPerActor = 3;
    if (typeof s.settings.gameActive !== "boolean") s.settings.gameActive = true;
    s.actors ||= [];
    s.roles ||= [];
    s.actors.forEach(a => {
      a.passwordHash ||= "";
      if (typeof a.replacementToken !== "boolean") a.replacementToken = false;
      if (!("lockedRoleId" in a)) a.lockedRoleId = null;
    });
    s.roles.forEach(r => {
      if (typeof r.hiddenSpoiler !== "boolean") r.hiddenSpoiler = false;
      if (typeof r.revealed !== "boolean") r.revealed = !r.hiddenSpoiler;
      if (typeof r.dead !== "boolean") r.dead = false;
      r.image ||= "";
      r.modifier ||= "";
      r.lastActorName ||= "";
    });
    return s;
  }

  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s) return normaliseState(s);
    } catch (_) {}
    return defaultState();
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      alert("Browser storage is full. Use smaller images or export the board.");
    }
  }

  function esc(s="") {
    return String(s).replace(/[&<>"']/g,c=>({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function actorById(actorId){ return state.actors.find(a=>a.id===actorId); }
  function roleById(roleId){ return state.roles.find(r=>r.id===roleId); }
  function rolesForActor(actorId){ return state.roles.filter(r=>!r.dead && r.ownerId===actorId); }
  function lockedOwnerOf(roleId){ return state.actors.find(a=>a.lockedRoleId===roleId) || null; }
  function activeActor(){ return actorById(activeActorId); }

  function toast(text){
    const el=$("#toast");
    el.textContent=text;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t=setTimeout(()=>el.classList.remove("show"),1800);
  }

  function appConfirm({title="Are you sure?", text="", confirmText="Confirm", kicker="CONFIRM", danger=false}={}){
    return new Promise(resolve=>{
      actionConfirmResolver=resolve;
      $("#actionConfirmKicker").textContent=kicker;
      $("#actionConfirmTitle").textContent=title;
      $("#actionConfirmText").innerHTML=text;
      $("#actionConfirmYes").textContent=confirmText;
      $("#actionConfirmYes").classList.toggle("danger-button", danger);
      $("#actionConfirmDialog").showModal();
    });
  }

  $("#actionConfirmForm").addEventListener("submit",e=>{
    e.preventDefault();
    $("#actionConfirmDialog").close();
    const resolve=actionConfirmResolver;
    actionConfirmResolver=null;
    if(resolve) resolve(true);
  });

  $("#actionConfirmNo").onclick=()=>{
    $("#actionConfirmDialog").close();
    const resolve=actionConfirmResolver;
    actionConfirmResolver=null;
    if(resolve) resolve(false);
  };

  function currentRoleVisible(r) {
    if (mode === "host") return true;
    if (!r.hiddenSpoiler) return true;
    return !!r.revealed;
  }

  function render(){
    if (mode === "player" && activeActorId && !actorById(activeActorId)) {
      activeActorId = null;
      sessionStorage.removeItem(SESSION_ACTOR_KEY);
    }

    $("#maxRolesLabel").textContent=state.settings.maxPerActor;
    $("#gameActiveToggle").checked=state.settings.gameActive;
    $("#actorCount").textContent=state.actors.length;

    const free=state.roles.filter(r=>!r.dead && !r.ownerId && currentRoleVisible(r) && (!r.hiddenSpoiler || r.revealed));
    const spoilers=state.roles.filter(r=>!r.dead && !r.ownerId && r.hiddenSpoiler && !r.revealed);
    const dead=state.roles.filter(r=>r.dead && currentRoleVisible(r));

    $("#availableCount").textContent=free.length;
    $("#spoilerCount").textContent=spoilers.length;
    $("#deadCount").textContent=dead.length;

    renderSession();
    renderRules();
    renderPool(free);
    renderSpoilers(spoilers);
    renderActors();
    renderGraveyard(dead);
  }

  function renderSession(){
    if(mode==="host"){
      $("#sessionLine").innerHTML='You are the <strong>host</strong>. You can move anything, reveal spoilers, and mark characters as dead.';
      return;
    }
    if(mode==="viewer"){
      $("#sessionLine").textContent="Read-only view.";
      return;
    }

    const actor=activeActor();
    if(actor){
      $("#sessionLine").innerHTML=`Logged in as <strong>${esc(actor.name)}</strong>${actor.replacementToken ? ' · <span class="token">★ replacement token ready</span>' : ""}`;
      $("#logoutBtn").disabled=false;
    } else {
      $("#sessionLine").innerHTML='You are not logged in to an actor yet. <strong>Select or create your actor.</strong>';
      $("#logoutBtn").disabled=true;
    }
  }

  function renderRules(){
    const banner=$("#playRuleBanner");
    const actor=activeActor();
    banner.classList.toggle("playing",state.settings.gameActive);

    if(mode==="host"){
      banner.innerHTML=state.settings.gameActive
        ? `<strong>LIVE:</strong> Players can only claim characters from the Open Library. Direct stealing is disabled, except for a one-use <span class="token">replacement token</span> after a locked character dies.`
        : `<strong>Casting/setup:</strong> Players may claim an unlocked character from another actor. They still cannot give their own characters directly to someone else; they must return them to the Library first.`;
    } else if(mode==="player"){
      if(!actor){
        banner.textContent="Log in to your actor to move characters.";
      }else if(state.settings.gameActive){
        banner.innerHTML=`Game in progress: claim from the <strong>Open Library</strong> or return your own characters there.${actor.replacementToken ? ' Your <span class="token">★ replacement token</span> lets you claim one unlocked character from another actor once.' : ""}`;
      }else{
        banner.innerHTML=`Casting/setup: you can claim available characters and also take an <strong>unlocked</strong> character from another actor. To give one of your characters away, return it to the Library first.`;
      }
    }else{
      banner.textContent=state.settings.gameActive ? "Game in progress." : "Casting/setup mode.";
    }

    $("#libraryHelp").textContent = mode==="host"
      ? "Drag characters between the Library and actors. Click an available card for details."
      : mode==="player"
      ? "You can claim characters from here for your own actor. You can return your own characters here."
      : "Characters that have not been claimed yet.";
  }

  function imageMarkup(r,cls,placeholder="IMG"){
    if(r.image) return `<img class="${cls}" src="${esc(r.image)}" alt="" referrerpolicy="no-referrer">`;
    return `<div class="${cls} role-mini-placeholder">${esc(placeholder)}</div>`;
  }

  function canDragRole(r){
    if(mode==="viewer") return false;
    if(mode==="host") return true;
    if(mode!=="player" || !activeActor()) return false;

    if(!r.ownerId) return true;
    if(r.ownerId===activeActorId) return true;

    const sourceLocked=!!lockedOwnerOf(r.id);
    if(sourceLocked) return false;

    if(activeActor().replacementToken) return true;
    return !state.settings.gameActive;
  }

  function roleCard(r,{assigned=false,locked=false,spoiler=false}={}){
    const canExpand=!assigned && mode==="host";
    const isExpanded=canExpand && expanded.has(r.id);
    const el=document.createElement("article");
    el.className=`role-card ${isExpanded?"expanded":""} ${locked?"locked":""} ${spoiler?"spoiler":""}`;
    el.dataset.roleId=r.id;

    const draggable=canDragRole(r);
    if(draggable) el.draggable=true;

    const hostAssignedActions = assigned && mode==="host" ? `
      <button type="button" class="icon-btn" data-action="edit-role" title="Edit">✎</button>
      <button type="button" class="icon-btn danger-text" data-action="kill-role" title="Mark dead">☠</button>
    ` : "";

    el.innerHTML=`
      <div class="role-compact">
        ${imageMarkup(r,"role-mini-img",r.name.slice(0,1).toUpperCase())}
        <div class="role-copy">
          <div class="role-name">${esc(r.name)}</div>
          <div class="role-title">${esc(r.title||"No title")}</div>
        </div>
        <div class="role-badges">
          ${locked?`<span class="lock-badge" title="Locked character">🔒</span>`:""}
          ${hostAssignedActions}
          ${canExpand?`<span class="role-chevron">${isExpanded?"▲":"▼"}</span>`:""}
        </div>
      </div>
      ${canExpand?`
        <div class="role-expanded">
          ${r.image?`<img class="role-image" src="${esc(r.image)}" alt="" referrerpolicy="no-referrer">`:`<div class="role-image placeholder">No image yet</div>`}
          ${r.modifier?`<div class="role-detail"><strong>Modifier:</strong> ${esc(r.modifier)}</div>`:""}
          <div class="role-actions">
            <button type="button" data-action="edit-role">✎ Edit</button>
            <button type="button" data-action="kill-role" class="danger-text">☠ Mark dead</button>
            ${spoiler?`<button type="button" data-action="reveal-role">👁 Reveal to Library</button>`:""}
            <button type="button" data-action="delete-role" class="danger-text">× Delete</button>
          </div>
        </div>`:""}
    `;

    if(draggable){
      el.addEventListener("dragstart",e=>{
        if(e.target.closest("button")){e.preventDefault();return}
        e.dataTransfer.effectAllowed="move";
        e.dataTransfer.setData("text/plain",r.id);
      });
    }

    if(mode==="host"){
      el.addEventListener("click",e=>{
        const action=e.target.closest("[data-action]")?.dataset.action;
        if(action==="edit-role"){e.stopPropagation();openRoleDialog(r);return}
        if(action==="kill-role"){e.stopPropagation();killRole(r.id);return}
        if(action==="delete-role"){e.stopPropagation();deleteRole(r.id);return}
        if(action==="reveal-role"){e.stopPropagation();revealRole(r.id);return}
        if(canExpand&&!e.target.closest("button")){
          expanded.has(r.id)?expanded.delete(r.id):expanded.add(r.id);
          render();
        }
      });
    }
    return el;
  }

  function renderPool(roles){
    const pool=$("#rolePool");
    pool.innerHTML="";
    if(!roles.length) pool.innerHTML=`<div class="empty-slot">No available characters</div>`;
    roles.forEach(r=>pool.appendChild(roleCard(r)));
    makeDropZone(pool,null,"library");
  }

  function renderSpoilers(roles){
    if(mode!=="host") return;
    const pool=$("#spoilerPool");
    pool.innerHTML="";
    if(!roles.length) pool.innerHTML=`<div class="empty-slot">No hidden spoiler characters</div>`;
    roles.forEach(r=>pool.appendChild(roleCard(r,{spoiler:true})));
    makeDropZone(pool,null,"spoiler");
  }

  function renderActors(){
    const grid=$("#actorsGrid");
    grid.innerHTML="";
    if(!state.actors.length){
      grid.innerHTML=`<div class="empty-slot">No voice actors yet.</div>`;
      return;
    }

    state.actors.forEach(actor=>{
      const assigned=rolesForActor(actor.id).filter(currentRoleVisible);
      const card=document.createElement("section");
      card.className="actor-card"+(mode==="player"&&actor.id===activeActorId?" mine":"");
      card.dataset.actorId=actor.id;

      let actions="";
      if(mode==="host"){
        actions=`
          <button class="icon-btn" data-action="choose-lock" title="Choose locked character">🔒</button>
          <button class="icon-btn" data-action="token" title="Toggle replacement token">${actor.replacementToken?"★":"☆"}</button>
          <button class="icon-btn" data-action="edit-actor" title="Edit actor">✎</button>
          <button class="icon-btn danger-text" data-action="delete-actor" title="Delete actor">×</button>
        `;
      }else if(mode==="player"){
        if(actor.id===activeActorId){
          actions=`
            <button class="icon-btn" data-action="choose-lock" title="Choose locked character">🔒</button>
            <button class="icon-btn" data-action="edit-my-actor" title="Name/password">⚙</button>
          `;
        }else{
          actions=`<button class="icon-btn" data-action="login-actor" title="Log in as this actor">↪</button>`;
        }
      }

      card.innerHTML=`
        <div class="actor-head">
          <div>
            <div class="actor-name">${esc(actor.name)}</div>
            <div class="actor-meta">
              <span>${assigned.length}/${state.settings.maxPerActor} characters</span>
              <span>${actor.lockedRoleId?"🔒 locked":"no locked character"}</span>
              ${actor.passwordHash?`<span>🔑 password</span>`:""}
              ${actor.replacementToken?`<span class="token-badge">★ REPLACEMENT</span>`:""}
            </div>
          </div>
          <div class="actor-actions">${actions}</div>
        </div>
        <div class="actor-slots"></div>
      `;

      const slots=card.querySelector(".actor-slots");
      if(!assigned.length) slots.innerHTML=`<div class="empty-slot">${mode==="viewer"?"No characters":"Drop a character here"}</div>`;
      assigned.forEach(r=>slots.appendChild(roleCard(r,{assigned:true,locked:actor.lockedRoleId===r.id})));

      if(mode!=="viewer") makeDropZone(card,actor.id,"actor");

      if(mode==="host"){
        card.querySelector('[data-action="choose-lock"]').onclick=()=>chooseLockedRole(actor.id,true);
        card.querySelector('[data-action="token"]').onclick=()=>{
          actor.replacementToken=!actor.replacementToken;saveState();render();
          toast(actor.replacementToken?`Replacement token granted to ${actor.name}.`:`Replacement token removed from ${actor.name}.`);
        };
        card.querySelector('[data-action="edit-actor"]').onclick=()=>openActorDialog(actor);
        card.querySelector('[data-action="delete-actor"]').onclick=()=>deleteActor(actor.id);
      }else if(mode==="player"){
        card.querySelector('[data-action="login-actor"]')?.addEventListener("click",()=>beginLogin(actor.id));
        card.querySelector('[data-action="choose-lock"]')?.addEventListener("click",()=>chooseLockedRole(actor.id,true));
        card.querySelector('[data-action="edit-my-actor"]')?.addEventListener("click",()=>openActorDialog(actor,true));
      }

      grid.appendChild(card);
    });
  }

  function renderGraveyard(deadRoles){
    const gy=$("#graveyard");
    gy.innerHTML="";
    if(!deadRoles.length){
      gy.innerHTML=`<div class="panel empty-slot" style="min-height:130px">The Graveyard is empty. For now.</div>`;
      return;
    }

    deadRoles.slice().sort((a,b)=>(b.deathTime||0)-(a.deathTime||0)).forEach(r=>{
      const card=document.createElement("article");
      card.className="memorial-card";
      card.innerHTML=`
        <div class="memorial-visual death-x">
          ${r.image?`<img src="${esc(r.image)}" alt="" referrerpolicy="no-referrer">`:`<div class="memorial-placeholder">☠</div>`}
        </div>
        <div class="memorial-name">${esc(r.name)}</div>
        <div class="memorial-title">${esc(r.title||"No title")}</div>
        <div class="last-actor">Last voiced by: <strong>${esc(r.lastActorName||"None")}</strong></div>
        ${r.modifier?`<div class="role-detail">${esc(r.modifier)}</div>`:""}
        ${mode==="host"?`
          <div class="role-actions">
            <button type="button" data-revive="${r.id}">↩ Revive</button>
            <button type="button" data-edit-dead="${r.id}">✎ Edit</button>
          </div>`:""}
      `;
      if(mode==="host"){
        card.querySelector(`[data-revive="${r.id}"]`).onclick=()=>reviveRole(r.id);
        card.querySelector(`[data-edit-dead="${r.id}"]`).onclick=()=>openRoleDialog(r);
      }
      gy.appendChild(card);
    });
  }

  function makeDropZone(el,newOwnerId,zone){
    if(mode==="viewer") return;
    el.ondragover=e=>{
      e.preventDefault();e.dataTransfer.dropEffect="move";el.classList.add("dragover");
    };
    el.ondragleave=e=>{
      if(!el.contains(e.relatedTarget))el.classList.remove("dragover");
    };
    el.ondrop=async e=>{
      e.preventDefault();el.classList.remove("dragover");
      const roleId=e.dataTransfer.getData("text/plain");
      if(roleId) await moveRole(roleId,newOwnerId,zone);
    };
  }

  function moveDenied(text){toast(text);return false}

  async function moveRole(roleId,newOwnerId,zone){
    const r=roleById(roleId);
    if(!r||r.dead||r.ownerId===newOwnerId) return;

    const oldOwnerId=r.ownerId;
    const oldActor=oldOwnerId?actorById(oldOwnerId):null;
    const newActor=newOwnerId?actorById(newOwnerId):null;
    const sourceLocked=!!oldActor&&oldActor.lockedRoleId===r.id;

    if(mode==="player"){
      const me=activeActor();
      if(!me) return moveDenied("Log in to your actor first.");

      // Player cannot move a role to somebody other than themselves.
      if(newOwnerId && newOwnerId!==me.id) return moveDenied("Only the host can assign a character directly to another actor.");

      // Releasing own role to Library is always allowed.
      if(oldOwnerId===me.id && newOwnerId===null){
        // allowed
      }
      // Taking from Library to self is always allowed.
      else if(!oldOwnerId && newOwnerId===me.id){
        // allowed
      }
      // Taking from another actor to self.
      else if(oldOwnerId && oldOwnerId!==me.id && newOwnerId===me.id){
        if(sourceLocked) return moveDenied("That character is locked and cannot be claimed.");
        if(state.settings.gameActive && !me.replacementToken){
          return moveDenied("The game is in progress: you can only claim from the Open Library.");
        }
        // Outside live play, unlocked stealing is allowed.
        // During live play, replacement token is required and consumed below.
      }
      else{
        return moveDenied("Only the host can make that move.");
      }
    }

    if(newActor){
      const count=rolesForActor(newOwnerId).length;
      if(count>=state.settings.maxPerActor){
        return moveDenied(`${newActor.name} already has the maximum number of characters.`);
      }
    }

    const removedLocked=!!oldActor&&oldActor.lockedRoleId===r.id;

    // A hidden spoiler becomes public the moment host places it in Open Library or on an actor.
    if(mode==="host" && r.hiddenSpoiler && !r.revealed && zone!=="spoiler"){
      r.revealed=true;
    }

    // Players cannot intentionally move revealed roles back into the host-only spoiler vault.
    if(zone==="spoiler" && mode!=="host") return;

    r.ownerId=newOwnerId;

    if(removedLocked){
      oldActor.lockedRoleId=null;
    }

    let consumedReplacement=false;
    if(mode==="player" && oldOwnerId && oldOwnerId!==activeActorId && newOwnerId===activeActorId && state.settings.gameActive){
      const me=activeActor();
      if(me.replacementToken){
        me.replacementToken=false;
        consumedReplacement=true;
      }
    }

    saveState();
    render();

    // Releasing a locked role normally asks for a replacement lock among remaining own roles.
    if(removedLocked && oldActor && !r.dead){
      await chooseLockedRole(oldActor.id,false);
    }

    // If the target has no locked role, keep asking on each newly received role until one is accepted.
    if(newActor && !newActor.lockedRoleId){
      const mayAsk = mode==="host" || (mode==="player" && newActor.id===activeActorId);
      if(mayAsk){
        const lockIt=await askLockNewRole(newActor,r);
        if(lockIt){
          newActor.lockedRoleId=r.id;
          saveState();render();
        }
      }
    }

    if(consumedReplacement) toast("Replacement token used.");
  }

  function askLockNewRole(actor,r){
    return new Promise(resolve=>{
      confirmResolver=resolve;
      $("#confirmTitle").textContent="Lock this character?";
      $("#confirmText").innerHTML=`<strong>${esc(actor.name)}</strong> does not have a locked character.<br>Do you want to lock <strong>${esc(r.name)}</strong>?`;
      $("#confirmDialog").showModal();
    });
  }

  $("#confirmForm").addEventListener("submit",e=>{
    e.preventDefault();$("#confirmDialog").close();
    const resolve=confirmResolver;confirmResolver=null;if(resolve)resolve(true);
  });
  $("#confirmNoBtn").onclick=()=>{
    $("#confirmDialog").close();
    const resolve=confirmResolver;confirmResolver=null;if(resolve)resolve(false);
  };

  function askRoleChoice(actor,roles,allowNone=true){
    return new Promise(resolve=>{
      choiceResolver=resolve;
      $("#choiceTitle").textContent=`Locked character for ${actor.name}`;
      $("#choiceText").textContent=roles.length
        ?"Choose which of this actor’s current characters should be locked."
        :"There are no other characters to lock right now.";
      const opts=$("#choiceOptions");opts.innerHTML="";

      roles.forEach((r,i)=>{
        const row=document.createElement("label");row.className="choice-row";
        row.innerHTML=`
          <input type="radio" name="locked-choice" value="${r.id}" ${i===0?"checked":""}>
          <div><strong>${esc(r.name)}</strong><span>${esc(r.title||"No title")}</span></div>
        `;
        opts.appendChild(row);
      });

      if(allowNone){
        const row=document.createElement("label");row.className="choice-row";
        row.innerHTML=`
          <input type="radio" name="locked-choice" value="" ${roles.length?"":"checked"}>
          <div><strong>None for now</strong><span>You will be asked again when a new character is assigned.</span></div>
        `;
        opts.appendChild(row);
      }

      $("#choiceDialog").showModal();
    });
  }

  $("#choiceForm").addEventListener("submit",e=>{
    e.preventDefault();
    const selected=document.querySelector('input[name="locked-choice"]:checked');
    $("#choiceDialog").close();
    const resolve=choiceResolver;choiceResolver=null;
    if(resolve)resolve(selected?.value||null);
  });

  async function chooseLockedRole(actorId,manual){
    const actor=actorById(actorId);
    if(!actor)return;

    if(mode==="player"&&actorId!==activeActorId){
      return moveDenied("You can only choose the locked character for your own actor.");
    }

    const roles=rolesForActor(actorId).filter(currentRoleVisible);
    if(!roles.length){
      actor.lockedRoleId=null;saveState();render();
      if(manual)toast("There are no characters to lock.");
      return;
    }

    const selectedId=await askRoleChoice(actor,roles,true);
    actor.lockedRoleId=selectedId;
    saveState();render();
  }

  async function killRole(roleId){
    if(mode!=="host")return;
    const r=roleById(roleId);
    if(!r||r.dead)return;
    const approved=await appConfirm({
      kicker:"DEATH CONFIRMATION",
      title:`Mark ${r.name} as dead?`,
      text:`The character will be removed from the active cast and moved to the <strong>Memorial / Graveyard</strong>.`,
      confirmText:"☠ Mark dead",
      danger:true
    });
    if(!approved)return;

    const ownerId=r.ownerId;
    const owner=ownerId?actorById(ownerId):null;
    const wasLocked=!!owner&&owner.lockedRoleId===r.id;

    r.dead=true;
    r.lastActorName=owner?owner.name:"None";
    r.deathTime=Date.now();
    r.ownerId=null;
    if(r.hiddenSpoiler) r.revealed=true; // a dead/revealed spoiler is visible in Memorial
    expanded.delete(r.id);

    if(wasLocked){
      owner.lockedRoleId=null;
      owner.replacementToken=true;
    }

    saveState();render();

    if(wasLocked){
      toast(`${owner.name} fik et replacement token.`);
    }else{
      toast(`${r.name} was moved to the Graveyard.`);
    }
  }

  function reviveRole(roleId){
    if(mode!=="host")return;
    const r=roleById(roleId);if(!r)return;
    r.dead=false;r.ownerId=null;r.deathTime=null;
    saveState();render();toast(`${r.name} is back in the Library.`);
  }

  function revealRole(roleId){
    if(mode!=="host")return;
    const r=roleById(roleId);if(!r)return;
    r.revealed=true;
    saveState();render();toast(`${r.name} has been revealed in the Open Library.`);
  }

  async function deleteRole(roleId){
    if(mode!=="host")return;
    const r=roleById(roleId);if(!r)return;
    const approved=await appConfirm({
      kicker:"DELETE CHARACTER",
      title:`Delete ${r.name}?`,
      text:`This character will be <strong>permanently</strong> deleted from this board.`,
      confirmText:"Delete character",
      danger:true
    });
    if(!approved)return;

    const owner=r.ownerId?actorById(r.ownerId):null;
    const wasLocked=!!owner&&owner.lockedRoleId===r.id;
    if(wasLocked)owner.lockedRoleId=null;
    state.roles=state.roles.filter(x=>x.id!==roleId);
    expanded.delete(roleId);
    saveState();render();
    if(wasLocked)await chooseLockedRole(owner.id,false);
  }

  async function deleteActor(actorId){
    if(mode!=="host")return;
    const actor=actorById(actorId);if(!actor)return;
    const approved=await appConfirm({
      kicker:"DELETE ACTOR",
      title:`Delete ${actor.name}?`,
      text:`This actor’s characters will be returned to the <strong>Open Library</strong>.`,
      confirmText:"Delete actor",
      danger:true
    });
    if(!approved)return;
    state.roles.forEach(r=>{if(r.ownerId===actorId)r.ownerId=null});
    state.actors=state.actors.filter(a=>a.id!==actorId);
    saveState();render();
  }

  async function openActorDialog(actor=null,ownEdit=false){
    if(mode==="viewer")return;
    if(mode==="player"&&actor&&actor.id!==activeActorId)return;

    $("#actorId").value=actor?.id||"";
    $("#actorName").value=actor?.name||"";
    $("#actorPassword").value="";
    $("#actorDialogTitle").textContent=actor?"Edit voice actor":"Add voice actor";
    $("#actorPasswordHelp").textContent=actor?.passwordHash
      ?"Enter a new password to change it. Leave the field blank to keep the current password."
      :"Password is optional. If left blank, this profile can be opened without a password.";
    $("#actorDialog").showModal();
    setTimeout(()=>$("#actorName").focus(),40);
  }

  $("#actorForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const name=$("#actorName").value.trim();
    if(!name)return;
    const actorId=$("#actorId").value;
    const password=$("#actorPassword").value;

    if(actorId){
      const actor=actorById(actorId);if(!actor)return;
      if(mode==="player"&&actor.id!==activeActorId)return;
      actor.name=name;
      if(password)actor.passwordHash=await hashPassword(password);
    }else{
      const newActor={
        id:id(),name,
        passwordHash:password?await hashPassword(password):"",
        lockedRoleId:null,replacementToken:false
      };
      state.actors.push(newActor);
      if(mode==="player"){
        activeActorId=newActor.id;
        sessionStorage.setItem(SESSION_ACTOR_KEY,activeActorId);
      }
    }

    saveState();$("#actorDialog").close();render();
  });

  function openRoleDialog(r=null){
    if(mode!=="host")return;
    $("#roleId").value=r?.id||"";
    $("#roleName").value=r?.name||"";
    $("#roleTitle").value=r?.title||"";
    $("#roleModifier").value=r?.modifier||"";
    $("#roleSpoiler").checked=!!r?.hiddenSpoiler;
    pendingImage=r?.image||"";
    $("#roleImageUrl").value=(pendingImage&&/^https?:/i.test(pendingImage))?pendingImage:"";
    $("#roleDialogTitle").textContent=r?"Edit character":"Add character";
    updateImagePreview();
    $("#roleDialog").showModal();
    setTimeout(()=>$("#roleName").focus(),40);
  }

  function updateImagePreview(){
    const box=$("#roleImagePreview");
    if(pendingImage){
      box.className="image-preview";
      box.innerHTML=`<img src="${esc(pendingImage)}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:contain;border-radius:inherit">`;
    }else{
      box.className="image-preview placeholder";
      box.textContent="No image";
    }
  }

  $("#roleImageUrl").addEventListener("input",e=>{
    const url=e.target.value.trim();
    if(url){pendingImage=url;updateImagePreview()}
  });

  $("#roleImageInput").addEventListener("change",async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      pendingImage=await compressImage(file,560,.8);
      $("#roleImageUrl").value="";
      updateImagePreview();
    }catch(_){alert("The image could not be read.")}
    finally{e.target.value=""}
  });

  $("#removeImageBtn").onclick=()=>{
    pendingImage="";$("#roleImageUrl").value="";updateImagePreview();
  };

  $("#roleForm").addEventListener("submit",e=>{
    e.preventDefault();
    const roleId=$("#roleId").value;
    const name=$("#roleName").value.trim();if(!name)return;
    const hiddenSpoiler=$("#roleSpoiler").checked;
    const values={
      name,
      title:$("#roleTitle").value.trim(),
      modifier:$("#roleModifier").value.trim(),
      image:pendingImage,
      hiddenSpoiler
    };

    if(roleId){
      const r=roleById(roleId);if(!r)return;
      const wasHidden=r.hiddenSpoiler;
      Object.assign(r,values);
      if(hiddenSpoiler&&!wasHidden&&!r.ownerId&&!r.dead)r.revealed=false;
      if(!hiddenSpoiler)r.revealed=true;
    }else{
      state.roles.push({
        id:id(),...values,ownerId:null,dead:false,lastActorName:"",deathTime:null,
        revealed:!hiddenSpoiler
      });
    }

    saveState();$("#roleDialog").close();render();
  });

  function compressImage(file,maxSide,quality){
    return new Promise((resolve,reject)=>{
      const img=new Image(),url=URL.createObjectURL(file);
      img.onload=()=>{
        let {width,height}=img;
        const scale=Math.min(1,maxSide/Math.max(width,height));
        width=Math.max(1,Math.round(width*scale));height=Math.max(1,Math.round(height*scale));
        const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
        canvas.getContext("2d").drawImage(img,0,0,width,height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg",quality));
      };
      img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("image"))};
      img.src=url;
    });
  }

  async function hashPassword(text){
    if(window.crypto?.subtle){
      const data=new TextEncoder().encode(text);
      const hash=await crypto.subtle.digest("SHA-256",data);
      return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");
    }
    // Compatibility fallback for local file preview; not cryptographically secure.
    let h=2166136261;
    for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}
    return "fallback-"+(h>>>0).toString(16);
  }

  async function beginLogin(actorId=null){
    if(mode!=="player")return;
    pendingLoginActorId=null;
    const list=$("#loginActorList");list.innerHTML="";
    state.actors.forEach(actor=>{
      const row=document.createElement("button");
      row.type="button";row.className="login-row";
      row.innerHTML=`<div><strong>${esc(actor.name)}</strong><span>${actor.passwordHash?"🔑 Password required":"No password"}</span></div><span>Select →</span>`;
      row.onclick=()=>selectLoginActor(actor.id);
      list.appendChild(row);
    });
    $("#passwordArea").classList.add("hidden");
    $("#loginPassword").value="";
    $("#loginDialog").showModal();
    if(actorId) selectLoginActor(actorId);
  }

  async function selectLoginActor(actorId){
    const actor=actorById(actorId);if(!actor)return;
    pendingLoginActorId=actorId;
    if(!actor.passwordHash){
      completeLogin(actorId);
      return;
    }
    $("#passwordArea").classList.remove("hidden");
    $("#loginPassword").value="";
    $("#loginPassword").placeholder=`Password for ${actor.name}`;
    setTimeout(()=>$("#loginPassword").focus(),40);
  }

  $("#loginConfirmBtn").onclick=async()=>{
    const actor=actorById(pendingLoginActorId);if(!actor)return;
    const hash=await hashPassword($("#loginPassword").value);
    if(hash!==actor.passwordHash){
      toast("Incorrect password.");
      $("#loginPassword").select();
      return;
    }
    completeLogin(actor.id);
  };

  $("#loginForm").addEventListener("submit",e=>{e.preventDefault();$("#loginConfirmBtn").click()});

  function completeLogin(actorId){
    activeActorId=actorId;
    sessionStorage.setItem(SESSION_ACTOR_KEY,actorId);
    $("#loginDialog").close();
    render();
    toast(`Logged in as ${actorById(actorId)?.name||"actor"}.`);
  }

  function logout(){
    activeActorId=null;
    sessionStorage.removeItem(SESSION_ACTOR_KEY);
    render();
  }

  $("#addActorBtn").onclick=()=>openActorDialog();
  $("#addRoleBtn").onclick=()=>openRoleDialog();

  $("#maxRolesBtn").onclick=()=>{
    const raw=prompt("Maximum characters per voice actor:",state.settings.maxPerActor);
    if(raw===null)return;
    const n=Math.max(1,Math.min(30,parseInt(raw,10)||state.settings.maxPerActor));
    const tooMany=state.actors.filter(a=>rolesForActor(a.id).length>n);
    if(tooMany.length){
      alert(`Cannot set the limit to ${n} because ${tooMany.map(a=>a.name).join(", ")} already have more characters assigned.`);
      return;
    }
    state.settings.maxPerActor=n;saveState();render();
  };

  $("#gameActiveToggle").onchange=e=>{
    state.settings.gameActive=e.target.checked;saveState();render();
    toast(state.settings.gameActive?"Live rules enabled.":"Casting/setup rules enabled.");
  };

  $("#expandAllBtn").onclick=()=>{
    state.roles.filter(r=>!r.dead&&!r.ownerId&&(!r.hiddenSpoiler||r.revealed)).forEach(r=>expanded.add(r.id));
    render();
  };
  $("#collapseAllBtn").onclick=()=>{expanded.clear();render()};

  $("#switchActorBtn").onclick=()=>beginLogin();
  $("#logoutBtn").onclick=logout;

  $$(".tab").forEach(btn=>{
    btn.onclick=()=>{
      $$(".tab").forEach(x=>x.classList.toggle("active",x===btn));
      $("#castingTab").classList.toggle("active",btn.dataset.tab==="casting");
      $("#memorialTab").classList.toggle("active",btn.dataset.tab==="memorial");
    };
  });

  $$("[data-close]").forEach(btn=>{
    btn.onclick=()=>document.getElementById(btn.dataset.close).close();
  });

  function openPreview(targetMode){
    const url=new URL(location.href);
    url.searchParams.set("mode",targetMode);
    window.open(url.href,"_blank","noopener");
  }

  $("#previewPlayerBtn").onclick=()=>openPreview("player");
  $("#previewViewerBtn").onclick=()=>openPreview("viewer");

  async function copyModeLink(targetMode){
    const url=new URL(location.href);
    url.searchParams.set("mode",targetMode);
    try{
      await navigator.clipboard.writeText(url.href);toast(`${targetMode==="player"?"Player":"Viewer"} link copied.`);
    }catch(_){
      prompt("Copy this link:",url.href);
    }
  }
  $("#playerLinkBtn").onclick=()=>copyModeLink("player");
  $("#viewerLinkBtn").onclick=()=>copyModeLink("viewer");

  $("#exportBtn").onclick=()=>{
    const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);
    a.download="danganronpa-cast-state-v4.json";a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  };

  $("#importInput").addEventListener("change",async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      const incoming=normaliseState(JSON.parse(await file.text()));
      if(!Array.isArray(incoming.roles)||!Array.isArray(incoming.actors))throw new Error("format");
      state=incoming;expanded.clear();saveState();render();toast("Board imported.");
    }catch(_){alert("This file does not look like a valid board export.")}
    finally{e.target.value=""}
  });

  // If a player arrives without a selected actor, open the selector automatically.
  render();
  if(mode==="player"&&!activeActorId){
    setTimeout(()=>beginLogin(),120);
  }
})();
