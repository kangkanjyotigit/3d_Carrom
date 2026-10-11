// Node verification harness for the Carrom3D game physics + rules.
// Mirrors the world setup and logic from carrom.html exactly (constants copied 1:1).
import * as CANNON from './cannon-es.mjs';

/* ---- constants (copied from carrom.html) ---- */
const BOARD_Y   = 0.06;
const HALF      = 0.35;
const BASELINE  = -0.33;
const COIN_R    = 0.016;
const COIN_H    = 0.003;
const STR_R     = 0.0205;
const STR_H     = 0.005;
const MAX_SPEED = 5.5;
const MU_BOARD = 0.35;
const POCKETS = [
  { x: 0.35, z: 0.35, r: 0.030 }, { x:-0.35, z: 0.35, r: 0.030 },
  { x: 0.35, z:-0.35, r: 0.030 }, { x:-0.35, z:-0.35, r: 0.030 },
];

// mirrors carrom.html brakeBody()
function brake(body, dt) {
  const v = body.velocity;
  const s = v.length();
  if (s < 0.02) return;
  const decel = MU_BOARD * 9.81 * dt;
  if (s <= decel) v.setZero();
  else v.scale((s - decel) / s, v);
}

/* ---- world ---- */
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.sleepSpeedLimit = 0.06;
world.sleepTimeLimit = 0.4;
const mCoin = new CANNON.Material('coin');
const mCushion = new CANNON.Material('cushion');
const mPlane = new CANNON.Material('plane');
world.addContactMaterial(new CANNON.ContactMaterial(mCoin, mCoin, { friction: 0.05, restitution: 0.88 }));
world.addContactMaterial(new CANNON.ContactMaterial(mCoin, mCushion, { friction: 0.05, restitution: 0.90 }));
world.addContactMaterial(new CANNON.ContactMaterial(mCoin, mPlane, { friction: 0.0, restitution: 0.08 }));
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
addStaticBox(0, 0.07, -0.365, 0.30, 0.01, 0.015, mCushion);
addStaticBox(0, 0.07,  0.365, 0.30, 0.01, 0.015, mCushion);
addStaticBox(-0.365, 0.07, -0.1905, 0.015, 0.01, 0.1595, mCushion);
addStaticBox(-0.365, 0.07,  0.1905, 0.015, 0.01, 0.1595, mCushion);
addStaticBox( 0.365, 0.07, -0.1905, 0.015, 0.01, 0.1595, mCushion);
addStaticBox( 0.365, 0.07,  0.1905, 0.015, 0.01, 0.1595, mCushion);
addStaticBox(0, 0.07, -0.40, 0.40, 0.01, 0.01, mCushion);
addStaticBox(0, 0.07,  0.40, 0.40, 0.01, 0.01, mCushion);
addStaticBox(-0.40, 0.07, 0, 0.01, 0.01, 0.40, mCushion);
addStaticBox( 0.40, 0.07, 0, 0.01, 0.01, 0.40, mCushion);

function makeDynamic(radius, height, mass, material, kind, owner) {
  const body = new CANNON.Body({ mass, material, shape: new CANNON.Cylinder(radius, radius, height, 24) });
  body.linearDamping = 0.008; body.angularDamping = 0.02;
  body.ccdSpeedThreshold = 1.5;
  body.ccdSphereRadius = radius + 0.006;
  body.userData = { kind, owner };
  world.addBody(body);
  return body;
}
function place(body, x, z, jitter) {
  body.position.set(x + (jitter ? (Math.random()-0.5)*jitter : 0), BOARD_Y + 0.012, z + (jitter ? (Math.random()-0.5)*jitter : 0));
  body.velocity.setZero(); body.angularVelocity.setZero();
  body.quaternion.set(0,0,0,1);
  if (!world.bodies.includes(body)) world.addBody(body);
}
function buildPieces() {
  const bodies = [];
  bodies.push(makeDynamic(COIN_R, COIN_H, 0.37, mCoin, 'queen', 'queen'));
  const ring = (n, r, off) => {
    for (let i = 0; i < n; i++) {
      const a = off + i * (2*Math.PI/n);
      const owner = i % 2 === 0 ? 'white' : 'black';
      const b = makeDynamic(COIN_R, COIN_H, 0.37, mCoin, 'coin', owner);
      place(b, r*Math.cos(a), r*Math.sin(a), 0.003);
      bodies.push(b);
    }
  };
  ring(6, 0.052, Math.PI/12);
  ring(12, 0.100, Math.PI/12);
  place(bodies[0], 0, 0, 0);
  const striker = makeDynamic(STR_R, STR_H, 1.0, mCoin, 'striker', null);
  striker.angularDamping = 0.15;
  place(striker, 0, BASELINE, 0);
  return { bodies, striker };
}

