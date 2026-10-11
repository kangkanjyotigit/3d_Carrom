// Full-game simulation: ports the game's AI shot selection + turn flow from carrom.html
// and plays complete AI-vs-AI games to prove the loop terminates with a winner.
import * as CANNON from './cannon-es.mjs';

const BOARD_Y = 0.06, BASELINE = -0.32, COIN_R = 0.016, COIN_H = 0.003;
const STR_R = 0.0205, STR_H = 0.005, MAX_SPEED = 5.5, MU_BOARD = 0.35;
const POCKETS = [
  { x: 0.35, z: 0.35, r: 0.040 }, { x:-0.35, z: 0.35, r: 0.040 },
  { x: 0.35, z:-0.35, r: 0.040 }, { x:-0.35, z:-0.35, r: 0.040 },
];
const other = p => p === 'white' ? 'black' : 'white';

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
// NaiveBroadphase: SAP's sweep-and-prune breaks early on stale axis order once bodies
// move (cannon-es only re-sorts on add/remove), letting the striker phase through coins.
// With ~20 bodies O(n²) is trivial and always correct.
world.broadphase = new CANNON.NaiveBroadphase();
world.allowSleep = true;
world.sleepSpeedLimit = 0.06;
world.sleepTimeLimit = 0.4;
const mCoin = new CANNON.Material('coin');
const mCushion = new CANNON.Material('cushion');
const mPlane = new CANNON.Material('plane');
world.addContactMaterial(new CANNON.ContactMaterial(mCoin, mCoin, { friction: 0.05, restitution: 0.88 }));
world.addContactMaterial(new CANNON.ContactMaterial(mCoin, mCushion, { friction: 0.05, restitution: 0.55 }));
world.addContactMaterial(new CANNON.ContactMaterial(mCoin, mPlane, { friction: 0.0, restitution: 0.08 }));
world.defaultContactMaterial.friction = 0.05;
world.defaultContactMaterial.restitution = 0.5;

const plane = new CANNON.Body({ mass: 0, material: mPlane, shape: new CANNON.Plane() });
plane.quaternion.setFromEuler(-Math.PI/2, 0, 0);
plane.position.y = BOARD_Y;
world.addBody(plane);
const statics = [
  [0, 0.07, -0.365, 0.30, 0.01, 0.015], [0, 0.07, 0.365, 0.30, 0.01, 0.015],
  [-0.365, 0.07, 0, 0.015, 0.01, 0.30], [0.365, 0.07, 0, 0.015, 0.01, 0.30],
  [0, 0.07, -0.40, 0.40, 0.01, 0.01], [0, 0.07, 0.40, 0.40, 0.01, 0.01],
  [-0.40, 0.07, 0, 0.01, 0.01, 0.40], [0.40, 0.07, 0, 0.01, 0.01, 0.40],
];
for (const [px, py, pz, hx, hy, hz] of statics) {
  const b = new CANNON.Body({ mass: 0, material: mCushion, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)) });
  b.position.set(px, py, pz);
  world.addBody(b);
}

let coins = [], striker = null;
let turn = 'white', queenOwner = null, queenPending = null;
const pocketed = { white: [], black: [] };
let shot = null;
let stats = { dry: 0, wrongContact: 0, strikerFoul: 0, potWithStrikerFoul: 0, ownPots: 0, oppPots: 0, queenPots: 0, queenCovers: 0, queenSteals: 0, queenReturns: 0 };
let aiStats = { candidates: 0, fallbacks: 0, considered: 0 };

