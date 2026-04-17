// ══════════════════════════════════════
//  NodeBlast — GAME ENGINE
//  Double jump, goo gun splatter, real physics, large crosshair
// ══════════════════════════════════════

import State from './state.js';
import { getActiveGun, getActiveSlot, setActiveSlot, setProjectileColor,
         getProjectileColor, initGunHUD, resetGuns, GUNS,
         unlockSlot, isSlotUnlocked } from './guns.js';
import { initPlasma, updatePlasma, destroyPlasma } from './plasma.js';
import { initEnemyNodes, updateEnemyNodes, damageEnemyNode,
         checkEnemyHit, destroyEnemyNodes } from './enemy-nodes.js';
import { initNodeBlaster, fireNodeBlaster, updateNodeBlaster,
         destroyNodeBlaster } from './node-blaster.js';
import { initAudio, playShoot, playHit, playJump, playJetpack,
         playFootstep, playGooImpact, playEnemyDeath, playPickup,
         setAudioEnabled, destroyAudio } from './audio.js';

function _tryLoadGLB(path, scene, onSuccess, onFallback) {
  // Always run fallback first so the game works immediately.
  // If GLB loads successfully, onSuccess can replace/enhance the scene.
  onFallback();
  const lastSlash = path.lastIndexOf('/');
  const rootUrl   = path.substring(0, lastSlash + 1);
  const fileName  = path.substring(lastSlash + 1);
  window.BABYLON.SceneLoader.ImportMeshAsync('', rootUrl, fileName, scene)
    .then(result => {
      if (result.meshes && result.meshes.length > 0) {
        onSuccess(result.meshes);
      }
    })
    .catch(() => { /* fallback already ran */ });
}

let _engine=null,_scene=null,_camera=null,_canvas=null,_pointerLocked=false,_resizeHandler=null,_obsHandler=null;
let _playerUsername='player',_playerHex='5aaa72';
let _gunRoot=null,_muzzleOffset=null;
let _jetpackPS=null,_jetpackNode=null;

const WALK_SPEED    = 0.09;
const SPRINT_MULT   = 2.8;   // was 1.85 — noticeably faster
const SPRINT_INERTIA = 0.28; // higher acceleration during sprint for instant feel
const JUMP_FORCE  = 0.28;
const JUMP2_FORCE = 0.22;
const GRAVITY     = 0.006;
const FALL_MULT   = 1.8;
const GROUND_Y    = 1.8;
const AIR_CONTROL = 0.32;
const FRICTION    = 0.76;
const INERTIA     = 0.16;

const JP_FORCE    = 0.012;
const JP_MAX_FUEL = 180;
const JP_MAX_Y    = 11.8;
const JP_RECHARGE = 0.8;

let _velX      = 0;
let _velZ      = 0;
let _velY      = 0;
let _onGround  = true;
let _sprinting = false;
let _jumpHeld  = false;
let _jumpsLeft = 2;
let _jpFuel      = JP_MAX_FUEL;
let _jpActive    = false;
let _jumpGrace   = 0;  // frames since last jump — prevents immediate re-land
const JUMP_GRACE = 6;  // ~100ms at 60fps
const _colBlocks=[];
const _keys={};
const _prevKeys={};
const _gunPickups=[];
let _nearPickup=null;
let _eHeld=false;
let _eHoldTimer=0;
const E_HOLD_TIME=30;
let _keyDownHandler=null,_keyUpHandler=null,_mouseDownHandler=null,_mouseUpHandler=null,_plcHandler=null,_canvasClickHandler=null;
let _mouseHeld=false;
let _lastShot=0;const SHOT_COOLDOWN=220;const _projectiles=[];const _gooSplats=[];
const _remotePlayers=new Map();
const _pendingRemotePlayers=new Map();
let _playerHp=100;
let _playerMaxHp=100;
const _colorNodes=[];
let _damageFlash=0;
let _shakeTimer=0;
let _shakeAmount=0;
let _isDead=false;
let _respawnTimer=0;
const RESPAWN_DELAY=300;
let _footstepTimer=0;
let _fpsFrames=0;
let _fpsLastTime=Date.now();
let _fpsValue=60;
let _lastTickTime=0;
let _delta=1.0;
const TARGET_MS=1000/60;
const MAX_DELTA=2.0;
const MIN_DELTA=0.5;

export function refreshPlayerIdentity(){_playerUsername=State.profile?.displayName||State.user?.displayName||'player';_playerHex=State.profile?.hexCode||'5aaa72';}
export function getPlayerState(){if(!_camera)return null;return{x:_camera.position.x,y:_camera.position.y,z:_camera.position.z,rotY:_camera.rotation.y,pitch:_camera.rotation.x,username:_playerUsername,hex:_playerHex};}

function _createRemotePlayerMeshProc(id,hex,root){
  const B=window.BABYLON;
  const body=B.MeshBuilder.CreateCapsule('rb_'+id,{height:1.8,radius:0.35,tessellation:10},_scene);
  body.parent=root;body.position.y=0.9;
  const r=parseInt(hex.slice(0,2),16)/255,g=parseInt(hex.slice(2,4),16)/255,b=parseInt(hex.slice(4,6),16)/255;
  const mat=new B.StandardMaterial('rm_'+id,_scene);mat.diffuseColor=new B.Color3(r,g,b);mat.emissiveColor=new B.Color3(r*.3,g*.3,b*.3);body.material=mat;
  const ring=B.MeshBuilder.CreateTorus('rg_'+id,{diameter:0.9,thickness:0.06,tessellation:24},_scene);
  ring.parent=root;ring.position.y=0.05;ring.rotation.x=Math.PI/2;
  const rm=new B.StandardMaterial('rgm_'+id,_scene);rm.emissiveColor=new B.Color3(r,g,b);rm.disableLighting=true;ring.material=rm;
  return{body,ring};
}

function _attachPlayerLabel(id,hex,username,root){
  const B=window.BABYLON;
  const LABEL_W=300,LABEL_H=72;
  const labelPlane=B.MeshBuilder.CreatePlane('rl_'+id,{width:2.6,height:0.62},_scene);
  labelPlane.parent=root;labelPlane.position.y=2.5;labelPlane.billboardMode=B.Mesh.BILLBOARDMODE_ALL;
  const lt=new B.DynamicTexture('rlt_'+id,{width:LABEL_W,height:LABEL_H},_scene);
  const ctx=lt.getContext();
  const borderColor='#'+hex;
  const radius=LABEL_H/2;
  ctx.clearRect(0,0,LABEL_W,LABEL_H);
  ctx.beginPath();
  ctx.moveTo(radius,0);ctx.lineTo(LABEL_W-radius,0);
  ctx.arcTo(LABEL_W,0,LABEL_W,LABEL_H,radius);ctx.lineTo(LABEL_W,LABEL_H-radius);
  ctx.arcTo(LABEL_W,LABEL_H,LABEL_W-radius,LABEL_H,radius);ctx.lineTo(radius,LABEL_H);
  ctx.arcTo(0,LABEL_H,0,LABEL_H-radius,radius);ctx.lineTo(0,radius);
  ctx.arcTo(0,0,radius,0,radius);ctx.closePath();
  ctx.fillStyle='rgba(8,8,14,0.82)';ctx.fill();
  ctx.strokeStyle=borderColor;ctx.lineWidth=4;ctx.stroke();
  ctx.fillStyle='#ffffff';ctx.font='bold 28px Outfit,Arial';
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(username,LABEL_W/2,LABEL_H/2);
  lt.update();
  const lm=new B.StandardMaterial('rlm_'+id,_scene);
  lm.diffuseTexture=lt;lm.emissiveTexture=lt;lm.opacityTexture=lt;lm.backFaceCulling=false;lm.disableLighting=true;labelPlane.material=lm;
  return{labelPlane,labelTex:lt};
}

function _attachPlayerHealthBar(id,root){
  const B=window.BABYLON;
  const hbBg=B.MeshBuilder.CreatePlane('rhb_bg_'+id,{width:1.2,height:0.1},_scene);
  hbBg.parent=root;hbBg.position.y=2.75;hbBg.billboardMode=B.Mesh.BILLBOARDMODE_ALL;
  const hbBgM=new B.StandardMaterial('rhbgm_'+id,_scene);hbBgM.diffuseColor=new B.Color3(0.08,0.0,0.0);hbBgM.disableLighting=true;hbBg.material=hbBgM;
  const hbFill=B.MeshBuilder.CreatePlane('rhb_fill_'+id,{width:1.2,height:0.08},_scene);
  hbFill.parent=root;hbFill.position.y=2.75;hbFill.position.z=-0.001;hbFill.billboardMode=B.Mesh.BILLBOARDMODE_ALL;
  const hbFillM=new B.StandardMaterial('rhbfm_'+id,_scene);hbFillM.emissiveColor=new B.Color3(0.9,0.1,0.1);hbFillM.disableLighting=true;hbFill.material=hbFillM;
  return{hbBg,hbFill};
}

function _createRemotePlayerMesh(id,hex,username){
  const B=window.BABYLON;
  const root=new B.TransformNode('rr_'+id,_scene);
  let body=null,ring=null;
  _tryLoadGLB('./games/Arena_1/models/nodeblast_player1.glb',_scene,
    (meshes)=>{
      const r=parseInt(hex.slice(0,2),16)/255,g=parseInt(hex.slice(2,4),16)/255,b=parseInt(hex.slice(4,6),16)/255;
      meshes.forEach(m=>{if(m.name==='__root__')return;m.parent=root;if(m.material)m.material.emissiveColor=new B.Color3(r*0.3,g*0.3,b*0.3);});
    },
    ()=>{const proc=_createRemotePlayerMeshProc(id,hex,root);body=proc.body;ring=proc.ring;}
  );
  const lbl=_attachPlayerLabel(id,hex,username,root);
  const hb=_attachPlayerHealthBar(id,root);
  return{root,body,ring,labelPlane:lbl.labelPlane,labelTex:lbl.labelTex,hbBg:hb.hbBg,hbFill:hb.hbFill};
}

export function addOrUpdateRemotePlayer(id,x,y,z,rotY,username,hex){
  if(!_scene||!_camera){_pendingRemotePlayers.set(id,{x,y,z,rotY,username,hex});return;}
  let p=_remotePlayers.get(id);
  if(!p){
    const safeHex=(hex||'5aaa72').replace('#','');
    const safeName=username||'player';
    const meshes=_createRemotePlayerMesh(id,safeHex,safeName);
    p={...meshes,username:username||'player',hex:(hex||'5aaa72').replace('#',''),targetX:x,targetY:y-GROUND_Y,targetZ:z,renderX:x,renderY:0,renderZ:z,targetRotY:rotY,renderRotY:rotY,lastUpdate:Date.now(),hp:100,maxHp:100};
    _remotePlayers.set(id,p);
    p.root.setEnabled(true);
    console.log('[game] remote player spawned at:',x.toFixed(1),y.toFixed(1),z.toFixed(1));
  }else{p.targetX=x;p.targetY=y-GROUND_Y;p.targetZ=z;p.targetRotY=rotY;p.lastUpdate=Date.now();if(username)p.username=username;if(hex)p.hex=hex;}
}
export function getRemotePlayerIds(){return Array.from(_remotePlayers.keys());}
export function getRemotePlayerData(id){const p=_remotePlayers.get(id);if(!p)return null;return{username:p.username||null,hex:p.hex||null};}
export function removeRemotePlayer(id){const p=_remotePlayers.get(id);if(!p)return;['labelTex','labelPlane','hbBg','hbFill','ring','body','root'].forEach(k=>{try{p[k]?.dispose();}catch{}});_remotePlayers.delete(id);}

export function damageRemotePlayer(id,damage){
  const B=window.BABYLON;
  const p=_remotePlayers.get(id);
  if(!p)return;
  p.hp=Math.max(0,p.hp-damage);
  const pct=p.hp/p.maxHp;
  if(p.hbFill){p.hbFill.scaling.x=pct;p.hbFill.position.x=-(1-pct)*0.6;}
  if(p.body?.material){
    const origColor=p.body.material.diffuseColor.clone();
    p.body.material.emissiveColor=new B.Color3(1.0,1.0,1.0);
    setTimeout(()=>{if(p.body?.material)p.body.material.emissiveColor=origColor.scale(0.3);},80);
  }
  if(p.hp<=0)_killRemotePlayer(id);
}

function _killRemotePlayer(id){
  const B=window.BABYLON;
  const p=_remotePlayers.get(id);
  if(!p)return;
  const pos=p.root.position.clone();
  const exp=new B.PointLight('rexp_'+id,pos,_scene);
  exp.diffuse=new B.Color3(1.0,0.5,0.0);exp.intensity=4.0;exp.range=10;
  let ei=0;
  const fade=setInterval(()=>{ei++;if(exp.intensity!==undefined)exp.intensity=Math.max(0,4-ei*0.35);if(ei>=12){clearInterval(fade);try{exp.dispose();}catch{}}},16);
  p.root.setEnabled(false);
  p.hp=100;
  setTimeout(()=>{if(_remotePlayers.has(id)){p.root.setEnabled(true);if(p.hbFill){p.hbFill.scaling.x=1;p.hbFill.position.x=0;}}},5200);
}

function _addCol(x,z,w,d,h){_colBlocks.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2,maxY:h});}

