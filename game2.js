'use strict';
const canvas     = document.getElementById('c');
const ctx        = canvas.getContext('2d');
const miniCanvas = document.getElementById('minimap');
const miniCtx    = miniCanvas.getContext('2d');

let player_position_x = 0;
let player_position_y = 0;

const ROOM_COLS  = 4;
const ROOM_ROWS  = 3;
const ROOM_W     = 340;
const ROOM_H     = 260;
const GAP        = 60;      
const WALL_T     = 8;
const DOOR_W     = 50;      
const WORLD_W    = ROOM_COLS*(ROOM_W+GAP)+GAP;
const WORLD_H    = ROOM_ROWS*(ROOM_H+GAP)+GAP;
const TORCH_HALF = Math.PI*0.42;
const TORCH_RANGE= 420;
const TAU        = Math.PI*2;
const clamp  = (v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const lerp   = (a,b,t)=>a+(b-a)*t;
const dist   = (ax,ay,bx,by)=>Math.sqrt((bx-ax)**2+(by-ay)**2);
const angDiff= (a,b)=>{let d=((b-a)%TAU+TAU)%TAU;return d>Math.PI?d-TAU:d;};

const single_global_state_object = {
  running:false, paused:false, gameOver:false, won:false,
  frame:0, score:0, kills:0, credits:0,
  comboCount:0, comboTimer:0,
  rooms:[], walls:[], lockWalls:[],
  currentRoom:null,   
  player:null, bullets:null, particles:[],
  keys:{}, mouse:{x:0,y:0,down:false},
  camX:0, camY:0,
  startTime:0, lastSaveFrame:0,
  shotsTotal:0, shotsHit:0,
  maskCanvas:null, maskCtx:null,
};
const G = single_global_state_object;

function resize(){
  canvas.width=window.innerWidth; canvas.height=window.innerHeight;
  G.maskCanvas=document.createElement('canvas');
  G.maskCanvas.width=canvas.width; G.maskCanvas.height=canvas.height;
  G.maskCtx=G.maskCanvas.getContext('2d');
}
window.addEventListener('resize',resize); resize();

function satRC(rx,ry,rw,rh,cx,cy,cr){
  const nx=Math.max(rx,Math.min(cx,rx+rw)), ny=Math.max(ry,Math.min(cy,ry+rh));
  const dx=cx-nx, dy=cy-ny; return dx*dx+dy*dy<cr*cr;
}
function segHit(ax,ay,bx,by,cx,cy,dx,dy){
  const d1x=bx-ax,d1y=by-ay,d2x=dx-cx,d2y=dy-cy;
  const cr=d1x*d2y-d1y*d2x;
  if(Math.abs(cr)<1e-10)return null;
  const t=((cx-ax)*d2y-(cy-ay)*d2x)/cr;
  const u=((cx-ax)*d1y-(cy-ay)*d1x)/cr;
  if(t>=0&&t<=1&&u>=0&&u<=1)return{t,x:ax+t*d1x,y:ay+t*d1y};
  return null;
}

function roomRect(col,row){
  return{x:GAP+col*(ROOM_W+GAP), y:GAP+row*(ROOM_H+GAP), w:ROOM_W, h:ROOM_H};
}

function getRoomAt(x,y){
  for(const room of G.rooms){
    const r=room.rect;
    if(x>r.x&&x<r.x+r.w&&y>r.y&&y<r.y+r.h) return room;
  }
  return null;
}

function buildWorldWalls(){
  const W=[], T=WALL_T;
  W.push({x:0,y:0,w:WORLD_W,h:T});
  W.push({x:0,y:WORLD_H-T,w:WORLD_W,h:T});
  W.push({x:0,y:0,w:T,h:WORLD_H});
  W.push({x:WORLD_W-T,y:0,w:T,h:WORLD_H});

  for(let row=0;row<ROOM_ROWS;row++){
    for(let col=0;col<ROOM_COLS;col++){
      const r=roomRect(col,row);
      const midX=r.x+r.w/2, midY=r.y+r.h/2, hw=DOOR_W/2;

      if(row>0){
        W.push({x:r.x,        y:r.y, w:midX-r.x-hw,       h:T});
        W.push({x:midX+hw,    y:r.y, w:r.x+r.w-(midX+hw),  h:T});
      } else {
        W.push({x:r.x,y:r.y,w:r.w,h:T});
      }

      if(row<ROOM_ROWS-1){
        W.push({x:r.x,        y:r.y+r.h-T, w:midX-r.x-hw,       h:T});
        W.push({x:midX+hw,    y:r.y+r.h-T, w:r.x+r.w-(midX+hw),  h:T});
      } else {
        W.push({x:r.x,y:r.y+r.h-T,w:r.w,h:T});
      }

      if(col>0){
        W.push({x:r.x, y:r.y,        h:midY-r.y-hw,       w:T});
        W.push({x:r.x, y:midY+hw,    h:r.y+r.h-(midY+hw),  w:T});
      } else {
        W.push({x:r.x,y:r.y,w:T,h:r.h});
      }

      if(col<ROOM_COLS-1){
        W.push({x:r.x+r.w-T, y:r.y,        h:midY-r.y-hw,       w:T});
        W.push({x:r.x+r.w-T, y:midY+hw,    h:r.y+r.h-(midY+hw),  w:T});
      } else {
        W.push({x:r.x+r.w-T,y:r.y,w:T,h:r.h});
      }
    }
  }
  return W;
}

function buildLockWalls(){
  const locks=[];
  const room=G.currentRoom;
  if(!room||room.cleared) return locks;

  const r=room.rect;
  const {col,row: rrow}=room;
  const midX=r.x+r.w/2, midY=r.y+r.h/2, hw=DOOR_W/2;
  const THICK=GAP+WALL_T*2; 
  const tag={isLock:true};

  if(rrow>0)
    locks.push({...tag, x:midX-hw, y:r.y-THICK+WALL_T, w:DOOR_W, h:THICK});
  if(rrow<ROOM_ROWS-1)
    locks.push({...tag, x:midX-hw, y:r.y+r.h-WALL_T, w:DOOR_W, h:THICK});
  if(col>0)
    locks.push({...tag, x:r.x-THICK+WALL_T, y:midY-hw, w:THICK, h:DOOR_W});
  if(col<ROOM_COLS-1)
    locks.push({...tag, x:r.x+r.w-WALL_T, y:midY-hw, w:THICK, h:DOOR_W});

  return locks;
}

function rebuildWalls(){
  const ww=buildWorldWalls();
  G.lockWalls=buildLockWalls();
  G.walls=ww.concat(G.lockWalls);
}

function generateRooms(){
  const rooms=[];
  for(let row=0;row<ROOM_ROWS;row++){
    for(let col=0;col<ROOM_COLS;col++){
      const idx=row*ROOM_COLS+col;
      const diff=Math.min(1,idx/(ROOM_COLS*ROOM_ROWS)*1.6);
      const rect=roomRect(col,row);
      const enemyCount=idx===0?2:2+Math.floor(idx*0.4+Math.random()*2);
      const enemies=[];
      for(let e=0;e<enemyCount;e++){
        let ex,ey,t=0;
        do{
          ex=rect.x+WALL_T*4+Math.random()*(rect.w-WALL_T*8);
          ey=rect.y+WALL_T*4+Math.random()*(rect.h-WALL_T*8);
          t++;
        }while(t<20&&dist(ex,ey,rect.x+rect.w*0.1,rect.y+rect.h/2)<50);
        enemies.push(mkEnemy(idx===0&&e<2?'patrol':pickType(),ex,ey,diff));
      }
      const loot=[];
      for(let l=0;l<Math.floor(1+Math.random()*2);l++){
        loot.push({
          x:rect.x+WALL_T*4+Math.random()*(rect.w-WALL_T*8),
          y:rect.y+WALL_T*4+Math.random()*(rect.h-WALL_T*8),
          type:Math.random()<0.5?'credits':'health',
          value:Math.floor(10+Math.random()*30),
          collected:false
        });
      }
      const pu=Math.random()<0.4?{
        x:rect.x+WALL_T*4+Math.random()*(rect.w-WALL_T*8),
        y:rect.y+WALL_T*4+Math.random()*(rect.h-WALL_T*8),
        type:['shield','speed','damage','invis'][Math.floor(Math.random()*4)],
        collected:false
      }:null;
      rooms.push({col,row,idx,rect,enemies,loot,powerupDrop:pu,cleared:idx===0?false:false,visited:false});
    }
  }
  return rooms;
}

function pickType(){
  const types=['patrol','aggro','sniper','dasher','tank','explosive'];
  const w=[5,4,2,2,1,1];
  let r=Math.random()*15;
  for(let i=0;i<types.length;i++){r-=w[i];if(r<0)return types[i];}
  return 'patrol';
}

function mkEnemy(type,x,y,diff=0.5){
  const base={x,y,vx:0,vy:0,type,state:'idle',health:0,maxHealth:0,
    speed:0,detectionRange:0,attackRange:0,fireCooldown:0,fireRate:0,
    angle:Math.random()*TAU,fovAngle:Math.PI/2.5,alertTimer:0,
    patrolTarget:null,patrolTimer:0,dead:false,r:13,
    dashCooldown:0,explodeRadius:0,color:'#f00',credits:0};
  const d=(v,lo,hi)=>clamp(v*(0.7+diff*0.6),lo,hi);
  switch(type){
    case 'patrol':   return{...base,health:d(40,20,80),maxHealth:d(40,20,80),speed:d(1.3,0.9,2.5),detectionRange:d(170,120,290),attackRange:150,fireRate:d(95,60,150),color:'#f84',credits:5};
    case 'aggro':    return{...base,health:d(30,15,60),maxHealth:d(30,15,60),speed:d(2.3,1.5,3.5),detectionRange:d(230,150,360),attackRange:165,fireRate:d(58,35,100),fovAngle:Math.PI*0.7,color:'#f44',credits:8};
    case 'sniper':   return{...base,health:d(25,15,50),maxHealth:d(25,15,50),speed:d(0.5,0.3,1),detectionRange:d(360,200,500),attackRange:400,fireRate:d(200,150,300),fovAngle:Math.PI/5,color:'#8ff',credits:15,r:11};
    case 'dasher':   return{...base,health:d(35,20,60),maxHealth:d(35,20,60),speed:d(1.6,1,2.5),detectionRange:d(190,120,280),attackRange:50,fireRate:d(300,200,400),color:'#f0f',credits:12};
    case 'tank':     return{...base,health:d(130,80,200),maxHealth:d(130,80,200),speed:d(0.8,0.5,1.4),detectionRange:d(150,100,230),attackRange:130,fireRate:d(80,50,120),color:'#fa0',credits:20,r:17};
    case 'explosive':return{...base,health:d(30,20,50),maxHealth:d(30,20,50),speed:d(1.9,1,3),detectionRange:d(170,100,270),attackRange:35,fireRate:9999,explodeRadius:90,color:'#ff4',credits:18};
  }
  return base;
}

function mkPlayer(){
  const s=roomRect(0,0);
  return{x:s.x+s.w*0.15, y:s.y+s.h/2,
    vx:0,vy:0,r:11,angle:0,health:100,maxHealth:100,speed:2.9,
    fireRate:17,fireCooldown:0,reloading:false,reloadTimer:0,ammo:12,maxAmmo:12,
    dead:false,invincible:false,invincibleTimer:0,damageFlash:0,
    powerupSlots:['','',''],powerupTimers:[0,0,0],
    shieldActive:false,speedBoost:1,damageBoost:1,invisible:false};
}

class BNode{constructor(d){this.data=d;this.next=null;this.prev=null;}}
class BList{
  constructor(){this.head=null;this.tail=null;}
  push(d){const n=new BNode(d);if(!this.tail){this.head=this.tail=n;}else{n.prev=this.tail;this.tail.next=n;this.tail=n;}}
  remove(n){if(n.prev)n.prev.next=n.next;else this.head=n.next;if(n.next)n.next.prev=n.prev;else this.tail=n.prev;}
  forEach(fn){let n=this.head;while(n){const nx=n.next;fn(n);n=nx;}}
}

function hasLOS(px,py,tx,ty){
  if(dist(px,py,tx,ty)>TORCH_RANGE+30)return false;
  const minX=Math.min(px,tx),maxX=Math.max(px,tx),minY=Math.min(py,ty),maxY=Math.max(py,ty);
  for(const w of G.walls){
    if(w.x+w.w<minX||w.x>maxX||w.y+w.h<minY||w.y>maxY)continue;
    const ss=[[w.x,w.y,w.x+w.w,w.y],[w.x+w.w,w.y,w.x+w.w,w.y+w.h],[w.x+w.w,w.y+w.h,w.x,w.y+w.h],[w.x,w.y+w.h,w.x,w.y]];
    for(const[x1,y1,x2,y2]of ss){
      const h=segHit(px,py,tx,ty,x1,y1,x2,y2);
      if(h&&h.t>0.02&&h.t<0.98)return false;
    }
  }
  return true;
}
function canSeePlayer(e){
  const p=G.player;
  const d=dist(e.x,e.y,p.x,p.y);
  if(d>e.detectionRange||p.invisible)return false;
  const a=Math.atan2(p.y-e.y,p.x-e.x);
  if(Math.abs(angDiff(e.angle,a))>e.fovAngle)return false;
  const pa=Math.atan2(e.y-p.y,e.x-p.x);
  if(Math.abs(angDiff(p.angle,pa))>TORCH_HALF)return false;
  return hasLOS(e.x,e.y,p.x,p.y);
}

function shoot(x,y,ang,spd,fromPlayer,dmg,bounces,color){
  G.bullets.push({x,y,ang,vx:Math.cos(ang)*spd,vy:Math.sin(ang)*spd,
    fromPlayer,damage:dmg,bouncesLeft:bounces,r:4,dead:false,trail:[],color:color||'#0ff',life:0});
  if(fromPlayer)G.shotsTotal++;
}
function updateBullets(){
  G.bullets.forEach(node=>{
    const b=node.data;
    if(b.dead){G.bullets.remove(node);return;}
    b.life++;
    if(b.life>400){b.dead=true;G.bullets.remove(node);return;}
    b.trail.unshift({x:b.x,y:b.y});
    if(b.trail.length>6)b.trail.pop();
    let nx=b.x+b.vx, ny=b.y+b.vy;
    for(const w of G.walls){
      if(w.x-b.r>Math.max(nx,b.x)+2||w.x+w.w+b.r<Math.min(nx,b.x)-2)continue;
      if(w.y-b.r>Math.max(ny,b.y)+2||w.y+w.h+b.r<Math.min(ny,b.y)-2)continue;
      if(satRC(w.x,w.y,w.w,w.h,nx,ny,b.r)){
        if(b.bouncesLeft<=0){b.dead=true;break;}
        const cx2=clamp(nx,w.x,w.x+w.w),cy2=clamp(ny,w.y,w.y+w.h);
        const dnx=nx-cx2,dny=ny-cy2,len=Math.sqrt(dnx*dnx+dny*dny)||1;
        const nX=dnx/len,nY=dny/len,dot=b.vx*nX+b.vy*nY;
        b.vx-=2*dot*nX;b.vy-=2*dot*nY;
        nx=b.x+b.vx;ny=b.y+b.vy;b.bouncesLeft--;
        pfx(b.x,b.y,2,'#888',2);break;
      }
    }
    b.x=nx;b.y=ny;
    if(!b.fromPlayer&&!b.dead){
      const p=G.player;
      if(!p.dead&&!p.invincible&&dist(b.x,b.y,p.x,p.y)<p.r+b.r){
        b.dead=true;
        if(!p.shieldActive){p.health=Math.max(0,p.health-b.damage);p.damageFlash=15;if(p.health<=0)playerDie();}
        else{p.shieldActive=false;pfx(p.x,p.y,12,'#0ff',3);}
      }
    }
    if(b.fromPlayer&&!b.dead){
      for(const room of G.rooms){
        for(const e of room.enemies){
          if(e.dead||b.dead)continue;
          if(dist(b.x,b.y,e.x,e.y)<e.r+b.r){
            b.dead=true;
            e.health-=b.damage*(G.player.damageBoost||1);
            pfx(b.x,b.y,8,e.color,3);G.shotsHit++;
            if(e.health<=0)killEnemy(e,room);
            else{e.state='chase';e.alertTimer=300;}
          }
        }
      }
    }
    if(b.dead)G.bullets.remove(node);
  });
}

const enemy_manager_singleton_controller_factory={
  update(){G.rooms.forEach(room=>room.enemies.forEach(e=>{if(!e.dead)aiTick(e,room);}));}
};
function aiTick(e,room){
  const p=G.player;if(p.dead)return;
  const dx=p.x-e.x,dy=p.y-e.y,d2=Math.sqrt(dx*dx+dy*dy),pa=Math.atan2(dy,dx);
  const sees=canSeePlayer(e);
  e.fireCooldown=Math.max(0,e.fireCooldown-1);
  switch(e.state){
    case 'idle':case 'patrol':
      patrol(e,room);
      if(sees){e.state='chase';e.alertTimer=300;}
      break;
    case 'chase':
      e.alertTimer--;
      if(e.alertTimer<=0&&!sees){e.state='patrol';break;}
      if(sees){e.alertTimer=300;e.angle=pa;}
      toward(e,p.x,p.y);
      if(d2<e.attackRange)e.state='attack';
      break;
    case 'attack':
      e.alertTimer=200;
      if(sees)e.angle=pa;
      if(d2>e.attackRange*1.6&&!sees){e.state='chase';break;}
      attack(e,p);
      if(e.type==='patrol'||e.type==='aggro')strafe(e,p);
      break;
  }
  if(e.type==='dasher'&&e.state==='attack'){
    e.dashCooldown=Math.max(0,e.dashCooldown-1);
    if(e.dashCooldown<=0&&d2<190){e.vx=Math.cos(pa)*9;e.vy=Math.sin(pa)*9;e.dashCooldown=110;}
  }
  if(e.type==='explosive'&&d2<e.attackRange&&!e.dead){
    killEnemy(e,room);pfx(e.x,e.y,30,'#ff4',5);
    if(dist(e.x,e.y,p.x,p.y)<e.explodeRadius&&!p.invincible&&!p.shieldActive){p.health-=40;p.damageFlash=20;if(p.health<=0)playerDie();}
    return;
  }
  if(e.type==='sniper'&&sees)e.state='attack';
  e.vx*=0.82;e.vy*=0.82;
  let nx=e.x+e.vx,ny=e.y+e.vy;
  for(const w of G.walls){
    if(satRC(w.x,w.y,w.w,w.h,nx,e.y,e.r))nx=e.x;
    if(satRC(w.x,w.y,w.w,w.h,e.x,ny,e.r))ny=e.y;
  }
  e.x=clamp(nx,e.r,WORLD_W-e.r);e.y=clamp(ny,e.r,WORLD_H-e.r);
}
function patrol(e,room){
  e.patrolTimer=Math.max(0,(e.patrolTimer||0)-1);
  if(!e.patrolTarget||e.patrolTimer<=0){
    const r=room.rect;
    e.patrolTarget={x:r.x+WALL_T*4+Math.random()*(r.w-WALL_T*8),y:r.y+WALL_T*4+Math.random()*(r.h-WALL_T*8)};
    e.patrolTimer=130+Math.random()*120;
  }
  const dx=e.patrolTarget.x-e.x,dy=e.patrolTarget.y-e.y,d=Math.sqrt(dx*dx+dy*dy)||1;
  if(d<10){e.patrolTimer=0;return;}
  e.vx+=dx/d*e.speed*0.06;e.vy+=dy/d*e.speed*0.06;e.angle=Math.atan2(dy,dx);
}
function toward(e,tx,ty){const dx=tx-e.x,dy=ty-e.y,d=Math.sqrt(dx*dx+dy*dy)||1;e.vx+=dx/d*e.speed*0.18;e.vy+=dy/d*e.speed*0.18;}
function strafe(e,p){const dx=p.x-e.x,dy=p.y-e.y,d=Math.sqrt(dx*dx+dy*dy)||1,dir=Math.sin(G.frame*0.03+e.x)>0?1:-1;e.vx+=(-dy/d)*e.speed*0.12*dir;e.vy+=(dx/d)*e.speed*0.12*dir;}
function attack(e,p){
  if(e.fireCooldown>0||e.type==='dasher')return;
  const ang=Math.atan2(p.y-e.y,p.x-e.x);
  let sp=0.1,dmg=8,spd=4.2,col=e.color;
  if(e.type==='sniper'){sp=0.02;dmg=25;spd=7;col='#8ff';}
  else if(e.type==='tank'){sp=0.25;dmg=6;spd=3.5;col='#fa0';}
  else if(e.type==='aggro'){sp=0.2;dmg=6;spd=5.2;}
  const shots=e.type==='tank'?3:1;
  for(let i=0;i<shots;i++)shoot(e.x,e.y,ang+(Math.random()-0.5)*sp*2,spd,false,dmg,0,col);
  e.fireCooldown=e.fireRate;
}

function killEnemy(e,room){
  if(e.dead)return;
  e.dead=true;e.state='dead';pfx(e.x,e.y,20,e.color,4);
  G.kills++;G.credits+=e.credits||5;G.comboCount++;G.comboTimer=120;
  G.score+=(e.type==='sniper'?150:e.type==='tank'?200:e.type==='explosive'?120:100)*Math.max(1,G.comboCount);
  updateHUD();showCombo(G.comboCount);
  const allDead=room.enemies.every(en=>en.dead);
  if(allDead){
    room.cleared=true;
    rebuildWalls();
    pfx(room.rect.x+room.rect.w/2,room.rect.y+room.rect.h/2,50,'#0ff',3.5);
    announceRoom('ROOM CLEARED — DOORS OPEN');
    playSound('room');
    checkWin();
  }
}

function playerDie(){G.player.dead=true;G.gameOver=true;pfx(G.player.x,G.player.y,40,'#f00',5);setTimeout(()=>showGO(),1200);}
function playerFire(){
  const p=G.player;
  if(p.reloading||p.ammo<=0||p.dead||p.fireCooldown>0)return;
  const ang=Math.atan2((G.mouse.y+G.camY)-p.y,(G.mouse.x+G.camX)-p.x);
  shoot(p.x,p.y,ang+(Math.random()-0.5)*0.04,7.2,true,15,3,'#0ff');
  p.fireCooldown=p.fireRate;p.ammo--;
  if(p.ammo<=0)startReload(p);
  updateAmmoHUD();playSound('shoot');
}
function startReload(p){p.reloading=true;p.reloadTimer=90;}

const POWERUP_DEFS={
  shield:{icon:'🛡',duration:300},
  speed: {icon:'⚡',duration:400},
  damage:{icon:'💥',duration:350},
  invis: {icon:'👻',duration:250},
};
function activatePowerup(slot){
  const p=G.player,type=p.powerupSlots[slot];
  if(!type||p.powerupTimers[slot]>0)return;
  p.powerupTimers[slot]=POWERUP_DEFS[type].duration;
  switch(type){case 'shield':p.shieldActive=true;break;case 'speed':p.speedBoost=2;break;case 'damage':p.damageBoost=2.5;break;case 'invis':p.invisible=true;break;}
  playSound('powerup');pfx(p.x,p.y,15,'#ff0',3);
}

function pfx(x,y,n,color,spd){
  for(let i=0;i<n;i++){const a=Math.random()*TAU,s=(0.5+Math.random())*spd;G.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1,decay:0.04+Math.random()*0.04,r:2+Math.random()*2.5,color});}
}
function updatePfx(){G.particles=G.particles.filter(p=>{p.x+=p.vx;p.y+=p.vy;p.vx*=0.91;p.vy*=0.91;p.life-=p.decay;return p.life>0;});}

