import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const BLOCKS=[{id:'grass',colour:0x64a83d},{id:'dirt',colour:0x8b5a2b},{id:'stone',colour:0x80868b},{id:'sand',colour:0xd9c27a},{id:'wood',colour:0x9a6a3a}];
const WORLD_SIZE=30, PLAYER_HEIGHT=1.7, PLAYER_RADIUS=.28, MAX_HP=100, SCORE_TO_WIN=150, KILL_SCORE=10, ROUND_SECONDS=300;
const $=id=>document.getElementById(id), canvas=$('game'), menu=$('menu'), hud=$('hud'), mobile=$('mobile'), status=$('menuStatus');
const isTouch=matchMedia('(pointer:coarse)').matches||'ontouchstart'in window;

const scene=new THREE.Scene(); scene.background=new THREE.Color(0x87c9ff); scene.fog=new THREE.Fog(0x87c9ff,34,85);
const camera=new THREE.PerspectiveCamera(72,innerWidth/innerHeight,.1,1000); camera.rotation.order='YXZ';
const renderer=new THREE.WebGLRenderer({canvas,antialias:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setSize(innerWidth,innerHeight); renderer.shadowMap.enabled=true;
scene.add(new THREE.HemisphereLight(0xdff3ff,0x52643c,1.75)); const sun=new THREE.DirectionalLight(0xffffff,1.45); sun.position.set(20,30,14); sun.castShadow=true; scene.add(sun);
const controls=new PointerLockControls(camera,document.body); scene.add(controls.object);

const cubeGeo=new THREE.BoxGeometry(1,1,1), materials=Object.fromEntries(BLOCKS.map(b=>[b.id,new THREE.MeshLambertMaterial({color:b.colour})]));
const blocks=new Map(), remotes=new Map(), connections=new Map(), playerStates=new Map();
let peer=null, roomId=null, isHost=false, started=false, selectedBlock=0, buildMode=false, team='blue', hp=MAX_HP, ammo=12, reloading=false;
let velocityY=0, grounded=false, mobileMove={x:0,y:0}, touchLook=null, targetYaw=0, targetPitch=0, smoothYaw=0, smoothPitch=0, lastNetworkSend=0, lastShot=0;
let blueScore=0, redScore=0, roundEnd=0, roundOver=false, countdownSent=0;
const key=(x,y,z)=>`${x},${y},${z}`;

function addBlock(x,y,z,type='grass',send=false){const k=key(x,y,z);if(blocks.has(k))return;const m=new THREE.Mesh(cubeGeo,materials[type]||materials.grass);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;m.userData={x,y,z,type,block:true};scene.add(m);blocks.set(k,m);if(send)sendWorld({kind:'setBlock',x,y,z,type});}
function removeBlock(x,y,z,send=false){const k=key(x,y,z),m=blocks.get(k);if(!m)return;scene.remove(m);blocks.delete(k);if(send)sendWorld({kind:'removeBlock',x,y,z});}
function generateWorld(){clearWorld();for(let x=-WORLD_SIZE/2;x<WORLD_SIZE/2;x++)for(let z=-WORLD_SIZE/2;z<WORLD_SIZE/2;z++){const h=Math.max(0,Math.floor((Math.sin(x*.34)+Math.cos(z*.3))*.55));for(let y=-2;y<=h;y++)addBlock(x,y,z,y===h?'grass':y===h-1?'dirt':'stone');}
  for(let y=1;y<5;y++)for(let z=-7;z<=7;z++)if(Math.abs(z)>2)addBlock(0,y,z,'stone');
  for(let x=-13;x<=-10;x++)for(let z=-3;z<=3;z++)addBlock(x,1,z,'wood');
  for(let x=10;x<=13;x++)for(let z=-3;z<=3;z++)addBlock(x,1,z,'wood');
}
function clearWorld(){for(const m of blocks.values())scene.remove(m);blocks.clear();}
const snapshot=()=>[...blocks.values()].map(m=>m.userData); function loadSnapshot(data=[]){clearWorld();data.forEach(b=>addBlock(b.x,b.y,b.z,b.type));}
function spawnPoint(which=team){return which==='blue'?new THREE.Vector3(-11,6,0):new THREE.Vector3(11,6,0);}
function respawn(){hp=MAX_HP;updateHP();controls.object.position.copy(spawnPoint());velocityY=0;targetYaw=team==='blue'?-Math.PI/2:Math.PI/2;smoothYaw=targetYaw;camera.rotation.set(0,smoothYaw,0);toast(`Respawned on ${team.toUpperCase()} team`);}

function makeGun(){const gun=new THREE.Group();gun.name='pixelGun';const dark=new THREE.MeshLambertMaterial({color:0x20242b}),metal=new THREE.MeshLambertMaterial({color:0x5f6b78}),accent=new THREE.MeshLambertMaterial({color:0xf59e0b});
 const body=new THREE.Mesh(new THREE.BoxGeometry(.32,.22,.75),metal);body.position.set(.34,-.3,-.72);const barrel=new THREE.Mesh(new THREE.BoxGeometry(.14,.14,.55),dark);barrel.position.set(.34,-.27,-1.28);const grip=new THREE.Mesh(new THREE.BoxGeometry(.16,.38,.18),dark);grip.position.set(.34,-.52,-.67);grip.rotation.x=-.22;const sight=new THREE.Mesh(new THREE.BoxGeometry(.08,.09,.16),accent);sight.position.set(.34,-.14,-.82);gun.add(body,barrel,grip,sight);camera.add(gun);return gun;}
const gun=makeGun(); let recoil=0;

function toast(text){const e=$('toast');e.textContent=text;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),1600);}
function roundMessage(text,ms=1800){const e=$('roundMessage');e.textContent=text;e.classList.remove('hidden');clearTimeout(roundMessage.t);roundMessage.t=setTimeout(()=>e.classList.add('hidden'),ms);}
const randomRoom=()=>Math.random().toString(36).slice(2,8).toUpperCase(), cleanName=()=>($('playerName').value.trim()||'Player').slice(0,16);
function updateHP(){hp=Math.max(0,Math.min(MAX_HP,hp));$('hpText').textContent=`HP ${hp}`;$('hpFill').style.width=`${hp}%`;$('hpFill').style.background=hp>55?'linear-gradient(90deg,#22c55e,#86efac)':hp>25?'#f59e0b':'#ef4444';}
function updateHUD(){ $('blueScore').textContent=`BLUE ${blueScore}`;$('redScore').textContent=`RED ${redScore}`;$('teamBadge').textContent=`${team.toUpperCase()} TEAM`;$('teamBadge').style.color=team==='blue'?'#60a5fa':'#f87171';$('ammo').textContent=reloading?'RELOADING…':`${ammo} / 12`;$('modeBadge').textContent=buildMode?'BUILD MODE':'COMBAT';$('hotbar').classList.toggle('hidden',!buildMode);$('shootBtn').classList.toggle('hidden',buildMode);document.querySelectorAll('.build-only').forEach(e=>e.classList.toggle('hidden',!buildMode));$('modeBtn').textContent=buildMode?'Combat':'Build'; }
function updateCount(){$('playersBadge').textContent=`Players: ${1+connections.size}`;}
function formatTime(s){s=Math.max(0,Math.ceil(s));return`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}

function startGame(label){started=true;menu.classList.add('hidden');hud.classList.remove('hidden');if(isTouch)mobile.classList.remove('hidden');else try{controls.lock()}catch{};$('roomBadge').textContent=label;roundEnd=roundEnd||performance.now()/1000+ROUND_SECONDS;updateCount();buildHotbar();updateHP();updateHUD();respawn();resize();roundMessage('TEAM DEATHMATCH');}
function createPeer(id){return new Promise((resolve,reject)=>{peer=new Peer(id?`blockworld-${id}`:undefined);peer.on('open',resolve);peer.on('error',reject);});}
$('soloBtn').onclick=()=>{isHost=true;generateWorld();roundEnd=performance.now()/1000+ROUND_SECONDS;startGame('Training');};
$('hostBtn').onclick=async()=>{try{status.textContent='Creating match…';roomId=randomRoom();isHost=true;team='blue';generateWorld();roundEnd=performance.now()/1000+ROUND_SECONDS;await createPeer(roomId);peer.on('connection',acceptConnection);startGame(`Room: ${roomId}`);toast(`Share code ${roomId}`)}catch(e){status.textContent=`Could not create match: ${e.type||e.message}`}};
$('joinBtn').onclick=async()=>{roomId=$('roomInput').value.trim().toUpperCase();if(!roomId){status.textContent='Enter a room code.';return}try{status.textContent='Joining match…';await createPeer();const c=peer.connect(`blockworld-${roomId}`,{reliable:true});c.on('open',()=>{connections.set(c.peer,c);wire(c);c.send({kind:'hello',name:cleanName()});startGame(`Room: ${roomId}`)});c.on('error',()=>status.textContent='Could not join that match.')}catch(e){status.textContent=`Could not join: ${e.type||e.message}`}};
function acceptConnection(c){connections.set(c.peer,c);wire(c);c.on('open',()=>{const blue=[...playerStates.values()].filter(p=>p.team==='blue').length+1,red=[...playerStates.values()].filter(p=>p.team==='red').length;const assigned=red<blue?'red':'blue';playerStates.set(c.peer,{name:'Player',team:assigned,hp:MAX_HP});c.send({kind:'snapshot',world:snapshot(),players:localPlayers(),team:assigned,blueScore,redScore,remaining:Math.max(0,roundEnd-performance.now()/1000)});updateCount();});}
function wire(c){c.on('data',d=>handleNetwork(d,c));c.on('close',()=>{connections.delete(c.peer);playerStates.delete(c.peer);removeRemote(c.peer);updateCount();broadcast({kind:'playerLeft',id:c.peer})});}
function handleNetwork(d,c){if(!d?.kind)return;
 if(d.kind==='hello'&&isHost){const st=playerStates.get(c.peer)||{team:'red',hp:MAX_HP};st.name=d.name;playerStates.set(c.peer,st);broadcast({kind:'notice',text:`${d.name} joined ${st.team} team`});return;}
 if(d.kind==='snapshot'){loadSnapshot(d.world);team=d.team||'red';blueScore=d.blueScore||0;redScore=d.redScore||0;roundEnd=performance.now()/1000+(d.remaining||ROUND_SECONDS);(d.players||[]).forEach(updateRemote);updateHUD();respawn();return;}
 if(d.kind==='setBlock')addBlock(d.x,d.y,d.z,d.type);if(d.kind==='removeBlock')removeBlock(d.x,d.y,d.z);
 if(d.kind==='player'){d.id=c.peer;updateRemote(d);if(isHost){const st=playerStates.get(c.peer)||{};Object.assign(st,{name:d.name,team:d.team,hp:d.hp});playerStates.set(c.peer,st);broadcast(d,c.peer)}}
 if(d.kind==='shot'&&isHost)processShot(d,c.peer);
 if(d.kind==='damage'&&d.target===peer?.id)takeDamage(d.amount,d.attacker,d.attackerTeam);
 if(d.kind==='score'){blueScore=d.blue;redScore=d.red;updateHUD();}
 if(d.kind==='round'){blueScore=d.blue;redScore=d.red;roundOver=d.over;roundEnd=performance.now()/1000+d.remaining;updateHUD();if(d.message)roundMessage(d.message,3000);}
 if(d.kind==='playerLeft')removeRemote(d.id);if(d.kind==='notice')toast(d.text);
 if(isHost&&['setBlock','removeBlock'].includes(d.kind))broadcast(d,c.peer);
}
function broadcast(d,except=null){for(const[id,c]of connections)if(id!==except&&c.open)c.send(d)} function sendWorld(d){if(!peer)return;isHost?broadcast(d):[...connections.values()][0]?.send(d)}
function localPlayers(){return[...remotes].map(([id,p])=>({kind:'player',id,name:p.name,team:p.team,x:p.group.position.x,y:p.group.position.y+PLAYER_HEIGHT,z:p.group.position.z,ry:p.group.rotation.y,rp:p.head.rotation.x,hp:p.hp}))}

function createAvatar(id,p){const group=new THREE.Group(), teamMat=new THREE.MeshLambertMaterial({color:p.team==='red'?0xef4444:0x3b82f6}),skin=new THREE.MeshLambertMaterial({color:0xf0c8a0}),dark=new THREE.MeshLambertMaterial({color:0x222831});
 const body=new THREE.Mesh(new THREE.BoxGeometry(.62,1.05,.38),teamMat);body.position.y=.9;const headPivot=new THREE.Group();headPivot.position.y=1.62;const head=new THREE.Mesh(new THREE.BoxGeometry(.52,.52,.52),skin);head.userData={playerId:id,hitbox:true};headPivot.add(head);const gunMesh=new THREE.Mesh(new THREE.BoxGeometry(.18,.18,.72),dark);gunMesh.position.set(.43,1.05,-.48);gunMesh.userData={playerId:id,hitbox:true};body.userData={playerId:id,hitbox:true};group.add(body,headPivot,gunMesh);scene.add(group);return{group,head:headPivot,body,gun:gunMesh,name:p.name||'Player',team:p.team||'red',hp:p.hp??100};}
function updateRemote(p){const id=p.id;if(!id||id===peer?.id)return;let e=remotes.get(id);if(!e){e=createAvatar(id,p);remotes.set(id,e)}if(p.team&&p.team!==e.team){e.team=p.team;e.body.material.color.set(p.team==='red'?0xef4444:0x3b82f6)}e.name=p.name||e.name;e.hp=p.hp??e.hp;e.group.position.set(p.x,p.y-PLAYER_HEIGHT,p.z);e.group.rotation.y=p.ry||0;e.head.rotation.x=p.rp||0;}
function removeRemote(id){const e=remotes.get(id);if(e){scene.remove(e.group);remotes.delete(id)}}

const ray=new THREE.Raycaster();ray.far=55;
function shoot(){const now=performance.now();if(buildMode||roundOver||reloading||now-lastShot<180)return;if(ammo<=0){reload();return}lastShot=now;ammo--;recoil=.11;updateHUD();ray.setFromCamera(new THREE.Vector2(0,0),camera);const hitMeshes=[];for(const p of remotes.values())p.group.traverse(o=>{if(o.isMesh&&o.userData.hitbox)hitMeshes.push(o)});const hits=ray.intersectObjects(hitMeshes,false);if(hits.length){const target=hits[0].object.userData.playerId,head=hits[0].object===remotes.get(target)?.head.children[0],damage=head?50:25;$('hitmarker').classList.add('show');setTimeout(()=>$('hitmarker').classList.remove('show'),90);const msg={kind:'shot',target,damage,attacker:peer?.id||'host',attackerName:cleanName(),attackerTeam:team};if(isHost)processShot(msg,peer?.id||'host');else[...connections.values()][0]?.send(msg)}if(ammo===0)setTimeout(reload,300);}
function reload(){if(reloading||ammo===12)return;reloading=true;updateHUD();setTimeout(()=>{ammo=12;reloading=false;updateHUD()},1300)}
function processShot(d){if(!isHost||roundOver)return;const targetState=d.target===peer?.id?{team,hp}:playerStates.get(d.target);if(!targetState||targetState.team===d.attackerTeam)return;targetState.hp=Math.max(0,(targetState.hp??MAX_HP)-d.damage);if(d.target===peer?.id){hp=targetState.hp;updateHP()}else{playerStates.set(d.target,targetState);connections.get(d.target)?.send({kind:'damage',target:d.target,amount:d.damage,attacker:d.attackerName,attackerTeam:d.attackerTeam});}
 if(targetState.hp<=0){if(d.attackerTeam==='blue')blueScore+=KILL_SCORE;else redScore+=KILL_SCORE;targetState.hp=MAX_HP;if(d.target===peer?.id)setTimeout(respawn,900);else playerStates.set(d.target,targetState);broadcast({kind:'score',blue:blueScore,red:redScore});updateHUD();broadcast({kind:'notice',text:`${d.attackerName} scored for ${d.attackerTeam.toUpperCase()}`});checkWinner();}}
function takeDamage(amount,attacker){if(roundOver)return;hp=Math.max(0,hp-amount);updateHP();if(hp<=0){roundMessage(`ELIMINATED BY ${attacker||'PLAYER'}`,900);setTimeout(respawn,1000)}}
function checkWinner(){if(blueScore>=SCORE_TO_WIN||redScore>=SCORE_TO_WIN)finishRound(blueScore>redScore?'BLUE TEAM WINS':'RED TEAM WINS')}
function finishRound(message){if(roundOver)return;roundOver=true;broadcast({kind:'round',blue:blueScore,red:redScore,remaining:0,over:true,message});roundMessage(message,5000);}

function interact(place){ray.far=7;ray.setFromCamera(new THREE.Vector2(0,0),camera);const hits=ray.intersectObjects([...blocks.values()],false);ray.far=55;if(!hits.length)return;const hit=hits[0],b=hit.object.userData;if(place){const n=hit.face.normal,x=b.x+n.x,y=b.y+n.y,z=b.z+n.z;if(Math.abs(camera.position.x-x)<.8&&Math.abs(camera.position.z-z)<.8&&Math.abs(camera.position.y-y)<1.8)return;addBlock(x,y,z,BLOCKS[selectedBlock].id,true)}else if(b.y>-2)removeBlock(b.x,b.y,b.z,true)}
function toggleMode(){buildMode=!buildMode;updateHUD();toast(buildMode?'Build mode: select and place blocks':'Combat mode: weapon ready')}
function selectBlock(i){selectedBlock=Math.max(0,Math.min(BLOCKS.length-1,i));buildHotbar();toast(`${BLOCKS[selectedBlock].id} selected`)}
function buildHotbar(){const h=$('hotbar');h.innerHTML='';BLOCKS.forEach((b,i)=>{const d=document.createElement('button');d.className=`slot ${i===selectedBlock?'selected':''}`;d.innerHTML=`<div class="swatch" style="background:#${b.colour.toString(16).padStart(6,'0')}"></div>`;d.onpointerdown=e=>{e.preventDefault();e.stopPropagation();selectBlock(i)};h.append(d)})}

const keys={};addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='KeyB')toggleMode();if(e.code==='KeyR')reload();if(/^Digit[1-5]$/.test(e.code))selectBlock(Number(e.code.at(-1))-1)});addEventListener('keyup',e=>keys[e.code]=false);
controls.addEventListener('lock',()=>$('desktopHint').classList.add('hidden'));controls.addEventListener('unlock',()=>{if(started&&!isTouch)$('desktopHint').classList.remove('hidden')});canvas.onclick=()=>{if(started&&!isTouch&&!controls.isLocked)controls.lock()};canvas.oncontextmenu=e=>e.preventDefault();canvas.onmousedown=e=>{if(!controls.isLocked)return;if(buildMode){if(e.button===0)interact(false);if(e.button===2)interact(true)}else if(e.button===0)shoot()};
function collides(pos){for(let x=Math.floor(pos.x-PLAYER_RADIUS);x<=Math.floor(pos.x+PLAYER_RADIUS);x++)for(let y=Math.floor(pos.y-PLAYER_HEIGHT);y<=Math.floor(pos.y-.05);y++)for(let z=Math.floor(pos.z-PLAYER_RADIUS);z<=Math.floor(pos.z+PLAYER_RADIUS);z++)if(blocks.has(key(x,y,z)))return true;return false;}
function move(dt){const speed=(keys.ShiftLeft?7:4.7)*dt;let f=(keys.KeyW?1:0)-(keys.KeyS?1:0)-mobileMove.y,s=(keys.KeyD?1:0)-(keys.KeyA?1:0)+mobileMove.x,l=Math.hypot(f,s)||1;f/=l;s/=l;let old=controls.object.position.clone();controls.moveRight(s*speed);if(collides(controls.object.position))controls.object.position.copy(old);old=controls.object.position.clone();controls.moveForward(f*speed);if(collides(controls.object.position))controls.object.position.copy(old);if((keys.Space||keys.__jump)&&grounded){velocityY=7;grounded=false;keys.__jump=false}velocityY-=18*dt;const y=controls.object.position.y;controls.object.position.y+=velocityY*dt;if(collides(controls.object.position)){controls.object.position.y=y;if(velocityY<0)grounded=true;velocityY=0}else grounded=false;if(controls.object.position.y<-10)respawn();}

function repeatButton(btn,action,delay=180){let t;const stop=()=>{clearInterval(t);t=null};btn.onpointerdown=e=>{e.preventDefault();e.stopPropagation();action();stop();t=setInterval(action,delay);try{btn.setPointerCapture(e.pointerId)}catch{}};btn.onpointerup=stop;btn.onpointercancel=stop;btn.onlostpointercapture=stop;}
function setupMobile(){const joy=$('joystick'),stick=$('stick'),reset=()=>{mobileMove={x:0,y:0};stick.style.transform='translate(0,0)'};joy.onpointerdown=e=>{e.preventDefault();joy.setPointerCapture(e.pointerId)};joy.onpointermove=e=>{if(!joy.hasPointerCapture(e.pointerId))return;const r=joy.getBoundingClientRect(),x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2,m=Math.min(38,Math.hypot(x,y)),a=Math.atan2(y,x);mobileMove={x:Math.cos(a)*m/38,y:Math.sin(a)*m/38};stick.style.transform=`translate(${mobileMove.x*34}px,${mobileMove.y*34}px)`};joy.onpointerup=reset;joy.onpointercancel=reset;
 repeatButton($('jumpBtn'),()=>keys.__jump=true,260);repeatButton($('shootBtn'),shoot,190);repeatButton($('breakBtn'),()=>interact(false),180);repeatButton($('placeBtn'),()=>interact(true),190);$('modeBtn').onclick=toggleMode;$('fullscreenBtn').onclick=enterFullscreen;
 const zone=$('lookZone');zone.onpointerdown=e=>{if(e.target!==zone)return;e.preventDefault();zone.setPointerCapture(e.pointerId);touchLook={id:e.pointerId,x:e.clientX,y:e.clientY}};zone.onpointermove=e=>{if(!touchLook||touchLook.id!==e.pointerId)return;e.preventDefault();const dx=e.clientX-touchLook.x,dy=e.clientY-touchLook.y;targetYaw-=dx*.00225;targetPitch=THREE.MathUtils.clamp(targetPitch-dy*.00195,-1.28,1.28);touchLook.x=e.clientX;touchLook.y=e.clientY};zone.onpointerup=e=>{if(touchLook?.id===e.pointerId)touchLook=null};zone.onpointercancel=zone.onpointerup;}
async function enterFullscreen(){try{if(!document.fullscreenElement&&document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen()}catch{}try{await screen.orientation?.lock?.('landscape')}catch{}resize()}
setupMobile();

const clock=new THREE.Clock();function animate(t){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);if(started){smoothYaw=THREE.MathUtils.lerp(smoothYaw,targetYaw,1-Math.pow(.0005,dt));smoothPitch=THREE.MathUtils.lerp(smoothPitch,targetPitch,1-Math.pow(.0005,dt));if(isTouch)camera.rotation.set(smoothPitch,smoothYaw,0,'YXZ');else{targetYaw=camera.rotation.y;targetPitch=camera.rotation.x;smoothYaw=targetYaw;smoothPitch=targetPitch}move(dt);recoil=THREE.MathUtils.lerp(recoil,0,1-Math.pow(.001,dt));gun.position.z=recoil;gun.rotation.x=recoil*1.8;
 const now=t/1000,remaining=Math.max(0,roundEnd-now);$('timer').textContent=formatTime(remaining);if(isHost&&!roundOver&&remaining<=0)finishRound(blueScore===redScore?'DRAW':blueScore>redScore?'BLUE TEAM WINS':'RED TEAM WINS');if(isHost&&t-countdownSent>1000){broadcast({kind:'round',blue:blueScore,red:redScore,remaining,over:roundOver});countdownSent=t}}
 if(peer&&t-lastNetworkSend>75){const p=controls.object.position,msg={kind:'player',name:cleanName(),team,hp,x:p.x,y:p.y,z:p.z,ry:camera.rotation.y,rp:camera.rotation.x};isHost?broadcast(msg):[...connections.values()][0]?.send(msg);lastNetworkSend=t}renderer.render(scene,camera)}animate(0);
function resize(){const w=visualViewport?.width||innerWidth,h=visualViewport?.height||innerHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false)}addEventListener('resize',resize);addEventListener('orientationchange',()=>setTimeout(resize,250));visualViewport?.addEventListener('resize',resize);