function _resolveCollision(nx,nz,cy){
  const PR=0.45;let rx=nx,rz=nz;
  for(const b of _colBlocks){
    if(cy-GROUND_Y>=b.maxY-0.05)continue;
    if(!(rx>b.minX-PR&&rx<b.maxX+PR&&rz>b.minZ-PR&&rz<b.maxZ+PR))continue;
    const pushes=[{a:'x',v:b.minX-PR-rx},{a:'x',v:b.maxX+PR-rx},{a:'z',v:b.minZ-PR-rz},{a:'z',v:b.maxZ+PR-rz}];
    const best=pushes.reduce((a,c)=>Math.abs(c.v)<Math.abs(a.v)?c:a);
    if(best.a==='x')rx+=best.v;else rz+=best.v;
  }
  return{x:rx,z:rz};
}

function _spawnGooSplat(pos,normal,color){
  const B=window.BABYLON;
  if(!normal)normal=new B.Vector3(0,1,0);
  normal=normal.normalize();
  if(!color)color=getProjectileColor();
  const cr=color.r,cg=color.g,cb=color.b;
  const up=B.Vector3.Up();
  const axis=B.Vector3.Cross(up,normal);
  const axisLen=axis.length();
  // Persistent splat disc on surface
  const splatSize=0.4+Math.random()*0.35;
  const disc=B.MeshBuilder.CreateCylinder('goo_splat_'+Date.now(),{diameter:splatSize,height:0.03,tessellation:10},_scene);
  disc.position.set(pos.x+normal.x*0.02,pos.y+normal.y*0.02,pos.z+normal.z*0.02);
  if(axisLen>0.001){disc.rotationQuaternion=B.Quaternion.RotationAxis(axis.normalize(),Math.acos(B.Vector3.Dot(up,normal)));}
  else if(normal.y<0){disc.rotationQuaternion=B.Quaternion.RotationAxis(B.Vector3.Right(),Math.PI);}
  const discMat=new B.StandardMaterial('gs_disc_'+Date.now(),_scene);
  discMat.diffuseColor=new B.Color3(cr*0.4,cg*0.4,cb*0.4);
  discMat.emissiveColor=new B.Color3(cr*0.7,cg*0.7,cb*0.7);
  discMat.specularColor=new B.Color3(0.1,0.1,0.1);
  disc.material=discMat;
  _gooSplats.push({mesh:disc,_vel:null,_gravity:0,_landed:true,_life:600});
  // Exploding blob pieces
  const isMG = getActiveGun().id === 'machinegun';
  const n = isMG ? 3 + Math.floor(Math.random() * 2) : 8 + Math.floor(Math.random() * 5);
  for(let i=0;i<n;i++){
    const size=0.05+Math.random()*0.14;
    const blob=B.MeshBuilder.CreateSphere('goo_blob_'+Date.now()+'_'+i,{diameter:size,segments:4},_scene);
    blob.position.set(pos.x,pos.y+0.05,pos.z);
    const mat=new B.StandardMaterial('goo_bm_'+i+Date.now(),_scene);
    const br=0.7+Math.random()*0.3;
    mat.diffuseColor=new B.Color3(cr*0.5*br,cg*0.5*br,cb*0.5*br);
    mat.emissiveColor=new B.Color3(cr*br,cg*br,cb*br);
    blob.material=mat;
    const outward=normal.scale(0.06+Math.random()*0.10);
    const scatter=new B.Vector3((Math.random()-0.5)*0.16,0.04+Math.random()*0.10,(Math.random()-0.5)*0.16);
    const vel=outward.add(scatter);
    const grav=0.004+Math.random()*0.003;
    _gooSplats.push({mesh:blob,_vel:vel,_gravity:grav,_landed:false,_life:120+Math.floor(Math.random()*80)});
  }
  // Impact flash
  const flash=new B.PointLight('gf_'+Date.now(),pos.clone(),_scene);
  flash.diffuse=new B.Color3(cr,cg,cb);flash.intensity=2.2;flash.range=5;
  let t=0;const fade=setInterval(()=>{t+=0.2;if(flash.intensity!==undefined)flash.intensity=Math.max(0,2.2-t*2.2);if(t>=1){clearInterval(fade);try{flash.dispose();}catch{}}},16);
  if(_gooSplats.length>120){const old=_gooSplats.splice(0,40);old.forEach(s=>{try{s.mesh.dispose();}catch{}});}
  playGooImpact();
}

function _spawnRocketExplosion(pos, color) {
  const B = window.BABYLON;
  const c = color;

  const exp = new B.PointLight('rk_exp_' + Date.now(), pos.clone(), _scene);
  exp.diffuse = new B.Color3(c.r, c.g, c.b);
  exp.intensity = 8.0; exp.range = 20;
  let ei = 0;
  const fade = setInterval(() => {
    ei++;
    if (exp.intensity !== undefined) exp.intensity = Math.max(0, 8.0 - ei * 0.5);
    if (ei >= 16) { clearInterval(fade); try { exp.dispose(); } catch {} }
  }, 16);

  for (let w = 0; w < 3; w++) {
    const ring = B.MeshBuilder.CreateTorus('rk_ring_' + Date.now() + '_' + w, {
      diameter: 0.5, thickness: 0.15, tessellation: 20
    }, _scene);
    ring.position.copyFrom(pos);
    ring.position.y = 0.3 + w * 0.4;
    ring.rotation.x = Math.PI / 2;
    const rm = new B.StandardMaterial('rk_rm_' + Date.now() + '_' + w, _scene);
    rm.emissiveColor = new B.Color3(c.r, c.g, c.b);
    rm.disableLighting = true;
    rm.alpha = 0.9;
    ring.material = rm;
    let rl = 0;
    const expandRate = 0.6 + w * 0.2;
    const ringAnim = setInterval(() => {
      rl++;
      ring.scaling.setAll(1 + rl * expandRate);
      rm.alpha = Math.max(0, 0.9 - rl * 0.04);
      if (rl >= 25) { clearInterval(ringAnim); try { ring.dispose(); } catch {} }
    }, 16);
  }

  const ps = new B.ParticleSystem('rk_ps_' + Date.now(), 250, _scene);
  ps.emitter = pos.clone();
  ps.direction1 = new B.Vector3(-5, 1, -5);
  ps.direction2 = new B.Vector3(5, 8, 5);
  ps.minLifeTime = 0.3; ps.maxLifeTime = 1.5;
  ps.minSize = 0.2; ps.maxSize = 0.9;
  ps.minEmitPower = 8; ps.maxEmitPower = 25;
  ps.updateSpeed = 0.02; ps.emitRate = 600;
  ps.color1 = new B.Color4(c.r, c.g, c.b, 1.0);
  ps.color2 = new B.Color4(1.0, 0.9, 0.3, 0.8);
  ps.colorDead = new B.Color4(0.15, 0.15, 0.15, 0.0);
  ps.targetStopDuration = 0.15;
  ps.start();
  setTimeout(() => { try { ps.dispose(); } catch {} }, 2500);

  for (let d = 0; d < 24; d++) {
    const size = 0.1 + Math.random() * 0.3;
    const chunk = B.MeshBuilder.CreateBox('rk_chunk_' + Date.now() + '_' + d, {
      width: size, height: size * 0.6, depth: size
    }, _scene);
    chunk.position.copyFrom(pos);
    const cm = new B.StandardMaterial('rk_cm_' + Date.now() + '_' + d, _scene);
    const br = 0.6 + Math.random() * 0.4;
    cm.emissiveColor = new B.Color3(c.r * br, c.g * br, c.b * br);
    cm.disableLighting = true;
    chunk.material = cm;
    const angle = (d / 24) * Math.PI * 2 + (Math.random() - 0.5);
    const speed = 0.25 + Math.random() * 0.4;
    const chunkVel = new B.Vector3(
      Math.cos(angle) * speed,
      0.2 + Math.random() * 0.5,
      Math.sin(angle) * speed
    );
    let chunkLife = 80 + Math.floor(Math.random() * 60);
    const chunkTick = setInterval(() => {
      chunkLife--;
      chunkVel.y -= 0.012;
      chunk.position.addInPlace(chunkVel);
      chunk.rotation.x += 0.1;
      chunk.rotation.z += 0.08;
      if (chunk.position.y < 0.05) { chunk.position.y = 0.05; chunkVel.y = 0; chunkVel.scaleInPlace(0.8); }
      if (chunkLife < 30 && cm.alpha !== undefined) cm.alpha = chunkLife / 30;
      if (chunkLife <= 0) { clearInterval(chunkTick); try { chunk.dispose(); } catch {} }
    }, 16);
  }

  const scorch = B.MeshBuilder.CreateCylinder('rk_scorch_' + Date.now(), {
    diameter: 6, height: 0.02, tessellation: 16
  }, _scene);
  scorch.position.set(pos.x, 0.02, pos.z);
  const sm = new B.StandardMaterial('rk_sm_' + Date.now(), _scene);
  sm.emissiveColor = new B.Color3(c.r * 0.3, c.g * 0.3, c.b * 0.3);
  sm.disableLighting = true;
  sm.alpha = 0.6;
  scorch.material = sm;
  let scorchLife = 200;
  const scorchFade = setInterval(() => {
    scorchLife--;
    sm.alpha = (scorchLife / 200) * 0.6;
    if (scorchLife <= 0) { clearInterval(scorchFade); try { scorch.dispose(); } catch {} }
  }, 16);

  _shakeTimer = 15;
  _shakeAmount = 0.015;

  playGooImpact();
}

function _updateGooSplats(){
  const dead=[];
  for(let i=0;i<_gooSplats.length;i++){
    const s=_gooSplats[i];
    s._life--;
    if(s._life<=0){dead.push(i);try{s.mesh.dispose();}catch{};continue;}
    if(!s._landed&&s._vel){
      s._vel.y-=s._gravity;
      s.mesh.position.addInPlace(s._vel);
      if(s.mesh.position.y<=0.04){
        s.mesh.position.y=0.04;
        s._vel.scaleInPlace(0);
        s._landed=true;
        s.mesh.scaling.set(1.4,0.12,1.4);
      }
    } else if(s._landed&&s._life<60&&s.mesh.material){
      s.mesh.material.alpha=s._life/60;
    }
  }
  for(let i=dead.length-1;i>=0;i--)_gooSplats.splice(dead[i],1);
}

function _updateFuelBar() {
  const bar = document.getElementById('play-fuel-bar');
  if (!bar) return;
  const pct = (_jpFuel / JP_MAX_FUEL) * 100;
  bar.style.width = pct + '%';
  if (pct < 25) bar.classList.add('low');
  else          bar.classList.remove('low');
}

function _buildJetpackFX() {
  const B = window.BABYLON;
  _jetpackNode = new B.TransformNode('jp_node', _scene);
  _jetpackPS                 = new B.ParticleSystem('jp_ps', 80, _scene);
  _jetpackPS.emitter         = _jetpackNode;
  _jetpackPS.minEmitBox      = new B.Vector3(-0.15, -0.3, -0.05);
  _jetpackPS.maxEmitBox      = new B.Vector3( 0.15, -0.3,  0.05);
  _jetpackPS.direction1      = new B.Vector3(-0.3, -1, -0.3);
  _jetpackPS.direction2      = new B.Vector3( 0.3, -1,  0.3);
  _jetpackPS.minLifeTime     = 0.18;
  _jetpackPS.maxLifeTime     = 0.45;
  _jetpackPS.minSize         = 0.06;
  _jetpackPS.maxSize         = 0.18;
  _jetpackPS.minEmitPower    = 2;
  _jetpackPS.maxEmitPower    = 5;
  _jetpackPS.updateSpeed     = 0.02;
  _jetpackPS.emitRate        = 0;
  _jetpackPS.color1          = new B.Color4(0.2, 1.0, 0.4, 1.0);
  _jetpackPS.color2          = new B.Color4(0.8, 1.0, 0.8, 0.6);
  _jetpackPS.colorDead       = new B.Color4(1.0, 1.0, 1.0, 0.0);
  _jetpackPS.start();
}

function _updateJetpackParticles(active) {
  if (!_jetpackPS || !_jetpackNode || !_camera) return;
  const B = window.BABYLON;
  const back = _camera.getDirection(B.Vector3.Forward()).negate();
  const up   = _camera.getDirection(B.Vector3.Up());
  _jetpackNode.position = _camera.position
    .add(back.scale(0.2))
    .add(up.scale(-0.5));
  _jetpackPS.emitRate = active ? 60 : 0;
}

function _applyMat(mesh,suffix,r,g,b){
  const B=window.BABYLON;const mat=new B.StandardMaterial('gun_mat_'+suffix,_scene);
  mat.diffuseColor=new B.Color3(r,g,b);mat.emissiveColor=new B.Color3(r*0.15,g*0.15,b*0.15);
  mat.specularColor=new B.Color3(0.3,0.3,0.4);mat.specularPower=64;mesh.material=mat;
}
function _applyColorMat(mesh,suffix,pc){
  const B=window.BABYLON;const mat=new B.StandardMaterial('gun_cmat_'+suffix,_scene);
  mat.diffuseColor=new B.Color3(pc.r*0.3,pc.g*0.3,pc.b*0.3);mat.emissiveColor=new B.Color3(pc.r*0.5,pc.g*0.5,pc.b*0.5);mesh.material=mat;
}
function _applyGlowMat(mesh,suffix,pc){
  const B=window.BABYLON;const mat=new B.StandardMaterial('gun_gmat_'+suffix,_scene);
  mat.emissiveColor=new B.Color3(pc.r,pc.g,pc.b);mat.disableLighting=true;mesh.material=mat;
}