function updateCamera(){
  const p=G.player;
  G.camX=lerp(G.camX,clamp(p.x-canvas.width/2,0,Math.max(0,WORLD_W-canvas.width)),0.1);
  G.camY=lerp(G.camY,clamp(p.y-canvas.height/2,0,Math.max(0,WORLD_H-canvas.height)),0.1);
}

function checkLoot(){
  const p=G.player;
  for(const room of G.rooms){
    for(const l of room.loot){
      if(l.collected||dist(p.x,p.y,l.x,l.y)>=24)continue;
      l.collected=true;
      if(l.type==='credits'){G.credits+=l.value;pfx(l.x,l.y,8,'#0f0',2);}
      else{p.health=Math.min(p.maxHealth,p.health+l.value);pfx(l.x,l.y,8,'#f0f',2);}
      updateHUD();
    }
    const pu=room.powerupDrop;
    if(pu&&!pu.collected&&dist(p.x,p.y,pu.x,pu.y)<24){
      pu.collected=true;
      const sl=p.powerupSlots.indexOf('');
      if(sl>=0){p.powerupSlots[sl]=pu.type;updatePowerupHUD();}
      pfx(pu.x,pu.y,15,'#ff0',3);
    }
  }
}

const ENTRY_MARGIN = DOOR_W * 0.8;

