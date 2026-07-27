import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const BLOCKS = [
  { id: 'grass', colour: 0x64a83d },
  { id: 'dirt', colour: 0x8b5a2b },
  { id: 'stone', colour: 0x80868b },
  { id: 'sand', colour: 0xd9c27a },
  { id: 'wood', colour: 0x9a6a3a }
];
const WORLD_SIZE = 24;
const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.28;
const LOOK_SENSITIVITY = 0.0032;

const $ = id => document.getElementById(id);
const canvas = $('game');
const menu = $('menu');
const hud = $('hud');
const mobile = $('mobile');
const status = $('menuStatus');
const roomBadge = $('roomBadge');
const playersBadge = $('playersBadge');
const toastEl = $('toast');
const isTouchDevice = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87c9ff);
scene.fog = new THREE.Fog(0x87c9ff, 28, 70);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000);
camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;

scene.add(new THREE.HemisphereLight(0xdff3ff, 0x5a6b3c, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(18, 28, 12);
sun.castShadow = true;
scene.add(sun);

const controls = new PointerLockControls(camera, document.body);
scene.add(controls.object);
controls.object.position.set(0, 8, 7);

const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
const materials = Object.fromEntries(BLOCKS.map(b => [b.id, new THREE.MeshLambertMaterial({ color: b.colour })]));
const blocks = new Map();
const remotePlayers = new Map();
const connections = new Map();
let selectedBlock = 0;
let peer = null;
let roomId = null;
let isHost = false;
let started = false;
let lastNetworkSend = 0;
let velocityY = 0;
let grounded = false;
let mobileMove = { x: 0, y: 0 };
let touchLook = null;
let yaw = 0;
let pitch = 0;

const key = (x, y, z) => `${x},${y},${z}`;

function addBlock(x, y, z, type = 'grass', broadcast = false) {
  const k = key(x, y, z);
  if (blocks.has(k)) return;
  const mesh = new THREE.Mesh(cubeGeo, materials[type] || materials.grass);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { x, y, z, type };
  scene.add(mesh);
  blocks.set(k, mesh);
  if (broadcast) sendWorldAction({ kind: 'setBlock', x, y, z, type });
}

function removeBlock(x, y, z, broadcast = false) {
  const k = key(x, y, z);
  const mesh = blocks.get(k);
  if (!mesh) return;
  scene.remove(mesh);
  blocks.delete(k);
  if (broadcast) sendWorldAction({ kind: 'removeBlock', x, y, z });
}

function generateWorld() {
  for (let x = -WORLD_SIZE / 2; x < WORLD_SIZE / 2; x++) {
    for (let z = -WORLD_SIZE / 2; z < WORLD_SIZE / 2; z++) {
      const h = Math.max(0, Math.floor((Math.sin(x * .45) + Math.cos(z * .38)) * .75));
      for (let y = -2; y <= h; y++) {
        addBlock(x, y, z, y === h ? 'grass' : (y === h - 1 ? 'dirt' : 'stone'));
      }
    }
  }
}

function clearWorld() {
  for (const mesh of blocks.values()) scene.remove(mesh);
  blocks.clear();
}

function snapshot() { return [...blocks.values()].map(m => m.userData); }
function loadSnapshot(data) { clearWorld(); for (const b of data) addBlock(b.x, b.y, b.z, b.type); }

function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}
function randomRoom() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
function cleanName() { return ($('playerName').value.trim() || 'Builder').slice(0, 16); }

function startGame(label) {
  started = true;
  menu.classList.add('hidden');
  hud.classList.remove('hidden');
  $('desktopHint').classList.add('hidden');
  if (isTouchDevice) {
    mobile.classList.remove('hidden');
  } else {
    try { controls.lock(); } catch (_) {}
  }
  roomBadge.textContent = label;
  updatePlayerCount();
  buildHotbar();
  resizeGame();
}

function createPeer(id) {
  return new Promise((resolve, reject) => {
    peer = new Peer(id ? `blockworld-${id}` : undefined);
    peer.on('open', resolve);
    peer.on('error', reject);
  });
}

$('soloBtn').onclick = () => { isHost = true; generateWorld(); startGame('Solo world'); };
$('hostBtn').onclick = async () => {
  try {
    status.textContent = 'Creating room…';
    roomId = randomRoom(); isHost = true; generateWorld();
    await createPeer(roomId);
    peer.on('connection', acceptConnection);
    startGame(`Room: ${roomId}`);
    toast(`Share room code ${roomId}`);
  } catch (e) { status.textContent = `Could not create room: ${e.type || e.message}`; }
};
$('joinBtn').onclick = async () => {
  roomId = $('roomInput').value.trim().toUpperCase();
  if (!roomId) { status.textContent = 'Enter a room code.'; return; }
  try {
    status.textContent = 'Joining room…';
    await createPeer();
    const conn = peer.connect(`blockworld-${roomId}`, { reliable: true });
    conn.on('open', () => {
      connections.set(conn.peer, conn);
      wireConnection(conn);
      conn.send({ kind: 'hello', name: cleanName() });
      startGame(`Room: ${roomId}`);
    });
    conn.on('error', () => status.textContent = 'Could not join that room.');
  } catch (e) { status.textContent = `Could not join: ${e.type || e.message}`; }
};

function acceptConnection(conn) {
  connections.set(conn.peer, conn);
  wireConnection(conn);
  conn.on('open', () => conn.send({ kind: 'snapshot', world: snapshot(), players: localPlayerList() }));
}
function wireConnection(conn) {
  conn.on('data', data => handleNetwork(data, conn));
  conn.on('close', () => {
    connections.delete(conn.peer);
    removeRemote(conn.peer);
    updatePlayerCount();
    broadcast({ kind: 'playerLeft', id: conn.peer });
  });
}
function handleNetwork(data, conn) {
  if (!data || !data.kind) return;
  if (data.kind === 'hello' && isHost) { conn.playerName = data.name; broadcast({ kind: 'notice', text: `${data.name} joined` }); updatePlayerCount(); return; }
  if (data.kind === 'snapshot') { loadSnapshot(data.world); for (const p of data.players || []) updateRemote(p); return; }
  if (data.kind === 'setBlock') addBlock(data.x, data.y, data.z, data.type);
  if (data.kind === 'removeBlock') removeBlock(data.x, data.y, data.z);
  if (data.kind === 'player') { data.id = conn.peer; updateRemote(data); if (isHost) broadcast(data, conn.peer); }
  if (data.kind === 'playerLeft') removeRemote(data.id);
  if (data.kind === 'notice') toast(data.text);
  if (isHost && ['setBlock', 'removeBlock'].includes(data.kind)) broadcast(data, conn.peer);
}
function broadcast(data, except = null) { for (const [id, c] of connections) if (id !== except && c.open) c.send(data); }
function sendWorldAction(data) { if (!peer) return; isHost ? broadcast(data) : [...connections.values()][0]?.send(data); }
function localPlayerList() { return [...remotePlayers].map(([id, p]) => ({ kind: 'player', id, name: p.name, x: p.group.position.x, y: p.group.position.y, z: p.group.position.z, ry: p.group.rotation.y })); }
function updatePlayerCount() { playersBadge.textContent = `Players: ${1 + connections.size}`; }

function updateRemote(p) {
  const id = p.id;
  if (!id || id === peer?.id) return;
  let entry = remotePlayers.get(id);
  if (!entry) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(.6, 1.15, .35), new THREE.MeshLambertMaterial({ color: 0x3b82f6 }));
    body.position.y = .85;
    const head = new THREE.Mesh(new THREE.BoxGeometry(.52, .52, .52), new THREE.MeshLambertMaterial({ color: 0xf0c8a0 }));
    head.position.y = 1.68;
    group.add(body, head);
    scene.add(group);
    entry = { group, name: p.name || 'Player' };
    remotePlayers.set(id, entry);
  }
  entry.name = p.name || entry.name;
  entry.group.position.set(p.x, p.y - PLAYER_HEIGHT, p.z);
  entry.group.rotation.y = p.ry || 0;
}
function removeRemote(id) { const p = remotePlayers.get(id); if (p) { scene.remove(p.group); remotePlayers.delete(id); } }