function _buildGun(){
  const B=window.BABYLON;const gun=getActiveGun();
  if(_gunRoot){try{_gunRoot.getChildMeshes().forEach(m=>m.dispose());_gunRoot.dispose();}catch{}_gunRoot=null;}
  _gunRoot=new B.TransformNode('gun_root',_scene);
  const pc=getProjectileColor();
  const gunId=gun.id;
  const path='./games/Arena_1/models/nodeblast_gun_'+gunId+'.glb';
  _tryLoadGLB(path,_scene,
    (meshes)=>{meshes.forEach(m=>{if(m.name==='__root__')return;m.parent=_gunRoot;});console.log('[assets] Gun GLB loaded:',gunId);},
    ()=>{
      switch(gun.id){
        case 'pistol':default:{
          const grip=B.MeshBuilder.CreateBox('gun_grip',{width:0.055,height:0.13,depth:0.09},_scene);grip.parent=_gunRoot;grip.position.set(0,-0.06,0);_applyMat(grip,'grip',0.12,0.12,0.15);
          const barrel=B.MeshBuilder.CreateCylinder('gun_barrel',{diameter:0.045,height:0.22,tessellation:10},_scene);barrel.parent=_gunRoot;barrel.rotation.x=Math.PI/2;barrel.position.set(0,0,0.08);_applyMat(barrel,'barrel',0.15,0.15,0.18);
          const dish=B.MeshBuilder.CreateTorus('gun_dish',{diameter:0.13,thickness:0.018,tessellation:20},_scene);dish.parent=_gunRoot;dish.rotation.x=Math.PI/2;dish.position.set(0,0,0.20);_applyColorMat(dish,'dish',pc);
          for(let i=0;i<4;i++){const s=B.MeshBuilder.CreateBox('gun_spoke_'+i,{width:0.008,height:0.1,depth:0.008},_scene);s.parent=_gunRoot;s.rotation.z=(i/4)*Math.PI*2;s.position.set(Math.cos((i/4)*Math.PI*2)*0.046,Math.sin((i/4)*Math.PI*2)*0.046,0.20);_applyColorMat(s,'spoke'+i,pc);}
          const orb=B.MeshBuilder.CreateSphere('gun_orb',{diameter:0.038,segments:6},_scene);orb.parent=_gunRoot;orb.position.set(0,0,0.20);_applyGlowMat(orb,'orb',pc);
          const cell=B.MeshBuilder.CreateBox('gun_cell',{width:0.025,height:0.06,depth:0.055},_scene);cell.parent=_gunRoot;cell.position.set(0.04,-0.02,0.04);_applyMat(cell,'cell',0.05,0.12,0.06);
          break;}
        case 'machinegun':{
          const body=B.MeshBuilder.CreateBox('gun_body',{width:0.08,height:0.07,depth:0.28},_scene);body.parent=_gunRoot;body.position.set(0,0,0.10);_applyMat(body,'body',0.18,0.18,0.20);
          const rail=B.MeshBuilder.CreateBox('gun_rail',{width:0.015,height:0.015,depth:0.28},_scene);rail.parent=_gunRoot;rail.position.set(0,0.045,0.10);_applyMat(rail,'rail',0.25,0.25,0.28);
          const grip=B.MeshBuilder.CreateBox('gun_grip',{width:0.05,height:0.11,depth:0.06},_scene);grip.parent=_gunRoot;grip.position.set(0,-0.07,-0.02);grip.rotation.x=0.15;_applyMat(grip,'grip',0.12,0.12,0.14);
          const drum=B.MeshBuilder.CreateCylinder('gun_drum',{diameter:0.065,height:0.05,tessellation:10},_scene);drum.parent=_gunRoot;drum.rotation.z=Math.PI/2;drum.position.set(0.07,-0.01,0.06);_applyMat(drum,'drum',0.14,0.14,0.16);
          const muzzle=B.MeshBuilder.CreateCylinder('gun_muzzle',{diameter:0.055,height:0.04,tessellation:8},_scene);muzzle.parent=_gunRoot;muzzle.rotation.x=Math.PI/2;muzzle.position.set(0,0,0.26);_applyMat(muzzle,'muzzle',0.22,0.22,0.24);
          const orb=B.MeshBuilder.CreateSphere('gun_orb',{diameter:0.03,segments:5},_scene);orb.parent=_gunRoot;orb.position.set(0,0,0.285);_applyGlowMat(orb,'orb',pc);
          break;}
        case 'plasma':{
          const body=B.MeshBuilder.CreateCylinder('gun_body',{diameter:0.11,height:0.3,tessellation:6},_scene);body.parent=_gunRoot;body.rotation.x=Math.PI/2;body.position.set(0,0,0.10);_applyMat(body,'body',0.10,0.08,0.18);
          for(let i=0;i<3;i++){const coil=B.MeshBuilder.CreateTorus('gun_coil_'+i,{diameter:0.14,thickness:0.014,tessellation:16},_scene);coil.parent=_gunRoot;coil.rotation.x=Math.PI/2;coil.position.set(0,0,0.0+i*0.09);_applyColorMat(coil,'coil'+i,pc);}
          const muzzle=B.MeshBuilder.CreateCylinder('gun_muzzle',{diameterTop:0.15,diameterBottom:0.08,height:0.06,tessellation:8},_scene);muzzle.parent=_gunRoot;muzzle.rotation.x=Math.PI/2;muzzle.position.set(0,0,0.27);_applyMat(muzzle,'muzzle',0.12,0.10,0.20);
          const orb=B.MeshBuilder.CreateSphere('gun_orb',{diameter:0.05,segments:6},_scene);orb.parent=_gunRoot;orb.position.set(0,0,0.30);_applyGlowMat(orb,'orb',pc);
          const grip=B.MeshBuilder.CreateBox('gun_grip',{width:0.06,height:0.12,depth:0.07},_scene);grip.parent=_gunRoot;grip.position.set(0,-0.09,0.05);_applyMat(grip,'grip',0.10,0.08,0.16);
          break;}
        case 'nodeblaster':{
          // Neutral dark base colors — no red tint
          const body=B.MeshBuilder.CreateSphere('gun_body',{diameter:0.11,segments:5},_scene);body.parent=_gunRoot;body.scaling.z=2.2;body.position.set(0,0,0.08);_applyMat(body,'body',0.12,0.13,0.16);
          for(let i=0;i<3;i++){const fin=B.MeshBuilder.CreateBox('gun_fin_'+i,{width:0.015,height:0.06,depth:0.08},_scene);fin.parent=_gunRoot;const a=(i/3)*Math.PI*2+Math.PI/6;fin.position.set(Math.cos(a)*0.065,Math.sin(a)*0.065,0.08);fin.rotation.z=a;_applyMat(fin,'fin'+i,0.16,0.16,0.20);}
          const tube=B.MeshBuilder.CreateCylinder('gun_tube',{diameter:0.06,height:0.18,tessellation:8},_scene);tube.parent=_gunRoot;tube.rotation.x=Math.PI/2;tube.position.set(0,0,0.20);_applyMat(tube,'tube',0.14,0.14,0.18);
          const grip=B.MeshBuilder.CreateBox('gun_grip',{width:0.05,height:0.10,depth:0.06},_scene);grip.parent=_gunRoot;grip.position.set(0,-0.08,0.03);_applyMat(grip,'grip',0.10,0.10,0.13);
          const orb=B.MeshBuilder.CreateSphere('gun_orb',{diameter:0.04,segments:6},_scene);orb.parent=_gunRoot;orb.position.set(0,0,0.30);_applyGlowMat(orb,'orb',pc);
          break;}
        case 'rocket': {
          // Wide tube body
          const body = B.MeshBuilder.CreateCylinder('gun_body', { diameter: 0.10, height: 0.38, tessellation: 10 }, _scene);
          body.parent = _gunRoot; body.rotation.x = Math.PI / 2; body.position.set(0, 0, 0.12);
          _applyMat(body, 'body', 0.20, 0.14, 0.06);
          // Flared exhaust at back
          const exhaust = B.MeshBuilder.CreateCylinder('gun_exhaust', { diameterTop: 0.06, diameterBottom: 0.14, height: 0.06, tessellation: 10 }, _scene);
          exhaust.parent = _gunRoot; exhaust.rotation.x = Math.PI / 2; exhaust.position.set(0, 0, -0.10);
          _applyMat(exhaust, 'exhaust', 0.18, 0.12, 0.05);
          // Front cone/warhead tip
          const cone = B.MeshBuilder.CreateCylinder('gun_cone', { diameterTop: 0.0, diameterBottom: 0.10, height: 0.10, tessellation: 8 }, _scene);
          cone.parent = _gunRoot; cone.rotation.x = Math.PI / 2; cone.position.set(0, 0, 0.36);
          _applyColorMat(cone, 'cone', pc);
          // Grip
          const grip = B.MeshBuilder.CreateBox('gun_grip', { width: 0.05, height: 0.12, depth: 0.07 }, _scene);
          grip.parent = _gunRoot; grip.position.set(0, -0.09, 0.05);
          _applyMat(grip, 'grip', 0.12, 0.10, 0.06);
          // Sight on top
          const sight = B.MeshBuilder.CreateBox('gun_sight', { width: 0.02, height: 0.04, depth: 0.06 }, _scene);
          sight.parent = _gunRoot; sight.position.set(0, 0.07, 0.10);
          _applyMat(sight, 'sight', 0.15, 0.15, 0.15);
          // Glowing orb at tip
          const orb = B.MeshBuilder.CreateSphere('gun_orb', { diameter: 0.05, segments: 6 }, _scene);
          orb.parent = _gunRoot; orb.position.set(0, 0, 0.38);
          _applyGlowMat(orb, 'orb', pc);
          break;
        }
      }
    }
  );
  const orbLight=new B.PointLight('gun_orb_light',new B.Vector3(0,0,0),_scene);
  orbLight.parent=_gunRoot;orbLight.position=new B.Vector3(0,0,0.20);
  orbLight.diffuse=new B.Color3(pc.r,pc.g,pc.b);orbLight.intensity=0.3;orbLight.range=2.5;
}

function _shoot(){
  const now=Date.now();
  const gun=getActiveGun();
  if(now-_lastShot<gun.cooldown)return;
  if(_projectiles.length>=12)return;
  _lastShot=now;
  playShoot(gun.id);
  if(gun.id==='nodeblaster'){
    const B=window.BABYLON;
    const pc=getProjectileColor();
    const dir=_camera.getDirection(B.Vector3.Forward()).normalize();
    const muz=_muzzleOffset?_muzzleOffset.clone():_camera.position.clone();
    fireNodeBlaster(muz,dir,pc);
    return;
  }
  if (gun.id === 'rocket') {
    const B = window.BABYLON;
    const pc = getProjectileColor();
    const dir = _camera.getDirection(B.Vector3.Forward()).normalize();
    const origin = _muzzleOffset ? _muzzleOffset.clone() : _camera.position.add(dir.scale(0.4));
    _fireRocket(origin, dir, pc);
    return;
  }
  const B=window.BABYLON,dir=_camera.getDirection(B.Vector3.Forward()).normalize();
  const isMG=gun.id==='machinegun';
  if(isMG){
    const spread=0.04;
    dir.x+=(Math.random()-0.5)*spread;
    dir.y+=(Math.random()-0.5)*spread;
    dir.z+=(Math.random()-0.5)*spread;
    dir.normalize();
  }
  const projSize=isMG?0.10:0.22;
  const projSpeed=isMG?2.2:1.6;
  const origin=_muzzleOffset?_muzzleOffset.clone():_camera.position.add(dir.scale(0.4));
  const ball=B.MeshBuilder.CreateSphere('proj_'+now,{diameter:projSize,segments:5},_scene);ball.position.copyFrom(origin);
  const pc=getProjectileColor();
  const mat=new B.StandardMaterial('pm_'+now,_scene);mat.emissiveColor=new B.Color3(pc.r,pc.g,pc.b);mat.alpha=0.88;mat.disableLighting=true;ball.material=mat;
  const flash=new B.PointLight('mf_'+now,origin.clone(),_scene);flash.diffuse=new B.Color3(pc.r,pc.g,pc.b);flash.intensity=3.0;flash.range=7;
  setTimeout(()=>{try{flash.dispose();}catch{}},70);
  const orb=_scene.getMeshByName('gun_orb');
  if(orb&&orb.material){orb.material.emissiveColor=new B.Color3(pc.r*1.2,pc.g*1.2,pc.b*1.2);setTimeout(()=>{if(orb.material)orb.material.emissiveColor=new B.Color3(pc.r,pc.g,pc.b);},80);}
  _projectiles.push({mesh:ball,vel:dir.scale(projSpeed),life:80});
}

function _fireRocket(origin, direction, color) {
  const B = window.BABYLON;
  const rocket = B.MeshBuilder.CreateCylinder('rocket_proj_' + Date.now(), {
    diameterTop: 0.0, diameterBottom: 0.12, height: 0.3, tessellation: 8
  }, _scene);
  rocket.position.copyFrom(origin);
  const axis = B.Vector3.Cross(B.Vector3.Up(), direction).normalize();
  const angle = Math.acos(B.Vector3.Dot(B.Vector3.Up(), direction));
  if (axis.length() > 0.001) {
    rocket.rotationQuaternion = B.Quaternion.RotationAxis(axis, angle);
  }
  const mat = new B.StandardMaterial('rocket_pm_' + Date.now(), _scene);
  mat.emissiveColor = new B.Color3(color.r, color.g, color.b);
  mat.disableLighting = true;
  rocket.material = mat;

  const trail = new B.ParticleSystem('rocket_trail_' + Date.now(), 40, _scene);
  trail.emitter = rocket;
  trail.minLifeTime = 0.1; trail.maxLifeTime = 0.4;
  trail.minSize = 0.04; trail.maxSize = 0.12;
  trail.emitRate = 60;
  trail.minEmitPower = 0.5; trail.maxEmitPower = 1.5;
  trail.direction1 = direction.negate().scale(0.5);
  trail.direction2 = direction.negate().scale(1.0);
  trail.color1 = new B.Color4(color.r, color.g, color.b, 0.8);
  trail.color2 = new B.Color4(1, 0.8, 0.3, 0.4);
  trail.colorDead = new B.Color4(0.2, 0.2, 0.2, 0);
  trail.start();

  const flash = new B.PointLight('rocket_flash_' + Date.now(), origin.clone(), _scene);
  flash.diffuse = new B.Color3(color.r, color.g, color.b);
  flash.intensity = 4.0; flash.range = 8;
  setTimeout(() => { try { flash.dispose(); } catch {} }, 100);

  _projectiles.push({
    mesh: rocket,
    vel: direction.scale(2.0),
    life: 120,
    _isRocket: true,
    _trail: trail,
    _color: color,
  });
}

