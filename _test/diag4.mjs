import * as CANNON from './cannon-es.mjs';
const BOARD_Y = 0.06, MU_BOARD = 0.35;

function newWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = false;
  const mCoin = new CANNON.Material('coin');
  const mPlane = new CANNON.Material('plane');
  const mCush = new CANNON.Material('cushion');
  world.addContactMaterial(new CANNON.ContactMaterial(mCoin, mPlane, { friction: 0.0, restitution: 0.08 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mCoin, mCush, { friction: 0.05, restitution: 0.90 }));
  world.defaultContactMaterial.friction = 0.05;
  world.defaultContactMaterial.restitution = 0.5;
  const plane = new CANNON.Body({ mass: 0, material: mPlane, shape: new CANNON.Plane() });
  plane.quaternion.setFromEuler(-Math.PI/2, 0, 0);
  plane.position.y = BOARD_Y;
  world.addBody(plane);
  return { world, mCoin, mCush };
}

function brake(body, dt) {
  const v = body.velocity;
  const s = v.length();
  if (s < 0.02) return;
  const decel = MU_BOARD * 9.81 * dt;
  if (s <= decel) v.setZero();
  else v.scale((s - decel) / s, v);
}

function coin(world, mCoin, x, z) {
  const b = new CANNON.Body({ mass: 0.37, material: mCoin, shape: new CANNON.Cylinder(0.016, 0.016, 0.003, 24) });
  b.linearDamping = 0.008; b.angularDamping = 0.02;
  b.position.set(x, BOARD_Y + 0.0015, z);
  world.addBody(b);
  return b;
}

// --- 1: free coin v0=3 with manual braking → expect ≈ v²/(2·μ·g) = 1.31m ---
{
  const { world, mCoin } = newWorld();
  const c = coin(world, mCoin, 0, 0);
  c.velocity.set(0, 0, 3);
  for (let i = 0; i < 60*30; i++) {
    world.step(1/60, 1/60, 6);
    brake(c, 1/60);
    if (c.velocity.length() < 0.02) break;
  }
  console.log(`[1] free coin v0=3, manual μ=0.35: dist=${c.position.z.toFixed(3)}m (expected ~1.31m)`);
}

// --- 2: striker → coin transfer ratio (clean dead-on hit) ---
{
  const { world, mCoin } = newWorld();
  const c = coin(world, mCoin, 0, -0.13);
  const s = new CANNON.Body({ mass: 1.0, material: mCoin, shape: new CANNON.Cylinder(0.0205, 0.0205, 0.005, 24) });
  s.linearDamping = 0.008; s.angularDamping = 0.15;
  s.position.set(0, BOARD_Y + 0.0025, -0.33);
  world.addBody(s);
  const v0 = 3.0;
  s.velocity.set(0, 0, v0);
  let peak = 0, peakT = 0;
  for (let i = 0; i < 60*6; i++) {
    world.step(1/60, 1/60, 6);
    brake(c, 1/60); brake(s, 1/60);
    if (c.velocity.length() > peak) { peak = c.velocity.length(); peakT = i/60; }
    if (peakT > 0 && i/60 - peakT > 1.5) break;
  }
  const travel = c.position.z + 0.13;
  console.log(`[2] clean hit@${v0}: coin peak=${peak.toFixed(2)} m/s ratio=${(peak/v0).toFixed(2)} travel=${travel.toFixed(3)}m`);
  // expected travel from peak with μ=0.35: peak²/(2·0.35·9.81)
  console.log(`    predicted travel from μ=0.35: ${(peak*peak/(2*0.35*9.81)).toFixed(3)}m`);
}

// --- 3: coin-cushion restitution ---
{
  const { world, mCoin, mCush } = newWorld();
  const cush = new CANNON.Body({ mass: 0, material: mCush, shape: new CANNON.Box(new CANNON.Vec3(0.30, 0.01, 0.015)) });
  cush.position.set(0, 0.07, 0.365);
  world.addBody(cush);
  const c = coin(world, mCoin, 0, 0.30);
  c.velocity.set(0, 0, 2.0);
  let minV = 2;
  for (let i = 0; i < 60*4; i++) {
    world.step(1/60, 1/60, 6);
    brake(c, 1/60);
    if (c.position.z > 0.35) { minV = c.velocity.length(); break; }
  }
  console.log(`[3] coin@2 m/s into cushion: rebound ${minV.toFixed(2)} m/s (restitution ≈ ${(minV/2).toFixed(2)})`);
}
