
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as CANNON from 'cannon-es';

/* ============================== CONSTANTS ============================== */
const BOARD_Y   = 0.06;   // height of play surface (physics plane)
const HALF      = 0.35;   // half of play area (cushion inner faces at ±0.35)
const BASELINE  = -0.32;  // striker baseline (z) — keeps the striker's edge clear of the bottom cushion
const COIN_R    = 0.016;
const COIN_H    = 0.003;
const STR_R     = 0.0205;
const STR_H     = 0.005;
const MAX_SPEED = 5.5;
const MU_BOARD = 0.35;   // board friction applied manually (solver base-friction is unreliable)
const POCKETS = [
  { x: 0.35, z: 0.35, r: 0.040 }, { x:-0.35, z: 0.35, r: 0.040 },
  { x: 0.35, z:-0.35, r: 0.040 }, { x:-0.35, z:-0.35, r: 0.040 },
];
const AIVSAI = new URLSearchParams(location.search).has('aivsai');

/* ============================== RENDERER ============================== */
let LOW_MODE = false;   // ⚡ manual override from the HUD
// adaptive quality: start at FULL quality and only step down when the frame rate
// actually demands it — quality is never sacrificed while the machine can cope
const QUAL_LEVELS = [
  { shadows: true,  dpr: 2 },     // best: shadows + full device resolution
  { shadows: true,  dpr: 1.5 },   // softer resolution
  { shadows: false, dpr: 1.25 },  // shadows off
  { shadows: false, dpr: 1 },     // minimal
];
let qualLevel = 0;
let degrades = 0, recovers = 0;
function applyQuality() {
  const lvl = LOW_MODE ? QUAL_LEVELS.length - 1 : qualLevel;
  const q = QUAL_LEVELS[lvl];
  renderer.shadowMap.enabled = q.shadows;
  sun.castShadow = q.shadows;
  renderer.setPixelRatio(LOW_MODE ? 1 : Math.min(devicePixelRatio || 1, q.dpr));
  renderer.setSize(innerWidth, innerHeight);
}
const renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('app').appendChild(renderer.domElement);
// auto-detect software rendering (embedded preview panes often use SwiftShader) —
// shadows are the #1 FPS killer there, so drop straight into low mode
try {
  const gl = renderer.getContext();
  const rstr = String(gl.getParameter(gl.RENDERER) || '');
  if (/swiftshader|software|llvmpipe|mesa offscreen/i.test(rstr)) qualLevel = QUAL_LEVELS.length - 1;
} catch (e) { qualLevel = QUAL_LEVELS.length - 1; }

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0d16);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
scene.add(new THREE.HemisphereLight(0xc7d8ff, 0x3a2f1e, 0.55));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.75);
sun.position.set(2.2, 4.5, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(512, 512);
sun.shadow.camera.left = -0.6; sun.shadow.camera.right = 0.6;
sun.shadow.camera.top = 0.6;   sun.shadow.camera.bottom = -0.6;
sun.shadow.camera.near = 1;    sun.shadow.camera.far = 8;
sun.shadow.bias = -0.0005;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
fill.position.set(-2.5, 1.5, -2.5);
scene.add(fill);
applyQuality();   // now that `sun` exists — sets DPR/shadows from LOW_MODE

const camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.05, 60);
camera.position.set(0.45, 1.55, 2.25);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.06, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.55;
controls.maxDistance = 4.5;
controls.maxPolarAngle = 1.45;
controls.mouseButtons.LEFT = -1;           // left drag = flick gesture
controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
controls.touches.ONE = -1;                 // one finger = flick, two = orbit/zoom
controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