function _updateProjectiles(){
  const B=window.BABYLON,dead=[];
  for(let i=0;i<_projectiles.length;i++){
    const p=_projectiles[i];p.life--;
    const prev=p.mesh.position.clone();
    p.mesh.position.addInPlace(p.vel.scale(_delta));p.vel.y-=0.006*_delta;
    const px=p.mesh.position.x,py=p.mesh.position.y,pz=p.mesh.position.z;
    let hit=false,hitPos=null,hitBlock=null;
    let hitNormal=new B.Vector3(0,1,0);
    const travel=p.mesh.position.subtract(prev);const tLen=travel.length();
    const steps=Math.max(1,Math.ceil(tLen/0.12));const step=travel.scale(1/steps);
    outer:for(let s=0;s<=steps;s++){
      const sp=prev.add(step.scale(s));const sx=sp.x,sy=sp.y,sz=sp.z;
      for(const b of _colBlocks){const m=0.1;if(sx>b.minX-m&&sx<b.maxX+m&&sz>b.minZ-m&&sz<b.maxZ+m&&sy<b.maxY+m&&sy>-0.5){hit=true;hitPos=sp.clone();hitBlock=b;break outer;}}
      const enemyIdx=checkEnemyHit(sp);
      if(enemyIdx>=0){damageEnemyNode(enemyIdx,20);hit=true;hitPos=sp.clone();break outer;}
      // Remote player hit check
      for(const[rpId,rp] of _remotePlayers){
        if(!rp.root.isEnabled())continue;
        const rdx=sp.x-rp.root.position.x,rdy=sp.y-(rp.root.position.y+GROUND_Y*0.5),rdz=sp.z-rp.root.position.z;
        if(Math.sqrt(rdx*rdx+rdy*rdy+rdz*rdz)<0.7){
          hit=true;hitPos=sp.clone();
          if(window._nbSendDamage)window._nbSendDamage(rpId,20,_playerUsername);
          break outer;
        }
      }
      if(sy<0.08){hit=true;hitPos=new B.Vector3(sx,0,sz);break;}
    }
    if(hit&&hitPos&&hitBlock){
      const cx=hitPos.x,cz=hitPos.z,cy=hitPos.y;
      const dists=[
        {n:new B.Vector3(1,0,0),d:Math.abs(cx-hitBlock.maxX)},
        {n:new B.Vector3(-1,0,0),d:Math.abs(cx-hitBlock.minX)},
        {n:new B.Vector3(0,0,1),d:Math.abs(cz-hitBlock.maxZ)},
        {n:new B.Vector3(0,0,-1),d:Math.abs(cz-hitBlock.minZ)},
        {n:new B.Vector3(0,1,0),d:Math.abs(cy-hitBlock.maxY)},
      ];
      hitNormal=dists.reduce((a,c)=>c.d<a.d?c:a).n;
    }
    if(py<0.12)hitNormal=new B.Vector3(0,1,0);
    if(!hit&&(Math.abs(px)>200||Math.abs(pz)>200)){try{p.mesh.dispose();}catch{}dead.push(i);continue;}
    if (hit || p.life <= 0) {
      if (p._isRocket) {
        if (p._trail) try { p._trail.dispose(); } catch {}
        if (hit && hitPos) _spawnRocketExplosion(hitPos, p._color || getProjectileColor());
        if (hit && hitPos) {
          const ROCKET_RADIUS = 10;
          const ROCKET_DAMAGE = 40;
          if (_camera) {
            const rdx = _camera.position.x - hitPos.x;
            const rdy = _camera.position.y - hitPos.y;
            const rdz = _camera.position.z - hitPos.z;
            if (Math.sqrt(rdx*rdx + rdy*rdy + rdz*rdz) < ROCKET_RADIUS) _onPlayerDamaged(ROCKET_DAMAGE);
          }
          if (window._nbEnemyPositions) {
            window._nbEnemyPositions().forEach(e => {
              const edx = e.pos.x - hitPos.x;
              const edz = e.pos.z - hitPos.z;
              if (Math.sqrt(edx*edx + edz*edz) < ROCKET_RADIUS) damageEnemyNode(e.index, ROCKET_DAMAGE);
            });
          }
          for (const [rpId, rp] of _remotePlayers) {
            if (!rp.root.isEnabled()) continue;
            const rpx = rp.root.position.x - hitPos.x;
            const rpz = rp.root.position.z - hitPos.z;
            if (Math.sqrt(rpx*rpx + rpz*rpz) < ROCKET_RADIUS) {
              if (window._nbSendDamage) window._nbSendDamage(rpId, ROCKET_DAMAGE, _playerUsername);
            }
          }
        }
      } else {
        const pc = getProjectileColor();
        if (hit && hitPos) _spawnGooSplat(hitPos, hitNormal, pc);
      }
      try { p.mesh.dispose(); } catch {}
      dead.push(i);
    }
  }
  for(let i=dead.length-1;i>=0;i--)_projectiles.splice(dead[i],1);
}

function _buildPickupGunModel(gunIndex) {
  const B = window.BABYLON;
  const gun = GUNS[gunIndex];
  const gc = gun.color;
  const root = new B.TransformNode('pickup_gun_model_' + gun.id, _scene);
  root.scaling.setAll(1.4);

  function _mkMat(suffix, r, g, b) {
    const m = new B.StandardMaterial('pgm_' + suffix + '_' + gun.id, _scene);
    m.diffuseColor = new B.Color3(r, g, b);
    m.emissiveColor = new B.Color3(r * 0.15, g * 0.15, b * 0.15);
    return m;
  }
  function _mkGlow(suffix) {
    const m = new B.StandardMaterial('pgg_' + suffix + '_' + gun.id, _scene);
    m.emissiveColor = new B.Color3(gc.r, gc.g, gc.b);
    m.disableLighting = true;
    return m;
  }

  switch (gun.id) {
    case 'rocket': {
      const body = B.MeshBuilder.CreateCylinder('pg_body', { diameter: 0.10, height: 0.38, tessellation: 10 }, _scene);
      body.parent = root; body.rotation.x = Math.PI / 2; body.position.set(0, 0, 0);
      body.material = _mkMat('body', 0.20, 0.14, 0.06);
      const exhaust = B.MeshBuilder.CreateCylinder('pg_exhaust', { diameterTop: 0.06, diameterBottom: 0.14, height: 0.06, tessellation: 10 }, _scene);
      exhaust.parent = root; exhaust.rotation.x = Math.PI / 2; exhaust.position.set(0, 0, -0.22);
      exhaust.material = _mkMat('exhaust', 0.18, 0.12, 0.05);
      const cone = B.MeshBuilder.CreateCylinder('pg_cone', { diameterTop: 0.0, diameterBottom: 0.10, height: 0.10, tessellation: 8 }, _scene);
      cone.parent = root; cone.rotation.x = Math.PI / 2; cone.position.set(0, 0, 0.24);
      cone.material = _mkGlow('cone');
      const orb = B.MeshBuilder.CreateSphere('pg_orb', { diameter: 0.05, segments: 6 }, _scene);
      orb.parent = root; orb.position.set(0, 0, 0.26);
      orb.material = _mkGlow('orb');
      break;
    }
    case 'pistol': {
      const barrel = B.MeshBuilder.CreateCylinder('pg_barrel', { diameter: 0.045, height: 0.22, tessellation: 10 }, _scene);
      barrel.parent = root; barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0, 0);
      barrel.material = _mkMat('barrel', 0.15, 0.15, 0.18);
      const orb = B.MeshBuilder.CreateSphere('pg_orb', { diameter: 0.038, segments: 6 }, _scene);
      orb.parent = root; orb.position.set(0, 0, 0.12);
      orb.material = _mkGlow('orb');
      break;
    }
    case 'machinegun': {
      const body = B.MeshBuilder.CreateBox('pg_body', { width: 0.08, height: 0.07, depth: 0.28 }, _scene);
      body.parent = root; body.position.set(0, 0, 0);
      body.material = _mkMat('body', 0.18, 0.18, 0.20);
      const orb = B.MeshBuilder.CreateSphere('pg_orb', { diameter: 0.03, segments: 5 }, _scene);
      orb.parent = root; orb.position.set(0, 0, 0.16);
      orb.material = _mkGlow('orb');
      break;
    }
    case 'plasma': {
      const body = B.MeshBuilder.CreateCylinder('pg_body', { diameter: 0.11, height: 0.3, tessellation: 6 }, _scene);
      body.parent = root; body.rotation.x = Math.PI / 2; body.position.set(0, 0, 0);
      body.material = _mkMat('body', 0.10, 0.08, 0.18);
      const orb = B.MeshBuilder.CreateSphere('pg_orb', { diameter: 0.05, segments: 6 }, _scene);
      orb.parent = root; orb.position.set(0, 0, 0.18);
      orb.material = _mkGlow('orb');
      break;
    }
    case 'nodeblaster': {
      const body = B.MeshBuilder.CreateSphere('pg_body', { diameter: 0.11, segments: 5 }, _scene);
      body.parent = root; body.scaling.z = 2.2; body.position.set(0, 0, 0);
      body.material = _mkMat('body', 0.12, 0.13, 0.16);
      const orb = B.MeshBuilder.CreateSphere('pg_orb', { diameter: 0.04, segments: 6 }, _scene);
      orb.parent = root; orb.position.set(0, 0, 0.18);
      orb.material = _mkGlow('orb');
      break;
    }
  }
  return root;
}

function _buildGunPickups() {
  const B = window.BABYLON;
  const PICKUP_POS = { x: 55, z: -55 };
  const TABLE_BASE_Y = 4.0; // sits on top of fortress upper platform
  const TABLE_W = 1.2, TABLE_D = 1.2, TABLE_H = 0.8;
  const LEG_W = 0.12, LEG_D = 0.12;
  const gc = GUNS[4].color;

  const tableTop = B.MeshBuilder.CreateBox('pickup_table_top', {
    width: TABLE_W, height: 0.08, depth: TABLE_D
  }, _scene);
  tableTop.position.set(PICKUP_POS.x, TABLE_BASE_Y + TABLE_H, PICKUP_POS.z);
  const ttMat = new B.StandardMaterial('pickup_tt_mat', _scene);
  ttMat.diffuseColor = new B.Color3(0.12, 0.14, 0.12);
  ttMat.emissiveColor = new B.Color3(0.02, 0.06, 0.03);
  tableTop.material = ttMat;

  for (let li = 0; li < 4; li++) {
    const lx = PICKUP_POS.x + (li % 2 === 0 ? -1 : 1) * (TABLE_W / 2 - LEG_W);
    const lz = PICKUP_POS.z + (li < 2 ? -1 : 1) * (TABLE_D / 2 - LEG_D);
    const leg = B.MeshBuilder.CreateBox('pickup_leg_' + li, {
      width: LEG_W, height: TABLE_H, depth: LEG_D
    }, _scene);
    leg.position.set(lx, TABLE_BASE_Y + TABLE_H / 2, lz);
    leg.material = ttMat;
  }

  const glowRing = B.MeshBuilder.CreateTorus('pickup_glow_ring', {
    diameter: 0.8, thickness: 0.03, tessellation: 20
  }, _scene);
  glowRing.position.set(PICKUP_POS.x, TABLE_BASE_Y + TABLE_H + 0.06, PICKUP_POS.z);
  glowRing.rotation.x = Math.PI / 2;
  const grMat = new B.StandardMaterial('pickup_gr_mat', _scene);
  grMat.emissiveColor = new B.Color3(gc.r, gc.g, gc.b);
  grMat.disableLighting = true;
  grMat.alpha = 0.6;
  glowRing.material = grMat;

  const pt = new B.PointLight('pickup_pt',
    new B.Vector3(PICKUP_POS.x, TABLE_BASE_Y + TABLE_H + 1.5, PICKUP_POS.z), _scene);
  pt.diffuse = new B.Color3(gc.r, gc.g, gc.b);
  pt.intensity = 1.0; pt.range = 6;

  const gunModel = _buildPickupGunModel(4);
  gunModel.position.set(PICKUP_POS.x, TABLE_BASE_Y + TABLE_H + 0.6, PICKUP_POS.z);

  _gunPickups.push({
    tableTop, glowRing, pt, gunModel,
    pos: new B.Vector3(PICKUP_POS.x, TABLE_BASE_Y + TABLE_H + 0.6, PICKUP_POS.z),
    slot: 4,
    _currentGunId: 'rocket',
  });
}