const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (/^Digit[1-5]$/.test(e.code)) selectBlock(Number(e.code.at(-1)) - 1);
});
addEventListener('keyup', e => keys[e.code] = false);
controls.addEventListener('lock', () => $('desktopHint').classList.add('hidden'));
controls.addEventListener('unlock', () => { if (started && !isTouchDevice) $('desktopHint').classList.remove('hidden'); });
canvas.addEventListener('click', () => { if (started && !isTouchDevice && !controls.isLocked) controls.lock(); });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  if (!controls.isLocked) return;
  if (e.button === 0) interact(false);
  if (e.button === 2) interact(true);
});

const raycaster = new THREE.Raycaster();
raycaster.far = 6;
function interact(place) {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits = raycaster.intersectObjects([...blocks.values()], false);
  if (!hits.length) return;
  const hit = hits[0], b = hit.object.userData;
  if (place) {
    const n = hit.face.normal;
    const x = b.x + n.x, y = b.y + n.y, z = b.z + n.z;
    if (Math.abs(camera.position.x - x) < .8 && Math.abs(camera.position.z - z) < .8 && Math.abs(camera.position.y - y) < 1.8) return;
    addBlock(x, y, z, BLOCKS[selectedBlock].id, true);
  } else if (b.y > -2) {
    removeBlock(b.x, b.y, b.z, true);
  }
}