function isDeepInRoom(p, room){
  const r = room.rect;
  return p.x > r.x + ENTRY_MARGIN &&
         p.x < r.x + r.w - ENTRY_MARGIN &&
         p.y > r.y + ENTRY_MARGIN &&
         p.y < r.y + r.h - ENTRY_MARGIN;
}

function updateCurrentRoom(){
  const p = G.player;
  const room = getRoomAt(p.x, p.y);

  if(room && room !== G.currentRoom){
    G.currentRoom = room;
    room.visited = true;
    G.lockWalls = [];
    G.walls = buildWorldWalls();
    updateRoomHUD();
  }

  if(G.currentRoom && !G.currentRoom.cleared && G.lockWalls.length === 0){
    if(isDeepInRoom(p, G.currentRoom)){
      rebuildWalls();
      announceRoom('ROOM LOCKED — KILL ALL ENEMIES');
    }
  }

  if(!room && G.lockWalls.length > 0){
    G.lockWalls = [];
    G.walls = buildWorldWalls();
  }
}
function checkWin(){
  if(G.rooms.every(r=>r.cleared)){G.won=true;G.running=false;setTimeout(()=>showWin(),1000);}
}
function showGO(){
  const el=document.getElementById('overlay');
  el.querySelector('h1').textContent='GAME OVER';
  document.getElementById('overlay-stats').innerHTML=`Kills: ${G.kills} &nbsp;|&nbsp; Score: ${G.score} &nbsp;|&nbsp; Rooms: ${G.rooms.filter(r=>r.cleared).length}/${G.rooms.length}`;
  document.getElementById('btn-start').classList.add('hidden');
  document.getElementById('btn-restart').classList.remove('hidden');
  el.classList.remove('hidden');
}
function showWin(){
  const el=document.getElementById('overlay');
  const elapsed=Math.floor((Date.now()-G.startTime)/1000);
  const acc=G.shotsTotal>0?Math.floor(G.shotsHit/G.shotsTotal*100):0;
  el.querySelector('h1').textContent='VICTORY';
  document.getElementById('overlay-score').textContent=G.score;
  document.getElementById('overlay-score').classList.remove('hidden');
  document.getElementById('overlay-stats').innerHTML=`Kills: ${G.kills} &nbsp;|&nbsp; Acc: ${acc}% &nbsp;|&nbsp; ${elapsed}s &nbsp;|&nbsp; Credits: ${G.credits}`;
  document.getElementById('btn-start').classList.add('hidden');
  document.getElementById('btn-restart').classList.remove('hidden');
  el.classList.remove('hidden');
}