function _updateHealthHUD() {
  const bar = document.getElementById('play-health-bar');
  const num = document.getElementById('play-health-num');
  if (bar) {
    const pct = (_playerHp / _playerMaxHp) * 100;
    bar.style.width = pct + '%';
    bar.classList.toggle('critical', pct < 30);
  }
  if (num) num.textContent = Math.ceil(_playerHp);
  const vignette = document.getElementById('play-vignette');
  if (vignette) {
    const pct = _playerHp / _playerMaxHp;
    if (pct < 0.3) {
      vignette.style.opacity = String(0.3 + (1 - pct) * 0.4);
      vignette.classList.add('pulse');
    } else {
      vignette.classList.remove('pulse');
      vignette.style.opacity = '0';
    }
  }
}

function _onPlayerDamaged(damage) {
  if (_isDead) return;
  _playerHp = Math.max(0, _playerHp - damage);
  _updateHealthHUD();
  playHit();
  _damageFlash = 12;
  const vignette = document.getElementById('play-vignette');
  if (vignette) {
    vignette.style.opacity = '0.65';
    vignette.classList.add('hit');
  }
  _shakeTimer  = 10;
  _shakeAmount = damage * 0.001;
  if (_playerHp <= 0) _onPlayerDeath();
}

function _onPlayerDeath() {
  _isDead       = true;
  _respawnTimer = 0;
  _velX = 0; _velZ = 0; _velY = 0;
  const screen = document.getElementById('play-death-screen');
  if (screen) screen.classList.add('visible');
  try { document.exitPointerLock(); } catch {}
}

function _respawn() {
  _isDead       = false;
  _playerHp     = _playerMaxHp;
  _respawnTimer = 0;
  const screen = document.getElementById('play-death-screen');
  if (screen) screen.classList.remove('visible');
  if (window._nbSetSpawn) {
    const spawnZ = (window._nbMyActorId % 2 === 1) ? -48 : 48;
    window._nbSetSpawn((Math.random() - 0.5) * 6, spawnZ);
  } else {
    _camera.position.set(0, GROUND_Y, -48);
  }
  _updateHealthHUD();
  setTimeout(() => {
    const canvas = document.getElementById('play-canvas');
    if (canvas) canvas.requestPointerLock().catch(() => {});
  }, 200);
}

function _physicsTick() {
  if (!_camera || !_scene) return;
  const B = window.BABYLON;

  // Delta time — keeps physics speed consistent across all frame rates
  const _now = performance.now();
  _delta = _lastTickTime
    ? Math.max(MIN_DELTA, Math.min(MAX_DELTA, (_now - _lastTickTime) / TARGET_MS))
    : 1.0;
  _lastTickTime = _now;

  // Flush pending remote players now that scene is ready
  if (_pendingRemotePlayers.size > 0) {
    _pendingRemotePlayers.forEach((data, id) => {
      addOrUpdateRemotePlayer(id, data.x, data.y, data.z, data.rotY, data.username, data.hex);
    });
    _pendingRemotePlayers.clear();
  }

  // Damage flash decay
  if (_damageFlash > 0) {
    _damageFlash--;
    if (_damageFlash === 0) {
      const vignette = document.getElementById('play-vignette');
      if (vignette) {
        vignette.classList.remove('hit');
        _updateHealthHUD();
      }
    }
  }

  // Camera shake
  if (_shakeTimer > 0) {
    _shakeTimer--;
    const shakeX = (Math.random() - 0.5) * _shakeAmount;
    const shakeY = (Math.random() - 0.5) * _shakeAmount;
    _camera.position.x += shakeX;
    _camera.position.y += shakeY;
    _shakeAmount *= 0.85;
  }

  // Respawn countdown
  if (_isDead) {
    _respawnTimer++;
    const remaining = Math.ceil((RESPAWN_DELAY - _respawnTimer) / 60);
    const countEl = document.getElementById('play-death-count');
    if (countEl) countEl.textContent = remaining > 0 ? remaining : '...';
    if (_respawnTimer >= RESPAWN_DELAY) _respawn();
    return;
  }

  const forward = _keys['KeyW']    || _keys['ArrowUp'];
  const back    = _keys['KeyS']    || _keys['ArrowDown'];
  const left    = _keys['KeyA']    || _keys['ArrowLeft'];
  const right   = _keys['KeyD']    || _keys['ArrowRight'];
  const jumping = _keys['Space'];

  const fwd = _camera.getDirection(B.Vector3.Forward()); fwd.y = 0; fwd.normalize();
  const rgt = _camera.getDirection(B.Vector3.Right());   rgt.y = 0; rgt.normalize();

  let mx = 0, mz = 0;
  if (forward) { mx += fwd.x; mz += fwd.z; }
  if (back)    { mx -= fwd.x; mz -= fwd.z; }
  if (right)   { mx += rgt.x; mz += rgt.z; }
  if (left)    { mx -= rgt.x; mz -= rgt.z; }

  const ml = Math.sqrt(mx*mx + mz*mz);
  if (ml > 0) { mx /= ml; mz /= ml; }

  _sprinting = (_keys['ShiftLeft'] || _keys['ShiftRight']) && _jpFuel > 0;
  const spd  = WALK_SPEED * (_sprinting ? SPRINT_MULT : 1);
  const ctrl = _onGround ? 1.0 : AIR_CONTROL;
  const accel = _sprinting ? SPRINT_INERTIA : INERTIA;

  _velX += ((mx * spd) - _velX) * accel * ctrl * _delta;
  _velZ += ((mz * spd) - _velZ) * accel * ctrl * _delta;
  if (ml === 0 && _onGround) { const fd = Math.pow(FRICTION, _delta); _velX *= fd; _velZ *= fd; }

  _velY -= GRAVITY * (_velY < 0 ? FALL_MULT : 1.0) * _delta;

  if (jumping && !_jumpHeld && _jumpsLeft > 0) {
    playJump();
    _velY      = _jumpsLeft === 2 ? JUMP_FORCE : JUMP2_FORCE;
    _jumpsLeft--;
    _jumpHeld  = true;
    _onGround  = false;
    _jpActive  = false;
    _jumpGrace = JUMP_GRACE;
  }
  if (!jumping) _jumpHeld = false;
  if (_jumpGrace > 0) _jumpGrace--;

  const jpFromGround = _onGround && _jumpHeld && _jumpsLeft < 2;
  const jpInAir      = !_onGround && _jumpsLeft === 0;
  const _jpWasActive = _jpActive;
  _jpActive = jumping && _jpFuel > 0 && (jpFromGround || jpInAir);

  if (_jpActive) {
    if (_camera.position.y < JP_MAX_Y) {
      // If just activated from ground, give a strong launch burst
      if (!_jpWasActive && _onGround) {
        _velY = Math.max(_velY, 0.22);  // guaranteed liftoff velocity
      }
      _velY += JP_FORCE * _delta;
      if (_velY < 0) _velY *= 0.7;
    }
    _jpFuel = Math.max(0, _jpFuel - _delta);
    _updateJetpackParticles(true);
  } else {
    _updateJetpackParticles(false);
  }
  playJetpack(_jpActive);

  const SPRINT_FUEL_DRAIN = 0.30; // 180 fuel / 0.30 / 60fps = ~10s to deplete
  if (_sprinting && _onGround && ml > 0) {
    _jpFuel = Math.max(0, _jpFuel - SPRINT_FUEL_DRAIN * _delta);
  } else if ((_onGround || !_jpActive) && _jpFuel < JP_MAX_FUEL) {
    _jpFuel = Math.min(JP_MAX_FUEL, _jpFuel + JP_RECHARGE * _delta);
  }

  _updateFuelBar();

  // Footsteps
  if (_onGround && (ml > 0)) {
    _footstepTimer++;
    const rate = _sprinting ? 10 : 18;
    if (_footstepTimer >= rate) { _footstepTimer = 0; playFootstep(); }
  } else { _footstepTimer = 0; }

  // ── Apply vertical first ──
  _camera.position.y += _velY * _delta;

  // ── Platform top-surface landing ──
  let landed     = false;
  let landHeight = GROUND_Y;

  if (_velY <= 0) {
    for (const b of _colBlocks) {
      const PR = 0.45;
      const cx = _camera.position.x;
      const cz = _camera.position.z;
      if (cx > b.minX - PR && cx < b.maxX + PR &&
          cz > b.minZ - PR && cz < b.maxZ + PR) {
        const feetY     = _camera.position.y - GROUND_Y;
        const prevFeetY = feetY - _velY * _delta;
        if (prevFeetY >= b.maxY - 0.05 && feetY <= b.maxY + 0.25) {
          landHeight = b.maxY + GROUND_Y;
          landed     = true;
          break;
        }
      }
    }
  }

  if (_camera.position.y <= GROUND_Y) {
    landHeight = GROUND_Y;
    landed     = true;
  }

  if (landed && _jumpGrace === 0) {
    _camera.position.y = landHeight;
    _velY              = 0;
    _onGround          = true;
    _jumpsLeft         = 2;
    _jpActive          = false;
  } else if (landed && _jumpGrace > 0) {
    // Grace period — clamp to ground but don't kill jump/jetpack
    _camera.position.y = Math.max(_camera.position.y, landHeight);
  }

  // ── Horizontal collision (after vertical is resolved) ──
  const stepX = _velX * _delta;
  const stepZ = _velZ * _delta;
  const res = _resolveCollision(
    _camera.position.x + stepX,
    _camera.position.z + stepZ,
    _camera.position.y,
  );
  _camera.position.x = res.x;
  _camera.position.z = res.z;

  const BOUND = 118;
  _camera.position.x = Math.max(-BOUND, Math.min(BOUND, _camera.position.x));
  _camera.position.z = Math.max(-BOUND, Math.min(BOUND, _camera.position.z));

  _updateProjectiles();
  _updateGooSplats();

  // Plasma cannon continuous fire + machine gun auto-fire
  const activeGun = getActiveGun();
  if (activeGun.id === 'plasma') {
    updatePlasma(_mouseHeld && _pointerLocked);
  } else {
    updatePlasma(false);
    if (activeGun.id === 'machinegun' && _mouseHeld && _pointerLocked) {
      _shoot();
    }
  }

  // Node blaster update
  updateNodeBlaster(
    _colBlocks,
    (x, y, z, radius, damage) => {
      if (_camera) {
        const B=window.BABYLON;
        const dx=_camera.position.x-x,dy=_camera.position.y-y,dz=_camera.position.z-z;
        if (Math.sqrt(dx*dx+dy*dy+dz*dz) < radius) _onPlayerDamaged(damage);
      }
      if (window._nbEnemyPositions) {
        window._nbEnemyPositions().forEach(e => {
          const dx=e.pos.x-x,dz=e.pos.z-z;
          if (Math.sqrt(dx*dx+dz*dz) < radius) damageEnemyNode(e.index, damage);
        });
      }
    },
  );

  // ── Gun pickup check ──
  _nearPickup = null;
  for (const pu of _gunPickups) {
    const dx   = _camera.position.x - pu.pos.x;
    const dz   = _camera.position.z - pu.pos.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < 2.5) { _nearPickup = pu; break; }
  }

  const eRingWrap = document.getElementById('play-e-ring-wrap');
  const eRingFill = document.getElementById('play-e-ring-fill');
  const ePrompt   = document.getElementById('play-e-prompt');
  const RING_CIRC = 113;

  if (_nearPickup) {
    if (ePrompt) {
      const gunName = GUNS.find(g => g.id === _nearPickup._currentGunId)?.name || 'Weapon';
      ePrompt.textContent = 'Hold E — swap for ' + gunName;
      ePrompt.style.opacity = '1';
    }
    if (_keys['KeyE'] && !_eHeld) {
      _eHoldTimer++;
      const prog = _eHoldTimer / E_HOLD_TIME;
      if (eRingWrap) eRingWrap.classList.add('visible');
      if (eRingFill) eRingFill.style.strokeDashoffset = RING_CIRC * (1 - prog);

      if (_eHoldTimer >= E_HOLD_TIME) {
        const pu = _nearPickup;
        const pickupSlotIndex = GUNS.findIndex(g => g.id === pu._currentGunId);
        const currentSlot = getActiveSlot();
        const currentGun  = getActiveGun();

        unlockSlot(pickupSlotIndex);
        setActiveSlot(pickupSlotIndex);
        playPickup();

        const slotEl = document.getElementById('gun-slot-' + pickupSlotIndex);
        if (slotEl) {
          slotEl.classList.remove('unlock-flash');
          void slotEl.offsetWidth;
          slotEl.classList.add('unlock-flash');
          setTimeout(() => slotEl.classList.remove('unlock-flash'), 650);
        }

        if (pu.gunModel) {
          try { pu.gunModel.getChildMeshes().forEach(m => m.dispose()); pu.gunModel.dispose(); } catch {}
        }
        pu.gunModel = _buildPickupGunModel(currentSlot);
        pu.gunModel.position.set(pu.pos.x, pu.pos.y, pu.pos.z);
        pu._currentGunId = currentGun.id;
        pu.slot = currentSlot;

        const newGc = currentGun.color;
        if (pu.glowRing?.material) pu.glowRing.material.emissiveColor = new B.Color3(newGc.r, newGc.g, newGc.b);
        if (pu.pt) pu.pt.diffuse = new B.Color3(newGc.r, newGc.g, newGc.b);

        _eHeld      = true;
        _eHoldTimer = 0;
        _nearPickup = null;
        if (eRingWrap) eRingWrap.classList.remove('visible');
        if (eRingFill) eRingFill.style.strokeDashoffset = RING_CIRC;
        if (ePrompt) ePrompt.style.opacity = '0';
      }
    } else if (!_keys['KeyE']) {
      _eHeld      = false;
      _eHoldTimer = 0;
      if (eRingWrap) eRingWrap.classList.remove('visible');
      if (eRingFill) eRingFill.style.strokeDashoffset = RING_CIRC;
    }
  } else {
    if (ePrompt) ePrompt.style.opacity = '0';
    if (eRingWrap) eRingWrap.classList.remove('visible');
    if (eRingFill) eRingFill.style.strokeDashoffset = RING_CIRC;
    if (!_keys['KeyE']) { _eHeld = false; _eHoldTimer = 0; }
  }

  // Animate pickup gun model — hover + rotate
  const pickupT = Date.now() * 0.002;
  _gunPickups.forEach((pu, i) => {
    if (pu.gunModel) {
      pu.gunModel.position.y = pu.pos.y + Math.sin(pickupT + i * 1.2) * 0.1;
      pu.gunModel.rotation.y = pickupT * 0.6;
    }
    if (pu.glowRing?.material) {
      pu.glowRing.material.alpha = 0.4 + Math.sin(pickupT + i * 1.2) * 0.2;
    }
  });

  // Color node pickup
  const t2 = Date.now() * 0.0015;
  for (const cn of _colorNodes) {
    cn.sphere.position.y = cn.sphere._floatBase + Math.sin(t2 + cn.sphere._floatPhase) * 0.15;
    cn.sphere.rotation.y = t2 * 0.5;
    const dx = _camera.position.x - cn.sphere.position.x;
    const dz = _camera.position.z - cn.sphere.position.z;
    if (Math.sqrt(dx*dx + dz*dz) < 1.5) {
      const c = cn.color;
      setProjectileColor(c.r, c.g, c.b);
      if (cn.sphere.material) {
        cn.sphere.material.emissiveColor = new B.Color3(1, 1, 1);
        setTimeout(() => {
          if (cn.sphere.material) cn.sphere.material.emissiveColor = new B.Color3(c.r, c.g, c.b);
        }, 150);
      }
    }
  }

  // 1-4 key switching (only switch to unlocked slots)
  for (let k = 1; k <= 5; k++) {
    if (_keys['Digit' + k] && !_prevKeys['Digit' + k]) {
      setActiveSlot(k - 1);
    }
  }

  // Gun drop disabled — all 4 base guns are permanent
  const dropTip = document.getElementById('play-drop-tip');
  if (dropTip) dropTip.style.opacity = '0';

  // Clamp camera pitch to prevent upside-down flips
  if (_camera) {
    if (_camera.rotation.x > 1.5) _camera.rotation.x = 1.5;
    if (_camera.rotation.x < -1.5) _camera.rotation.x = -1.5;
  }

  // FOV kick: sprint widens FOV slightly for speed feel
  if (_camera) {
    const targetFov = _sprinting && ml > 0 ? 1.32 : 1.22;
    _camera.fov += (targetFov - _camera.fov) * 0.08;
  }

  // Sprint vignette
  const sprintVig = document.getElementById('play-sprint-vignette');
  if (sprintVig) {
    if (_sprinting && ml > 0) sprintVig.classList.add('active');
    else                       sprintVig.classList.remove('active');
  }

  if (_gunRoot && _camera) {
    const r = _camera.getDirection(B.Vector3.Right());
    const u = _camera.getDirection(B.Vector3.Up());
    const f = _camera.getDirection(B.Vector3.Forward());
    const jpBob = _jpActive ? Math.sin(Date.now() * 0.02) * 0.008 : 0;
    _gunRoot.position = _camera.position
      .add(r.scale(0.22))
      .add(u.scale(-0.18 + jpBob))
      .add(f.scale(0.35));
    _gunRoot.rotation.copyFrom(_camera.rotation);
    _muzzleOffset = _gunRoot.position.add(f.scale(0.22));
    window._nbMuzzlePos = _muzzleOffset;
  }

  const now = Date.now();
  _remotePlayers.forEach(p => {
    p.renderX    += (p.targetX    - p.renderX)    * 0.2;
    p.renderY    += (p.targetY    - p.renderY)    * 0.2;
    p.renderZ    += (p.targetZ    - p.renderZ)    * 0.2;
    p.renderRotY += (p.targetRotY - p.renderRotY) * 0.2;
    p.root.position.set(p.renderX, p.renderY, p.renderZ);
    p.root.rotation.y = p.renderRotY;
    p.root.setEnabled(now - p.lastUpdate <= 5000);
  });

  updateEnemyNodes();

  // Track previous key state for single-press detection
  Object.keys(_keys).forEach(k => { _prevKeys[k] = _keys[k]; });

  // FPS counter
  _fpsFrames++;
  if (_fpsFrames >= 30) {
    const fpsNow = Date.now();
    _fpsValue    = Math.round(30000 / (fpsNow - _fpsLastTime));
    _fpsLastTime = fpsNow;
    _fpsFrames   = 0;
    const el = document.getElementById('play-fps');
    if (el) {
      el.textContent = _fpsValue + ' fps';
      el.style.color = _fpsValue >= 50 ? 'rgba(255,255,255,0.25)'
        : _fpsValue >= 30 ? 'rgba(255,200,50,0.5)' : 'rgba(255,80,80,0.7)';
    }
  }
}