/* ============================== TEXTURES ============================== */
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// --- play surface: warm wood, rings, arrows, baselines, pocket discs ---
const boardTex = canvasTex(1024, 1024, (g, w, h) => {
  const cx = w/2, cy = h/2, P = 512/0.38;           // px per metre (surface half = 0.38)
  g.fillStyle = '#e3cfa1';
  g.fillRect(0, 0, w, h);
  // subtle wood grain
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(${Math.random()<.5?'150,110,60':'255,240,205'},${0.03+Math.random()*0.05})`;
    g.lineWidth = 1 + Math.random()*2;
    g.beginPath();
    const y = Math.random()*h, x0 = Math.random()*w;
    g.moveTo(x0, y);
    g.bezierCurveTo(x0+40, y+(Math.random()-0.5)*30, x0+120, y+(Math.random()-0.5)*30, x0+180, y);
    g.stroke();
  }
  const ink = 'rgba(122,42,28,0.85)';
  // concentric rings (classic carrom print)
  g.strokeStyle = ink; g.lineWidth = 6;
  g.beginPath(); g.arc(cx, cy, 0.088*P, 0, 7); g.stroke();
  g.beginPath(); g.arc(cx, cy, 0.175*P, 0, 7); g.stroke();
  g.strokeStyle = 'rgba(122,42,28,0.6)'; g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cy, 0.035*P, 0, 7); g.stroke();
  // corner arrows (classic carrom decoration)
  g.fillStyle = ink; g.strokeStyle = ink; g.lineWidth = 9; g.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    const a = Math.PI/4 + k*Math.PI/2;
    const x1 = cx + 0.205*P*Math.cos(a), y1 = cy + 0.205*P*Math.sin(a);
    const x2 = cx + 0.285*P*Math.cos(a), y2 = cy + 0.285*P*Math.sin(a);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    const aa = a + Math.PI;
    const hx = x2 + 0.030*P*Math.cos(aa), hy = y2 + 0.030*P*Math.sin(aa);
    const px = x2 + 0.016*P*Math.cos(aa + Math.PI/2), py = y2 + 0.016*P*Math.sin(aa + Math.PI/2);
    const qx = x2 + 0.016*P*Math.cos(aa - Math.PI/2), qy = y2 + 0.016*P*Math.sin(aa - Math.PI/2);
    g.beginPath(); g.moveTo(hx, hy); g.lineTo(px, py); g.lineTo(qx, qy); g.closePath(); g.fill();
  }
  // baselines
  g.strokeStyle = 'rgba(122,42,28,0.8)'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(0.06*P, cy + 0.32*P); g.lineTo(w - 0.06*P, cy + 0.32*P); g.stroke();
  g.beginPath(); g.moveTo(0.06*P, cy - 0.32*P); g.lineTo(w - 0.06*P, cy - 0.32*P); g.stroke();
  // pocket discs
  const px = v => cx + v.x*P, py = v => cy + v.z*P;
  for (const p of POCKETS) {
    const r = p.r*P;
    g.fillStyle = '#171310';
    g.beginPath(); g.arc(px(p), py(p), r, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 3;
    g.beginPath(); g.arc(px(p), py(p), r+3, 0, 7); g.stroke();
  }
  // vignette
  const vg = g.createRadialGradient(cx, cy, 0.3*P, cx, cy, 0.72*P);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(60,35,10,0.22)');
  g.fillStyle = vg; g.fillRect(0, 0, w, h);
});

const frameTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#6b4a2c'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 220; i++) {
    g.strokeStyle = `rgba(${Math.random()<.5?'90,58,30':'130,95,55'},${0.04+Math.random()*0.07})`;
    g.lineWidth = 1 + Math.random()*2;
    g.beginPath(); const y = Math.random()*h, x0 = Math.random()*w;
    g.moveTo(x0, y); g.bezierCurveTo(x0+30, y+(Math.random()-0.5)*20, x0+90, y+(Math.random()-0.5)*20, x0+130, y); g.stroke();
  }
});

function coinTex(base, ring, inner, dot) {
  return canvasTex(128, 128, (g, w, h) => {
    const c = w/2;
    g.fillStyle = base; g.beginPath(); g.arc(c, c, 62, 0, 7); g.fill();
    g.strokeStyle = ring; g.lineWidth = 6;
    g.beginPath(); g.arc(c, c, 46, 0, 7); g.stroke();
    g.fillStyle = inner; g.beginPath(); g.arc(c, c, 34, 0, 7); g.fill();
    g.fillStyle = dot; g.beginPath(); g.arc(c, c, 10, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
    g.beginPath(); g.arc(c, c, 61, 0, 7); g.stroke();
  });
}
const texWhite  = coinTex('#f4eee0', '#cfc2a2', '#e6dcc2', '#b9ab8c');
const texBlack  = coinTex('#2b2723', '#4c453d', '#3a3530', '#141210');
const texQueen  = coinTex('#c62f2f', '#8f1f1f', '#e04545', '#7c1515');
const texStriker = coinTex('#f2ead8', '#b8a98a', '#dcd0b4', '#a99878');

/* ============================== BOARD MESHES ============================== */
const matBoard = new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.65, metalness: 0.02 });
const matFrame = new THREE.MeshStandardMaterial({ map: frameTex, roughness: 0.6 });
const matWood  = new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 0.7 });
const matCush  = new THREE.MeshStandardMaterial({ color: 0x7a1420, roughness: 0.85 });

// frame + play surface (top face textured)
const frame = new THREE.Mesh(new THREE.BoxGeometry(0.90, 0.07, 0.90), matFrame);
frame.position.y = 0.025; frame.castShadow = true; frame.receiveShadow = true;
scene.add(frame);
const surface = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.02, 0.76), [
  matWood, matWood, matBoard, matWood, matWood, matWood
]);
surface.position.y = 0.05; surface.receiveShadow = true;
scene.add(surface);

// cushions (8 segments) + rim walls (4)
function addBox(sx, sy, sz, px, py, pz, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(px, py, pz); m.castShadow = true;
  scene.add(m);
  return m;
}
const CUSH = 0.03, CW = 0.60, SEG = 0.60;
addBox(CW, 0.02, CUSH, 0,     0.07, -0.365, matCush);           // bottom (full)
addBox(CW, 0.02, CUSH, 0,     0.07,  0.365, matCush);           // top (full)
addBox(CUSH, 0.02, SEG, -0.365, 0.07, 0, matCush);              // left (full)
addBox(CUSH, 0.02, SEG,  0.365, 0.07, 0, matCush);              // right (full)
addBox(0.80, 0.02, 0.02, 0,     0.07, -0.40,  matWood);         // rim walls
addBox(0.80, 0.02, 0.02, 0,     0.07,  0.40,  matWood);
addBox(0.02, 0.02, 0.80, -0.40, 0.07, 0,      matWood);
addBox(0.02, 0.02, 0.80,  0.40, 0.07, 0,      matWood);

// pocket holes (dark wells)
const pocketMesh = new THREE.MeshStandardMaterial({ color: 0x0a0808, roughness: 0.4 });
for (const p of POCKETS) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, 0.01, 24), pocketMesh);
  m.position.set(p.x, BOARD_Y - 0.006, p.z);
  scene.add(m);
}

// pedestal + legs
const base = new THREE.Mesh(new THREE.BoxGeometry(0.90, 0.35, 0.90), matWood);
base.position.y = -0.185; base.receiveShadow = true; base.castShadow = true;
scene.add(base);
for (const sx of [-0.38, 0.38]) for (const sz of [-0.38, 0.38]) {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.40, 0.07), matWood);
  leg.position.set(sx, -0.56, sz); leg.castShadow = true;
  scene.add(leg);
}
const ground = new THREE.Mesh(new THREE.CircleGeometry(7, 40), new THREE.MeshStandardMaterial({ color: 0x13131c, roughness: 1 }));
ground.rotation.x = -Math.PI/2; ground.position.y = -0.8; ground.receiveShadow = true;
scene.add(ground);

/* ============================== PHYSICS ============================== */
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
// NaiveBroadphase: SAP's sweep-and-prune breaks early on stale axis order once bodies
// move (cannon-es only re-sorts on add/remove), letting the striker phase through coins.
// With ~20 bodies O(n²) is trivial and always correct.
world.broadphase = new CANNON.NaiveBroadphase();
world.allowSleep = true;
world.sleepSpeedLimit = 0.06;
world.sleepTimeLimit = 0.4;

const mCoin     = new CANNON.Material('coin');
const mCushion  = new CANNON.Material('cushion');
const mPlane    = new CANNON.Material('plane');
world.addContactMaterial(new CANNON.ContactMaterial(mCoin, mCoin,    { friction: 0.05, restitution: 0.88 }));
world.addContactMaterial(new CANNON.ContactMaterial(mCoin, mCushion, { friction: 0.05, restitution: 0.55 })); // 0.9 launched coins airborne
world.addContactMaterial(new CANNON.ContactMaterial(mCoin, mPlane,   { friction: 0.0,  restitution: 0.08 })); // base friction handled manually (MU_BOARD)
world.defaultContactMaterial.friction = 0.05;
world.defaultContactMaterial.restitution = 0.5;

const boardBody = new CANNON.Body({ mass: 0, material: mPlane, shape: new CANNON.Plane() });
boardBody.quaternion.setFromEuler(-Math.PI/2, 0, 0);
boardBody.position.y = BOARD_Y;
world.addBody(boardBody);

function addStaticBox(px, py, pz, hx, hy, hz, material) {
  const b = new CANNON.Body({ mass: 0, material, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)) });
  b.position.set(px, py, pz);
  world.addBody(b);
  return b;
}
// cushions (4 full-length: classic home board with corner pockets only)
addStaticBox(0, 0.07, -0.365, 0.30, 0.01, 0.015, mCushion);
addStaticBox(0, 0.07,  0.365, 0.30, 0.01, 0.015, mCushion);
addStaticBox(-0.365, 0.07, 0, 0.015, 0.01, 0.30, mCushion);
addStaticBox( 0.365, 0.07, 0, 0.015, 0.01, 0.30, mCushion);
// rim walls
addStaticBox(0, 0.07, -0.40, 0.40, 0.01, 0.01, mCushion);
addStaticBox(0, 0.07,  0.40, 0.40, 0.01, 0.01, mCushion);
addStaticBox(-0.40, 0.07, 0, 0.01, 0.01, 0.40, mCushion);
addStaticBox( 0.40, 0.07, 0, 0.01, 0.01, 0.40, mCushion);

/* ============================== PIECES ============================== */
const coins = [];   // { mesh, body, owner:'white'|'black'|'queen', state, sink }
let striker = null;
let shot = null;    // { firstContact, pockets:[], t0, still, active }

function makeDynamic(radius, height, mass, material, tex, kind, owner) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 32),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.38, metalness: 0.04 }));
  mesh.castShadow = true;
  scene.add(mesh);
  // fixedRotation via constructor: zeroes invInertia → the solver can never tilt a piece
  // (real carrom coins are flat discs; a tilting cylinder also breaks contact geometry)
  const body = new CANNON.Body({ mass, material, shape: new CANNON.Cylinder(radius, radius, height, 24), fixedRotation: true });
  body.linearDamping = 0.008; body.angularDamping = 0.02;
  body.angularFactor.set(0, 0, 0);
  // CCD disabled: its swept-sphere raycast misses thin cylinders at grazing angles.
  // Tunneling is impossible anyway with 6 substeps (max move 1.5cm/substep vs 7.3cm needed).
  body.ccdSpeedThreshold = 1e9;
  body.ccdSphereRadius = radius + 0.006;
  body.userData = { kind, owner };
  const isStriker = kind === 'striker';
  body.addEventListener('collide', ev => {
    const b = ev.body, vel = Math.abs(ev.contact.getImpactVelocityAlongNormal());
    const k = b.userData ? b.userData.kind : '';
    if (k === 'coin' || k === 'queen') {
      if (vel > 0.8) playSound('wood', vel / 7);
      // first-contact rule + stop-shot: ONLY the striker's own listener may record it.
      // Coin-vs-coin contacts must never count — they'd register the wrong owner as
      // "first contact" and brake the striker mid-flight.
      if (isStriker && shot && shot.active && !shot.firstContact) {
        shot.firstContact = { type: k === 'queen' ? 'queen' : 'coin', owner: b.userData.owner };
        body.velocity.scale(0.35, body.velocity);
      }
    } else if (k === 'cushion' || k === 'wall') {
      if (vel > 0.6) playSound('cushion', vel / 7);
    }
  });
  world.addBody(body);
  return { mesh, body, kind, owner, state: 'onboard', sink: null };
}

// Manual constant-friction braking on the play surface (replaces unreliable solver base friction)
function brakeBody(body, dt) {
  const v = body.velocity;
  const s = v.length();
  if (s < 0.02) return;
  const decel = MU_BOARD * 9.81 * dt;
  if (s <= decel) v.setZero();
  else v.scale((s - decel) / s, v);
}

function placeCoin(obj, x, z, jitter) {
  obj.state = 'onboard'; obj.sink = null;
  obj.body.position.set(x + (jitter ? (Math.random()-0.5)*jitter : 0), BOARD_Y + 0.012, z + (jitter ? (Math.random()-0.5)*jitter : 0));
  obj.body.velocity.setZero(); obj.body.angularVelocity.setZero();
  obj.body.quaternion.set(0, 0, 0, 1);
  obj.mesh.visible = true;
  obj.mesh.scale.set(1, 1, 1);
  if (!world.bodies.includes(obj.body)) world.addBody(obj.body);
  obj.body.wakeUp();
}

function buildPieces() {
  coins.length = 0;
  // queen at centre
  coins.push(makeDynamic(COIN_R, COIN_H, 0.37, mCoin, texQueen, 'queen', 'queen'));
  // inner ring: 6 alternating, outer ring: 12 alternating
  const ring = (n, r, off) => {
    for (let i = 0; i < n; i++) {
      const a = off + i * (2*Math.PI/n);
      const owner = i % 2 === 0 ? 'white' : 'black';
      coins.push(makeDynamic(COIN_R, COIN_H, 0.37, mCoin, owner === 'white' ? texWhite : texBlack, 'coin', owner));
      placeCoin(coins[coins.length-1], r*Math.cos(a), r*Math.sin(a), 0.003);
    }
  };
  ring(6, 0.052, Math.PI/12);
  ring(12, 0.100, Math.PI/12);
  placeCoin(coins[0], 0, 0, 0);

  striker = makeDynamic(STR_R, STR_H, 1.0, mCoin, texStriker, 'striker', null);
  striker.body.angularDamping = 0.15;
}

/* ============================== GAME STATE ============================== */
let turn = 'white';
let phase = 'idle';            // idle | physics | over
let queenOwner = null;         // 'white' | 'black' | null
let queenPending = null;       // player who pocketed queen but hasn't covered
let gameToken = 0;
let aiFor = { white: AIVSAI, black: true };
let soundOn = true;
const pocketed = { white: [], black: [] };   // coin objects

const other = p => p === 'white' ? 'black' : 'white';
const isAI = p => !!aiFor[p];
const humanName = p => aiFor.white ? (p === 'white' ? 'YOU' : 'AI') : (p === 'white' ? 'P1' : 'P2');

/* ============================== AUDIO ============================== */
let actx = null, lastSound = 0;
function initAudio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {} }
  if (actx && actx.state === 'suspended') actx.resume();
}
function playSound(kind, vol) {
  if (!soundOn || !actx) return;
  const now = performance.now();
  if (now - lastSound < 35) return;
  lastSound = now;
  const t = actx.currentTime, v = Math.min(1, Math.max(0.05, vol));
  const dur = kind === 'wood' ? 0.05 : 0.07;
  const buf = actx.createBuffer(1, Math.floor(actx.sampleRate * dur), actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2-1) * Math.pow(1 - i/d.length, 2);
  const src = actx.createBufferSource(); src.buffer = buf;
  const f = actx.createBiquadFilter(); f.type = 'bandpass';
  f.frequency.value = kind === 'wood' ? 2600 : 800; f.Q = 1.2;
  const g = actx.createGain(); g.gain.value = v * 0.85;
  src.connect(f); f.connect(g); g.connect(actx.destination); src.start(t);
  const o = actx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(kind === 'wood' ? 300 : 170, t);
  o.frequency.exponentialRampToValueAtTime(80, t + dur);
  const g2 = actx.createGain();
  g2.gain.setValueAtTime(v * 0.45, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g2); g2.connect(actx.destination); o.start(t); o.stop(t + dur);
}
function playPocket() {
  if (!soundOn || !actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(430, t);
  o.frequency.exponentialRampToValueAtTime(85, t + 0.2);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.22);
}

/* ============================== SHOOTING & RESOLUTION ============================== */
function shoot(dirX, dirZ, speed) {
  striker.body.velocity.set(dirX * speed, 0, dirZ * speed);
  striker.body.angularVelocity.setZero();
  striker.body.wakeUp();                       // sleeping bodies are skipped by the solver!
  phase = 'physics';
  shot = { firstContact: null, pockets: [], t0: performance.now(), still: 0, active: true };
  hideAim();
}

function sinkItem(obj, pocket) {
  obj.state = 'sinking';
  obj.sink = { t: 0, from: obj.mesh.position.clone(), pocket };
  world.removeBody(obj.body);
  shot.pockets.push({
    type: obj.kind === 'queen' ? 'queen' : obj.kind === 'striker' ? 'striker' : 'coin',
    owner: obj.owner
  });
  playPocket();
}

function checkPockets() {
  for (const c of coins) {
    if (c.state !== 'onboard') continue;
    const p = c.body.position;
    let sunk = false;
    for (const pk of POCKETS) {
      const dx = p.x - pk.x, dz = p.z - pk.z;
      const d2 = dx*dx + dz*dz;
      if (d2 < pk.r * pk.r) {
        const sp = c.body.velocity.length();
        // a real pocket catches a coin at any reasonable speed — long pots arrive at
        // the mouth at ~2.7 m/s and must sink, not zip across between frames
        if (sp < 3.5 || d2 < pk.r * pk.r * 0.25) { sinkItem(c, pk); sunk = true; break; }
      }
    }
    // wedged into a cushion (edge past the face, at rest) → official rule: back to centre.
    // Fast coins are transiently in the cushion during bounces — only rescue the stuck ones.
    if (!sunk && (Math.abs(p.x) > 0.335 || Math.abs(p.z) > 0.335) && c.body.velocity.length() < 0.25) {
      const a = Math.random() * Math.PI * 2, r = 0.05;
      placeCoin(c, r*Math.cos(a), r*Math.sin(a), 0);
    }
  }
  if (striker && striker.state === 'onboard') {
    const p = striker.body.position;
    for (const pk of POCKETS) {
      const dx = p.x - pk.x, dz = p.z - pk.z;
      const d2 = dx*dx + dz*dz;
      if (d2 < pk.r * pk.r) {
        const sp = striker.body.velocity.length();
        if (sp < 3.5 || d2 < pk.r * pk.r * 0.25) { sinkItem(striker, pk); break; }
      }
    }
  }
}

function setMsg(t) {
  const el = document.getElementById('msg');
  el.textContent = t;
  el.style.color = '';
}

function returnCoinToCenter(owner) {
  const list = pocketed[owner];
  if (!list.length) return false;
  const c = list.pop();
  c.mesh.scale.set(1,1,1); c.mesh.visible = true;
  const a = Math.random() * Math.PI * 2, r = 0.05;
  placeCoin(c, r*Math.cos(a), r*Math.sin(a), 0);
  return true;
}

function returnQueenToCenter() {
  const q = coins.find(c => c.kind === 'queen');
  placeCoin(q, 0, 0, 0.008);
}

function resolveShot() {
  const player = turn, opp = other(player);
  const ownP = shot.pockets.filter(p => p.type === 'coin' && p.owner === player);
  const oppP = shot.pockets.filter(p => p.type === 'coin' && p.owner === opp);
  const queenP = shot.pockets.some(p => p.type === 'queen');
  const strikerP = shot.pockets.some(p => p.type === 'striker');
  const fc = shot.firstContact;
  const contactFoul = fc ? (fc.type === 'coin' && fc.owner !== player) : true;
  const msgs = [];

  // queen foul rule: striker in pocket → queen returns to centre
  if (strikerP && (queenP || queenPending)) {
    returnQueenToCenter();
    queenPending = null;
    msgs.push('👑 Queen returned to centre!');
  }
  // queen pending / cover / steal
  if (queenP && !strikerP) queenPending = player;
  if (queenPending === player && ownP.length) {
    queenOwner = player; queenPending = null;
    msgs.push(`👑 Queen covered by ${humanName(player)} (+3)!`);
  } else if (queenPending === opp && ownP.length) {
    queenOwner = player; queenPending = null;
    msgs.push(`👑 ${humanName(player)} covered the queen — stolen from ${humanName(opp)}! (+3)`);
  }

  // striker foul penalty
  if (strikerP) {
    if (returnCoinToCenter(player)) msgs.push(`⚠️ Striker in pocket — a ${player} coin returns to centre.`);
    else msgs.push('⚠️ Striker in pocket — foul!');
  } else if (contactFoul) {
    msgs.push(fc ? '⚠️ Foul — first contact was the wrong coin!' : '⚠️ Dry shot — you must hit a coin!');
  }

  // pocket reports
  if (ownP.length) msgs.push(ownP.length > 1 ? `✅ ${ownP.length} coins pocketed!` : '✅ Coin pocketed!');
  if (oppP.length) msgs.push(`❌ Gave ${oppP.length} coin${oppP.length>1?'s':''} to ${humanName(opp)}.`);
  if (queenP && !strikerP) msgs.push('👑 Queen pocketed — cover it with your own coin!');

  // continuation
  let again = !strikerP && !contactFoul && ownP.length > 0;

  // win check
  const winCount = pocketed[player].length;
  if (winCount >= 9) { endGame(player); return; }

  turn = again ? player : opp;
  if (again) msgs.push(`${humanName(player)} plays again!`);
  else msgs.push(`${humanName(turn)}'s turn.`);
  setMsg(msgs.join(' '));
  startTurn();
}

function startTurn() {
  shot = null;
  phase = 'idle';
  // reset striker to baseline
  striker.state = 'onboard';
  striker.body.position.set(0, BOARD_Y + STR_H/2 + 0.002, BASELINE);
  striker.body.velocity.setZero();
  striker.body.angularVelocity.setZero();
  striker.body.wakeUp();                       // sleeping bodies are skipped by the solver!
  striker.mesh.visible = true;
  striker.mesh.scale.set(1, 1, 1);
  if (!world.bodies.includes(striker.body)) world.addBody(striker.body);
  updateHUD();
  if (phase !== 'over' && isAI(turn)) scheduleAI();
}

function endGame(winner) {
  phase = 'over';
  const wScore = pocketed.white.length + (queenOwner === 'white' ? 3 : 0);
  const bScore = pocketed.black.length + (queenOwner === 'black' ? 3 : 0);
  const wName = humanName('white'), bName = humanName('black');
  document.getElementById('winTitle').textContent =
    winner === 'white' ? '🏆 You win!' : '🏆 Opponent wins!';
  document.getElementById('winSub').textContent =
    winner === 'white' ? `${wName} cleared all 9 coins first.` : `${bName} cleared all 9 coins first.`;
  document.getElementById('winScore').textContent =
    `${wName}: ${pocketed.white.length} coins ${queenOwner==='white'?'+ 👑 3':''} = ${wScore} pts   •   ` +
    `${bName}: ${pocketed.black.length} coins ${queenOwner==='black'?'+ 👑 3':''} = ${bScore} pts`;
  document.getElementById('winOverlay').hidden = false;
  updateHUD();
}

function resetGame() {
  gameToken++;
  document.getElementById('winOverlay').hidden = true;
  turn = 'white';
  phase = 'idle';
  queenOwner = null; queenPending = null;
  pocketed.white.length = 0; pocketed.black.length = 0;
  for (const c of coins) {
    world.removeBody(c.body);
    c.mesh.visible = false;
  }
  buildPieces();
  const ring = [
    [0.052, 6, Math.PI/12], [0.100, 12, Math.PI/12]
  ];
  // rebuild arrangement
  let idx = 1;
  for (const [r, n, off] of ring) {
    for (let i = 0; i < n; i++) {
      const a = off + i * (2*Math.PI/n);
      placeCoin(coins[idx], r*Math.cos(a), r*Math.sin(a), 0.003);
      idx++;
    }
  }
  placeCoin(coins[0], 0, 0, 0);
  startTurn();
  setMsg('Fresh board! Drag anywhere & release to flick. Good luck!');
}

/* ============================== AI ============================== */
function dist2(ax, az, bx, bz) { const dx = ax-bx, dz = az-bz; return Math.hypot(dx, dz); }
function distPointSeg2(px, pz, ax, az, bx, bz) {
  const abx = bx-ax, abz = bz-az;
  const len2 = abx*abx + abz*abz;
  let t = len2 ? ((px-ax)*abx + (pz-az)*abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return dist2(px, pz, ax+abx*t, az+abz*t);
}
function distPointRay2(px, pz, ax, az, dx, dz) {
  const t = Math.max(0, (px-ax)*dx + (pz-az)*dz);
  return dist2(px, pz, ax+dx*t, az+dz*t);
}

function aiChooseShot() {
  const player = turn;
  const myCoins = coins.filter(c => c.kind === 'coin' && c.owner === player && c.state === 'onboard'
    && Math.abs(c.body.position.x) < 0.368 && Math.abs(c.body.position.z) < 0.368);
  const queen = coins.find(c => c.kind === 'queen' && c.state === 'onboard'
    && Math.abs(c.body.position.x) < 0.368 && Math.abs(c.body.position.z) < 0.368);
  const sx = striker.body.position.x, sz = striker.body.position.z;
  const cands = [];
  const targets = myCoins.slice();
  if (queen && !queenPending) targets.push(queen);
  const steal = queenPending === other(player);
  // goals: direct pots + one-cushion bank shots (mirror the pocket across a side
  // cushion — needed for the bottom corners on the 4-pocket board)
  const CUSH_LINE = 0.334;   // coin-centre bounce line at the side cushions
  const goals = [];
  for (const pk of POCKETS) {
    goals.push({ x: pk.x, z: pk.z, pk, bank: 0 });
    if (pk.z < 0) {
      goals.push({ x: 2*CUSH_LINE - pk.x, z: pk.z, pk, bank: 1 });   // bank off right cushion
      goals.push({ x: -2*CUSH_LINE - pk.x, z: pk.z, pk, bank: -1 }); // bank off left cushion
    }
  }
  for (const t of targets) {
    const tx = t.body.position.x, tz = t.body.position.z;
    for (const g of goals) {
      let dx = g.x - tx, dz = g.z - tz;
      const d = Math.hypot(dx, dz);
      if (d < 0.10) continue;   // too close to the mouth — the striker follows the coin into the pocket (foul)
      dx /= d; dz /= d;
      if (dz < 0.05 || Math.abs(dx) > 0.99) continue;       // must travel away from baseline
      if (g.bank === 1) {       // must hit the right cushion before any other wall
        if (dx < 0.03) continue;
        const tX = (CUSH_LINE - tx) / dx, tZ = dz > 0 ? (CUSH_LINE - tz) / dz : (-CUSH_LINE - tz) / dz;
        if (!(tX > 0 && tZ > 0 && tX < tZ)) continue;
      } else if (g.bank === -1) {
        if (dx > -0.03) continue;
        const tX = (-CUSH_LINE - tx) / dx, tZ = dz > 0 ? (CUSH_LINE - tz) / dz : (-CUSH_LINE - tz) / dz;
        if (!(tX > 0 && tZ > 0 && tX < tZ)) continue;
      }
      const tParam = (tz - sz) / dz;
      const xs = tx - tParam * dx;                            // striker baseline x for a clean hit
      if (xs < -0.28 || xs > 0.28) continue;
      // reachability: striker travels L = (tz-sz)/dz and must arrive with enough speed
      // to pot the coin; launch speed = sqrt(vImpact² + 2·μ·g·L) must fit MAX_SPEED
      const vCoin = Math.sqrt(2 * MU_BOARD * 9.81 * (d + 0.05));
      const vImpact = vCoin / 0.60;                           // measured striker→coin transfer ratio
      const vLaunch = Math.sqrt(vImpact*vImpact + 2*MU_BOARD*9.81*tParam);
      if (vLaunch > MAX_SPEED * 0.9) continue;
      // blocked by coins on the striker line?
      let blocked = 0;
      for (const o of coins) {
        if (o === t || o.state !== 'onboard') continue;
        if (distPointSeg2(o.body.position.x, o.body.position.z, xs, sz, tx, tz) < COIN_R*2 + 0.008) { blocked++; }
      }
      if (blocked) continue;
      // blocked on coin → pocket path?
      for (const o of coins) {
        if (o === t || o.state !== 'onboard') continue;
        const dot = (o.body.position.x - tx)*dx + (o.body.position.z - tz)*dz;
        if (dot > 0 && distPointRay2(o.body.position.x, o.body.position.z, tx, tz, dx, dz) < COIN_R*2) { blocked++; }
      }
      if (blocked) continue;
      // alignment error vs goal (real pocket for direct shots, mirror point for banks)
      const err = distPointRay2(g.x, g.z, tx, tz, dx, dz);
      if (err > g.pk.r - 0.004) continue;
      const score = err + d * 0.02 + (t === queen ? -0.02 : 0) + (steal && t !== queen ? -0.025 : 0);
      cands.push({ t, pk: g.pk, xs, dx, dz, d, err, score, vLaunch });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  if (cands.length) {
    const c = cands[0];
    // physical model: launch speed covers braking losses over the striker's path
    // and leaves enough impact speed for the coin to reach the pocket mouth
    let v = (c.vLaunch + 0.3) * (0.97 + Math.random() * 0.06);
    v = Math.max(0.5, Math.min(MAX_SPEED, v));
    // aim noise
    const na = (Math.random() - 0.5) * 0.0052;  // ±0.15° aim error — off-center hits deflect the coin
    const cos = Math.cos(na), sin = Math.sin(na);
    const ddx = c.dx * cos - c.dz * sin, ddz = c.dx * sin + c.dz * cos;
    return { xs: c.xs, dx: ddx, dz: ddz, v };
  }
  // fallback: pick the own coin with the most open line (dense clusters foul otherwise —
  // the line passes through other coins first). Prefer clear lines over proximity.
  let best = null, bestScore = 1e9;
  for (const c of myCoins) {
    let minBlock = 1e9;
    for (const o of coins) {
      if (o === c || o.state !== 'onboard') continue;
      const d = distPointSeg2(o.body.position.x, o.body.position.z, sx, sz, c.body.position.x, c.body.position.z);
      if (d < minBlock) minBlock = d;
    }
    const dist = dist2(c.body.position.x, c.body.position.z, sx, sz);
    const score = (minBlock < COIN_R*2 + 0.008 ? 100 + (COIN_R*2 + 0.008 - minBlock) : 0) + dist * 0.05;
    if (score < bestScore) { bestScore = score; best = c; }
  }
  if (!best) return null;
  // stuck-pack escape: occasionally smash the pack open — only when it's actually
  // needed (a clear tap exists otherwise); each smash risks a visible foul
  if (Math.random() < 0.12) {
    let cx = 0, cz = 0, n = 0;
    for (const c of coins) {
      if (c.state !== 'onboard') continue;
      cx += c.body.position.x; cz += c.body.position.z; n++;
    }
    if (n) {
      cx /= n; cz /= n;
      let dx = cx - sx, dz = cz - sz;
      const dd = Math.hypot(dx, dz) || 1;
      return { xs: Math.max(-0.28, Math.min(0.28, sx)), dx: dx/dd, dz: dz/dd, v: 3.4 + Math.random()*0.6 };
    }
  }
  let dx = best.body.position.x - sx, dz = best.body.position.z - sz;
  const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
  // reachability: a tap must still arrive — power scales with distance, hard enough to scatter
  const vNeed = Math.sqrt(2 * MU_BOARD * 9.81 * d);
  const v = Math.max(0.6, Math.min(3.2, vNeed * 1.35 + 0.3));
  return { xs: Math.max(-0.28, Math.min(0.28, sx)), dx, dz, v };
}

async function scheduleAI() {
  const token = gameToken;
  await new Promise(r => setTimeout(r, 380));   // brief "thinking" pause — long delays just feel dead
  if (token !== gameToken || phase !== 'idle' || !isAI(turn)) return;
  const choice = aiChooseShot();
  if (!choice) { endGame(other(turn)); return; }
  striker.body.position.x = choice.xs;
  updateHUD();
  await new Promise(r => setTimeout(r, 300));
  if (token !== gameToken || phase !== 'idle' || !isAI(turn)) return;
  shoot(choice.dx, choice.dz, choice.v);
}

/* ============================== INPUT ============================== */
const ray = new THREE.Raycaster();
const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_Y);
const ndc = new THREE.Vector2();
const pointer3 = new THREE.Vector3();
const _followTmp = new THREE.Vector3();   // reused each frame — zero per-frame allocation
let drag = null;      // { mode:'flex'|'aim', start:Vector3, cur:Vector3 }
const aimLine = new THREE.Line(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })
);
aimLine.frustumCulled = false;
aimLine.visible = false;
scene.add(aimLine);

function projectPointer(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(boardPlane, pointer3) ? pointer3.clone() : null;
}

function canShoot() {
  return phase === 'idle' && !isAI(turn);
}

function previewPoints(sx, sz, dx, dz, len) {
  const pts = [{ x: sx, z: sz }];
  let x = sx, z = sz, ux = dx, uz = dz, rem = len;
  for (let i = 0; i < 3 && rem > 0.005; i++) {
    let t = Infinity, nx = 0, nz = 0;
    if (ux > 1e-4)      { const t2 = ( HALF - x) / ux; if (t2 > 0.002 && t2 < t) { t = t2; nx = -1; } }
    else if (ux < -1e-4){ const t2 = (-HALF - x) / ux; if (t2 > 0.002 && t2 < t) { t = t2; nx =  1; } }
    if (uz > 1e-4)      { const t2 = ( HALF - z) / uz; if (t2 > 0.002 && t2 < t) { t = t2; nz = -1; } }
    else if (uz < -1e-4){ const t2 = (-HALF - z) / uz; if (t2 > 0.002 && t2 < t) { t = t2; nz =  1; } }
    if (t <= rem) {
      x += ux * t; z += uz * t; rem -= t;
      const dot = ux*nx + uz*nz;
      ux -= 2*dot*nx; uz -= 2*dot*nz;
      pts.push({ x, z });
    } else {
      pts.push({ x: x + ux*rem, z: z + uz*rem });
      rem = 0;
    }
  }
  return pts;
}

function updateAim() {
  if (!drag || drag.mode !== 'aim') { aimLine.visible = false; return; }
  const sp = striker.body.position;
  const dx = sp.x - drag.cur.x, dz = sp.z - drag.cur.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) { aimLine.visible = false; return; }
  const ux = dx/d, uz = dz/d;
  const power = Math.min(MAX_SPEED, d * 8);
  const len = power * 0.16;
  const pts = previewPoints(sp.x, sp.z, ux, uz, len);
  const pos = aimLine.geometry.attributes.position;
  pos.setXYZ(0, pts[0].x, BOARD_Y + 0.005, pts[0].z);
  pos.setXYZ(1, pts[1].x, BOARD_Y + 0.005, pts[1].z);
  if (pts.length > 2) {
    pos.setXYZ(2, pts[1].x, BOARD_Y + 0.005, pts[1].z);
    pos.setXYZ(3, pts[2].x, BOARD_Y + 0.005, pts[2].z);
    aimLine.geometry.setDrawRange(0, 4);
  } else {
    aimLine.geometry.setDrawRange(0, 2);
  }
  aimLine.geometry.attributes.position.needsUpdate = true;
  aimLine.visible = true;
  const hue = Math.min(1, power / MAX_SPEED);
  aimLine.material.color.setHSL(0.32 - hue * 0.32, 0.9, 0.6);
}
function hideAim() { aimLine.visible = false; }

renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  initAudio();
  if (!canShoot()) {
    if (phase === 'physics') setMsg('⏳ Wait for the coins to stop…');
    else if (isAI(turn)) setMsg('🤖 AI is thinking…');
    else if (phase === 'over') setMsg('Game over — press Restart to play again');
    return;
  }
  const p = projectPointer(e);
  if (!p) return;
  const sp = striker.body.position;
  // start near the striker = flexible: stay on the baseline band to place it,
  // leave the band to flick (dragging from the striker straight back works!)
  const nearStriker = dist2(p.x, p.z, sp.x, sp.z) < 0.09;
  drag = { mode: nearStriker ? 'flex' : 'aim', start: p, cur: p };
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', e => {
  if (!drag) return;
  const p = projectPointer(e);
  if (!p) return;
  drag.cur = p;
  if (drag.mode === 'flex') {
    if (Math.abs(p.z - BASELINE) < 0.045) {
      // still on the baseline strip → place the striker
      striker.body.position.x = Math.max(-0.28, Math.min(0.28, p.x));
      striker.mesh.position.copy(striker.body.position);
    } else {
      drag.mode = 'aim';   // left the strip → it's a flick now
    }
  }
  if (drag.mode === 'aim') updateAim();
});
renderer.domElement.addEventListener('pointerup', e => {
  if (!drag) return;
  const wasFlex = drag.mode === 'flex';
  const start = drag.start, cur = drag.cur;
  drag = null;
  hideAim();
  if (wasFlex) return;               // placed the striker, didn't flick
  if (!canShoot()) return;
  const sp = striker.body.position;
  const dx = sp.x - cur.x, dz = sp.z - cur.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.015) return;
  const ux = dx/d, uz = dz/d;
  const power = Math.min(MAX_SPEED, d * 8);
  shoot(ux, uz, power);
});

