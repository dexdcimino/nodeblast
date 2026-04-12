// ══════════════════════════════════════
//  NodeBlast — GAME ENGINE
//  Double jump, goo gun splatter, real physics, large crosshair
// ══════════════════════════════════════

import State from './state.js';

let _engine=null,_scene=null,_camera=null,_canvas=null,_pointerLocked=false,_resizeHandler=null,_obsHandler=null;
let _playerUsername='player',_playerHex='5aaa72';

const WALK_SPEED=0.09,SPRINT_MULT=1.85,JUMP_FORCE=0.22,JUMP2_FORCE=0.18,GRAVITY=0.008,FALL_MULT=2.2,GROUND_Y=1.8,AIR_CONTROL=0.28,FRICTION=0.76,INERTIA=0.16;

let _velX=0,_velZ=0,_velY=0,_onGround=true,_sprinting=false,_jumpHeld=false,_jumpsLeft=2;
const _colBlocks=[];
const _keys={};
let _keyDownHandler=null,_keyUpHandler=null,_mouseDownHandler=null;
let _lastShot=0;const SHOT_COOLDOWN=220;const _projectiles=[];const _gooSplats=[];
const _remotePlayers=new Map();

export function refreshPlayerIdentity(){_playerUsername=State.profile?.displayName||State.user?.displayName||'player';_playerHex=State.profile?.hexCode||'5aaa72';}
export function getPlayerState(){if(!_camera)return null;return{x:_camera.position.x,y:_camera.position.y,z:_camera.position.z,rotY:_camera.rotation.y,pitch:_camera.rotation.x,username:_playerUsername,hex:_playerHex};}

function _createRemotePlayerMesh(id,hex,username){
  const B=window.BABYLON,root=new B.TransformNode('rr_'+id,_scene);
  const body=B.MeshBuilder.CreateCapsule('rb_'+id,{height:1.8,radius:0.35,tessellation:10},_scene);
  body.parent=root;body.position.y=0.9;
  const r=parseInt(hex.slice(0,2),16)/255,g=parseInt(hex.slice(2,4),16)/255,b=parseInt(hex.slice(4,6),16)/255;
  const mat=new B.StandardMaterial('rm_'+id,_scene);mat.diffuseColor=new B.Color3(r,g,b);mat.emissiveColor=new B.Color3(r*.3,g*.3,b*.3);body.material=mat;
  const ring=B.MeshBuilder.CreateTorus('rg_'+id,{diameter:0.9,thickness:0.06,tessellation:24},_scene);
  ring.parent=root;ring.position.y=0.05;ring.rotation.x=Math.PI/2;
  const rm=new B.StandardMaterial('rgm_'+id,_scene);rm.emissiveColor=new B.Color3(r,g,b);rm.disableLighting=true;ring.material=rm;
  const lp=B.MeshBuilder.CreatePlane('rl_'+id,{width:2.2,height:0.5},_scene);
  lp.parent=root;lp.position.y=2.35;lp.billboardMode=B.Mesh.BILLBOARDMODE_ALL;
  const lt=new B.DynamicTexture('rlt_'+id,{width:256,height:64},_scene);
  lt.drawText(username,null,46,'bold 26px Outfit,Arial','#'+hex,'transparent',true);
  const lm=new B.StandardMaterial('rlm_'+id,_scene);
  lm.diffuseTexture=lt;lm.emissiveTexture=lt;lm.opacityTexture=lt;lm.backFaceCulling=false;lm.disableLighting=true;lp.material=lm;
  return{root,body,ring,labelPlane:lp,labelTex:lt};
}

export function addOrUpdateRemotePlayer(id,x,y,z,rotY,username,hex){
  let p=_remotePlayers.get(id);
  if(!p){const m=_createRemotePlayerMesh(id,(hex||'5aaa72').replace('#',''),username||'player');
    p={...m,targetX:x,targetY:y-GROUND_Y,targetZ:z,renderX:x,renderY:y-GROUND_Y,renderZ:z,targetRotY:rotY,renderRotY:rotY,lastUpdate:Date.now()};
    _remotePlayers.set(id,p);
  }else{p.targetX=x;p.targetY=y-GROUND_Y;p.targetZ=z;p.targetRotY=rotY;p.lastUpdate=Date.now();}
}
export function getRemotePlayerIds(){return Array.from(_remotePlayers.keys());}
export function removeRemotePlayer(id){const p=_remotePlayers.get(id);if(!p)return;['labelTex','labelPlane','ring','body','root'].forEach(k=>{try{p[k].dispose();}catch{}});_remotePlayers.delete(id);}