function save_game_state_every_frame(){
  if(G.frame-G.lastSaveFrame<300)return;
  G.lastSaveFrame=G.frame;
  try{localStorage.setItem('dark_save',JSON.stringify({score:G.score,kills:G.kills,credits:G.credits,hp:G.player.health,ts:Date.now()}));}catch(_){}
}
function updateHUD(){
  const p=G.player,pct=p.health/p.maxHealth;
  document.getElementById('hp-val').textContent=Math.ceil(p.health);
  document.getElementById('hp-bar').style.width=Math.max(0,pct*100)+'%';
  document.getElementById('hp-bar').style.background=pct>0.5?'linear-gradient(90deg,#0f0,#0ff)':pct>0.25?'linear-gradient(90deg,#ff0,#fa0)':'linear-gradient(90deg,#f00,#f80)';
  document.getElementById('score-val').textContent=G.score;
  document.getElementById('kills-val').textContent=G.kills;
  document.getElementById('credits-val').textContent=G.credits;
  document.getElementById('room-val').textContent=G.rooms.filter(r=>r.cleared).length+'/'+G.rooms.length;
}
function updateRoomHUD(){document.getElementById('room-val').textContent=G.rooms.filter(r=>r.cleared).length+'/'+G.rooms.length;}
function updateAmmoHUD(){
  const p=G.player,el=document.getElementById('ammo-pips');el.innerHTML='';
  for(let i=0;i<p.maxAmmo;i++){const d=document.createElement('div');d.className='pip'+(i>=p.ammo?' empty':'');el.appendChild(d);}
}
function updatePowerupHUD(){
  const p=G.player;
  for(let i=0;i<3;i++){const t=p.powerupSlots[i];document.getElementById('pu'+i+'-icon').textContent=t?POWERUP_DEFS[t].icon:'—';}
}
function announceRoom(txt){
  const el=document.getElementById('room-announce');el.textContent=txt;el.style.opacity='1';
  setTimeout(()=>el.style.opacity='0',2500);
}
function showCombo(n){
  if(n<2)return;
  const el=document.getElementById('combo-display');el.textContent=n+'× COMBO!';el.style.opacity='1';
  setTimeout(()=>el.style.opacity='0',800);
}
function renderMinimap(){
  const mc=miniCtx,mw=120,mh=90,sx=mw/WORLD_W,sy=mh/WORLD_H;
  mc.fillStyle='rgba(0,5,15,0.95)';mc.fillRect(0,0,mw,mh);
  G.rooms.forEach(room=>{
    const r=room.rect;
    const isCurrent=room===G.currentRoom;
    mc.fillStyle=room.cleared?'rgba(0,80,40,0.8)':room.visited?'rgba(40,10,10,0.8)':'rgba(0,20,50,0.6)';
    mc.fillRect(r.x*sx,r.y*sy,r.w*sx,r.h*sy);
    mc.strokeStyle=isCurrent?'#ff0':room.cleared?'rgba(0,255,100,0.6)':room.visited?'rgba(255,50,50,0.7)':'rgba(0,120,200,0.3)';
    mc.lineWidth=isCurrent?1.5:0.7;
    mc.strokeRect(r.x*sx,r.y*sy,r.w*sx,r.h*sy);
    if(room.visited){
      room.enemies.filter(e=>!e.dead).forEach(e=>{
        mc.fillStyle=e.color;mc.fillRect(e.x*sx-1,e.y*sy-1,2,2);
      });
    }
  });
  
  G.lockWalls.forEach(w=>{mc.fillStyle='rgba(255,40,40,0.5)';mc.fillRect(w.x*sx,w.y*sy,w.w*sx,w.h*sy);});
  
  const p=G.player;
  mc.fillStyle='#0ff';mc.beginPath();mc.arc(p.x*sx,p.y*sy,3,0,TAU);mc.fill();
  mc.strokeStyle='rgba(0,255,255,0.6)';mc.lineWidth=1;
  mc.beginPath();mc.moveTo(p.x*sx,p.y*sy);mc.lineTo((p.x+Math.cos(p.angle)*30)*sx,(p.y+Math.sin(p.angle)*30)*sy);mc.stroke();
}