/* ============================== UI ============================== */
function updateHUD() {
  const wName = humanName('white'), bName = humanName('black');
  const wEl = document.getElementById('pWhite'), bEl = document.getElementById('pBlack');
  wEl.querySelector('.name').innerHTML = `<span class="swatch w"></span>${wName}`;
  bEl.querySelector('.name').innerHTML = `<span class="swatch b"></span>${bName}`;
  wEl.querySelector('.coins').textContent = `⚪ ${pocketed.white.length} / 9`;
  bEl.querySelector('.coins').textContent = `⚫ ${pocketed.black.length} / 9`;
  const qline = (p) => {
    if (queenOwner === p) return '👑 covered +3';
    if (queenPending === p) return '👑 cover it!';
    if (queenPending === other(p)) return '👑 steal it!';
    return '👑 on board';
  };
  wEl.querySelector('.queenLine').textContent = qline('white');
  bEl.querySelector('.queenLine').textContent = qline('black');
  wEl.classList.toggle('active', turn === 'white' && phase !== 'over');
  bEl.classList.toggle('active', turn === 'black' && phase !== 'over');
  const ph = document.getElementById('phase');
  if (phase === 'over') ph.textContent = '🏁 GAME OVER';
  else if (phase === 'physics') ph.textContent = '⏳ Coins in motion…';
  else ph.textContent = isAI(turn) ? '🤖 AI thinking…' : '🎯 YOUR TURN — flick!';
}

