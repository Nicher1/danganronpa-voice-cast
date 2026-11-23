// Front-page countdown to the Danganronpa 2x2 release. Only the public title and date appear, so it is spoiler-free.
(function(root){
  'use strict';
  const TARGET=Date.parse('2027-01-14T00:00:00+01:00'); // midnight in Denmark
  const HIDE_AFTER=Date.parse('2027-01-15T00:00:00+01:00');
  const UNITS=[['days','Days'],['hours','Hours'],['minutes','Minutes'],['seconds','Seconds']];

  function parts(now,target=TARGET){
    const total=Math.max(0,Math.floor((target-now)/1000));
    return {days:Math.floor(total/86400),hours:Math.floor(total%86400/3600),minutes:Math.floor(total%3600/60),seconds:total%60,total};
  }
  function phase(now,target=TARGET,hideAfter=HIDE_AFTER){
    if(now>=hideAfter)return {id:'gone',label:'',line:''};
    if(now>=target)return {id:'released',label:'IT IS HERE',line:'The island is open. Time to start the game.'};
    const left=target-now;
    if(left<=3600e3)return {id:'hour',label:'FINAL HOUR',line:'Get ready. Almost there.'};
    if(left<=86400e3)return {id:'day',label:'FINAL DAY',line:'Tomorrow it begins. Charge everything.'};
    if(left<=7*86400e3)return {id:'week',label:'FINAL WEEK',line:'One week left. The island is almost open.'};
    if(left<=30*86400e3)return {id:'month',label:'LESS THAN A MONTH',line:'The waiting is nearly over.'};
    return {id:'far',label:'COUNTDOWN',line:'A new killing game is on its way.'};
  }
  function spoken(p){
    const bit=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
    return `${bit(p.days,'day')}, ${bit(p.hours,'hour')} and ${bit(p.minutes,'minute')} until Danganronpa 2×2 is released.`;
  }

  const SCENE=`<svg class="cd-scene" viewBox="0 0 800 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
    <circle class="cd-sun" cx="560" cy="150" r="46"/>
    <path class="cd-sea" d="M0 150 Q50 140 100 150 T200 150 T300 150 T400 150 T500 150 T600 150 T700 150 T800 150 V200 H0Z"/>
    <path class="cd-island" d="M0 200 V170 Q60 150 130 162 Q190 140 250 168 Q300 160 340 200Z"/>
    <path class="cd-island" d="M470 200 Q520 176 590 184 Q680 150 760 176 Q790 182 800 200Z"/>
    <g class="cd-palm"><path d="M214 166 Q220 120 206 86" fill="none" stroke-width="5"/><path d="M206 86 Q186 74 164 84 M206 86 Q196 66 176 62 M206 86 Q222 68 246 72 M206 86 Q230 86 244 100"/></g>
    <g class="cd-palm"><path d="M650 184 Q644 140 656 112" fill="none" stroke-width="4"/><path d="M656 112 Q638 102 620 110 M656 112 Q648 94 630 92 M656 112 Q670 96 690 100 M656 112 Q676 112 688 126"/></g>
  </svg>`;

  function build(){
    return `<div class="cd-rays" aria-hidden="true"></div>${SCENE}
      <div class="cd-copy">
        <span class="cd-kicker"><i class="cd-dot"></i><span data-cd-phase>COUNTDOWN</span></span>
        <h2 class="cd-title"><span>DANGANRONPA 2×2</span><em data-text="GOODBYE DESPAIR">GOODBYE DESPAIR</em></h2>
        <p class="cd-line" data-cd-line></p>
        <p class="cd-date">Releases 14 January 2027</p>
      </div>
      <div class="cd-clock" role="timer" aria-label="Time until release">
        ${UNITS.map(([key,label])=>`<div class="cd-unit" data-unit="${key}"><div class="cd-digits"></div><span class="cd-label">${label}</span></div>`).join('<span class="cd-colon" aria-hidden="true">:</span>')}
      </div>
      <p class="cd-sr" role="status"></p>`;
  }

  function mount({root:container,now=()=>Date.now(),target=TARGET}={}){
    if(!container)return null;
    container.innerHTML=build();
    const sr=container.querySelector('.cd-sr'),phaseLabel=container.querySelector('[data-cd-phase]'),line=container.querySelector('[data-cd-line]');
    let lastMinute=-1,timer=null;
    function setDigits(unit,value){
      const box=container.querySelector(`[data-unit="${unit}"] .cd-digits`),text=String(value).padStart(2,'0');
      while(box.children.length<text.length)box.appendChild(Object.assign(document.createElement('b'),{className:'cd-digit'}));
      [...box.children].forEach((digit,index)=>{
        const next=text[index]||'0';
        if(digit.textContent!==next){
          digit.textContent=next;digit.classList.remove('flip');void digit.offsetWidth;digit.classList.add('flip');
        }
      });
    }
    function render(){
      const at=now(),p=parts(at,target),state=phase(at,target,HIDE_AFTER+(target-TARGET));
      container.hidden=state.id==='gone';
      if(container.hidden)return;
      container.dataset.phase=state.id;
      phaseLabel.textContent=state.label;line.textContent=state.line;
      UNITS.forEach(([key])=>setDigits(key,p[key]));
      const unitSeconds=container.querySelector('[data-unit="seconds"]');
      unitSeconds.classList.remove('tick');void unitSeconds.offsetWidth;unitSeconds.classList.add('tick');
      const minute=Math.floor(p.total/60);
      if(minute!==lastMinute){lastMinute=minute;sr.textContent=state.id==='released'?'Danganronpa 2×2 is out now.':spoken(p);}
    }
    function start(){
      render();
      if(!timer)timer=setInterval(()=>{if(!document.hidden)render()},1000);
    }
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)render()});
    start();
    return {render,dispose(){clearInterval(timer);timer=null}};
  }

  const api={TARGET,HIDE_AFTER,parts,phase,spoken,mount};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.CastReleaseCountdown=api;
})(typeof window!=='undefined'?window:globalThis);
