import * as CANNON from './cannon-es.mjs';
const BOARD_Y = 0.06;

function run(shape, drop, mu, label) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = false;
  const mCoin = new CANNON.Material('coin');
  const mPlane = new CANNON.Material('plane');
  world.addContactMaterial(new CANNON.ContactMaterial(mCoin, mPlane, { friction: mu, restitution: 0.08 }));
  world.defaultContactMaterial.friction = mu;
  world.defaultContactMaterial.restitution = 0.08;
  const plane = new CANNON.Body({ mass: 0, material: mPlane, shape: new CANNON.Plane() });
  plane.quaternion.setFromEuler(-Math.PI/2, 0, 0);
  plane.position.y = BOARD_Y;
  world.addBody(plane);
  let body;
  if (shape === 'cyl') body = new CANNON.Body({ mass: 0.37, material: mCoin, shape: new CANNON.Cylinder(0.016, 0.016, 0.003, 24) });
  else body = new CANNON.Body({ mass: 0.37, material: mCoin, shape: new CANNON.Sphere(0.016) });
  body.linearDamping = 0.008; body.angularDamping = 0.02;
  body.position.set(0, drop ? BOARD_Y + 0.012 : BOARD_Y + (shape === 'cyl' ? 0.0015 : 0.016), 0);
  world.addBody(body);
  body.velocity.set(0, 0, 3.0);
  let t = 0, lastV = 3;
  let minDecel = 0;
  const profile = [];
  for (let i = 0; i < 240; i++) {
    world.step(1/60, 1/60, 6);
    t += 1/60;
    const v = body.velocity.length();
    if (i % 10 === 0) profile.push(`t=${t.toFixed(2)} v=${v.toFixed(3)} z=${body.position.z.toFixed(3)}`);
    if (v < 0.05) break;
    lastV = v;
  }
  const z = body.position.z;
  console.log(`${label}: stopped at z=${z.toFixed(3)}m, profile: ${profile.join(' | ')}`);
}

run('cyl', true,  0.04, 'cylinder dropped, μ=0.04');
run('cyl', false, 0.04, 'cylinder placed, μ=0.04');
run('cyl', false, 0.0,  'cylinder placed, μ=0.00');
run('sph', false, 0.04, 'sphere placed, μ=0.04');