document.getElementById('btnRestart').addEventListener('click', () => { initAudio(); resetGame(); });
document.getElementById('btnAgain').addEventListener('click', () => { initAudio(); resetGame(); });
document.getElementById('btnRules').addEventListener('click', () => {
  document.getElementById('rulesOverlay').hidden = false;
});
document.getElementById('btnCloseRules').addEventListener('click', () => {
  document.getElementById('rulesOverlay').hidden = true;
});
document.getElementById('btnSound').addEventListener('click', () => {
  soundOn = !soundOn;
  document.getElementById('btnSound').textContent = soundOn ? '🔊' : '🔇';
  document.getElementById('btnSound').classList.toggle('on', soundOn);
  if (soundOn) initAudio();
});
document.getElementById('btnLow').addEventListener('click', () => {
  LOW_MODE = !LOW_MODE;
  if (!LOW_MODE) qualLevel = 0;   // resume full quality; adaptive takes over again
  applyQuality();
  const b = document.getElementById('btnLow');
  b.textContent = LOW_MODE ? '⚡ON' : '⚡';
  b.classList.toggle('on', LOW_MODE);
  setMsg(LOW_MODE ? '⚡ Low mode: shadows off, max smoothness' : '⚡ Full quality restored — adaptive mode on');
});
document.getElementById('btnMode').addEventListener('click', () => {
  const mode2P = aiFor.white;
  aiFor = mode2P ? { white: false, black: true } : { white: true, black: false };
  document.getElementById('btnMode').textContent = aiFor.white ? '👥 2P' : '🤖 AI';
  document.getElementById('btnMode').classList.toggle('on', !aiFor.white);
  resetGame();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  applyQuality();
});
addEventListener('keydown', e => {
  if (e.key === 'r' || e.key === 'R') resetGame();
});