function drawWorld(){
  const TILE=50;
  ctx.fillStyle='#04080f';ctx.fillRect(0,0,WORLD_W,WORLD_H);

  G.rooms.forEach(room=>{
    const r=room.rect;
    const isCurrent=room===G.currentRoom;
    ctx.fillStyle=room.cleared?'#0b1e18':isCurrent?'hsl(220,30%,9%)':'hsl('+(212+room.idx*4)+',28%,'+(5+room.idx*0.4)+'%)';
    ctx.fillRect(r.x,r.y,r.w,r.h);
    ctx.strokeStyle='rgba(0,200,255,0.035)';ctx.lineWidth=1;ctx.beginPath();
    for(let gx=r.x;gx<=r.x+r.w;gx+=TILE){ctx.moveTo(gx,r.y);ctx.lineTo(gx,r.y+r.h);}
    for(let gy=r.y;gy<=r.y+r.h;gy+=TILE){ctx.moveTo(r.x,gy);ctx.lineTo(r.x+r.w,gy);}
    ctx.stroke();
    room.loot.forEach(l=>{
      if(l.collected)return;
      const pulse=0.7+Math.sin(G.frame*0.09)*0.3,col=l.type==='credits'?'#0f0':'#f0f';
      ctx.shadowBlur=9*pulse;ctx.shadowColor=col;ctx.fillStyle=col;
      ctx.beginPath();ctx.arc(l.x,l.y,6,0,TAU);ctx.fill();ctx.shadowBlur=0;
      ctx.fillStyle='#fff';ctx.font='7px monospace';ctx.textAlign='center';ctx.fillText(l.type==='credits'?'$':'♥',l.x,l.y+3);
    });
    const pu=room.powerupDrop;
    if(pu&&!pu.collected){
      const p2=0.8+Math.sin(G.frame*0.1)*0.2;
      ctx.shadowBlur=14*p2;ctx.shadowColor='#ff0';
      ctx.fillStyle='rgba(255,220,0,0.15)';ctx.beginPath();ctx.arc(pu.x,pu.y,13,0,TAU);ctx.fill();
      ctx.shadowBlur=0;ctx.font='14px serif';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(POWERUP_DEFS[pu.type].icon,pu.x,pu.y);ctx.textBaseline='alphabetic';
    }
    room.enemies.forEach(e=>{
      if(e.dead)return;
      ctx.shadowBlur=e.state==='attack'?16:6;ctx.shadowColor=e.color;
      ctx.fillStyle=e.color;ctx.beginPath();ctx.arc(e.x,e.y,e.r,0,TAU);ctx.fill();ctx.shadowBlur=0;
      ctx.fillStyle='rgba(0,0,0,0.7)';
      ctx.beginPath();ctx.arc(e.x+Math.cos(e.angle)*e.r*0.55,e.y+Math.sin(e.angle)*e.r*0.55,e.r*0.3,0,TAU);ctx.fill();
      if(e.health<e.maxHealth){
        const bw=e.r*2.4,bh=3,bx=e.x-bw/2,by=e.y-e.r-7;
        ctx.fillStyle='#200';ctx.fillRect(bx,by,bw,bh);
        const pct=Math.max(0,e.health/e.maxHealth);
        ctx.fillStyle=pct>0.5?'#0f0':pct>0.25?'#ff0':'#f00';ctx.fillRect(bx,by,bw*pct,bh);
      }
      if(e.state==='chase'||e.state==='attack'){ctx.fillStyle='#ff0';ctx.font='bold 11px monospace';ctx.textAlign='center';ctx.fillText('!',e.x,e.y-e.r-6);}
    });
  });

  ctx.fillStyle='rgba(0,110,170,0.75)';
  G.walls.filter(w=>!w.isLock).forEach(w=>ctx.fillRect(w.x,w.y,w.w,w.h));
  ctx.strokeStyle='rgba(0,220,255,0.28)';ctx.lineWidth=1;
  G.walls.filter(w=>!w.isLock).forEach(w=>ctx.strokeRect(w.x,w.y,w.w,w.h));

  if(G.lockWalls.length){
    const fa=0.55+Math.sin(G.frame*0.22)*0.3;
    ctx.fillStyle=`rgba(200,10,10,${fa*0.55})`;
    G.lockWalls.forEach(w=>ctx.fillRect(w.x,w.y,w.w,w.h));
    ctx.strokeStyle=`rgba(255,60,60,${fa})`;ctx.lineWidth=2.5;
    G.lockWalls.forEach(w=>ctx.strokeRect(w.x,w.y,w.w,w.h));
    ctx.strokeStyle=`rgba(255,180,180,${fa*0.45})`;ctx.lineWidth=1;
    G.lockWalls.forEach(w=>{
      ctx.beginPath();
      if(w.w>=w.h){ctx.moveTo(w.x,w.y+w.h/2);ctx.lineTo(w.x+w.w,w.y+w.h/2);}
      else{ctx.moveTo(w.x+w.w/2,w.y);ctx.lineTo(w.x+w.w/2,w.y+w.h);}
      ctx.stroke();
    });
  }

  G.particles.forEach(pt=>{ctx.globalAlpha=pt.life;ctx.fillStyle=pt.color;ctx.beginPath();ctx.arc(pt.x,pt.y,pt.r*pt.life,0,TAU);ctx.fill();});
  ctx.globalAlpha=1;

  G.bullets.forEach(node=>{
    const b=node.data;
    b.trail.forEach((t,i)=>{ctx.globalAlpha=(1-i/b.trail.length)*0.45;ctx.fillStyle=b.color;ctx.beginPath();ctx.arc(t.x,t.y,b.r*(1-i/b.trail.length),0,TAU);ctx.fill();});
    ctx.globalAlpha=1;ctx.shadowBlur=10;ctx.shadowColor=b.color;ctx.fillStyle=b.color;ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,TAU);ctx.fill();ctx.shadowBlur=0;
  });

  const p=G.player;
  if(!p.dead){
    if(p.shieldActive){ctx.strokeStyle='rgba(0,255,255,0.7)';ctx.lineWidth=3;ctx.shadowBlur=18;ctx.shadowColor='#0ff';ctx.beginPath();ctx.arc(p.x,p.y,p.r+6,0,TAU);ctx.stroke();ctx.shadowBlur=0;}
    if(p.damageFlash>0)ctx.globalAlpha=0.45+Math.sin(G.frame*0.5)*0.55;
    ctx.shadowBlur=14;ctx.shadowColor='#0ff';ctx.fillStyle='#0ff';
    ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,TAU);ctx.fill();
    const bx=Math.cos(p.angle),by=Math.sin(p.angle);
    ctx.strokeStyle='rgba(0,210,255,0.9)';ctx.lineWidth=5;ctx.shadowBlur=8;ctx.shadowColor='#0ff';
    ctx.beginPath();ctx.moveTo(p.x+bx*p.r,p.y+by*p.r);ctx.lineTo(p.x+bx*(p.r+12),p.y+by*(p.r+12));ctx.stroke();
    ctx.shadowBlur=0;ctx.globalAlpha=1;
    if(p.reloading){const prog=1-(p.reloadTimer/90);ctx.strokeStyle='#ff0';ctx.lineWidth=3;ctx.beginPath();ctx.arc(p.x,p.y,p.r+10,-Math.PI/2,-Math.PI/2+prog*TAU);ctx.stroke();}
  }
}

