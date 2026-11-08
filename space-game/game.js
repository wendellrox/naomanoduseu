import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const hudSpeed = document.getElementById('speed');
const hudSystem = document.getElementById('system');
const hudTarget = document.getElementById('target');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start');
const stick = document.getElementById('stick');
const nub = document.getElementById('nub');
const boostBtn = document.getElementById('boost');

let renderer, scene, camera, clock;
let ship, shipVel = new THREE.Vector3();
let yaw = 0, pitch = 0, roll = 0;
let pointerLooking = false, lastX = 0, lastY = 0;
let move = { x: 0, y: 0, boost: false };
let bodies = [];
let seed = (Math.random() * 1e9) | 0;
let running = false;

function rng(s) {
  let t = s >>> 0;
  return () => (t = (t + 0x6D2B79F5) >>> 0, (Math.imul(t ^ (t >>> 15), 1 | t) >>> 0) / 4294967296);
}

function nameFor(s) {
  const r = rng(s);
  const a = ['Astra','Orion','Vega','Nexus','Kyra','Helios','Nova','Lumen','Cryon','Zeph'];
  const b = ['Prime','Minor','Reach','Drift','Hollow','Gate',' Verge','Field','Crown','Belt'];
  return `${a[(r()*a.length)|0]} ${b[(r()*b.length)|0]}-${((r()*90)|0)+10}`;
}

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x02040a, 0.00018);
  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 8000);
  clock = new THREE.Clock();

  ship = new THREE.Object3D();
  ship.position.set(0, 0, 220);
  scene.add(ship);

  scene.add(new THREE.AmbientLight(0x667799, 0.7));
  const sunLight = new THREE.PointLight(0xfff2d0, 2.2, 0, 2);
  sunLight.position.set(0, 0, 0);
  scene.add(sunLight);

  makeStars();
  buildSystem(seed);
  bindInput();
  addEventListener('resize', onResize);
  requestAnimationFrame(loop);
}

function clearBodies() {
  for (const b of bodies) {
    scene.remove(b.mesh);
    b.mesh.geometry?.dispose?.();
    b.mesh.material?.dispose?.();
  }
  bodies = [];
}

function makeStars() {
  const g = new THREE.BufferGeometry();
  const n = 2200;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 2500 + Math.random() * 3500;
    const t = Math.random() * Math.PI * 2;
    const p = Math.acos(2 * Math.random() - 1);
    pos[i*3] = r * Math.sin(p) * Math.cos(t);
    pos[i*3+1] = r * Math.sin(p) * Math.sin(t);
    pos[i*3+2] = r * Math.cos(p);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: true })));
}

function buildSystem(s) {
  clearBodies();
  const r = rng(s);
  hudSystem.textContent = nameFor(s);

  const star = new THREE.Mesh(
    new THREE.SphereGeometry(28, 20, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.08 + r()*0.08, 0.9, 0.6) })
  );
  scene.add(star);
  bodies.push({ mesh: star, name: 'Estrela', radius: 28, kind: 'star' });

  const count = 4 + ((r()*5)|0);
  for (let i = 0; i < count; i++) {
    const dist = 90 + i * (55 + r()*45) + r()*30;
    const ang = r() * Math.PI * 2;
    const y = (r()-0.5) * 40;
    const radius = 4 + r()*18;
    const hue = r();
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.55, 0.45), roughness: 0.95, metalness: 0.05, flatShading: true });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 14), mat);
    mesh.position.set(Math.cos(ang)*dist, y, Math.sin(ang)*dist);
    scene.add(mesh);
    bodies.push({ mesh, name: `Planeta ${i+1}`, radius, kind: 'planet' });
  }

  for (let i = 0; i < 80; i++) {
    const d = 120 + r()*520;
    const a = r()*Math.PI*2;
    const p = (r()-0.5)*120;
    const size = 0.6 + r()*2.8;
    const rock = new THREE.Mesh(
      new THREE.IcosahedronGeometry(size, 0),
      new THREE.MeshStandardMaterial({ color: 0x88929f, roughness: 1, flatShading: true })
    );
    rock.position.set(Math.cos(a)*d, p, Math.sin(a)*d);
    rock.rotation.set(r()*3, r()*3, r()*3);
    scene.add(rock);
    bodies.push({ mesh: rock, name: 'Asteroide', radius: size, kind: 'rock' });
  }
}

