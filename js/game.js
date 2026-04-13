// ══════════════════════════════════════
//  NodeBlast — GAME ENGINE
//  Double jump, goo gun splatter, real physics, large crosshair
// ══════════════════════════════════════

import State from './state.js';
import { getActiveGun, getActiveSlot, setActiveSlot, setProjectileColor,
         getProjectileColor, initGunHUD, resetGuns, GUNS } from './guns.js';
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

const WALK_SPEED  = 0.09;
const SPRINT_MULT = 1.85;
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
let _jpFuel    = JP_MAX_FUEL;
let _jpActive  = false;
const _colBlocks=[];
const _keys={};
const _prevKeys={};
const _gunPickups=[];
let _nearPickup=null;
let _eHeld=false;
let _eHoldTimer=0;
const E_HOLD_TIME=30;
let _keyDownHandler=null,_keyUpHandler=null,_mouseDownHandler=null,_mouseUpHandler=null;
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
const MAX_DELTA=3.0;

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
  const n=8+Math.floor(Math.random()*5);
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
  if(_gooSplats.length>250){const old=_gooSplats.splice(0,20);old.forEach(s=>{try{s.mesh.dispose();}catch{}});}
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
          const body=B.MeshBuilder.CreateSphere('gun_body',{diameter:0.11,segments:5},_scene);body.parent=_gunRoot;body.scaling.z=2.2;body.position.set(0,0,0.08);_applyMat(body,'body',0.15,0.05,0.05);
          for(let i=0;i<3;i++){const fin=B.MeshBuilder.CreateBox('gun_fin_'+i,{width:0.015,height:0.06,depth:0.08},_scene);fin.parent=_gunRoot;const a=(i/3)*Math.PI*2+Math.PI/6;fin.position.set(Math.cos(a)*0.065,Math.sin(a)*0.065,0.08);fin.rotation.z=a;_applyMat(fin,'fin'+i,0.20,0.06,0.06);}
          const tube=B.MeshBuilder.CreateCylinder('gun_tube',{diameter:0.06,height:0.18,tessellation:8},_scene);tube.parent=_gunRoot;tube.rotation.x=Math.PI/2;tube.position.set(0,0,0.20);_applyMat(tube,'tube',0.18,0.06,0.06);
          const grip=B.MeshBuilder.CreateBox('gun_grip',{width:0.05,height:0.10,depth:0.06},_scene);grip.parent=_gunRoot;grip.position.set(0,-0.08,0.03);_applyMat(grip,'grip',0.12,0.04,0.04);
          const orb=B.MeshBuilder.CreateSphere('gun_orb',{diameter:0.04,segments:6},_scene);orb.parent=_gunRoot;orb.position.set(0,0,0.30);_applyGlowMat(orb,'orb',pc);
          break;}
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
  if(_projectiles.length>=20)return;
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
    if(!hit&&(Math.abs(px)>65||Math.abs(pz)>65)){try{p.mesh.dispose();}catch{}dead.push(i);continue;}
    if(hit||p.life<=0){const pc=getProjectileColor();if(hit&&hitPos)_spawnGooSplat(hitPos,hitNormal,pc);try{p.mesh.dispose();}catch{}dead.push(i);}
  }
  for(let i=dead.length-1;i>=0;i--)_projectiles.splice(dead[i],1);
}

