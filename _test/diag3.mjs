import * as CANNON from './cannon-es.mjs';
const BOARD_Y = 0.06;

function slideTest(mu, v0, segs = 24, tries = 1) {
  const results = [];
  for (let t = 0; t < tries; t++) {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.allowSleep = false;
    const mCoin = new CANNON.Material('coin');
    const mPlane = new CANNON.Material('plane');
    world.addContactMaterial(new CANNON.ContactMaterial(mCoin, mPlane, { friction: mu, restitution: 0.08 }));
    world.defaultContactMaterial.friction = mu;
    const plane = new CANNON.Body({ mass: 0, material: mPlane, shape: new CANNON.Plane() });
    plane.quaternion.setFromEuler(-Math.PI/2, 0, 0);
    plane.position.y = BOARD_Y;
    world.addBody(plane);
    const body = new CANNON.Body({ mass: 0.37, material: mCoin, shape: new CANNON.Cylinder(0.016, 0.016, 0.003, segs) });
    body.linearDamping = 0.008; body.angularDamping = 0.02;
    body.position.set(0, BOARD_Y + 0.0015, 0);
    world.addBody(body);
    body.velocity.set(0, 0, v0);
    let settled = false;
    for (let i = 0; i < 60*30 && !settled; i++) {
      world.step(1/60, 1/60, 6);
      if (body.velocity.length() < 0.05) settled = true;
    }
    const d = body.position.z;
    // v^2 = 2*a*d → a = v0²/(2d) → μ_eff = a/g
    const muEff = d > 0.001 ? v0*v0 / (2 * 9.81 * d) : Infinity;
    results.push({ d, muEff });
  }
  return results;
}

console.log('segs=24, v0=3:');
for (const mu of [0.001, 0.004, 0.01, 0.04]) {
  const r = slideTest(mu, 3);
  console.log(`  configured μ=${mu}: dist=${r[0].d.toFixed(3)}m μ_eff=${r[0].muEff.toFixed(3)} (amplification ${(r[0].muEff/mu).toFixed(0)}×)`);
}
console.log('stability of μ=0.004 @ v0=3 (5 runs):');
console.log('  ' + slideTest(0.004, 3, 24, 5).map(r => r.muEff.toFixed(3)).join(', '));
console.log('speed-dependence of μ=0.004:');
for (const v0 of [1, 2, 4]) {
  const r = slideTest(0.004, v0);
  console.log(`  v0=${v0}: μ_eff=${r[0].muEff.toFixed(3)} dist=${r[0].d.toFixed(3)}m`);
}
console.log('segs=16 & segs=8 @ μ=0.004, v0=3:');
console.log('  16: ' + slideTest(0.004, 3, 16, 2).map(r => r.muEff.toFixed(3)).join(', '));
console.log('  8:  ' + slideTest(0.004, 3, 8, 2).map(r => r.muEff.toFixed(3)).join(', '));