function bindInput() {
  startBtn.addEventListener('click', () => { overlay.style.display = 'none'; running = true; });
  addEventListener('keydown', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') move.boost = true;
    if (e.code === 'Space') { seed = (seed ^ ((Date.now()/1000)|0) ^ 0x9e3779b9) >>> 0; buildSystem(seed); ship.position.set(0,0,220); shipVel.set(0,0,0); }
    keys[e.code] = true;
  });
  addEventListener('keyup', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') move.boost = move.boostTouch;
    keys[e.code] = false;
  });

  const canvasEventsTarget = () => renderer.domElement;
  canvasEventsTarget().addEventListener('pointerdown', (e) => {
    if (e.target !== renderer.domElement) return;
    pointerLooking = true; lastX = e.clientX; lastY = e.clientY;
    renderer.domElement.setPointerCapture?.(e.pointerId);
  });
  addEventListener('pointermove', (e) => {
    if (!pointerLooking) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    yaw -= dx * 0.0035;
    pitch -= dy * 0.003;
    pitch = Math.max(-1.25, Math.min(1.25, pitch));
  });
  addEventListener('pointerup', () => { pointerLooking = false; });
  addEventListener('pointercancel', () => { pointerLooking = false; });

  // Touch joystick
  let stickId = null, stickCenter = null;
  const onStick = (e) => {
    for (const t of e.changedTouches || [e]) {
      if (e.type === 'touchstart') { stickId = t.identifier; const r = stick.getBoundingClientRect(); stickCenter = { x: r.left + r.width/2, y: r.top + r.height/2 }; }
      if (stickId !== null && t.identifier !== stickId && e.type !== 'touchstart') continue;
      const dx = t.clientX - stickCenter.x, dy = t.clientY - stickCenter.y;
      const max = 38, len = Math.hypot(dx,dy) || 1, c = Math.min(len, max);
      const nx = dx/len*c, ny = dy/len*c;
      nub.style.transform = `translate(${nx}px, ${ny}px)`;
      move.x = nx/max; move.y = -ny/max;
      if (e.type === 'touchend' || e.type === 'touchcancel') { stickId = null; nub.style.transform = ''; move.x = 0; move.y = 0; }
    }
  };
  stick.addEventListener('touchstart', onStick, { passive: true });
  stick.addEventListener('touchmove', onStick, { passive: true });
  stick.addEventListener('touchend', onStick, { passive: true });
  stick.addEventListener('touchcancel', onStick, { passive: true });

  move.boostTouch = false;
  const setBoost = (v) => { move.boostTouch = v; move.boost = v || keys['ShiftLeft'] || keys['ShiftRight']; boostBtn.classList.toggle('active', v); };
  boostBtn.addEventListener('touchstart', (e)=>{ e.preventDefault(); setBoost(true); }, { passive: false });
  boostBtn.addEventListener('touchend', ()=> setBoost(false));
  boostBtn.addEventListener('mousedown', ()=> setBoost(true));
  addEventListener('mouseup', ()=> setBoost(false));
}

const keys = {};
function inputVector() {
  const kx = (keys['KeyA']||keys['ArrowLeft']? -0.6:0) + (keys['KeyD']||keys['ArrowRight']? 0.6:0);
  const ky = (keys['KeyW']||keys['ArrowUp']? 1:0) + (keys['KeyS']||keys['ArrowDown']? -0.7:0);
  const kr = (keys['KeyQ']? 1:0) + (keys['KeyE']? -1:0);
  return { x: THREE.MathUtils.clamp(move.x + kx, -1, 1), y: THREE.MathUtils.clamp(move.y + ky, -1, 1), roll: kr };
}

function update(dt) {
  if (!running) return;
  const inp = inputVector();
  roll += inp.roll * dt * 1.2;
  roll *= Math.pow(0.08, dt);

  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  ship.quaternion.slerp(q, 1 - Math.pow(0.001, dt));

  const forward = new THREE.Vector3(0,0,-1).applyQuaternion(ship.quaternion);
  const right = new THREE.Vector3(1,0,0).applyQuaternion(ship.quaternion);
  const thrust = (move.boost ? 95 : 38) * Math.max(0, inp.y) - 22 * Math.max(0, -inp.y);
  shipVel.addScaledVector(forward, thrust * dt);
  shipVel.addScaledVector(right, inp.x * 26 * dt);
  shipVel.multiplyScalar(Math.pow(0.35, dt));
  ship.position.addScaledVector(shipVel, dt);

  const camPos = ship.position.clone().add(new THREE.Vector3(0, 2.2, 7).applyQuaternion(ship.quaternion));
  camera.position.lerp(camPos, 1 - Math.pow(0.0005, dt));
  camera.quaternion.slerp(ship.quaternion, 1 - Math.pow(0.0008, dt));

  let nearest = null, nd = Infinity;
  for (const b of bodies) {
    if (b.kind === 'rock') continue;
    const d = ship.position.distanceTo(b.mesh.position) - b.radius;
    if (d < nd) { nd = d; nearest = b; }
  }
  hudSpeed.textContent = `${shipVel.length().toFixed(1)} u/s`;
  hudTarget.textContent = nearest ? `${nearest.name} (${Math.max(0,nd).toFixed(0)}u)` : '—';
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

init();