function render_entities_and_update_state(){
  const p=G.player;
  const sx=p.x-G.camX, sy=p.y-G.camY;

  ctx.save();ctx.translate(-G.camX,-G.camY);drawWorld();ctx.restore();

  const mc=G.maskCtx, mw=canvas.width, mh=canvas.height;
  mc.clearRect(0,0,mw,mh);
  mc.fillStyle='rgba(0,0,0,0.96)';mc.fillRect(0,0,mw,mh);
  mc.save();mc.globalCompositeOperation='destination-out';
  const grad=mc.createRadialGradient(sx,sy,0,sx,sy,TORCH_RANGE);
  grad.addColorStop(0,'rgba(255,255,255,1)');
  grad.addColorStop(0.6,'rgba(255,255,255,0.98)');
  grad.addColorStop(0.88,'rgba(255,255,255,0.38)');
  grad.addColorStop(1,'rgba(255,255,255,0)');
  mc.fillStyle=grad;
  mc.beginPath();mc.moveTo(sx,sy);
  for(let i=0;i<=48;i++){
    const a=(p.angle-TORCH_HALF)+(i/48)*TORCH_HALF*2;
    mc.lineTo(sx+Math.cos(a)*TORCH_RANGE,sy+Math.sin(a)*TORCH_RANGE);
  }
  mc.closePath();mc.fill();
  mc.restore();

  ctx.drawImage(G.maskCanvas,0,0);
}

