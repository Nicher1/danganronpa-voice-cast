// Island Pet minigames. Each game is drawn on the same 360x420 canvas and reports a score.
// The server decides what a score is worth (see cast_pet_apply), so these only need to be fun.
(function(root){
  'use strict';
  const W=360,H=420,TAU=Math.PI*2,HORIZON=250,GROUND=H-70;
  const EMOJI_FONT='"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  const INFO={
    snack:{seconds:30,controls:'lr',blurb:"Monomi's picnic is falling from the sky. Catch the snacks and dodge the Monokuma balls. Move with the mouse, your finger, the arrow keys or the buttons."},
    memory:{seconds:45,controls:'none',blurb:'Flip the cards and match the island pairs. Fewer misses and a quicker finish earn more. Tap a card, or use the arrow keys and Enter.'},
    bubble:{seconds:30,controls:'none',blurb:'Pop the bubbles before they float away. Gold ones are worth more; leave the Monokuma bubbles alone. Tap them, or steer the aim with the arrow keys and press Enter.'},
    run:{seconds:30,controls:'jump',blurb:'Run along the beach and jump over crabs and Monokuma beach balls. Tap the play area, press Space or use the Jump button.'}
  };
  const rand=(a,b)=>a+Math.random()*(b-a);
  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));

  function palm(ctx,x,y,h,lean){
    ctx.lineCap='round';ctx.strokeStyle='#7a5230';ctx.lineWidth=7;
    ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x+lean/2,y-h/2,x+lean,y-h);ctx.stroke();
    ctx.strokeStyle='#2f9e5b';ctx.lineWidth=5;
    for(const a of [-2.7,-2.1,-1.2,-.5,.1]){
      ctx.beginPath();ctx.moveTo(x+lean,y-h);
      ctx.quadraticCurveTo(x+lean+Math.cos(a)*24,y-h+Math.sin(a)*24-8,x+lean+Math.cos(a)*46,y-h+Math.sin(a)*46+14);ctx.stroke();
    }
  }
  // Jabberwock-style beach: bright sky, sea, sand and a couple of palms.
  function island(ctx,t){
    const sky=ctx.createLinearGradient(0,0,0,HORIZON);sky.addColorStop(0,'#3fb6e0');sky.addColorStop(1,'#c6ecf7');
    ctx.fillStyle=sky;ctx.fillRect(0,0,W,HORIZON);
    ctx.fillStyle='#fff3b0';ctx.beginPath();ctx.arc(296,58,24,0,TAU);ctx.fill();
    ctx.fillStyle='#2c9ec6';ctx.fillRect(0,HORIZON-34,W,34);
    ctx.strokeStyle='rgba(255,255,255,.7)';ctx.lineWidth=2;
    for(let i=0;i<5;i++){const x=((i*80+t*18)%(W+60))-30;ctx.beginPath();ctx.moveTo(x,HORIZON-20+(i%2)*8);ctx.lineTo(x+22,HORIZON-20+(i%2)*8);ctx.stroke();}
    ctx.fillStyle='#f3dca4';ctx.fillRect(0,HORIZON,W,H-HORIZON);
    palm(ctx,34,HORIZON,92,22);palm(ctx,322,HORIZON-4,70,-16);
  }
  function shade(ctx,alpha){ctx.fillStyle=`rgba(12,52,70,${alpha})`;ctx.fillRect(0,0,W,H);}
  function monoBall(ctx,x,y,r){
    ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fillStyle='#f4f4f4';ctx.fill();
    ctx.beginPath();ctx.arc(x,y,r,Math.PI/2,Math.PI*1.5);ctx.closePath();ctx.fillStyle='#1b1b1f';ctx.fill();
    ctx.beginPath();ctx.arc(x+r*.4,y-r*.2,r*.17,0,TAU);ctx.fillStyle='#e0183c';ctx.fill();
    ctx.strokeStyle='#e0183c';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x-r*.5,y+r*.42);ctx.lineTo(x-r*.15,y+r*.55);ctx.lineTo(x+r*.15,y+r*.38);ctx.lineTo(x+r*.5,y+r*.52);ctx.stroke();
    ctx.strokeStyle='#111';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.stroke();
  }
  function emoji(ctx,text,x,y,size,baseline='middle'){
    ctx.font=`${size}px ${EMOJI_FONT}`;ctx.textAlign='center';ctx.textBaseline=baseline;ctx.fillStyle='#000';ctx.fillText(text,x,y);
  }

  const FACTORY={
    // Catch the snacks, dodge the Monokuma balls. Later chapters fall a little faster.
    snack({chapter}){
      const k=Math.max(0,chapter-1),COLORS=['#ff9ec7','#ffd45e','#8be0f5','#b7f0a6'];
      let items=[],basket=W/2,spawn=.3,dir=0;const keys={};
      return {
        score:0,finished:false,
        steer(value){dir=value;},
        key(code,down){
          const name={ArrowLeft:'l',a:'l',ArrowRight:'r',d:'r'}[code];if(!name)return false;
          keys[name]=down;return true;
        },
        pointer(x,y,type){if(type!=='up')basket=clamp(x,36,W-36);},
        update(dt,t){
          basket=clamp(basket+((keys.l||dir<0?-1:0)+(keys.r||dir>0?1:0))*300*dt,36,W-36);
          spawn-=dt;
          if(spawn<=0){
            spawn=Math.max(.32,rand(.5,.75)-k*.03);
            items.push({x:rand(20,W-20),y:-14,v:(120+t*3+rand(0,30))*(1+k*.07),bad:Math.random()<.24+k*.025,color:COLORS[Math.floor(Math.random()*COLORS.length)]});
          }
          for(const item of items)item.y+=item.v*dt;
          const by=H-34;
          items=items.filter(item=>{
            if(item.y>=by-8&&item.y<=by+20&&Math.abs(item.x-basket)<=44){this.score=item.bad?Math.max(0,this.score-2):this.score+1;return false;}
            return item.y<H+20;
          });
        },
        draw(ctx,t){
          island(ctx,t);
          for(const item of items){
            if(item.bad){monoBall(ctx,item.x,item.y,15);continue;}
            ctx.beginPath();ctx.arc(item.x,item.y,13,0,TAU);ctx.fillStyle=item.color;ctx.fill();
            ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.stroke();
          }
          const y=H-34;ctx.fillStyle='#ffe0ee';ctx.strokeStyle='#ff67ac';ctx.lineWidth=4;
          ctx.beginPath();ctx.roundRect(basket-36,y,72,24,8);ctx.fill();ctx.stroke();
          ctx.fillStyle='#ff67ac';ctx.beginPath();ctx.moveTo(basket,y+2);ctx.lineTo(basket-12,y-8);ctx.lineTo(basket-12,y+12);ctx.closePath();ctx.moveTo(basket,y+2);ctx.lineTo(basket+12,y-8);ctx.lineTo(basket+12,y+12);ctx.closePath();ctx.fill();
        }
      };
    },

    // Match eight island pairs. Misses cost a point, finishing early adds a bonus.
    memory({seconds}){
      const FACES=['🍍','🥥','🐚','🌺','🦀','🍧','⭐','🎀'],COLS=4,CW=78,CH=84,GAP=8,X0=12,Y0=52;
      const cards=FACES.concat(FACES).map(face=>({face,r:Math.random()})).sort((a,b)=>a.r-b.r).map(card=>card.face);
      const matched=cards.map(()=>false);
      let up=[],lock=0,pairs=0,misses=0,now=0,doneAt=0,cursor=0,kb=false;
      const flip=i=>{
        if(lock>0||matched[i]||up.includes(i))return;
        up.push(i);
        if(up.length===2){
          if(cards[up[0]]===cards[up[1]]){
            matched[up[0]]=matched[up[1]]=true;pairs++;up=[];
            if(pairs===FACES.length){doneAt=now;game.finished=true;}
          }else{misses++;lock=.7;}
        }
      };
      const cell=i=>[X0+(i%COLS)*(CW+GAP),Y0+Math.floor(i/COLS)*(CH+GAP)];
      const game={
        finished:false,
        get score(){return clamp(pairs*4-misses,0,32)+(game.finished?Math.min(8,Math.floor((seconds-doneAt)/4)):0);},
        key(code,down){
          if(!down)return ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(code);
          const move={ArrowLeft:-1,ArrowRight:1,ArrowUp:-COLS,ArrowDown:COLS}[code];
          if(move){kb=true;const next=cursor+move;if(next>=0&&next<cards.length&&!(Math.abs(move)===1&&Math.floor(next/COLS)!==Math.floor(cursor/COLS)))cursor=next;return true;}
          if(code==='Enter'||code===' '){kb=true;flip(cursor);return true;}
          return false;
        },
        pointer(x,y,type){
          if(type!=='down')return;
          for(let i=0;i<cards.length;i++){const [cx,cy]=cell(i);if(x>=cx&&x<=cx+CW&&y>=cy&&y<=cy+CH){cursor=i;kb=false;flip(i);return;}}
        },
        update(dt,t){now=t;if(lock>0){lock-=dt;if(lock<=0)up=[];}},
        draw(ctx,t){
          island(ctx,t);shade(ctx,.62);
          ctx.fillStyle='#fff';ctx.font='bold 15px sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';
          ctx.fillText(`Pairs ${pairs}/${FACES.length}`,14,26);ctx.textAlign='right';ctx.fillText(`Misses ${misses}`,W-14,26);
          for(let i=0;i<cards.length;i++){
            const [x,y]=cell(i),open=matched[i]||up.includes(i);
            ctx.globalAlpha=matched[i]?.5:1;
            ctx.beginPath();ctx.roundRect(x,y,CW,CH,12);
            if(open){ctx.fillStyle='#fff';ctx.fill();emoji(ctx,cards[i],x+CW/2,y+CH/2+2,38);}
            else{
              ctx.save();ctx.clip();ctx.fillStyle='#ff9ec7';ctx.fillRect(x,y,CW,CH);
              ctx.fillStyle='#1b1b1f';ctx.beginPath();ctx.moveTo(x+CW,y);ctx.lineTo(x+CW,y+CH);ctx.lineTo(x,y+CH);ctx.closePath();ctx.fill();ctx.restore();
              ctx.fillStyle='#fff';ctx.font='bold 30px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('?',x+CW/2,y+CH/2+2);
            }
            ctx.globalAlpha=1;ctx.lineWidth=3;ctx.strokeStyle=kb&&i===cursor?'#ffd45e':'rgba(255,255,255,.8)';
            ctx.beginPath();ctx.roundRect(x,y,CW,CH,12);ctx.stroke();
          }
        }
      };
      return game;
    },

    // Pop the bubbles. Gold is worth three, a Monokuma bubble costs two.
    bubble({chapter}){
      const k=Math.max(0,chapter-3),COLORS=['#ff9ec7','#8be0f5','#b7f0a6','#ffe08a'];
      let bubbles=[],pops=[],spawn=.2,ax=W/2,ay=H/2,kb=false;const keys={};
      return {
        score:0,finished:false,
        key(code,down){
          const name={ArrowLeft:'l',ArrowRight:'r',ArrowUp:'u',ArrowDown:'d'}[code];
          if(name){keys[name]=down;if(down)kb=true;return true;}
          if(code==='Enter'||code===' '){if(down){kb=true;this.pointer(ax,ay,'down');}return true;}
          return false;
        },
        pointer(x,y,type){
          if(type!=='down')return;
          for(let i=bubbles.length-1;i>=0;i--){
            const b=bubbles[i];
            if(Math.hypot(b.x-x,b.y-y)<=b.r+8){
              this.score=Math.max(0,this.score+(b.type==='gold'?3:b.type==='bad'?-2:1));
              pops.push({x:b.x,y:b.y,r:b.r,age:0,bad:b.type==='bad'});bubbles.splice(i,1);return;
            }
          }
        },
        update(dt,t){
          ax=clamp(ax+((keys.r?1:0)-(keys.l?1:0))*240*dt,10,W-10);ay=clamp(ay+((keys.d?1:0)-(keys.u?1:0))*240*dt,10,H-10);
          spawn-=dt;
          if(spawn<=0){
            spawn=Math.max(.3,rand(.42,.7)-k*.04);
            const roll=Math.random(),type=roll<.12?'gold':roll<.32+k*.02?'bad':'n';
            bubbles.push({x:rand(34,W-34),y:H+32,r:rand(22,30),vy:rand(65,105)+t*1.2+(type==='gold'?30:0),ph:rand(0,TAU),type,color:COLORS[Math.floor(Math.random()*COLORS.length)]});
          }
          for(const b of bubbles){b.y-=b.vy*dt;b.x+=Math.sin(t*2+b.ph)*18*dt;}
          bubbles=bubbles.filter(b=>b.y>-40);
          for(const p of pops)p.age+=dt;
          pops=pops.filter(p=>p.age<.25);
        },
        draw(ctx,t){
          island(ctx,t);
          for(const b of bubbles){
            ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,TAU);
            ctx.fillStyle=b.type==='gold'?'rgba(255,212,94,.8)':b.type==='bad'?'rgba(27,27,31,.55)':b.color+'aa';ctx.fill();
            ctx.lineWidth=3;ctx.strokeStyle=b.type==='bad'?'#e0183c':'#fff';ctx.stroke();
            if(b.type==='bad')monoBall(ctx,b.x,b.y,b.r*.55);
            else if(b.type==='gold')emoji(ctx,'★',b.x,b.y+1,b.r*1.1);
            else{ctx.fillStyle='rgba(255,255,255,.7)';ctx.beginPath();ctx.arc(b.x-b.r*.35,b.y-b.r*.35,b.r*.2,0,TAU);ctx.fill();}
          }
          for(const p of pops){ctx.strokeStyle=p.bad?'#e0183c':'#fff';ctx.lineWidth=3;ctx.globalAlpha=1-p.age/.25;ctx.beginPath();ctx.arc(p.x,p.y,p.r+p.age*80,0,TAU);ctx.stroke();ctx.globalAlpha=1;}
          if(kb){ctx.strokeStyle='#ff67ac';ctx.lineWidth=3;ctx.beginPath();ctx.arc(ax,ay,16,0,TAU);ctx.moveTo(ax-24,ay);ctx.lineTo(ax+24,ay);ctx.moveTo(ax,ay-24);ctx.lineTo(ax,ay+24);ctx.stroke();}
        }
      };
    },

    // Run along the beach. Hits cost points and give a second of grace, so a round always lasts the full time.
    run({art}){
      const PX=74,GRAV=1500,JUMP=-560;
      let py=GROUND,vy=0,obstacles=[],spawn=.8,grace=0,distance=0;
      const jump=()=>{if(py>=GROUND-.5)vy=JUMP;};
      return {
        score:0,finished:false,
        act:jump,
        key(code,down){if(['ArrowUp',' ','w','Enter'].includes(code)){if(down)jump();return true;}return false;},
        pointer(x,y,type){if(type==='down')jump();},
        update(dt,t){
          const speed=190+t*5;distance+=speed*dt;
          vy+=GRAV*dt;py=Math.min(GROUND,py+vy*dt);if(py>=GROUND)vy=0;
          grace=Math.max(0,grace-dt);spawn-=dt;
          if(spawn<=0){spawn=rand(190,330)/speed;obstacles.push({x:W+24,ball:Math.random()<.4,passed:false});}
          for(const o of obstacles)o.x-=speed*dt;
          for(const o of obstacles){
            const hw=o.ball?15:16,hh=o.ball?30:24;
            if(!o.hit&&grace<=0&&Math.abs(o.x-PX)<hw+12&&py>GROUND-hh-2){o.hit=true;grace=1;this.score=Math.max(0,this.score-3);}
            if(!o.passed&&!o.hit&&o.x<PX-26){o.passed=true;this.score+=2;}
          }
          obstacles=obstacles.filter(o=>o.x>-40&&!o.hit);
        },
        draw(ctx,t){
          island(ctx,t);
          ctx.fillStyle='#d9bd7e';ctx.fillRect(0,GROUND,W,H-GROUND);
          ctx.strokeStyle='rgba(120,90,40,.45)';ctx.lineWidth=3;
          for(let i=0;i<8;i++){const x=((i*60-distance)%(W+60)+W+60)%(W+60)-30;ctx.beginPath();ctx.moveTo(x,GROUND+26+(i%3)*10);ctx.lineTo(x+18,GROUND+26+(i%3)*10);ctx.stroke();}
          for(const o of obstacles){if(o.ball)monoBall(ctx,o.x,GROUND-15,15);else emoji(ctx,'🦀',o.x,GROUND+2,34,'bottom');}
          if(grace>0&&Math.floor(grace*10)%2)return;
          const bob=py>=GROUND?Math.sin(distance/14)*2:0;
          if(art&&art.complete&&art.naturalWidth)ctx.drawImage(art,PX-22,py-58+bob,44,57);
          else{ctx.fillStyle='#ff9ec7';ctx.beginPath();ctx.arc(PX,py-28+bob,26,0,TAU);ctx.fill();}
        }
      };
    }
  };

  function create(id,canvas,{chapter=()=>1,art,seconds,onTick=()=>{},onEnd=()=>{}}={}){
    const info=INFO[id],ctx=canvas.getContext('2d'),total=seconds||info.seconds;
    canvas.width=W;canvas.height=H;
    const image=art?Object.assign(new Image(),{src:art}):null;
    const build=()=>FACTORY[id]({chapter:Math.max(1,Number(chapter())||1),art:image,seconds:total});
    let game=build(),running=false,t=0,last=0,raf=0;
    const pos=event=>{const rect=canvas.getBoundingClientRect();return [(event.clientX-rect.left)/rect.width*W,(event.clientY-rect.top)/rect.height*H];};
    const onPointer=type=>event=>{if(!running)return;const [x,y]=pos(event);game.pointer?.(x,y,type);if(type==='down'&&event.cancelable)event.preventDefault();};
    const onMove=onPointer('move'),onDown=onPointer('down');
    const onKey=down=>event=>{
      if(!running||event.ctrlKey||event.metaKey||event.altKey)return;
      if(game.key?.(event.key,down)&&event.cancelable)event.preventDefault();
    };
    const keyDown=onKey(true),keyUp=onKey(false);
    canvas.addEventListener('pointermove',onMove);canvas.addEventListener('pointerdown',onDown);
    root.addEventListener('keydown',keyDown);root.addEventListener('keyup',keyUp);
    function finish(){running=false;cancelAnimationFrame(raf);game.draw(ctx,t);onEnd(game.score);}
    function frame(now){
      if(!running)return;
      const dt=Math.min(.05,(now-last)/1000);last=now;t+=dt;
      game.update(dt,t);game.draw(ctx,t);onTick(game.score,Math.max(0,total-t));
      if(t>=total||game.finished){finish();return;}
      raf=requestAnimationFrame(frame);
    }
    game.draw(ctx,0);
    return {
      id,seconds:total,controls:info.controls,
      start(){game=build();t=0;running=true;last=performance.now();cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);onTick(0,total);},
      stop(){running=false;cancelAnimationFrame(raf);},
      destroy(){
        running=false;cancelAnimationFrame(raf);
        canvas.removeEventListener('pointermove',onMove);canvas.removeEventListener('pointerdown',onDown);
        root.removeEventListener('keydown',keyDown);root.removeEventListener('keyup',keyUp);
      },
      steer(value){game.steer?.(value);},
      act(){if(running)game.act?.();},
      get running(){return running;}
    };
  }

  root.CastPetGames={INFO,create};
})(window);
