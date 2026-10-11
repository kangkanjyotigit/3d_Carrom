import * as CANNON from './cannon-es.mjs';
const BOARD_Y = 0.06;
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.sleepSpeedLimit = 0.06;
world.sleepTimeLimit = 0.4;
const mCoin = new CANNON.Material('coin');
const mPlane = new CANNON.Material('plane');
world.addContactMaterial(new CANNON.ContactMaterial(mCoin, mPlane, { friction: 0.04, restitution: 0.08 }));
world.defaultContactMaterial.friction = 0.05;
world.defaultContactMaterial.restitution = 0.5;
const boardBody = new CANNON.Body({ mass: 0, material: mPlane, shape: new CANNON.Plane() });
boardBody.quaternion.setFromEuler(-Math.PI/2, 0, 0);
boardBody.position.y = BOARD_Y;
world.addBody(boardBody);

function mkCoin(ccd) {
  const b = new CANNON.Body({ mass: 0.37, material: mCoin, shape: new CANNON.Cylinder(0.016, 0.016, 0.003, 24) });
  b.linearDamping = 0.008; b.angularDamping = 0.02;
  if (ccd) { b.ccdSpeedThreshold = 1.5; b.ccdSphereRadius = 0.022; }
  b.position.set(0, BOARD_Y + 0.012, 0);
  world.addBody(b);
  return b;
}

for (const ccd of [false, true]) {
  for (const damp of [0.008, 0.0]) {
    // fresh world bodies
    for (const b of [...world.bodies]) if (b !== boardBody) world.removeBody(b);
    const c = mkCoin(ccd);
    c.linearDamping = damp;
    c.velocity.set(0, 0, 3.0);
    let t = 0;
    const log = [];
    for (let i = 0; i < 200; i++) {
      world.step(1/60, 1/60, 6);
      t += 1/60;
      if (i % 12 === 0 || c.velocity.length() < 0.1) {
        log.push(`t=${t.toFixed(2)} v=${c.velocity.length().toFixed(3)} z=${c.position.z.toFixed(3)} w=${c.angularVelocity.length().toFixed(2)} sleeping=${c.sleepState}`);
        if (c.velocity.length() < 0.05) break;
      }
    }
    console.log(`--- ccd=${ccd} linearDamping=${damp} ---`);
    console.log(log.join('\n'));
  }
}