function _buildGunPickups() {
  const B = window.BABYLON;
  const spawnSets = [{ z: -44 }, { z: 44 }];
  const pickupDefs = [
    { slot: 1, name: 'machinegun', x: -6 },
    { slot: 2, name: 'plasma',     x:  0 },
    { slot: 3, name: 'nodeblaster',x:  6 },
  ];
  spawnSets.forEach(sp => {
    pickupDefs.forEach(def => {
      const base = B.MeshBuilder.CreateBox('pickup_' + def.name + '_' + sp.z,
        { width: 0.6, height: 0.2, depth: 0.6 }, _scene);
      base.position.set(def.x, 0.5, sp.z);
      const mat = new B.StandardMaterial('pm_' + def.name + sp.z, _scene);
      const gc = GUNS[def.slot].color;
      mat.diffuseColor  = new B.Color3(gc.r * 0.3, gc.g * 0.3, gc.b * 0.3);
      mat.emissiveColor = new B.Color3(gc.r * 0.6, gc.g * 0.6, gc.b * 0.6);
      base.material = mat;
      const orb = B.MeshBuilder.CreateSphere('pickup_orb_' + def.name + sp.z,
        { diameter: 0.35, segments: 8 }, _scene);
      orb.position.set(def.x, 1.1, sp.z);
      const orbMat = new B.StandardMaterial('pom_' + def.name + sp.z, _scene);
      orbMat.emissiveColor   = new B.Color3(gc.r, gc.g, gc.b);
      orbMat.disableLighting = true;
      orb.material = orbMat;
      const pt = new B.PointLight('ppt_' + def.name + sp.z,
        new B.Vector3(def.x, 1.1, sp.z), _scene);
      pt.diffuse   = new B.Color3(gc.r, gc.g, gc.b);
      pt.intensity = 0.8;
      pt.range     = 4;
      _gunPickups.push({ base, orb, pt, slot: def.slot,
        pos: new B.Vector3(def.x, 1.0, sp.z) });
    });
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
  _delta = _lastTickTime ? Math.min(MAX_DELTA, (_now - _lastTickTime) / TARGET_MS) : 1.0;
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

  _sprinting = _keys['ShiftLeft'] || _keys['ShiftRight'] || false;
  const spd  = WALK_SPEED * (_sprinting ? SPRINT_MULT : 1);
  const ctrl = _onGround ? 1.0 : AIR_CONTROL;

  _velX += ((mx * spd) - _velX) * INERTIA * ctrl * _delta;
  _velZ += ((mz * spd) - _velZ) * INERTIA * ctrl * _delta;
  if (ml === 0 && _onGround) { const fd = Math.pow(FRICTION, _delta); _velX *= fd; _velZ *= fd; }

  _velY -= GRAVITY * (_velY < 0 ? FALL_MULT : 1.0) * _delta;

  if (jumping && !_jumpHeld && _jumpsLeft > 0) {
    playJump();
    _velY      = _jumpsLeft === 2 ? JUMP_FORCE : JUMP2_FORCE;
    _jumpsLeft--;
    _jumpHeld  = true;
    _onGround  = false;
    _jpActive  = false;
  }
  if (!jumping) _jumpHeld = false;

  const jpFromGround = _onGround && _jumpHeld && _jumpsLeft < 2;
  const jpInAir      = !_onGround && _jumpsLeft === 0;
  _jpActive = jumping && _jpFuel > 0 && (jpFromGround || jpInAir);

  if (_jpActive) {
    if (_camera.position.y < JP_MAX_Y) {
      _velY += JP_FORCE * _delta;
      if (_velY < 0) _velY *= 0.7;
    }
    _jpFuel = Math.max(0, _jpFuel - _delta);
    _updateJetpackParticles(true);
  } else {
    _updateJetpackParticles(false);
  }
  playJetpack(_jpActive);

  if ((_onGround || !_jpActive) && _jpFuel < JP_MAX_FUEL) {
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

  if (landed) {
    _camera.position.y = landHeight;
    _velY              = 0;
    _onGround          = true;
    _jumpsLeft         = 2;
    _jpActive          = false;
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

  const BOUND = 58;
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
    if (dist < 2.2) { _nearPickup = pu; break; }
  }
  const equipTip = document.getElementById('play-equip-tip');
  if (_nearPickup) {
    if (equipTip) equipTip.classList.add('visible');
    if (_keys['KeyE'] && !_eHeld) {
      _eHoldTimer++;
      if (_eHoldTimer >= E_HOLD_TIME) {
        setActiveSlot(_nearPickup.slot);
        playPickup();
        _eHeld      = true;
        _eHoldTimer = 0;
        if (equipTip) equipTip.classList.remove('visible');
      }
    } else if (!_keys['KeyE']) {
      _eHeld      = false;
      _eHoldTimer = 0;
    }
  } else {
    if (equipTip) equipTip.classList.remove('visible');
    if (!_keys['KeyE']) { _eHeld = false; _eHoldTimer = 0; }
  }

  // Animate pickup orbs
  const pt = Date.now() * 0.002;
  _gunPickups.forEach((pu, i) => {
    pu.orb.position.y = 1.1 + Math.sin(pt + i * 1.2) * 0.12;
    pu.orb.rotation.y = pt * 0.8;
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

  // 1-4 key switching
  for (let k = 1; k <= 4; k++) {
    if (_keys['Digit' + k] && !_prevKeys['Digit' + k]) {
      setActiveSlot(k - 1);
    }
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
  // Fence walls
  const W=60,FH=3.5,FW=W*2;
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
  const W=60,FH=3.5,FP=8,FW=W*2;
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
  [-50,50].forEach(sz=>{
    COLORS.forEach((col,ci)=>{
      const x=8+ci*2.2,z=sz;
      const sphere=B.MeshBuilder.CreateSphere('color_node_'+col.name+sz,{diameter:0.5,segments:8},_scene);
      sphere.position.set(x,1.2,z);
      const mat=new B.StandardMaterial('cnm_'+col.name+sz,_scene);
      mat.emissiveColor=new B.Color3(col.r,col.g,col.b);mat.disableLighting=true;sphere.material=mat;
      const pt=new B.PointLight('cnl_'+col.name+sz,new B.Vector3(x,1.2,z),_scene);
      pt.diffuse=new B.Color3(col.r,col.g,col.b);pt.intensity=0.6;pt.range=3.5;
      sphere._floatBase=1.2;sphere._floatPhase=ci*0.8;sphere._color=col;
      _colorNodes.push({sphere,pt,color:col});
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
  _scene.fogMode=B.Scene.FOGMODE_EXP2;_scene.fogColor=new B.Color3(0.02,0.02,0.05);_scene.fogDensity=isLowEnd?0.005:0.008;
  _camera=new B.UniversalCamera('cam',new B.Vector3(0,GROUND_Y,-48),_scene);_camera.setTarget(B.Vector3.Zero());
  _camera.attachControl(canvas,true);_camera.keysUp=[];_camera.keysDown=[];_camera.keysLeft=[];_camera.keysRight=[];
  _camera.angularSensibility=650;_camera.inertia=0.04;_camera.minZ=0.05;_camera.fov=1.22;
  window._nbSetSpawn=(x,z)=>{if(_camera){_camera.position.x=x;_camera.position.z=z;_camera.position.y=GROUND_Y;_velX=0;_velZ=0;_velY=0;}};
  _pointerLocked=false;
  canvas.addEventListener('click',()=>{if(!_pointerLocked)canvas.requestPointerLock().catch(()=>{});});
  document.addEventListener('pointerlockchange',()=>{
    const wasLocked=_pointerLocked;
    _pointerLocked=document.pointerLockElement===canvas;
    const ch=document.getElementById('play-crosshair');if(ch)ch.style.opacity=_pointerLocked?'1':'0.35';
    // Browser exits pointer lock on Escape before keydown fires —
    // open exit modal when pointer lock is lost (not during death/respawn)
    if(wasLocked&&!_pointerLocked&&!_isDead&&!window._nbPlayExitModalOpen){
      if(window._nbOpenExitModal)window._nbOpenExitModal();
    }
  });
  _keyDownHandler=e=>{_keys[e.code]=true;if(e.code==='ShiftLeft'||e.code==='ShiftRight')_sprinting=true;if(e.code==='Space')e.preventDefault();};
  _keyUpHandler=e=>{_keys[e.code]=false;if(e.code==='ShiftLeft'||e.code==='ShiftRight')_sprinting=false;};
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
  initEnemyNodes(_scene, _camera, _onPlayerDamaged);
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
  return{engine:_engine,scene:_scene};
}

export function destroyGame(engine){
  if(_keyDownHandler){document.removeEventListener('keydown',_keyDownHandler);_keyDownHandler=null;}
  if(_keyUpHandler){document.removeEventListener('keyup',_keyUpHandler);_keyUpHandler=null;}
  if(_mouseDownHandler){document.removeEventListener('mousedown',_mouseDownHandler);_mouseDownHandler=null;}
  if(_mouseUpHandler){document.removeEventListener('mouseup',_mouseUpHandler);_mouseUpHandler=null;}
  _mouseHeld=false;
  if(_scene&&_obsHandler){_scene.onBeforeRenderObservable.remove(_obsHandler);_obsHandler=null;}
  if(_resizeHandler){window.removeEventListener('resize',_resizeHandler);_resizeHandler=null;}
  _projectiles.forEach(p=>{try{p.mesh.dispose();}catch{}});_projectiles.length=0;
  _gooSplats.forEach(s=>{try{s.mesh.dispose();}catch{}});_gooSplats.length=0;
  _remotePlayers.forEach((_,id)=>removeRemotePlayer(id));_remotePlayers.clear();
  _pendingRemotePlayers.clear();
  if(_gunRoot){try{_gunRoot.getChildMeshes().forEach(m=>m.dispose());_gunRoot.dispose();}catch{}_gunRoot=null;}
  if(_jetpackPS){try{_jetpackPS.dispose();}catch{}_jetpackPS=null;}
  if(_jetpackNode){try{_jetpackNode.dispose();}catch{}_jetpackNode=null;}
  _gunPickups.forEach(pu=>{try{pu.base.dispose();pu.orb.dispose();pu.pt.dispose();}catch{}});
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
  _colBlocks.length=0;Object.keys(_keys).forEach(k=>delete _keys[k]);
  _scene=null;_camera=null;_canvas=null;_engine=null;
  if(engine){engine.stopRenderLoop();engine.dispose();}
}