function makeBody(radius, height, mass, kind, owner) {
  // fixedRotation via constructor: zeroes invInertia → solver can never tilt the piece
  // (real carrom coins are flat discs; a tilting cylinder also breaks contact geometry)
  const b = new CANNON.Body({ mass, material: mCoin, shape: new CANNON.Cylinder(radius, radius, height, 24), fixedRotation: true });
  b.linearDamping = 0.008; b.angularDamping = 0.02;
  b.angularFactor.set(0, 0, 0);
  // CCD disabled: its swept-sphere raycast misses thin cylinders at grazing angles.
  // Tunneling is impossible anyway with 6 substeps (max move 1.5cm/substep vs 7.3cm needed).
  b.ccdSpeedThreshold = 1e9;
  b.ccdSphereRadius = radius + 0.006;
  b.userData = { kind, owner };
  b.userData.hits = 0;
  if (kind === 'striker') {
    b.angularDamping = 0.15;
    b.addEventListener('collide', ev => {
      const k = ev.body.userData ? ev.body.userData.kind : '';
      if ((k === 'coin' || k === 'queen') && shot && shot.active && !shot.firstContact) {
        // stop-shot: the striker sheds most of its speed on its first coin contact
        // (real players control follow-through; otherwise the striker follows every
        // pot into the pocket). Break shots keep energy via subsequent contacts.
        shot.firstContact = { type: k === 'queen' ? 'queen' : 'coin', owner: ev.body.userData.owner };
        b.velocity.scale(0.35, b.velocity);
      }
    });
  }
  world.addBody(b);
  // mirror the game's piece wrapper: { body, kind, owner, state, sink }
  return { body: b, kind, owner, state: 'onboard', sink: null };
}
function place(b, x, z) {
  b.position.set(x, BOARD_Y + 0.012, z);
  b.velocity.setZero(); b.angularVelocity.setZero();
  b.quaternion.set(0, 0, 0, 1);
  b.wakeUp();
  if (!world.bodies.includes(b)) world.addBody(b);
}
function build() {
  for (const b of [...world.bodies]) if (b.mass > 0) world.removeBody(b);
  coins = []; pocketed.white.length = 0; pocketed.black.length = 0;
  queenOwner = null; queenPending = null; turn = 'white';
  const queen = makeBody(COIN_R, COIN_H, 0.37, 'queen', 'queen'); coins.push(queen);
  const ring = (n, r, off) => {
    for (let i = 0; i < n; i++) {
      const a = off + i * (2*Math.PI/n);
      const owner = i % 2 === 0 ? 'white' : 'black';
      coins.push(makeBody(COIN_R, COIN_H, 0.37, 'coin', owner));
      place(coins[coins.length-1].body, r*Math.cos(a), r*Math.sin(a));
    }
  };
  ring(6, 0.052, Math.PI/12);
  ring(12, 0.100, Math.PI/12);
  place(queen.body, 0, 0);
  striker = makeBody(STR_R, STR_H, 1.0, 'striker', null);
  place(striker.body, 0, BASELINE);
}
function brake(b, dt) {
  const v = b.velocity, s = v.length();
  if (s < 0.02) return;
  const decel = MU_BOARD * 9.81 * dt;
  if (s <= decel) v.setZero(); else v.scale((s - decel) / s, v);
}
function dist2(ax, az, bx, bz) { return Math.hypot(ax-bx, az-bz); }
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