function _addCol(x,z,w,d,h){_colBlocks.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2,maxY:h});}

function _resolveCollision(nx,nz,cy){
  const PR=0.45;let rx=nx,rz=nz;
  for(const b of _colBlocks){
    if(cy-GROUND_Y>b.maxY+0.1)continue;
    if(!(rx>b.minX-PR&&rx<b.maxX+PR&&rz>b.minZ-PR&&rz<b.maxZ+PR))continue;
    const pushes=[{a:'x',v:b.minX-PR-rx},{a:'x',v:b.maxX+PR-rx},{a:'z',v:b.minZ-PR-rz},{a:'z',v:b.maxZ+PR-rz}];
    const best=pushes.reduce((a,c)=>Math.abs(c.v)<Math.abs(a.v)?c:a);
    if(best.a==='x')rx+=best.v;else rz+=best.v;
  }
  return{x:rx,z:rz};
}

function _spawnGooSplat(pos){
  const B=window.BABYLON;const n=8+Math.floor(Math.random()*6);
  for(let i=0;i<n;i++){
    const angle=Math.random()*Math.PI*2,radius=0.15+Math.random()*0.55,size=0.08+Math.random()*0.22;
    const blob=B.MeshBuilder.CreateSphere('goo_'+Date.now()+'_'+i,{diameter:size,segments:4},_scene);
    blob.position.set(pos.x+Math.cos(angle)*radius,pos.y+0.02+Math.random()*0.06,pos.z+Math.sin(angle)*radius);
    blob.scaling.y=0.18+Math.random()*0.12;
    const mat=new B.StandardMaterial('gm_'+i+Date.now(),_scene);const br=0.7+Math.random()*0.3;
    mat.diffuseColor=new B.Color3(0,br*0.6,0);mat.emissiveColor=new B.Color3(0,br,br*0.3);blob.material=mat;
    _gooSplats.push(blob);
  }
  const disc=B.MeshBuilder.CreateCylinder('gd_'+Date.now(),{diameter:0.5+Math.random()*0.3,height:0.04,tessellation:10},_scene);
  disc.position.set(pos.x,pos.y+0.02,pos.z);
  const dm=new B.StandardMaterial('gdm_'+Date.now(),_scene);dm.diffuseColor=new B.Color3(0,0.5,0.1);dm.emissiveColor=new B.Color3(0,0.8,0.2);disc.material=dm;
  _gooSplats.push(disc);
  const flash=new B.PointLight('gf_'+Date.now(),pos.clone(),_scene);flash.diffuse=new B.Color3(0.1,1.0,0.3);flash.intensity=2.5;flash.range=8;
  let t=0;const fade=setInterval(()=>{t+=0.15;if(flash.intensity!==undefined)flash.intensity=Math.max(0,2.5-t*2.5);if(t>=1){clearInterval(fade);try{flash.dispose();}catch{}}},16);
  if(_gooSplats.length>300){const old=_gooSplats.splice(0,20);old.forEach(m=>{try{m.dispose();}catch{}});}
}

function _shoot(){
  const now=Date.now();if(now-_lastShot<SHOT_COOLDOWN)return;_lastShot=now;
  const B=window.BABYLON,dir=_camera.getDirection(B.Vector3.Forward()).normalize(),origin=_camera.position.add(dir.scale(0.9));
  const ball=B.MeshBuilder.CreateSphere('proj_'+now,{diameter:0.22,segments:5},_scene);ball.position.copyFrom(origin);
  const mat=new B.StandardMaterial('pm_'+now,_scene);mat.emissiveColor=new B.Color3(0.1,1.0,0.35);mat.alpha=0.88;mat.disableLighting=true;ball.material=mat;
  const flash=new B.PointLight('mf_'+now,origin.clone(),_scene);flash.diffuse=new B.Color3(0.2,1.0,0.4);flash.intensity=3.0;flash.range=7;
  setTimeout(()=>{try{flash.dispose();}catch{}},70);
  _projectiles.push({mesh:ball,vel:dir.scale(1.6),life:80});
}