function main_game_loop(){
  requestAnimationFrame(main_game_loop);
  if(!G.running)return;
  G.frame++;
  ctx.clearRect(0,0,canvas.width,canvas.height);

  if(G.paused){
    ctx.save();ctx.translate(-G.camX,-G.camY);ctx.globalAlpha=0.12;drawWorld();ctx.globalAlpha=1;ctx.restore();
    ctx.fillStyle='rgba(0,0,0,0.7)';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#0ff';ctx.font='bold 32px Orbitron,monospace';ctx.textAlign='center';
    ctx.fillText('PAUSED',canvas.width/2,canvas.height/2);
    ctx.font='14px monospace';ctx.fillStyle='rgba(0,255,255,0.5)';
    ctx.fillText('P to resume',canvas.width/2,canvas.height/2+40);
    return;
  }

  const p=G.player;

  if(!p.dead){
    let mx=0,my=0;
    if(G.keys['w']||G.keys['ArrowUp'])my=-1;
    if(G.keys['s']||G.keys['ArrowDown'])my=1;
    if(G.keys['a']||G.keys['ArrowLeft'])mx=-1;
    if(G.keys['d']||G.keys['ArrowRight'])mx=1;
    if(mx&&my){mx*=0.707;my*=0.707;}
    const spd=p.speed*(p.speedBoost||1);
    p.vx=lerp(p.vx,mx*spd,0.25);p.vy=lerp(p.vy,my*spd,0.25);
    p.angle=Math.atan2((G.mouse.y+G.camY)-p.y,(G.mouse.x+G.camX)-p.x);
    p.fireCooldown=Math.max(0,p.fireCooldown-1);
    if(G.mouse.down)playerFire();

    let nx=p.x+p.vx,ny=p.y+p.vy;
    for(const w of G.walls){
      if(satRC(w.x,w.y,w.w,w.h,nx,p.y,p.r)){nx=p.x;p.vx*=-0.1;}
      if(satRC(w.x,w.y,w.w,w.h,p.x,ny,p.r)){ny=p.y;p.vy*=-0.1;}
    }
    p.x=clamp(nx,p.r,WORLD_W-p.r);p.y=clamp(ny,p.r,WORLD_H-p.r);
    player_position_x=p.x;player_position_y=p.y;

    if(p.reloading){p.reloadTimer--;if(p.reloadTimer<=0){p.reloading=false;p.ammo=p.maxAmmo;updateAmmoHUD();}}
    p.damageFlash=Math.max(0,p.damageFlash-1);
    if(p.invincibleTimer>0){p.invincibleTimer--;p.invincible=p.invincibleTimer>0;}
    for(let i=0;i<3;i++){
      if(p.powerupTimers[i]>0){
        p.powerupTimers[i]--;
        if(p.powerupTimers[i]===0){
          const t=p.powerupSlots[i];
          if(t==='speed')p.speedBoost=1;if(t==='damage')p.damageBoost=1;if(t==='invis')p.invisible=false;
          p.powerupSlots[i]='';updatePowerupHUD();
        }
      }
    }
  }

  if(G.comboTimer>0){G.comboTimer--;if(G.comboTimer===0)G.comboCount=0;}

  updateCurrentRoom();
  enemy_manager_singleton_controller_factory.update();
  updateBullets();updatePfx();checkLoot();updateCamera();
  render_entities_and_update_state();
  if(G.frame%3===0)renderMinimap();
  if(G.frame%12===0)updateHUD();
  save_game_state_every_frame();
}