function step(t = 1/60, n = 1) { for (let i = 0; i < n; i++) world.step(t, t, 6); }

const MAXV = 9, MINV = -9;

/* ================= TEST A: initial layout stability ================= */
{
  const { bodies, striker } = buildPieces();
  const start = bodies.map(b => ({ x: b.position.x, z: b.position.z }));
  for (let i = 0; i < 600; i++) { world.step(1/60, 1/60, 6); for (const b of bodies) brake(b, 1/60); brake(striker, 1/60); }
  let maxDrift = 0, worst = '';
  bodies.forEach((b, i) => {
    const d = Math.hypot(b.position.x - start[i].x, b.position.z - start[i].z);
    if (d > maxDrift) { maxDrift = d; worst = b.userData.kind + '/' + b.userData.owner; }
  });
  const allOnBoard = bodies.every(b => Math.abs(b.position.x) < 0.38 && Math.abs(b.position.z) < 0.38);
  const strikerRest = striker.position.z;
  console.log(`[A] layout stability: max drift ${maxDrift.toFixed(4)}m (${worst}), all on board: ${allOnBoard}, striker z=${strikerRest.toFixed(3)}`);
}

/* ================= TEST B: shot calibration (clean single-coin lane) ================= */
{
  // clear the board, place ONE coin at a known distance from the baseline
  for (const b of [...world.bodies]) if (b !== boardBody && b.mass > 0) world.removeBody(b);
  const coin = makeDynamic(COIN_R, COIN_H, 0.37, mCoin, 'coin', 'white');
  place(coin, 0, -0.13, 0);                       // 0.20m above baseline
  const striker = makeDynamic(STR_R, STR_H, 1.0, mCoin, 'striker', null);
  place(striker, 0, BASELINE, 0);
  const v = 3.0;
  striker.velocity.set(0, 0, v);                  // straight up
  let hitSpeed = 0, tHit = 0;
  for (let i = 0; i < 60*8; i++) {
    world.step(1/60, 1/60, 6);
    brake(coin, 1/60); brake(striker, 1/60);
    if (coin.velocity.length() > hitSpeed) { hitSpeed = coin.velocity.length(); tHit = i/60; }
    let maxV = 0;
    for (const b of [coin, striker]) maxV = Math.max(maxV, b.velocity.length());
    if (maxV < 0.05) { if (++tHit > 33) break; } else tHit = 0;
  }
  const travel = coin.position.z - (-0.13);
  console.log(`[B] clean hit@${v}m/s: coin peak ${hitSpeed.toFixed(2)} m/s (ratio ${(hitSpeed/v).toFixed(2)}), coin travelled ${travel.toFixed(3)}m (predicted ${(hitSpeed*hitSpeed/(2*MU_BOARD*9.81)).toFixed(3)}m)`);
  // calibrate deceleration: fire coin alone at 3 m/s, measure stopping distance
  for (const b of [...world.bodies]) if (b !== boardBody && b.mass > 0) world.removeBody(b);
  const c2 = makeDynamic(COIN_R, COIN_H, 0.37, mCoin, 'coin', 'black');
  place(c2, 0, 0, 0);
  c2.velocity.set(0, 0, 1.5);                    // slow enough to stop before the cushion (0.334m)
  const vStart = 1.5;
  let vAfter = 0;
  for (let i = 0; i < 12; i++) {                 // 0.2s window, travel ~0.27m < 0.334m
    world.step(1/60, 1/60, 6);
    brake(c2, 1/60);
  }
  vAfter = c2.velocity.length();
  const decel = (vStart - vAfter) / 0.2;
  console.log(`[B2] free coin deceleration: ${decel.toFixed(2)} m/s² (target μ·g = ${(MU_BOARD*9.81).toFixed(2)}, μ_eff=${(decel/9.81).toFixed(3)})`);
}