/* ============================== MAIN LOOP ============================== */
const clock = new THREE.Clock();
let elapsed = 0;
let fpsAcc = 0, fpsFrames = 0, fpsLowStreak = 0, fpsGoodStreak = 0;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 1.0) {
    const fps = fpsFrames / fpsAcc;
    const f = document.getElementById('fps');
    if (f) f.textContent = `${Math.round(fps)} FPS${qualLevel > 0 ? ' ⚡' : ''}`;
    // adaptive quality: degrade on sustained low fps, recover when it's easy
    if (!LOW_MODE) {
      if (fps < 40) { fpsLowStreak++; fpsGoodStreak = 0; if (fpsLowStreak >= 2 && qualLevel < QUAL_LEVELS.length - 1) { qualLevel++; applyQuality(); degrades++; fpsLowStreak = 0; } }
      else if (fps > 55) { fpsGoodStreak++; fpsLowStreak = 0; if (fpsGoodStreak >= 5 && qualLevel > 0) { qualLevel--; applyQuality(); recovers++; fpsGoodStreak = 0; } }
      else { fpsLowStreak = 0; fpsGoodStreak = 0; }
    }
    fpsAcc = 0; fpsFrames = 0;
  }

  if (phase === 'physics' && shot) {
    world.step(1/60, dt, 6);
    shot.still += dt;
    // Flat discs on a flat board: clamp pieces to the surface — no pops, no stacking,
    // no climbing the cushions (real carrom coins never leave the plane).
    for (const c of coins) {
      if (c.state !== 'onboard') continue;
      if (c.body.position.y > 0.0635) {
        c.body.position.y = 0.0615; c.body.velocity.y = 0;
        c.body.position.x = Math.max(-0.35, Math.min(0.35, c.body.position.x));
        c.body.position.z = Math.max(-0.35, Math.min(0.35, c.body.position.z));
      }
    }
    if (striker.state === 'onboard' && striker.body.position.y > 0.064) {
      striker.body.position.y = 0.0625; striker.body.velocity.y = 0;
      striker.body.position.x = Math.max(-0.35, Math.min(0.35, striker.body.position.x));
      striker.body.position.z = Math.max(-0.35, Math.min(0.35, striker.body.position.z));
    }
    let maxV = 0;
    for (const c of coins) {
      if (c.state === 'onboard') { brakeBody(c.body, dt); maxV = Math.max(maxV, c.body.velocity.length(), c.body.angularVelocity.length()*0.06); }
    }
    if (striker.state === 'onboard') { brakeBody(striker.body, dt); maxV = Math.max(maxV, striker.body.velocity.length(), striker.body.angularVelocity.length()*0.06); }
    if (maxV > 0.05) shot.still = 0;
    checkPockets();
    if (shot.still > 0.45 || performance.now() - shot.t0 > 8000) resolveShot();
  }
  // idle: no physics stepping — the board is static between shots (solver was running
  // every frame for nothing; sleeping bodies keep resting contacts stable)

  // sync meshes
  for (const c of coins) {
    if (c.state === 'onboard') {
      c.mesh.position.copy(c.body.position);
      c.mesh.quaternion.copy(c.body.quaternion);
    } else if (c.state === 'sinking') {
      c.sink.t += dt;
      const k = Math.min(1, c.sink.t / 0.38);
      c.mesh.position.y = c.sink.from.y - k * 0.09;
      c.mesh.rotation.z += dt * 9;
      c.mesh.rotation.x += dt * 5;
      const s = 1 - 0.65 * k;
      c.mesh.scale.set(s, s, s);
      if (k >= 1) { c.mesh.visible = false; c.state = 'pocketed'; pocketed[c.owner].push(c); }
    }
  }
  if (striker) {
    if (striker.state === 'onboard') {
      striker.mesh.position.copy(striker.body.position);
      striker.mesh.quaternion.copy(striker.body.quaternion);
    } else if (striker.state === 'sinking') {
      striker.sink.t += dt;
      const k = Math.min(1, striker.sink.t / 0.38);
      striker.mesh.position.y = striker.sink.from.y - k * 0.09;
      striker.mesh.rotation.z += dt * 9;
      striker.mesh.rotation.x += dt * 5;
      const s = 1 - 0.65 * k;
      striker.mesh.scale.set(s, s, s);
      if (k >= 1) striker.mesh.visible = false;
    }
  }

  // follow the striker while a shot is running — the action should stay in view
  const follow = phase === 'physics' && striker && striker.state === 'onboard'
    ? _followTmp.set(striker.body.position.x * 0.35, 0.06, striker.body.position.z * 0.35)
    : _followTmp.set(0, 0.06, 0);
  controls.target.lerp(follow, 0.06);
  controls.update();
  renderer.render(scene, camera);
}

/* ============================== BOOT ============================== */
buildPieces();
startTurn();
setMsg('Drag anywhere & release to flick 🎯 — drag the striker along the line to position it (right-drag = camera)');
tick();

/* debug handle */
window.__carrom = {
  get state() {
    return {
      turn, phase, aivsai: AIVSAI,
      pocketed: { white: pocketed.white.length, black: pocketed.black.length },
      queenOwner, queenPending,
      firstContact: shot ? shot.firstContact : null,
      shotPockets: shot ? shot.pockets.map(p => p.type + (p.owner ? ':' + p.owner : '')) : [],
    };
  },
  shoot: (vx, vz) => { if (phase === 'idle') shoot(vx, vz, Math.hypot(vx, vz) || 1); },
  reset: resetGame,
  coinsOnBoard: () => coins.filter(c => c.state === 'onboard').length,
};