const audioCtx2=window.AudioContext?new AudioContext():null;
function playSound(type){
  if(!audioCtx2)return;if(audioCtx2.state==='suspended')audioCtx2.resume();
  const o=audioCtx2.createOscillator(),g=audioCtx2.createGain();
  o.connect(g);g.connect(audioCtx2.destination);
  const now=audioCtx2.currentTime;
  const P={shoot:{f:800,d:0.07,v:0.07,t:'square'},hit:{f:180,d:0.13,v:0.1,t:'sawtooth'},die:{f:90,d:0.7,v:0.15,t:'sawtooth'},room:{f:420,d:0.35,v:0.09,t:'sine'},powerup:{f:640,d:0.28,v:0.1,t:'sine'}};
  const s=P[type]||P.shoot;
  o.type=s.t;o.frequency.setValueAtTime(s.f,now);o.frequency.exponentialRampToValueAtTime(s.f*0.3,now+s.d);
  g.gain.setValueAtTime(s.v,now);g.gain.exponentialRampToValueAtTime(0.001,now+s.d);
  o.start(now);o.stop(now+s.d+0.05);
}

window.addEventListener('keydown',e=>{
  G.keys[e.key]=true;
  if((e.key==='p'||e.key==='P'||e.key==='Escape')&&G.running&&!G.gameOver)G.paused=!G.paused;
  if(e.key==='q'||e.key==='Q')activatePowerup(0);
  if(e.key==='e'||e.key==='E')activatePowerup(1);
  if(e.key==='r'||e.key==='R')activatePowerup(2);
  if((e.key==='f'||e.key==='F')&&G.player&&!G.player.reloading&&G.player.ammo<G.player.maxAmmo)startReload(G.player);
  e.preventDefault();
});
window.addEventListener('keyup',e=>{G.keys[e.key]=false;});
canvas.addEventListener('mousemove',e=>{const r=canvas.getBoundingClientRect();G.mouse.x=e.clientX-r.left;G.mouse.y=e.clientY-r.top;});
canvas.addEventListener('mousedown',()=>{G.mouse.down=true;if(audioCtx2&&audioCtx2.state==='suspended')audioCtx2.resume();});
canvas.addEventListener('mouseup',()=>{G.mouse.down=false;});
canvas.addEventListener('contextmenu',e=>e.preventDefault());

function initGame(){
  G.rooms=generateRooms();
  G.currentRoom=G.rooms[0];
  G.rooms[0].visited=true;
  G.player=mkPlayer();
  G.bullets=new BList();
  G.particles=[];
  G.score=0;G.kills=0;G.credits=0;G.comboCount=0;G.comboTimer=0;
  G.frame=0;G.gameOver=false;G.won=false;G.running=true;G.paused=false;
  G.shotsTotal=0;G.shotsHit=0;G.startTime=Date.now();G.camX=0;G.camY=0;
  rebuildWalls();
  player_position_x=G.player.x;player_position_y=G.player.y;
  updateHUD();updateAmmoHUD();updatePowerupHUD();updateRoomHUD();
  announceRoom('SECTOR 1 — ELIMINATE ALL HOSTILES');
}

document.getElementById('btn-start').addEventListener('click',()=>{
  document.getElementById('overlay').classList.add('hidden');initGame();
});
document.getElementById('btn-restart').addEventListener('click',()=>{
  const ol=document.getElementById('overlay');
  ol.querySelector('h1').textContent='DArk';
  document.getElementById('overlay-score').classList.add('hidden');
  document.getElementById('btn-restart').classList.add('hidden');
  document.getElementById('btn-start').classList.remove('hidden');
  ol.classList.add('hidden');initGame();
});

main_game_loop();