/* ---- aiChooseShot: verbatim port from carrom.html ---- */
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
  aiStats.considered += targets.length;
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
      if (dz < 0.05 || Math.abs(dx) > 0.99) continue;
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
      const xs = tx - tParam * dx;
      if (xs < -0.28 || xs > 0.28) continue;
      // reachability: striker must travel L = (tz-sz)/dz and arrive with enough
      // speed to pot the coin; launch speed = sqrt(vImpact² + 2·μ·g·L) must fit MAX_SPEED
      const vCoin = Math.sqrt(2 * MU_BOARD * 9.81 * (d + 0.05));
      const vImpact = vCoin / 0.60;
      const L = tParam;
      const vLaunch = Math.sqrt(vImpact*vImpact + 2*MU_BOARD*9.81*L);
      if (vLaunch > MAX_SPEED * 0.9) continue;
      let blocked = 0;
      for (const o of coins) {
        if (o === t || o.state !== 'onboard') continue;
        if (distPointSeg2(o.body.position.x, o.body.position.z, xs, sz, tx, tz) < COIN_R*2 + 0.008) { blocked++; }
      }
      if (blocked) continue;
      for (const o of coins) {
        if (o === t || o.state !== 'onboard') continue;
        const dot = (o.body.position.x - tx)*dx + (o.body.position.z - tz)*dz;
        if (dot > 0 && distPointRay2(o.body.position.x, o.body.position.z, tx, tz, dx, dz) < COIN_R*2) { blocked++; }
      }
      if (blocked) continue;
      const err = distPointRay2(g.x, g.z, tx, tz, dx, dz);
      if (err > g.pk.r - 0.004) continue;
      const score = err + d * 0.02 + (t === queen ? -0.02 : 0) + (steal && t !== queen ? -0.025 : 0);
      cands.push({ t, pk: g.pk, xs, dx, dz, d, err, score, vLaunch });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  if (cands.length) {
    aiStats.candidates++;
    const c = cands[0];
    // physical model: launch speed covers braking losses over the striker's path
    // and leaves enough impact speed for the coin to reach the pocket mouth
    let v = (c.vLaunch + 0.3) * (0.97 + Math.random() * 0.06);
    v = Math.max(0.5, Math.min(MAX_SPEED, v));
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
  aiStats.fallbacks++;
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
  return { xs: Math.max(-0.28, Math.min(0.28, sx)), dx, dz, v, tgt: { x: best.body.position.x, z: best.body.position.z, d, owner: best.owner } };
}

/* ---- game flow (resolveShot port) ---- */
function sinkItem(obj, pk) {
  obj.state = 'pocketed';
  world.removeBody(obj.body);
  shot.pockets.push({ type: obj.kind === 'queen' ? 'queen' : obj.kind === 'striker' ? 'striker' : 'coin', owner: obj.owner });
  if (obj.kind === 'coin') pocketed[obj.owner].push(obj);
}
function checkPockets() {
  for (const c of coins) {
    if (c.state !== 'onboard') continue;
    const p = c.body.position;
    let sunk = false;
    for (const pk of POCKETS) {
      const dx = p.x - pk.x, dz = p.z - pk.z, d2 = dx*dx + dz*dz;
      if (d2 < pk.r * pk.r) {
        const sp = c.body.velocity.length();
        // a real pocket catches a coin at any reasonable speed — long pots arrive at
        // the mouth at ~2.7 m/s and must sink, not zip across between frames
        if (sp < 3.5 || d2 < pk.r * pk.r * 0.25) { sinkItem(c, pk); sunk = true; break; }
      }
    }
    // off the playing surface / wedged into a cushion (edge past the face, at rest)
    // → official rule: back to centre. Fast coins are transiently in the cushion during
    // bounces — only rescue the stuck ones.
    if (!sunk && (Math.abs(p.x) > 0.335 || Math.abs(p.z) > 0.335) && c.body.velocity.length() < 0.25) {
      const a = Math.random() * Math.PI * 2, r = 0.05;
      c.state = 'onboard';
      place(c.body, r*Math.cos(a), r*Math.sin(a));
    }
  }
  if (striker && striker.state === 'onboard') {
    const p = striker.body.position;
    for (const pk of POCKETS) {
      const dx = p.x - pk.x, dz = p.z - pk.z, d2 = dx*dx + dz*dz;
      if (d2 < pk.r * pk.r) {
        const sp = striker.body.velocity.length();
        if (sp < 3.5 || d2 < pk.r * pk.r * 0.25) { sinkItem(striker, pk); break; }
      }
    }
  }
}
function returnCoinToCenter(owner) {
  const list = pocketed[owner];
  if (!list.length) return false;
  const c = list.pop();
  const a = Math.random() * Math.PI * 2, r = 0.05;
  c.state = 'onboard';
  place(c.body, r*Math.cos(a), r*Math.sin(a));
  return true;
}
function returnQueenToCenter() {
  const q = coins.find(c => c.kind === 'queen');
  q.state = 'onboard';
  place(q.body, 0, 0);
}
function resolveShot() {
  const player = turn, opp = other(player);
  const ownP = shot.pockets.filter(p => p.type === 'coin' && p.owner === player).length;
  const queenP = shot.pockets.some(p => p.type === 'queen');
  const strikerP = shot.pockets.some(p => p.type === 'striker');
  const fc = shot.firstContact;
  const contactFoul = fc ? (fc.type === 'coin' && fc.owner !== player) : true;
  if (!fc) stats.dry++;
  if (contactFoul && fc) stats.wrongContact++;
  if (strikerP) {
    stats.strikerFoul++;
    if (shot.pockets.some(p => p.type === 'coin')) stats.potWithStrikerFoul++;   // the churn marker
  }
  if (strikerP && (queenP || queenPending)) { queenPending = null; stats.queenReturns++; returnQueenToCenter(); }
  if (queenP && !strikerP) { queenPending = player; stats.queenPots++; }
  if (queenPending === player && ownP > 0) { queenOwner = player; queenPending = null; stats.queenCovers++; }
  else if (queenPending === opp && ownP > 0) { queenOwner = player; queenPending = null; stats.queenSteals++; }
  if (strikerP) returnCoinToCenter(player);
  if (ownP > 0) stats.ownPots += ownP;
  const oppP = shot.pockets.filter(p => p.type === 'coin' && p.owner === opp).length;
  if (oppP > 0) stats.oppPots += oppP;
  const again = !strikerP && !contactFoul && ownP > 0;
  if (pocketed[player].length >= 9) return player;
  turn = again ? player : opp;
  return null;
}