function selectBlock(index) {
  selectedBlock = Math.max(0, Math.min(BLOCKS.length - 1, index));
  buildHotbar();
  toast(`${BLOCKS[selectedBlock].id[0].toUpperCase()}${BLOCKS[selectedBlock].id.slice(1)} selected`);
}
function buildHotbar() {
  const hotbar = $('hotbar');
  hotbar.innerHTML = '';
  BLOCKS.forEach((b, i) => {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = `slot ${i === selectedBlock ? 'selected' : ''}`;
    d.setAttribute('aria-label', `Select ${b.id}`);
    d.innerHTML = `<div class="swatch" style="background:#${b.colour.toString(16).padStart(6, '0')}"></div>`;
    d.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      selectBlock(i);
    });
    hotbar.append(d);
  });
}

function collides(pos) {
  const minX = Math.floor(pos.x - PLAYER_RADIUS), maxX = Math.floor(pos.x + PLAYER_RADIUS);
  const minY = Math.floor(pos.y - PLAYER_HEIGHT), maxY = Math.floor(pos.y - .05);
  const minZ = Math.floor(pos.z - PLAYER_RADIUS), maxZ = Math.floor(pos.z + PLAYER_RADIUS);
  for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) if (blocks.has(key(x, y, z))) return true;
  return false;
}
function movePlayer(dt) {
  const speed = (keys.ShiftLeft ? 7 : 4.5) * dt;
  let forward = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - mobileMove.y;
  let side = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + mobileMove.x;
  const len = Math.hypot(forward, side) || 1;
  forward /= len; side /= len;
  const old = controls.object.position.clone();
  controls.moveRight(side * speed);
  if (collides(controls.object.position)) controls.object.position.copy(old);
  const old2 = controls.object.position.clone();
  controls.moveForward(forward * speed);
  if (collides(controls.object.position)) controls.object.position.copy(old2);
  if ((keys.Space || keys.__jump) && grounded) { velocityY = 7; grounded = false; keys.__jump = false; }
  velocityY -= 18 * dt;
  const beforeY = controls.object.position.y;
  controls.object.position.y += velocityY * dt;
  if (collides(controls.object.position)) {
    controls.object.position.y = beforeY;
    if (velocityY < 0) grounded = true;
    velocityY = 0;
  } else grounded = false;
  if (controls.object.position.y < -10) { controls.object.position.set(0, 8, 7); velocityY = 0; }
}