function _createSkybox(){
  const B=window.BABYLON,sky=B.MeshBuilder.CreateBox('skybox',{size:1200},_scene);
  const mat=new B.ShaderMaterial('skyShader',_scene,{
    vertexSource:'precision highp float;attribute vec3 position;uniform mat4 worldViewProjection;varying vec3 vPos;void main(){vPos=position;gl_Position=worldViewProjection*vec4(position,1.0);}',
    fragmentSource:'precision highp float;varying vec3 vPos;void main(){float t=clamp((normalize(vPos).y+1.0)*0.5,0.0,1.0);vec3 h=vec3(0.05,0.02,0.10);vec3 z=vec3(0.01,0.01,0.06);vec3 p=normalize(vPos)*120.0;float s=step(0.995,fract(sin(dot(floor(p),vec3(127.1,311.7,74.3)))*43758.5));vec3 c=mix(h,z,t)+s*0.8*smoothstep(0.4,1.0,t);gl_FragColor=vec4(c,1.0);}',
  },{attributes:['position'],uniforms:['worldViewProjection']});
  mat.backFaceCulling=false;sky.material=mat;sky.infiniteDistance=true;
}

function _buildArenaCollision(){
  const B=window.BABYLON;
  // Center
  _addCol(0,0,18,18,0.7);_addCol(0,0,8,8,1.4);_addCol(0,0,2,2,5);
  // Towers
  [{x:28,z:28},{x:-28,z:28},{x:28,z:-28},{x:-28,z:-28}].forEach((t,i)=>{
    _addCol(t.x,t.z,5,5,10);_addCol(t.x,t.z,7,7,0.5);
    const pt=new B.PointLight('twp_'+i,new B.Vector3(t.x,1.5,t.z),_scene);pt.diffuse=new B.Color3(0.1,1,0.4);pt.intensity=1.4;pt.range=16;
  });
  // Low walls
  [{x:14,z:14,w:1,d:6},{x:19,z:11,w:6,d:1},{x:-14,z:14,w:1,d:6},{x:-19,z:11,w:6,d:1},
   {x:14,z:-14,w:1,d:6},{x:19,z:-11,w:6,d:1},{x:-14,z:-14,w:1,d:6},{x:-19,z:-11,w:6,d:1}].forEach(w=>_addCol(w.x,w.z,w.w,w.d,2.5));
  // Bunkers
  [{x:0,z:38},{x:0,z:-38},{x:38,z:0},{x:-38,z:0}].forEach(b=>{
    const ns=b.x===0;
    _addCol(b.x,b.z,ns?10:2,ns?2:10,1.4);
    _addCol(b.x+(ns?-6:0),b.z+(ns?0:-6),ns?1:2,ns?2:1,2.5);
    _addCol(b.x+(ns?6:0),b.z+(ns?0:6),ns?1:2,ns?2:1,2.5);
  });
  // Catwalks
  _addCol(0,44,20,4,0.4);_addCol(-9,44,0.5,0.5,5);_addCol(9,44,0.5,0.5,5);
  _addCol(0,-44,20,4,0.4);_addCol(-9,-44,0.5,0.5,5);_addCol(9,-44,0.5,0.5,5);
  // Ramps
  [1,2,3].forEach(s=>{_addCol(0,20+s*3,4,2,s*0.5);_addCol(0,-20-s*3,4,2,s*0.5);});
  // Pillars
  [{x:8,z:22},{x:-8,z:22},{x:8,z:-22},{x:-8,z:-22},{x:22,z:8},{x:22,z:-8},{x:-22,z:8},{x:-22,z:-8}].forEach(p=>_addCol(p.x,p.z,2,2,4));
  // ══ EXPANDED ARENA — QUADRANT COLLISION ══

  // NE Hex Platforms
  _addCol(55, 55, 10, 10, 3.0);
  _addCol(55, 55, 6, 6, 5.0);
  _addCol(48, 48, 3, 3, 2.0);
  _addCol(62, 48, 3, 3, 2.0);
  _addCol(48, 62, 3, 3, 2.0);
  _addCol(62, 62, 3, 3, 2.0);
  _addCol(70, 55, 1, 8, 2.5);
  _addCol(55, 70, 8, 1, 2.5);

  // NW Sunken Pit rim walls
  _addCol(-55, 45, 20, 1, 1.5);
  _addCol(-55, 65, 20, 1, 1.5);
  _addCol(-45, 55, 1, 20, 1.5);
  _addCol(-65, 55, 1, 20, 1.5);
  _addCol(-52, 52, 2, 2, 4);
  _addCol(-58, 58, 2, 2, 4);
  _addCol(-52, 58, 2, 2, 3);
  _addCol(-58, 52, 2, 2, 3);

  // SE Elevated Fortress
  _addCol(55, -55, 14, 14, 2.0);
  _addCol(55, -55, 8, 8, 4.0);
  _addCol(55, -55, 3, 3, 7.0);
  _addCol(48, -48, 4, 2, 0.7);
  _addCol(48, -50, 4, 2, 1.3);
  _addCol(48, -52, 4, 2, 2.0);
  _addCol(68, -50, 1, 6, 2.5);
  _addCol(50, -68, 6, 1, 2.5);

  // SW Trench Network
  _addCol(-50, -45, 1, 16, 2.0);
  _addCol(-60, -45, 1, 16, 2.0);
  _addCol(-55, -38, 10, 1, 2.0);
  _addCol(-55, -53, 10, 1, 2.0);
  _addCol(-55, -60, 10, 1, 2.0);
  _addCol(-45, -55, 3, 3, 5);
  _addCol(-65, -55, 3, 3, 5);
  _addCol(-55, -55, 12, 2, 3.5);

  // Mid-ring structures
  _addCol(35, 0, 4, 7, 2.0);
  _addCol(-35, 0, 4, 7, 2.0);
  _addCol(0, 35, 7, 4, 2.0);
  _addCol(0, -35, 7, 4, 2.0);
  _addCol(25, 35, 3, 3, 3);
  _addCol(-25, 35, 3, 3, 3);
  _addCol(25, -35, 3, 3, 3);
  _addCol(-25, -35, 3, 3, 3);

  // Outer ring pillars
  [{x:80,z:0},{x:-80,z:0},{x:0,z:80},{x:0,z:-80},
   {x:75,z:75},{x:-75,z:75},{x:75,z:-75},{x:-75,z:-75}].forEach(p => {
    _addCol(p.x, p.z, 2, 2, 6);
  });

  // Fence walls
  const W=120,FH=3.5,FW=W*2;
  [{x:0,z:W,rotY:0},{x:0,z:-W,rotY:0},{x:W,z:0,rotY:Math.PI/2},{x:-W,z:0,rotY:Math.PI/2}].forEach((fd,fi)=>{
    _addCol(fd.x,fd.z,fd.rotY===0?FW:0.3,fd.rotY===0?0.3:FW,FH);
    for(let pl=0;pl<Math.floor(FW/24);pl++){
      const offset=-FW/2+pl*24+12;
      const ptPos=fd.rotY===0?new B.Vector3(fd.x+offset,2,fd.z):new B.Vector3(fd.x,2,fd.z+offset);
      const fpt=new B.PointLight('fence_pt_'+fi+'_'+pl,ptPos,_scene);fpt.diffuse=new B.Color3(0.0,0.8,0.3);fpt.intensity=0.5;fpt.range=10;
    }
  });
  const spot=new B.SpotLight('spot',new B.Vector3(0,30,0),new B.Vector3(0,-1,0),Math.PI/5,10,_scene);spot.intensity=0.55;spot.diffuse=new B.Color3(0.85,0.95,1.0);
}