/* ---- one game ---- */
function playGame() {
  build();
  let shots = 0, winner = null, candFound = 0, fallback = 0;
  while (shots < 1500 && !winner) {
    shots++;
    // mirrors game startTurn(): striker back on the baseline before the AI plans
    striker.state = 'onboard';
    striker.body.position.set(0, BOARD_Y + STR_H/2 + 0.002, BASELINE);
    striker.body.velocity.setZero(); striker.body.angularVelocity.setZero();
    striker.body.wakeUp();   // sleeping bodies are skipped by the solver
    if (!world.bodies.includes(striker.body)) world.addBody(striker.body);
    const choice = aiChooseShot();
    if (!choice) { winner = other(turn); break; }
    striker.body.position.x = choice.xs;
    striker.body.velocity.set(choice.dx * choice.v, 0, choice.dz * choice.v);
    if (shots === 4) {
      const near = coins.filter(c => c.state === 'onboard' && dist2(c.body.position.x, c.body.position.z, striker.body.position.x, striker.body.position.z) < 0.12)
        .map(c => c.kind.slice(0,1) + ':' + c.owner + '@' + c.body.position.x.toFixed(2) + ',' + c.body.position.z.toFixed(2));
      console.log(`    fire: v=(${striker.body.velocity.x.toFixed(2)},${striker.body.velocity.z.toFixed(2)}) coinsNear=${JSON.stringify(near)}`);
    }
    shot = { firstContact: null, pockets: [], active: true, still: 0 };
    let still = 0;
    for (let i = 0; i < 60*16; i++) {
      world.step(1/60, 1/60, 6);
      // Flat discs on a flat board: clamp pieces to the surface — no pops, no stacking,
      // no climbing the cushions (real carrom coins never leave the plane).
      for (const c of coins) {
        if (c.state !== 'onboard') continue;
        if (c.body.position.y > 0.0635) {
          c.body.position.y = 0.0615; c.body.velocity.y = 0;
          // keep the piece inside the play area while teleporting down
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
        if (c.state !== 'onboard') continue;
        brake(c.body, 1/60);
        maxV = Math.max(maxV, c.body.velocity.length());
      }
      if (striker.state === 'onboard') {
        brake(striker.body, 1/60);
        maxV = Math.max(maxV, striker.body.velocity.length());
      }
      checkPockets();
      if (maxV < 0.05) { still++; if (still > 27) break; } else still = 0;
    }
    // telemetry
    if (shots < 6) {
      let nearest = 1e9, nObj = null;
      for (const c of coins) {
        if (c.state !== 'onboard') continue;
        const dd = dist2(c.body.position.x, c.body.position.z, striker.body.position.x, striker.body.position.z);
        if (dd < nearest) { nearest = dd; nObj = c; }
      }
      console.log(`    striker ends (${striker.body.position.x.toFixed(3)},${striker.body.position.z.toFixed(3)}) v=${striker.body.velocity.length().toFixed(2)} hits=${striker.body.userData.hits} nearest ${nObj ? nObj.kind + ':' + nObj.owner : '-'} @ ${nearest.toFixed(3)}`);
    }
    const before = stats.ownPots + stats.oppPots;
    const w = resolveShot();
    if (w) winner = w;
  }
  const onboardW = coins.filter(c => c.kind === 'coin' && c.owner === 'white' && c.state === 'onboard').length;
  const onboardB = coins.filter(c => c.kind === 'coin' && c.owner === 'black' && c.state === 'onboard').length;
  return { shots, winner, candFound, fallback, onboardW, onboardB, cands: aiStats.candidates, fbs: aiStats.fallbacks, dry: stats.dry, wrongContact: stats.wrongContact, strikerFoul: stats.strikerFoul, potWithStrikerFoul: stats.potWithStrikerFoul, ownPots: stats.ownPots, oppPots: stats.oppPots, queenPots: stats.queenPots, queenCovers: stats.queenCovers, queenSteals: stats.queenSteals, queenReturns: stats.queenReturns, whiteP: pocketed.white.length, blackP: pocketed.black.length, queenOwner };
}

const results = [];
const GAMES = parseInt(process.env.SIM_GAMES || '3', 10);
for (let g = 0; g < GAMES; g++) {
  stats = { dry: 0, wrongContact: 0, strikerFoul: 0, potWithStrikerFoul: 0, ownPots: 0, oppPots: 0, queenPots: 0, queenCovers: 0, queenSteals: 0, queenReturns: 0 };
  aiStats = { candidates: 0, fallbacks: 0, considered: 0 };
  const r = playGame();
  results.push(r);
  console.log(`game ${String(g+1).padStart(2)}: winner=${String(r.winner).padEnd(5)} shots=${String(r.shots).padStart(3)} W:${r.whiteP} B:${r.blackP} queen→${r.queenOwner || 'none'} | cands=${r.cands} fbs=${r.fbs} pots own/opp=${r.ownPots}/${r.oppPots} dry=${r.dry} wrongFc=${r.wrongContact} strikers=${r.strikerFoul} pot+strikerFoul=${r.potWithStrikerFoul} queenP=${r.queenPots} covers=${r.queenCovers} steals=${r.queenSteals} ret=${r.queenReturns} onboard=${r.onboardW}/${r.onboardB}`);
}
const totals = results.reduce((a, r) => {
  for (const k of ['shots','dry','wrongContact','strikerFoul','ownPots','oppPots','queenPots','queenCovers','queenSteals','queenReturns']) a[k] += r[k];
  return a;
}, { shots:0, dry:0, wrongContact:0, strikerFoul:0, ownPots:0, oppPots:0, queenPots:0, queenCovers:0, queenSteals:0, queenReturns:0 });
const allTerminated = results.every(r => r.winner);
const noHangs = results.every(r => r.shots < 600);
const potRate = totals.ownPots / totals.shots;
console.log(`\n${results.length} games: all terminated with winner=${allTerminated}, no 600-shot hangs=${noHangs}`);
console.log(`avg shots/game=${(totals.shots/results.length).toFixed(0)}, AI own-coin pot rate=${(potRate*100).toFixed(1)}% per shot`);
console.log(`queen events: pocketed=${totals.queenPots}, covered=${totals.queenCovers}, stolen=${totals.queenSteals}, returned-on-foul=${totals.queenReturns}`);
console.log(`fouls: dry=${totals.dry}, wrong-first-contact=${totals.wrongContact}, striker-in-pocket=${totals.strikerFoul}`);