function _updateProjectiles(){
  const dead=[];
  for(let i=0;i<_projectiles.length;i++){
    const p=_projectiles[i];p.life--;p.mesh.position.addInPlace(p.vel);p.vel.y-=0.006;
    const px=p.mesh.position.x,py=p.mesh.position.y,pz=p.mesh.position.z;
    let hit=false,hitPos=null;
    for(const b of _colBlocks){if(px>b.minX-0.15&&px<b.maxX+0.15&&pz>b.minZ-0.15&&pz<b.maxZ+0.15&&py<b.maxY+0.15&&py>-0.5){hit=true;hitPos=p.mesh.position.clone();break;}}
    if(py<0.12){hit=true;hitPos=new window.BABYLON.Vector3(px,0,pz);}
    if(Math.abs(px)>65||Math.abs(pz)>65)hit=true;
    if(hit||p.life<=0){if(hit&&hitPos)_spawnGooSplat(hitPos);try{p.mesh.dispose();}catch{}dead.push(i);}
  }
  for(let i=dead.length-1;i>=0;i--)_projectiles.splice(dead[i],1);
}

function _physicsTick(){
  if(!_camera||!_scene)return;const B=window.BABYLON;
  const fwd=_camera.getDirection(B.Vector3.Forward());fwd.y=0;fwd.normalize();
  const rgt=_camera.getDirection(B.Vector3.Right());rgt.y=0;rgt.normalize();
  let mx=0,mz=0;
  if(_keys['KeyW']||_keys['ArrowUp']){mx+=fwd.x;mz+=fwd.z;}
  if(_keys['KeyS']||_keys['ArrowDown']){mx-=fwd.x;mz-=fwd.z;}
  if(_keys['KeyD']||_keys['ArrowRight']){mx+=rgt.x;mz+=rgt.z;}
  if(_keys['KeyA']||_keys['ArrowLeft']){mx-=rgt.x;mz-=rgt.z;}
  const ml=Math.sqrt(mx*mx+mz*mz);if(ml>0){mx/=ml;mz/=ml;}
  const spd=WALK_SPEED*(_sprinting?SPRINT_MULT:1),ctrl=_onGround?1:AIR_CONTROL;
  _velX+=((mx*spd)-_velX)*INERTIA*ctrl;_velZ+=((mz*spd)-_velZ)*INERTIA*ctrl;
  if(ml===0&&_onGround){_velX*=FRICTION;_velZ*=FRICTION;}
  _velY-=GRAVITY*(_velY<0?FALL_MULT:1);
  const jumping=_keys['Space'];
  if(jumping&&!_jumpHeld&&_jumpsLeft>0){_velY=_jumpsLeft===2?JUMP_FORCE:JUMP2_FORCE;_jumpsLeft--;_jumpHeld=true;_onGround=false;}
  if(!jumping)_jumpHeld=false;
  const res=_resolveCollision(_camera.position.x+_velX,_camera.position.z+_velZ,_camera.position.y);
  _camera.position.x=res.x;_camera.position.z=res.z;_camera.position.y+=_velY;
  if(_camera.position.y<=GROUND_Y){_camera.position.y=GROUND_Y;_velY=0;_onGround=true;_jumpsLeft=2;}
  _camera.position.x=Math.max(-58,Math.min(58,_camera.position.x));
  _camera.position.z=Math.max(-58,Math.min(58,_camera.position.z));
  _updateProjectiles();
  const now=Date.now();
  _remotePlayers.forEach(p=>{
    p.renderX+=(p.targetX-p.renderX)*0.2;p.renderY+=(p.targetY-p.renderY)*0.2;
    p.renderZ+=(p.targetZ-p.renderZ)*0.2;p.renderRotY+=(p.targetRotY-p.renderRotY)*0.2;
    p.root.position.set(p.renderX,p.renderY,p.renderZ);p.root.rotation.y=p.renderRotY;
    p.root.setEnabled(now-p.lastUpdate<=5000);
  });
}

function _createSkybox(){
  const B=window.BABYLON,sky=B.MeshBuilder.CreateBox('skybox',{size:1200},_scene);
  const mat=new B.ShaderMaterial('skyShader',_scene,{
    vertexSource:'precision highp float;attribute vec3 position;uniform mat4 worldViewProjection;varying vec3 vPos;void main(){vPos=position;gl_Position=worldViewProjection*vec4(position,1.0);}',
    fragmentSource:'precision highp float;varying vec3 vPos;void main(){float t=clamp((normalize(vPos).y+1.0)*0.5,0.0,1.0);vec3 h=vec3(0.05,0.02,0.10);vec3 z=vec3(0.01,0.01,0.06);vec3 p=normalize(vPos)*120.0;float s=step(0.995,fract(sin(dot(floor(p),vec3(127.1,311.7,74.3)))*43758.5));vec3 c=mix(h,z,t)+s*0.8*smoothstep(0.4,1.0,t);gl_FragColor=vec4(c,1.0);}',
  },{attributes:['position'],uniforms:['worldViewProjection']});
  mat.backFaceCulling=false;sky.material=mat;sky.infiniteDistance=true;
}