function _buildArenaProc(){
  const B=window.BABYLON;
  function mkMat(n,r,g,b,er,eg,eb){const m=new B.StandardMaterial(n,_scene);m.diffuseColor=new B.Color3(r,g,b);m.emissiveColor=new B.Color3(er||0,eg||0,eb||0);m.specularColor=new B.Color3(0.08,0.08,0.12);m.specularPower=48;return m;}
  const MC=mkMat('mc',0.16,0.17,0.21),MD=mkMat('md',0.10,0.11,0.14),MG=mkMat('mg',0.03,0.18,0.09,0,0.6,0.25),MGD=mkMat('mgd',0.02,0.10,0.05,0,0.2,0.08);
  const gnd=B.MeshBuilder.CreateGround('ground',{width:130,height:130,subdivisions:2},_scene);gnd.material=mkMat('gnd',0.06,0.07,0.09);
  function box(n,w,h,d,x,z,mat,nc){const m=B.MeshBuilder.CreateBox(n,{width:w,height:h,depth:d},_scene);m.position.set(x,h/2,z);m.material=mat;if(!nc)_addCol(x,z,w,d,h);return m;}
  function strip(n,w,h,d,x,y,z){const m=B.MeshBuilder.CreateBox(n,{width:w,height:h,depth:d},_scene);m.position.set(x,y,z);m.material=MG;return m;}
  box('ctr_base',18,0.7,18,0,0,MD);box('ctr_inner',8,1.4,8,0,0,MC);box('ctr_pillar',2,5,2,0,0,MD);
  strip('ctr_n',18,0.1,0.15,0,0.76,9);strip('ctr_s',18,0.1,0.15,0,0.76,-9);
  strip('ctr_e',0.15,0.1,18,9,0.76,0);strip('ctr_w',0.15,0.1,18,-9,0.76,0);
  strip('ctr_pn',2.1,0.08,0.1,0,5.1,1);strip('ctr_ps',2.1,0.08,0.1,0,5.1,-1);
  [{x:28,z:28},{x:-28,z:28},{x:28,z:-28},{x:-28,z:-28}].forEach((t,i)=>{
    box('tw_'+i,5,10,5,t.x,t.z,MD);box('twt_'+i,7,0.5,7,t.x,t.z,MC);
    strip('twg_'+i,7,0.14,7,t.x,10.33,t.z);
    const pt=new B.PointLight('twp_'+i,new B.Vector3(t.x,1.5,t.z),_scene);pt.diffuse=new B.Color3(0.1,1,0.4);pt.intensity=1.4;pt.range=16;
  });
  [{x:14,z:14,w:1,d:6},{x:19,z:11,w:6,d:1},{x:-14,z:14,w:1,d:6},{x:-19,z:11,w:6,d:1},
   {x:14,z:-14,w:1,d:6},{x:19,z:-11,w:6,d:1},{x:-14,z:-14,w:1,d:6},{x:-19,z:-11,w:6,d:1}].forEach((w,i)=>box('lw_'+i,w.w,2.5,w.d,w.x,w.z,MC));
  [{x:0,z:38},{x:0,z:-38},{x:38,z:0},{x:-38,z:0}].forEach((b,i)=>{
    const ns=b.x===0;
    box('bk_'+i,ns?10:2,1.4,ns?2:10,b.x,b.z,MD);
    box('bkl_'+i,ns?1:2,2.5,ns?2:1,b.x+(ns?-6:0),b.z+(ns?0:-6),MC);
    box('bkr_'+i,ns?1:2,2.5,ns?2:1,b.x+(ns?6:0),b.z+(ns?0:6),MC);
    strip('bkg_'+i,ns?10:2,0.08,ns?2:10,b.x,1.46,b.z);
  });
  box('cat_n',20,0.4,4,0,44,MD);box('cnl',0.5,5,0.5,-9,44,MC);box('cnr',0.5,5,0.5,9,44,MC);
  strip('cng',20,0.1,0.12,0,0.46,44);
  box('cat_s',20,0.4,4,0,-44,MD);box('csl',0.5,5,0.5,-9,-44,MC);box('csr',0.5,5,0.5,9,-44,MC);
  strip('csg',20,0.1,0.12,0,0.46,-44);
  [1,2,3].forEach(s=>{box('rn_'+s,4,s*0.5,2,0,20+s*3,MC);box('rs_'+s,4,s*0.5,2,0,-20-s*3,MC);});
  [{x:8,z:22},{x:-8,z:22},{x:8,z:-22},{x:-8,z:-22},{x:22,z:8},{x:22,z:-8},{x:-22,z:8},{x:-22,z:-8}].forEach((p,i)=>{
    box('pl_'+i,2,4,2,p.x,p.z,MD);strip('plg_'+i,2,0.08,2,p.x,4.1,p.z);
  });
  [{x:0,z:-50},{x:0,z:50},{x:50,z:0},{x:-50,z:0}].forEach((s,i)=>{
    const pad=B.MeshBuilder.CreateGround('sp_'+i,{width:4,height:4},_scene);pad.position.set(s.x,0.02,s.z);pad.material=MGD;
  });
  // ══ EXPANDED ARENA — VISUAL GEOMETRY ══
  const MHex = mkMat('mhex', 0.08, 0.15, 0.10, 0, 0.3, 0.12);

  // Extended ground
  const gndExt = B.MeshBuilder.CreateGround('ground_ext', { width: 260, height: 260, subdivisions: 4 }, _scene);
  gndExt.position.y = -0.01;
  gndExt.material = mkMat('gnd_ext', 0.05, 0.06, 0.08);

  // NE Hex Platforms
  box('hex_base_ne', 10, 3, 10, 55, 55, MD);
  box('hex_upper_ne', 6, 5, 6, 55, 55, MC);
  strip('hex_glow_ne', 10, 0.12, 10, 55, 3.08, 55);
  [{x:48,z:48},{x:62,z:48},{x:48,z:62},{x:62,z:62}].forEach((h, i) => {
    box('hex_step_ne_' + i, 3, 2, 3, h.x, h.z, MHex);
    strip('hex_step_g_ne_' + i, 3, 0.08, 3, h.x, 2.08, h.z);
  });
  box('hex_wall_ne_e', 1, 2.5, 8, 70, 55, MC);
  box('hex_wall_ne_n', 8, 2.5, 1, 55, 70, MC);

  // NW Sunken Pit
  box('pit_s_nw', 20, 1.5, 1, -55, 45, MD);
  box('pit_n_nw', 20, 1.5, 1, -55, 65, MD);
  box('pit_e_nw', 1, 1.5, 20, -45, 55, MD);
  box('pit_w_nw', 1, 1.5, 20, -65, 55, MD);
  strip('pit_gs_nw', 20, 0.08, 1, -55, 1.56, 45);
  strip('pit_gn_nw', 20, 0.08, 1, -55, 1.56, 65);
  [{x:-52,z:52,h:4},{x:-58,z:58,h:4},{x:-52,z:58,h:3},{x:-58,z:52,h:3}].forEach((p, i) => {
    box('pit_pil_' + i, 2, p.h, 2, p.x, p.z, MC);
    strip('pit_pilg_' + i, 2, 0.08, 2, p.x, p.h + 0.05, p.z);
  });
  const pitLight = new B.PointLight('pit_light_nw', new B.Vector3(-55, 1, 55), _scene);
  pitLight.diffuse = new B.Color3(0.1, 0.8, 0.4); pitLight.intensity = 1.2; pitLight.range = 18;

  // SE Elevated Fortress
  box('fort_base_se', 14, 2, 14, 55, -55, MD);
  box('fort_upper_se', 8, 4, 8, 55, -55, MC);
  box('fort_tower_se', 3, 7, 3, 55, -55, MD);
  strip('fort_glow_se', 14, 0.12, 14, 55, 2.08, -55);
  strip('fort_glow2_se', 8, 0.1, 8, 55, 4.08, -55);
  [{ z: -48, h: 0.7 }, { z: -50, h: 1.3 }, { z: -52, h: 2.0 }].forEach((r, i) => {
    box('fort_ramp_' + i, 4, r.h, 2, 48, r.z, MC);
  });
  box('fort_wall_e', 1, 2.5, 6, 68, -50, MC);
  box('fort_wall_s', 6, 2.5, 1, 50, -68, MC);
  const fortLight = new B.PointLight('fort_light_se', new B.Vector3(55, 8, -55), _scene);
  fortLight.diffuse = new B.Color3(0.2, 0.6, 1.0); fortLight.intensity = 1.5; fortLight.range = 20;

  // SW Trench Network
  box('trench_w1', 1, 2, 16, -50, -45, MC);
  box('trench_w2', 1, 2, 16, -60, -45, MC);
  box('trench_h1', 10, 2, 1, -55, -38, MC);
  box('trench_h2', 10, 2, 1, -55, -53, MC);
  box('trench_h3', 10, 2, 1, -55, -60, MC);
  box('trench_perch1', 3, 5, 3, -45, -55, MD);
  box('trench_perch2', 3, 5, 3, -65, -55, MD);
  const bridgeMesh = B.MeshBuilder.CreateBox('trench_bridge', { width: 12, height: 3.5, depth: 2 }, _scene);
  bridgeMesh.position.set(-55, 3.5/2, -55); bridgeMesh.material = MC;
  strip('trench_bg', 12, 0.08, 2, -55, 3.56, -55);
  const trenchLight = new B.PointLight('trench_light_sw', new B.Vector3(-55, 2, -50), _scene);
  trenchLight.diffuse = new B.Color3(1.0, 0.3, 0.1); trenchLight.intensity = 0.8; trenchLight.range = 14;

  // Mid-ring hex cover
  [{x:35,z:0},{x:-35,z:0}].forEach((m, i) => {
    box('mid_hex_ew_' + i, 4, 2, 7, m.x, m.z, MHex);
    strip('mid_hex_g_ew_' + i, 4, 0.08, 7, m.x, 2.08, m.z);
  });
  [{x:0,z:35},{x:0,z:-35}].forEach((m, i) => {
    box('mid_hex_ns_' + i, 7, 2, 4, m.x, m.z, MHex);
    strip('mid_hex_g_ns_' + i, 7, 0.08, 4, m.x, 2.08, m.z);
  });
  [{x:25,z:35},{x:-25,z:35},{x:25,z:-35},{x:-25,z:-35}].forEach((d, i) => {
    box('diag_pil_' + i, 3, 3, 3, d.x, d.z, MC);
    strip('diag_pilg_' + i, 3, 0.08, 3, d.x, 3.08, d.z);
  });

  // Outer ring pillars with lights
  [{x:80,z:0},{x:-80,z:0},{x:0,z:80},{x:0,z:-80},
   {x:75,z:75},{x:-75,z:75},{x:75,z:-75},{x:-75,z:-75}].forEach((p, i) => {
    box('outer_pil_' + i, 2, 6, 2, p.x, p.z, MD);
    strip('outer_pilg_' + i, 2, 0.08, 2, p.x, 6.08, p.z);
    const opl = new B.PointLight('opl_' + i, new B.Vector3(p.x, 6.5, p.z), _scene);
    opl.diffuse = new B.Color3(0.0, 0.7, 0.3); opl.intensity = 0.6; opl.range = 12;
  });

  const W=120,FH=3.5,FP=8,FW=W*2;
  const fenceMat=new B.StandardMaterial('fence_mat',_scene);
  fenceMat.diffuseColor=new B.Color3(0.08,0.10,0.08);fenceMat.emissiveColor=new B.Color3(0.0,0.18,0.06);
  fenceMat.specularColor=new B.Color3(0.1,0.3,0.1);fenceMat.alpha=0.85;
  const fenceGlowMat=new B.StandardMaterial('fence_glow_mat',_scene);
  fenceGlowMat.emissiveColor=new B.Color3(0.0,0.7,0.25);fenceGlowMat.disableLighting=true;
  [{x:0,z:W,rotY:0},{x:0,z:-W,rotY:0},{x:W,z:0,rotY:Math.PI/2},{x:-W,z:0,rotY:Math.PI/2}].forEach((fd,fi)=>{
    const fence=B.MeshBuilder.CreateBox('fence_'+fi,{width:FW,height:FH,depth:0.3},_scene);
    fence.position.set(fd.x,FH/2,fd.z);fence.rotation.y=fd.rotY;fence.material=fenceMat;
    _addCol(fd.x,fd.z,fd.rotY===0?FW:0.3,fd.rotY===0?0.3:FW,FH);
    const topS=B.MeshBuilder.CreateBox('fence_top_'+fi,{width:FW,height:0.08,depth:0.35},_scene);
    topS.position.set(fd.x,FH+0.04,fd.z);topS.rotation.y=fd.rotY;topS.material=fenceGlowMat;
    const botS=B.MeshBuilder.CreateBox('fence_bot_'+fi,{width:FW,height:0.06,depth:0.35},_scene);
    botS.position.set(fd.x,0.3,fd.z);botS.rotation.y=fd.rotY;botS.material=fenceGlowMat;
    const postCount=Math.floor(FW/FP);
    for(let p=0;p<=postCount;p++){
      const offset=-FW/2+p*FP;
      const post=B.MeshBuilder.CreateBox('fence_post_'+fi+'_'+p,{width:0.25,height:FH+0.5,depth:0.4},_scene);
      if(fd.rotY===0)post.position.set(fd.x+offset,(FH+0.5)/2,fd.z);
      else post.position.set(fd.x,(FH+0.5)/2,fd.z+offset);
      post.rotation.y=fd.rotY;post.material=fenceMat;
      const pip=B.MeshBuilder.CreateSphere('pip_'+fi+'_'+p,{diameter:0.22,segments:4},_scene);
      pip.position.copyFrom(post.position);pip.position.y=FH+0.5;pip.material=fenceGlowMat;
    }
    for(let pl=0;pl<Math.floor(FW/24);pl++){
      const offset=-FW/2+pl*24+12;
      const ptPos=fd.rotY===0?new B.Vector3(fd.x+offset,2,fd.z):new B.Vector3(fd.x,2,fd.z+offset);
      const fpt=new B.PointLight('fence_pt_'+fi+'_'+pl,ptPos,_scene);
      fpt.diffuse=new B.Color3(0.0,0.8,0.3);fpt.intensity=0.5;fpt.range=10;
    }
  });
  const spot=new B.SpotLight('spot',new B.Vector3(0,30,0),new B.Vector3(0,-1,0),Math.PI/5,10,_scene);spot.intensity=0.55;spot.diffuse=new B.Color3(0.85,0.95,1.0);
}