/* ================= TEST C: pocket catch behaviour ================= */
{
  const { bodies, striker } = buildPieces();
  // C1: slow coin rolling into corner pocket → must sink
  const coin = makeDynamic(COIN_R, COIN_H, 0.37, mCoin, 'coin', 'white');
  place(coin, 0.30, -0.30, 0);
  coin.velocity.set(1.2, 0, -1.2);   // diagonal toward corner pocket (0.35,-0.35)
  let sunkSlow = false, tSlow = 0, slowSinkSpeed = 0;
  for (let i = 0; i < 60*5 && !sunkSlow; i++) {
    world.step(1/60, 1/60, 6);
    brake(coin, 1/60);
    tSlow += 1/60;
    const p = coin.position;
    const pk = POCKETS.find(q => Math.hypot(p.x-q.x, p.z-q.z) < q.r && (coin.velocity.length() < 3.5 || Math.hypot(p.x-q.x, p.z-q.z) < q.r*0.5));
    if (pk) { sunkSlow = true; slowSinkSpeed = coin.velocity.length(); }
  }
  console.log(`[C1] slow coin (1.7 m/s) into corner pocket: ${sunkSlow ? 'SUNK ✓' : 'MISSED ✗'} after ${tSlow.toFixed(2)}s at speed ${slowSinkSpeed.toFixed(2)}`);
  // C2: fast coin zipping across mid pocket mouth → must NOT be teleported while fast
  const coin2 = makeDynamic(COIN_R, COIN_H, 0.37, mCoin, 'coin', 'black');
  place(coin2, -0.24, 0.0, 0);                   // clear spot, dead-on line through mid pocket (-0.35, 0)
  coin2.velocity.set(-4.5, 0, 0);    // crosses mid pocket mouth at 4.5 m/s
  let sunkFast = false, fastAt = 0, sinkSpeed = 0, everInsideFast = false;
  for (let i = 0; i < 60*6; i++) {
    world.step(1/60, 1/60, 6);
    brake(coin2, 1/60);
    const p = coin2.position;
    const spd = coin2.velocity.length();
    const inside = POCKETS.some(q => Math.hypot(p.x-q.x, p.z-q.z) < q.r);
    if (inside && spd > 2.0 && !sunkFast) everInsideFast = true;
    const pk = POCKETS.find(q => Math.hypot(p.x-q.x, p.z-q.z) < q.r && (spd < 3.5 || Math.hypot(p.x-q.x, p.z-q.z) < q.r*0.5));
    if (pk) { sunkFast = true; sinkSpeed = spd; fastAt = i/60; break; }
  }
  const teleported = sunkFast && sinkSpeed > 2.0;
  console.log(`[C2] fast coin (4.5 m/s) across mid pocket: ${teleported ? `TELEPORT ✗ sunk at ${sinkSpeed.toFixed(1)} m/s` : `no teleport ✓ (${sunkFast ? 'sunk later at ' + sinkSpeed.toFixed(2) + ' m/s' : 'rattled out'}, crossed-fast=${everInsideFast})`}`);
  // C3: coin slowed by wall then settles in corner pocket → sinks (the real pocketing path)
  const coin3 = makeDynamic(COIN_R, COIN_H, 0.37, mCoin, 'coin', 'white');
  place(coin3, 0.28, -0.28, 0);
  coin3.velocity.set(2.2, 0, -2.2);
  let sunk3 = false;
  for (let i = 0; i < 60*6 && !sunk3; i++) {
    world.step(1/60, 1/60, 6);
    brake(coin3, 1/60);
    const p = coin3.position;
    if (POCKETS.some(q => Math.hypot(p.x-q.x, p.z-q.z) < q.r)) {
      const sp = coin3.velocity.length();
      if (sp < 3.5) sunk3 = true;
    }
  }
  console.log(`[C3] medium coin (3.1 m/s) into corner: ${sunk3 ? 'SUNK ✓' : 'not caught'}`);
}