function repeatButton(button, action, delay = 170) {
  let timer = null;
  const stop = () => { if (timer) clearInterval(timer); timer = null; };
  button.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    action();
    stop();
    timer = setInterval(action, delay);
    try { button.setPointerCapture(e.pointerId); } catch (_) {}
  });
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointercancel', stop);
  button.addEventListener('lostpointercapture', stop);
}

async function enterFullscreenLandscape() {
  try {
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) await root.requestFullscreen();
  } catch (_) {}
  try {
    if (screen.orientation?.lock) await screen.orientation.lock('landscape');
  } catch (_) {}
  resizeGame();
}

function setupMobile() {
  const joy = $('joystick'), stick = $('stick');
  const reset = () => { mobileMove = { x: 0, y: 0 }; stick.style.transform = 'translate(0,0)'; };
  joy.addEventListener('pointerdown', e => { e.preventDefault(); joy.setPointerCapture(e.pointerId); });
  joy.addEventListener('pointermove', e => {
    if (!joy.hasPointerCapture(e.pointerId)) return;
    const r = joy.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    const m = Math.min(38, Math.hypot(x, y)), a = Math.atan2(y, x);
    mobileMove = { x: Math.cos(a) * m / 38, y: Math.sin(a) * m / 38 };
    stick.style.transform = `translate(${mobileMove.x * 35}px,${mobileMove.y * 35}px)`;
  });
  joy.addEventListener('pointerup', reset);
  joy.addEventListener('pointercancel', reset);

  repeatButton($('jumpBtn'), () => { keys.__jump = true; }, 260);
  repeatButton($('breakBtn'), () => interact(false), 170);
  repeatButton($('placeBtn'), () => interact(true), 190);
  $('fullscreenBtn').addEventListener('click', enterFullscreenLandscape);

  const lookZone = $('lookZone');
  lookZone.addEventListener('pointerdown', e => {
    if (e.target !== lookZone) return;
    e.preventDefault();
    lookZone.setPointerCapture(e.pointerId);
    touchLook = { x: e.clientX, y: e.clientY, id: e.pointerId };
    $('lookHint').classList.add('hidden');
  });
  lookZone.addEventListener('pointermove', e => {
    if (!touchLook || touchLook.id !== e.pointerId || !lookZone.hasPointerCapture(e.pointerId)) return;
    e.preventDefault();
    const dx = e.clientX - touchLook.x;
    const dy = e.clientY - touchLook.y;
    yaw -= dx * LOOK_SENSITIVITY;
    pitch = THREE.MathUtils.clamp(pitch - dy * LOOK_SENSITIVITY, -1.42, 1.42);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    touchLook.x = e.clientX;
    touchLook.y = e.clientY;
  });
  const stopLook = e => { if (touchLook?.id === e.pointerId) touchLook = null; };
  lookZone.addEventListener('pointerup', stopLook);
  lookZone.addEventListener('pointercancel', stopLook);
}
setupMobile();

const clock = new THREE.Clock();
function animate(t) {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .05);
  if (started) movePlayer(dt);
  if (peer && t - lastNetworkSend > 80) {
    const p = controls.object.position;
    const msg = { kind: 'player', name: cleanName(), x: p.x, y: p.y, z: p.z, ry: camera.rotation.y };
    isHost ? broadcast(msg) : [...connections.values()][0]?.send(msg);
    lastNetworkSend = t;
  }
  renderer.render(scene, camera);
}
animate(0);

function resizeGame() {
  const w = window.visualViewport?.width || innerWidth;
  const h = window.visualViewport?.height || innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
addEventListener('resize', resizeGame);
addEventListener('orientationchange', () => setTimeout(resizeGame, 250));
window.visualViewport?.addEventListener('resize', resizeGame);