function _buildArena(){
  _tryLoadGLB('./games/Arena_1/models/nodeblast_game_arena_1.glb',_scene,
    (meshes)=>{
      meshes.forEach(m=>{if(m.name==='__root__')return;m.isPickable=false;});
      console.log('[assets] Arena GLB loaded (procedural kept for collision)');
    },
    ()=>{_buildArenaProc();}
  );
}

function _buildColorNodes(){
  const B=window.BABYLON;
  const COLORS=[
    {r:1.0,g:0.1,b:0.1,name:'red'},{r:1.0,g:0.5,b:0.0,name:'orange'},
    {r:1.0,g:1.0,b:0.0,name:'yellow'},{r:0.1,g:1.0,b:0.2,name:'green'},
    {r:0.0,g:1.0,b:1.0,name:'cyan'},{r:0.1,g:0.3,b:1.0,name:'blue'},
    {r:0.7,g:0.1,b:1.0,name:'purple'},{r:1.0,g:1.0,b:1.0,name:'white'},
  ];
  const nodePositions = [
    { x: 8, z: -50 }, { x: 8, z: 50 },
    { x: 55, z: 55 }, { x: -55, z: 55 },
    { x: 55, z: -55 }, { x: -55, z: -55 },
    { x: 80, z: 0 }, { x: -80, z: 0 },
  ];
  nodePositions.forEach((np, npi) => {
    COLORS.forEach((col, ci) => {
      const x = np.x + ci * 2.2, z = np.z;
      const sphere = B.MeshBuilder.CreateSphere('color_node_' + col.name + '_' + npi, { diameter: 0.5, segments: 8 }, _scene);
      sphere.position.set(x, 1.2, z);
      const mat = new B.StandardMaterial('cnm_' + col.name + '_' + npi, _scene);
      mat.emissiveColor = new B.Color3(col.r, col.g, col.b); mat.disableLighting = true; sphere.material = mat;
      const pt = new B.PointLight('cnl_' + col.name + '_' + npi, new B.Vector3(x, 1.2, z), _scene);
      pt.diffuse = new B.Color3(col.r, col.g, col.b); pt.intensity = 0.6; pt.range = 3.5;
      sphere._floatBase = 1.2; sphere._floatPhase = ci * 0.8 + npi; sphere._color = col;
      _colorNodes.push({ sphere, pt, color: col });
    });
  });
}

export function initGame(canvas){
  const B=window.BABYLON;if(!B)throw new Error('Babylon.js not loaded');
  _canvas=canvas;_colBlocks.length=0;refreshPlayerIdentity();
  _engine=new B.Engine(canvas,true,{adaptToDeviceRatio:true,antialias:true});
  const isLowEnd=navigator.hardwareConcurrency<=4||/Android|iPhone|iPad/i.test(navigator.userAgent);
  if(isLowEnd){_engine.setHardwareScalingLevel(1.5);console.log('[game] low-end device detected — reduced quality');}
  _scene=new B.Scene(_engine);_scene.clearColor=new B.Color4(0.02,0.02,0.05,1);_scene.collisionsEnabled=false;
  _scene.autoClear=true;_scene.autoClearDepthAndStencil=true;_scene.blockMaterialDirtyMechanism=false;
  _createSkybox();
  const hemi=new B.HemisphericLight('hemi',new B.Vector3(0,1,0),_scene);hemi.intensity=0.30;hemi.diffuse=new B.Color3(0.55,0.60,0.85);hemi.groundColor=new B.Color3(0.04,0.04,0.07);
  const dir=new B.DirectionalLight('dir',new B.Vector3(-0.5,-1,-0.3),_scene);dir.intensity=0.65;dir.diffuse=new B.Color3(0.85,0.82,0.75);dir.position=new B.Vector3(30,50,30);
  _scene.fogMode=B.Scene.FOGMODE_EXP2;_scene.fogColor=new B.Color3(0.02,0.02,0.05);_scene.fogDensity=isLowEnd?0.003:0.004;
  _camera=new B.UniversalCamera('cam',new B.Vector3(0,GROUND_Y,-48),_scene);_camera.setTarget(B.Vector3.Zero());
  _camera.keysUp=[];_camera.keysDown=[];_camera.keysLeft=[];_camera.keysRight=[];
  _camera.angularSensibility=650;_camera.inertia=0.04;_camera.minZ=0.05;_camera.fov=1.22;
  window._nbSetSpawn=(x,z)=>{if(_camera){_camera.position.x=x;_camera.position.z=z;_camera.position.y=GROUND_Y;_velX=0;_velZ=0;_velY=0;}};
  _pointerLocked=false;
  _canvasClickHandler=()=>{if(!_pointerLocked)canvas.requestPointerLock().catch(()=>{});};
  canvas.addEventListener('click',_canvasClickHandler);
  _plcHandler=()=>{
    const wasLocked=_pointerLocked;
    _pointerLocked=document.pointerLockElement===canvas;
    const ch=document.getElementById('play-crosshair');if(ch)ch.style.opacity=_pointerLocked?'1':'0.35';
    // Detach/reattach camera to prevent stale mouse deltas from causing rotation snaps
    if(_camera&&_canvas){
      if(_pointerLocked&&!wasLocked){ _camera.attachControl(_canvas,true); }
      else if(!_pointerLocked&&wasLocked){ _camera.detachControl(); }
    }
    // Clear held keys — browser doesn't fire keyup when pointer lock drops
    if(!_pointerLocked){
      Object.keys(_keys).forEach(k=>delete _keys[k]);
      Object.keys(_prevKeys).forEach(k=>delete _prevKeys[k]);
      _mouseHeld=false;
    }
    // Browser exits pointer lock on Escape before keydown fires —
    // open exit modal when pointer lock is lost (not during death/respawn)
    if(wasLocked&&!_pointerLocked&&!_isDead&&!window._nbPlayExitModalOpen){
      if(window._nbOpenExitModal)window._nbOpenExitModal();
    }
  };
  document.addEventListener('pointerlockchange',_plcHandler);
  _keyDownHandler=e=>{_keys[e.code]=true;if(e.code==='Space')e.preventDefault();};
  _keyUpHandler=e=>{delete _keys[e.code];};
  document.addEventListener('keydown',_keyDownHandler);document.addEventListener('keyup',_keyUpHandler);
  _mouseDownHandler=e=>{
    if(e.button===0&&_pointerLocked){
      _mouseHeld=true;
      const gun=getActiveGun();
      if(gun.id!=='plasma')_shoot();
    }
  };
  document.addEventListener('mousedown',_mouseDownHandler);
  _mouseUpHandler=e=>{if(e.button===0)_mouseHeld=false;};
  document.addEventListener('mouseup',_mouseUpHandler);
  _buildArena();
  _buildGun();
  window._nbRebuildGun=_buildGun;
  initAudio();
  _buildJetpackFX();
  _buildGunPickups();
  _buildColorNodes();
  // Freeze static materials for performance
  _scene.meshes.forEach(mesh=>{
    if(mesh.material&&!mesh.name.startsWith('proj')&&!mesh.name.startsWith('goo')&&
       !mesh.name.startsWith('enemy')&&!mesh.name.startsWith('remote')&&!mesh.name.startsWith('fn_')&&
       !mesh.name.startsWith('gun_')&&!mesh.name.startsWith('plasma')&&!mesh.name.startsWith('rr_')&&
       !mesh.name.startsWith('rb_')&&!mesh.name.startsWith('rl_')&&!mesh.name.startsWith('rg_')){
      try{mesh.material.freeze();}catch{}
    }
  });
  initGunHUD();
  initPlasma(_scene, _camera, _colBlocks);
  initEnemyNodes(_scene, _camera, _onPlayerDamaged, _colBlocks);
  initNodeBlaster(_scene, _camera);
  window._nbEnemyPositions = null; // set by enemy-nodes.js
  window._nbDamageEnemy = (idx, dmg) => damageEnemyNode(idx, dmg);
  window._nbApplyPlayerDamage = _onPlayerDamaged;
  window._nbSendDamage = null; // set by play-mode.js
  window._nbPlayEnemyDeath = playEnemyDeath;
  window._nbSetAudio = setAudioEnabled;
  window._nbColorEnemy = (index, color) => {
    if (window._nbApplyEnemyColor) window._nbApplyEnemyColor(index, color);
  };
  window._nbGetRemotePlayerData = getRemotePlayerData;
  window._nbSetGunColor = (r, g, b) => {
    const orb = _scene?.getMeshByName('gun_orb');
    if (orb?.material) orb.material.emissiveColor = new B.Color3(r, g, b);
    const dish = _scene?.getMeshByName('gun_dish');
    if (dish?.material) {
      dish.material.diffuseColor  = new B.Color3(r*0.2, g*0.2, b*0.2);
      dish.material.emissiveColor = new B.Color3(r*0.4, g*0.4, b*0.4);
    }
  };
  _obsHandler=_scene.onBeforeRenderObservable.add(_physicsTick);
  _engine.runRenderLoop(()=>_scene.render());
  _resizeHandler=()=>_engine.resize();window.addEventListener('resize',_resizeHandler);
  window._nbGetPlayerState=getPlayerState;
  // Expose current delta for enemy-nodes and other modules
  Object.defineProperty(window, '_nbDelta', { get: () => _delta, configurable: true });
  return{engine:_engine,scene:_scene};
}

export function attachCameraInput() {
  if (_camera && _canvas) {
    _camera.rotation.x = 0;
    _camera.rotation.y = 0;
    // Only attach if not already attached — plcHandler also manages this
    if (!_pointerLocked) {
      _camera.attachControl(_canvas, true);
    }
  }
}

export function destroyGame(engine){
  if(_keyDownHandler){document.removeEventListener('keydown',_keyDownHandler);_keyDownHandler=null;}
  if(_keyUpHandler){document.removeEventListener('keyup',_keyUpHandler);_keyUpHandler=null;}
  if(_mouseDownHandler){document.removeEventListener('mousedown',_mouseDownHandler);_mouseDownHandler=null;}
  if(_mouseUpHandler){document.removeEventListener('mouseup',_mouseUpHandler);_mouseUpHandler=null;}
  _mouseHeld=false;
  if(_plcHandler){document.removeEventListener('pointerlockchange',_plcHandler);_plcHandler=null;}
  if(_canvasClickHandler&&_canvas){try{_canvas.removeEventListener('click',_canvasClickHandler);}catch{}_canvasClickHandler=null;}
  _pointerLocked=false;
  if(_scene&&_obsHandler){_scene.onBeforeRenderObservable.remove(_obsHandler);_obsHandler=null;}
  if(_resizeHandler){window.removeEventListener('resize',_resizeHandler);_resizeHandler=null;}
  _projectiles.forEach(p=>{try{p.mesh.dispose();}catch{}});_projectiles.length=0;
  _gooSplats.forEach(s=>{try{s.mesh.dispose();}catch{}});_gooSplats.length=0;
  _remotePlayers.forEach((_,id)=>removeRemotePlayer(id));_remotePlayers.clear();
  _pendingRemotePlayers.clear();
  if(_gunRoot){try{_gunRoot.getChildMeshes().forEach(m=>m.dispose());_gunRoot.dispose();}catch{}_gunRoot=null;}
  if(_jetpackPS){try{_jetpackPS.dispose();}catch{}_jetpackPS=null;}
  if(_jetpackNode){try{_jetpackNode.dispose();}catch{}_jetpackNode=null;}
  _gunPickups.forEach(pu => {
    try {
      pu.tableTop?.dispose();
      pu.glowRing?.dispose();
      pu.pt?.dispose();
      if (pu.gunModel) {
        pu.gunModel.getChildMeshes().forEach(m => m.dispose());
        pu.gunModel.dispose();
      }
      pu.base?.dispose(); pu.orb?.dispose(); pu.glow?.dispose(); pu.glowDisc?.dispose();
    } catch {}
  });
  _gunPickups.length=0;_nearPickup=null;
  window._nbSetGunColor=null;
  resetGuns();
  destroyPlasma();
  destroyEnemyNodes();
  destroyNodeBlaster();
  _colorNodes.forEach(cn=>{try{cn.sphere.dispose();cn.pt.dispose();}catch{}});
  _colorNodes.length=0;
  window._nbEnemyPositions=null;
  window._nbDamageEnemy=null;
  window._nbSetSpawn=null;
  window._nbApplyPlayerDamage=null;
  window._nbSendDamage=null;
  window._nbPlayEnemyDeath=null;
  window._nbSetAudio=null;
  window._nbRebuildGun=null;
  window._nbGetRemotePlayerData=null;
  window._nbColorEnemy=null;
  window._nbApplyEnemyColor=null;
  destroyAudio();
  _playerHp=100;_isDead=false;_respawnTimer=0;_damageFlash=0;_shakeTimer=0;
  _lastTickTime=0;_delta=1.0;
  _muzzleOffset=null;
  window._nbGetPlayerState=null;
  _velX=0;_velZ=0;_velY=0;_onGround=true;_sprinting=false;_jumpHeld=false;_jumpsLeft=2;_jpFuel=JP_MAX_FUEL;_jpActive=false;
  _colBlocks.length=0;Object.keys(_keys).forEach(k=>delete _keys[k]);Object.keys(_prevKeys).forEach(k=>delete _prevKeys[k]);
  _scene=null;_camera=null;_canvas=null;_engine=null;
  if(engine){engine.stopRenderLoop();engine.dispose();}
}