/* ================= TEST D: rule resolution (pure logic) ================= */
function resolve(shot, state) {
  const { player, opp, qo, qp, pc } = state;
  const ownP = shot.pockets.filter(p => p.type === 'coin' && p.owner === player).length;
  const oppP = shot.pockets.filter(p => p.type === 'coin' && p.owner === opp).length;
  const queenP = shot.pockets.some(p => p.type === 'queen');
  const strikerP = shot.pockets.some(p => p.type === 'striker');
  const fc = shot.firstContact;
  const contactFoul = fc ? (fc.type === 'coin' && fc.owner !== player) : true;
  let queenOwner = qo, queenPending = qp;
  let queenReturned = false;
  if (strikerP && (queenP || queenPending)) { queenReturned = true; queenPending = null; }
  if (queenP && !strikerP) queenPending = player;
  if (queenPending === player && ownP > 0) { queenOwner = player; queenPending = null; }
  else if (queenPending === opp && ownP > 0) { queenOwner = player; queenPending = null; }
  const again = !strikerP && !contactFoul && ownP > 0;
  const win = pc[player] + ownP >= 9;
  return { again, next: again ? player : opp, queenOwner, queenPending, queenReturned, win, foul: strikerP || contactFoul };
}
const cases = [
  ['own coin pocketed → play again', { player:'white', opp:'black', qo:null, qp:null, pc:{white:0,black:0} }, { pockets:[{type:'coin',owner:'white'}], firstContact:{type:'coin',owner:'white'} }, r => r.again && r.next==='white' && !r.foul],
  ['opp coin pocketed → turn passes', { player:'white', opp:'black', qo:null, qp:null, pc:{white:0,black:0} }, { pockets:[{type:'coin',owner:'black'}], firstContact:{type:'coin',owner:'white'} }, r => !r.again && r.next==='black'],
  ['striker foul → turn passes + coin returned', { player:'white', opp:'black', qo:null, qp:null, pc:{white:3,black:0} }, { pockets:[{type:'striker',owner:null}], firstContact:{type:'coin',owner:'white'} }, r => r.foul && r.next==='black'],
  ['wrong first contact → foul, turn passes even with own pocket', { player:'white', opp:'black', qo:null, qp:null, pc:{white:0,black:0} }, { pockets:[{type:'coin',owner:'white'}], firstContact:{type:'coin',owner:'black'} }, r => r.foul && !r.again],
  ['queen pocketed → pending, must cover', { player:'white', opp:'black', qo:null, qp:null, pc:{white:0,black:0} }, { pockets:[{type:'queen',owner:'queen'}], firstContact:{type:'coin',owner:'white'} }, r => r.queenPending==='white' && r.queenOwner===null],
  ['queen + own coin same shot → covered +3', { player:'white', opp:'black', qo:null, qp:null, pc:{white:0,black:0} }, { pockets:[{type:'queen',owner:'queen'},{type:'coin',owner:'white'}], firstContact:{type:'coin',owner:'white'} }, r => r.queenOwner==='white' && r.queenPending===null],
  ['queen pending, opponent pockets own coin → stolen', { player:'black', opp:'white', qo:null, qp:'white', pc:{white:0,black:0} }, { pockets:[{type:'coin',owner:'black'}], firstContact:{type:'coin',owner:'black'} }, r => r.queenOwner==='black'],
  ['queen pending, striker foul → queen back to centre', { player:'white', opp:'black', qo:null, qp:'white', pc:{white:1,black:0} }, { pockets:[{type:'striker',owner:null}], firstContact:{type:'coin',owner:'white'} }, r => r.queenReturned && r.queenPending===null && r.queenOwner===null],
  ['9th coin pocketed → win', { player:'white', opp:'black', qo:'white', qp:null, pc:{white:8,black:0} }, { pockets:[{type:'coin',owner:'white'}], firstContact:{type:'coin',owner:'white'} }, r => r.win],
  ['dry shot (no contact) → foul', { player:'white', opp:'black', qo:null, qp:null, pc:{white:0,black:0} }, { pockets:[], firstContact:null }, r => r.foul && !r.again],
];
let pass = 0;
for (const [name, st, shot, check] of cases) {
  const r = resolve(shot, st);
  const ok = check(r);
  if (ok) pass++;
  console.log(`[D] ${ok ? '✓' : '✗ FAIL'} ${name} → ${JSON.stringify(r)}`);
}
console.log(`[D] ${pass}/${cases.length} rule cases passed`);