function _buildArena(){
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

  const W=60;
  [{x:0,z:W,w:W*2,d:1},{x:0,z:-W,w:W*2,d:1},{x:W,z:0,w:1,d:W*2},{x:-W,z:0,w:1,d:W*2}].forEach((w,i)=>{
    const wall=B.MeshBuilder.CreateBox('bd_'+i,{width:w.w,height:12,depth:w.d},_scene);wall.position.set(w.x,6,w.z);wall.isVisible=false;_addCol(w.x,w.z,w.w,w.d,12);
  });

  const spot=new B.SpotLight('spot',new B.Vector3(0,30,0),new B.Vector3(0,-1,0),Math.PI/5,10,_scene);spot.intensity=0.55;spot.diffuse=new B.Color3(0.85,0.95,1.0);
}

export function initGame(canvas){
  const B=window.BABYLON;if(!B)throw new Error('Babylon.js not loaded');
  _canvas=canvas;_colBlocks.length=0;refreshPlayerIdentity();
  _engine=new B.Engine(canvas,true,{adaptToDeviceRatio:true,antialias:true});
  _scene=new B.Scene(_engine);_scene.clearColor=new B.Color4(0.02,0.02,0.05,1);_scene.collisionsEnabled=false;
  _createSkybox();
  const hemi=new B.HemisphericLight('hemi',new B.Vector3(0,1,0),_scene);hemi.intensity=0.30;hemi.diffuse=new B.Color3(0.55,0.60,0.85);hemi.groundColor=new B.Color3(0.04,0.04,0.07);
  const dir=new B.DirectionalLight('dir',new B.Vector3(-0.5,-1,-0.3),_scene);dir.intensity=0.65;dir.diffuse=new B.Color3(0.85,0.82,0.75);dir.position=new B.Vector3(30,50,30);
  _scene.fogMode=B.Scene.FOGMODE_EXP2;_scene.fogColor=new B.Color3(0.02,0.02,0.05);_scene.fogDensity=0.008;
  _camera=new B.UniversalCamera('cam',new B.Vector3(0,GROUND_Y,-48),_scene);_camera.setTarget(B.Vector3.Zero());
  _camera.attachControl(canvas,true);_camera.keysUp=[];_camera.keysDown=[];_camera.keysLeft=[];_camera.keysRight=[];
  _camera.angularSensibility=650;_camera.inertia=0.04;_camera.minZ=0.05;_camera.fov=1.22;
  _pointerLocked=false;
  canvas.addEventListener('click',()=>{if(!_pointerLocked)canvas.requestPointerLock();});
  document.addEventListener('pointerlockchange',()=>{
    _pointerLocked=document.pointerLockElement===canvas;
    const ch=document.getElementById('play-crosshair');if(ch)ch.style.opacity=_pointerLocked?'1':'0.35';
  });
  _keyDownHandler=e=>{_keys[e.code]=true;if(e.code==='ShiftLeft'||e.code==='ShiftRight')_sprinting=true;if(e.code==='Space')e.preventDefault();};
  _keyUpHandler=e=>{_keys[e.code]=false;if(e.code==='ShiftLeft'||e.code==='ShiftRight')_sprinting=false;};
  document.addEventListener('keydown',_keyDownHandler);document.addEventListener('keyup',_keyUpHandler);
  _mouseDownHandler=e=>{if(e.button===0&&_pointerLocked)_shoot();};
  document.addEventListener('mousedown',_mouseDownHandler);
  _buildArena();
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
  if(_scene&&_obsHandler){_scene.onBeforeRenderObservable.remove(_obsHandler);_obsHandler=null;}
  if(_resizeHandler){window.removeEventListener('resize',_resizeHandler);_resizeHandler=null;}
  _projectiles.forEach(p=>{try{p.mesh.dispose();}catch{}});_projectiles.length=0;
  _gooSplats.forEach(m=>{try{m.dispose();}catch{}});_gooSplats.length=0;
  _remotePlayers.forEach((_,id)=>removeRemotePlayer(id));_remotePlayers.clear();
  window._nbGetPlayerState=null;
  _velX=0;_velZ=0;_velY=0;_onGround=true;_sprinting=false;_jumpHeld=false;_jumpsLeft=2;
  _colBlocks.length=0;Object.keys(_keys).forEach(k=>delete _keys[k]);
  _scene=null;_camera=null;_canvas=null;_engine=null;
  if(engine){engine.stopRenderLoop();engine.dispose();}
}
