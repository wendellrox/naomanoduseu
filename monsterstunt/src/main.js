import * as THREE from '../vendor/three.module.js';
import {
  WHEEL_LOCALS,
  WHEEL_RADIUS,
  RAMPS,
  createTruckState,
  stepTruck,
  groundHeight,
  upDotOf,
} from './physics.js';

// ------------------------------------------------------------------ helpers
const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const rand = (a, b) => a + Math.random() * (b - a);
const fmt = (n) => Math.round(n).toLocaleString('pt-BR');
const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);

// --------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });

// Aceleração por software (SwiftShader/llvmpipe) costuma quebrar com shadow maps.
// Nesses casos — e com ?low=1 — roda no modo leve.
let lowPower = false;
try {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  lowPower = /swiftshader|llvmpipe|software|basic render/i.test(gpu);
} catch {
  lowPower = false;
}
if (new URLSearchParams(location.search).has('low')) lowPower = true;

renderer.setPixelRatio(lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !lowPower;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x63304d, 95, 240);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 650);
camera.position.set(0, 5.5, -20);

// ------------------------------------------------------------------ texturas
function makeDirtTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#7a4a2c';
  g.fillRect(0, 0, size, size);

  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${(50 + Math.random() * 70) | 0},${(28 + Math.random() * 42) | 0},${
      (12 + Math.random() * 26) | 0
    },0.22)`;
    g.beginPath();
    g.ellipse(rand(0, size), rand(0, size), rand(8, 42), rand(5, 26), rand(0, 6.28), 0, 6.28);
    g.fill();
  }
  for (let i = 0; i < 9000; i++) {
    const light = Math.random() > 0.5;
    g.fillStyle = light
      ? `rgba(232,192,142,${rand(0.03, 0.16)})`
      : `rgba(32,16,8,${rand(0.04, 0.2)})`;
    const s = rand(0.6, 2.4);
    g.fillRect(rand(0, size), rand(0, size), s, s);
  }
  g.strokeStyle = 'rgba(40,20,10,0.2)';
  g.lineWidth = 7;
  g.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    g.beginPath();
    g.arc(rand(-80, size + 80), rand(-80, size + 80), rand(40, 140), rand(0, 6.28), rand(0, 6.28));
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 12);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeSoftTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBannerTexture(title, sub, accent) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#140c1d';
  g.fillRect(0, 0, 1024, 256);
  g.fillStyle = accent;
  g.fillRect(0, 0, 1024, 14);
  g.fillRect(0, 242, 1024, 14);
  g.strokeStyle = 'rgba(255,255,255,0.1)';
  g.lineWidth = 2;
  g.strokeRect(14, 14, 996, 228);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.font = '900 92px system-ui, "Segoe UI", sans-serif';
  g.fillText(title, 512, 104, 940);
  g.fillStyle = accent;
  g.font = '800 38px system-ui, "Segoe UI", sans-serif';
  g.fillText(sub, 512, 184, 900);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const dirtTex = makeDirtTexture();
const softTex = makeSoftTexture();

// ---------------------------------------------------------------- materiais
const matGround = new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 0.98, metalness: 0 });
const matRamp = new THREE.MeshStandardMaterial({ color: '#8a5734', roughness: 0.95, metalness: 0 });
const matRampLip = new THREE.MeshStandardMaterial({
  color: '#ff9330',
  emissive: '#ff5200',
  emissiveIntensity: 0.5,
  roughness: 0.55,
});
const matConcrete = new THREE.MeshStandardMaterial({ color: '#342a38', roughness: 0.95 });
const matStand = new THREE.MeshStandardMaterial({ color: '#241d2c', roughness: 0.95 });
const matSteel = new THREE.MeshStandardMaterial({ color: '#9aa2b1', metalness: 0.85, roughness: 0.35 });
const matDark = new THREE.MeshStandardMaterial({ color: '#17141d', roughness: 0.85 });
const matTire = new THREE.MeshStandardMaterial({ color: '#141117', roughness: 0.96 });
const matGlass = new THREE.MeshStandardMaterial({
  color: '#0a1520',
  metalness: 0.85,
  roughness: 0.15,
  emissive: '#0d2233',
  emissiveIntensity: 0.4,
});
const matHeadlight = new THREE.MeshStandardMaterial({
  color: '#fff6cf',
  emissive: '#ffe0a0',
  emissiveIntensity: 2.2,
  roughness: 0.3,
});
const matTaillight = new THREE.MeshStandardMaterial({
  color: '#5a0c0c',
  emissive: '#ff2200',
  emissiveIntensity: 0.8,
  roughness: 0.4,
});
const matFloodPanel = new THREE.MeshStandardMaterial({
  color: '#fff8e6',
  emissive: '#ffe0a8',
  emissiveIntensity: 3,
  roughness: 0.4,
});

function addBox(parent, w, h, d, mat, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// ------------------------------------------------------------------- céu
{
  const skyGeo = new THREE.SphereGeometry(480, 28, 18);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color('#1a1033') },
      midColor: { value: new THREE.Color('#7a2d5e') },
      botColor: { value: new THREE.Color('#ff9a5a') },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 botColor;
      void main() {
        float h = normalize(vDir).y;
        vec3 col = mix(botColor, midColor, smoothstep(-0.06, 0.34, h));
        col = mix(col, topColor, smoothstep(0.24, 0.9, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
}

// ------------------------------------------------------------------ luzes
scene.add(new THREE.HemisphereLight(0xffd0a0, 0x2a1626, 1.05));
scene.add(new THREE.AmbientLight(0x6a4a6a, 0.25));

const sun = new THREE.DirectionalLight(0xffd6a5, 2.5);
sun.position.set(36, 58, -22);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -58;
sun.shadow.camera.right = 58;
sun.shadow.camera.top = 58;
sun.shadow.camera.bottom = -58;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 180;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.05;
scene.add(sun);
scene.add(sun.target);

const rim = new THREE.DirectionalLight(0x7b8cff, 0.55);
rim.position.set(-30, 22, 30);
scene.add(rim);

// ------------------------------------------------------------------- chão
{
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), matGround);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // mancha central de terra batida
  const innerMat = new THREE.MeshStandardMaterial({
    map: dirtTex,
    color: '#b98a66',
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const inner = new THREE.Mesh(new THREE.CircleGeometry(43, 48), innerMat);
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.012;
  inner.receiveShadow = true;
  scene.add(inner);
}

// --------------------------------------------------------------- arquibancada
{
  const crowdPositions = [];
  const crowdColors = [];
  const palette = [
    '#ffd166',
    '#ef476f',
    '#06d6a0',
    '#118ab2',
    '#f78c6b',
    '#e9e3f2',
    '#f4a261',
    '#9b5de5',
    '#ff9f43',
  ];

  function buildStand(dirX, dirZ) {
    for (let tier = 0; tier < 5; tier++) {
      const dist = 51 + tier * 2.6;
      const y = 0.5 + tier * 1.0;
      const geo =
        dirZ !== 0 ? new THREE.BoxGeometry(96, 1.0, 2.6) : new THREE.BoxGeometry(2.6, 1.0, 96);
      const step = new THREE.Mesh(geo, matStand);
      step.position.set(dirX * dist, y, dirZ * dist);
      step.receiveShadow = true;
      scene.add(step);

      for (let i = 0; i < 54; i++) {
        const along = -42 + i * 1.58 + rand(-0.3, 0.3);
        const px = dirZ !== 0 ? along : dirX * (dist - 0.6);
        const pz = dirZ !== 0 ? dirZ * (dist - 0.6) : along;
        crowdPositions.push([px, y + 0.8 + rand(-0.04, 0.04), pz]);
        crowdColors.push(palette[(Math.random() * palette.length) | 0]);
      }
    }
  }
  buildStand(0, 1);
  buildStand(0, -1);
  buildStand(1, 0);
  buildStand(-1, 0);

  const crowdGeo = new THREE.BoxGeometry(0.42, 0.56, 0.32);
  const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdPositions.length);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  crowdPositions.forEach((p, i) => {
    dummy.position.set(p[0], p[1], p[2]);
    dummy.rotation.set(0, rand(-0.4, 0.4), 0);
    dummy.updateMatrix();
    crowd.setMatrixAt(i, dummy.matrix);
    crowd.setColorAt(i, col.set(crowdColors[i]));
  });
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  crowd.frustumCulled = false;
  crowd.castShadow = false;
  crowd.receiveShadow = false;
  scene.add(crowd);
}

// ------------------------------------------------------------------ muros
{
  const wallY = 1.4;
  const walls = [
    [0, wallY, 46.6, 96, 2.8, 1.2],
    [0, wallY, -46.6, 96, 2.8, 1.2],
    [46.6, wallY, 0, 1.2, 2.8, 96],
    [-46.6, wallY, 0, 1.2, 2.8, 96],
  ];
  for (const [x, y, z, w, h, d] of walls) {
    const wall = addBox(scene, w, h, d, matConcrete, x, y, z, false);
    wall.receiveShadow = true;
    const rail = addBox(scene, w * 0.995, 0.14, d * 0.995, matRampLip, x, y + h / 2 + 0.07, z, false);
    rail.receiveShadow = false;
  }

  // barreiras de pneus
  const tireGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.45, 10);
  const spots = [];
  for (let t = -43.5; t <= 43.5; t += 1.8) {
    spots.push([t, 45.1, 0]);
    spots.push([t, -45.1, 0]);
    spots.push([45.1, t, 1]);
    spots.push([-45.1, t, 1]);
    if (Math.random() < 0.3) {
      spots.push([t, 45.1, 2]);
      spots.push([-45.1, t, 2]);
    }
  }
  const tires = new THREE.InstancedMesh(tireGeo, matTire, spots.length);
  const dummy = new THREE.Object3D();
  spots.forEach((s, i) => {
    dummy.position.set(s[2] === 1 ? s[0] : s[0], s[2] === 2 ? 0.68 : 0.23, s[2] === 1 ? s[1] : s[1]);
    dummy.rotation.set(0, rand(0, Math.PI), 0);
    dummy.updateMatrix();
    tires.setMatrixAt(i, dummy.matrix);
  });
  tires.instanceMatrix.needsUpdate = true;
  tires.frustumCulled = false;
  tires.castShadow = false;
  tires.receiveShadow = true;
  scene.add(tires);
}

// ---------------------------------------------------------------- outdoors
{
  function addBanner(title, sub, x, z, rotY) {
    const group = new THREE.Group();
    group.position.set(x, 4.5, z);
    group.rotation.y = rotY;

    addBox(group, 23.4, 6.4, 0.35, matDark, 0, 0, -0.24, false);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 5.5),
      new THREE.MeshBasicMaterial({
        map: makeBannerTexture(title, sub, '#ff7a2a'),
        toneMapped: false,
      })
    );
    plane.position.z = 0.02;
    group.add(plane);

    for (const sx of [-11.3, 11.3]) {
      addBox(group, 0.4, 4.6, 0.4, matSteel, sx, -2.0, -0.1, false);
    }
    scene.add(group);
  }

  addBanner('MONSTER STUNT', 'ARENA DE DEMOLIÇÃO', 0, 46.1, Math.PI);
  addBanner('SUNDAY! SUNDAY!', 'SÓ HOJE NA ARENA', 0, -46.1, 0);
  addBanner('50 PÉS', 'DE PURA ADRENALINA', -46.1, 0, Math.PI / 2);
  addBanner('NÃO FREIE', 'O RECORDE É SEU', 46.1, 0, -Math.PI / 2);

  function addFloodlight(x, z) {
    const group = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.44, 16, 8), matSteel);
    pole.position.y = 8;
    pole.castShadow = true;
    group.add(pole);

    const head = new THREE.Group();
    head.position.y = 16;
    head.rotation.y = Math.atan2(-x, -z);
    const box = addBox(head, 3.7, 1.5, 0.7, matDark, 0, 0, 0.25, false);
    box.receiveShadow = false;
    for (let i = 0; i < 4; i++) {
      const panel = addBox(head, 0.72, 1.1, 0.1, matFloodPanel, -1.26 + i * 0.84, 0, 0.66, false);
      panel.receiveShadow = false;
    }
    group.add(head);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: softTex,
        color: '#ffd6a0',
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    glow.position.y = 16;
    glow.scale.set(7.5, 5.2, 1);
    group.add(glow);

    group.position.set(x, 0, z);
    scene.add(group);
  }

  addFloodlight(-44.2, -44.2);
  addFloodlight(44.2, -44.2);
  addFloodlight(-44.2, 44.2);
  addFloodlight(44.2, 44.2);
}

// ------------------------------------------------------------------ rampas
{
  for (const r of RAMPS) {
    const riseZ = -r.l / 2 + r.l * r.rise;
    const shape = new THREE.Shape();
    shape.moveTo(-r.l / 2, 0);
    shape.lineTo(riseZ, r.h);
    shape.lineTo(r.l / 2, r.h);
    shape.lineTo(r.l / 2, 0);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: r.w, bevelEnabled: false, steps: 1 });
    geo.translate(0, 0, -r.w / 2);
    geo.rotateY(-Math.PI / 2);
    geo.computeVertexNormals();

    const group = new THREE.Group();
    group.position.set(r.x, 0, r.z);
    group.rotation.y = r.angle;

    const mesh = new THREE.Mesh(geo, matRamp);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    const lip = addBox(group, r.w * 0.985, 0.14, 0.46, matRampLip, 0, r.h + 0.05, r.l / 2 - 0.23, false);
    lip.receiveShadow = false;

    scene.add(group);
  }
}

// ------------------------------------------------------------------ carros
const CAR_COLORS = ['#e8402a', '#2b7de0', '#f0c22e', '#2fc38a', '#9b5ce0', '#e8e6e3'];
const carMats = CAR_COLORS.map(
  (c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.45, roughness: 0.38 })
);
const carWheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12);
carWheelGeo.rotateZ(Math.PI / 2);

const CAR_SPOTS = [
  [-6, 34, 0.2, 0],
  [0, 36, -0.1, 1],
  [6, 34.5, 0.4, 2],
  [-3, 41, 0.1, 3],
  [4, 42, 0.3, 4],
  [-11, 39, 0.5, 5],
  [11, 38, -0.2, 0],
  [24, 36, 0.2, 2],
  [-24, 36, -0.3, 1],
  [0, -37, 0.2, 3],
  [-9, -34, 0.4, 4],
  [9, -35, -0.2, 5],
  [32, -6, 0.6, 1],
  [-32, -4, -0.4, 2],
];

function buildCar(x, z, rotY, colorIndex) {
  const group = new THREE.Group();
  const mat = carMats[colorIndex % carMats.length];

  addBox(group, 1.7, 0.55, 3.3, mat, 0, 0.62, 0);
  addBox(group, 1.45, 0.52, 1.55, mat, 0, 1.12, -0.15);
  addBox(group, 1.28, 0.34, 0.06, matGlass, 0, 1.14, 0.65, false);
  addBox(group, 1.28, 0.3, 0.06, matGlass, 0, 1.14, -0.95, false);
  addBox(group, 0.06, 0.32, 1.1, matGlass, 0.735, 1.14, -0.15, false);
  addBox(group, 0.06, 0.32, 1.1, matGlass, -0.735, 1.14, -0.15, false);

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(carWheelGeo, matTire);
      w.position.set(sx * 0.86, 0.34, sz * 1.05);
      w.castShadow = true;
      w.receiveShadow = true;
      group.add(w);
    }
    addBox(group, 0.28, 0.14, 0.05, matHeadlight, sx * 0.55, 0.62, 1.67, false);
    addBox(group, 0.26, 0.14, 0.05, matTaillight, sx * 0.55, 0.62, -1.67, false);
  }

  group.position.set(x, 0, z);
  group.rotation.y = rotY;
  scene.add(group);
  return group;
}

const cars = CAR_SPOTS.map(([x, z, rotY, colorIndex]) => ({
  group: buildCar(x, z, rotY, colorIndex),
  x,
  z,
  top: 1.5,
  color: CAR_COLORS[colorIndex % CAR_COLORS.length],
  alive: true,
  respawn: 0,
  pop: 1,
  baseRot: rotY,
}));

// ---------------------------------------------------------------- caminhão
const truckPaint = new THREE.MeshStandardMaterial({
  color: '#e23a26',
  metalness: 0.5,
  roughness: 0.32,
});
const truckPaintDark = new THREE.MeshStandardMaterial({
  color: '#9e1f16',
  metalness: 0.45,
  roughness: 0.45,
});
const truckChrome = new THREE.MeshStandardMaterial({
  color: '#d7dde8',
  metalness: 1,
  roughness: 0.22,
});
const truckWheelMat = new THREE.MeshStandardMaterial({ color: '#16131a', roughness: 0.92 });
const truckRimMat = new THREE.MeshStandardMaterial({
  color: '#c3cad6',
  metalness: 0.9,
  roughness: 0.28,
});

function buildTruck() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // chassi
  addBox(body, 1.7, 0.26, 4.35, matDark, 0, -0.16, 0);

  // carroceria
  addBox(body, 2.0, 0.62, 3.4, truckPaint, 0, 0.28, 0);
  addBox(body, 1.86, 0.3, 1.15, truckPaint, 0, 0.52, 1.32);
  addBox(body, 1.4, 0.1, 1.0, truckPaintDark, 0, 0.69, 1.32);

  // cabine
  addBox(body, 1.7, 0.75, 1.5, truckPaint, 0, 0.95, -0.55);
  addBox(body, 1.44, 0.44, 0.06, matGlass, 0, 1.03, 0.22, false);
  addBox(body, 1.3, 0.38, 0.06, matGlass, 0, 1.03, -1.31, false);
  addBox(body, 0.06, 0.38, 1.05, matGlass, 0.86, 1.03, -0.55, false);
  addBox(body, 0.06, 0.38, 1.05, matGlass, -0.86, 1.03, -0.55, false);
  addBox(body, 1.82, 0.1, 1.58, truckPaintDark, 0, 1.37, -0.55);

  // caçamba e gaiola
  addBox(body, 1.88, 0.3, 1.1, truckPaintDark, 0, 0.62, -1.1);
  for (const sx of [-0.76, 0.76]) {
    for (const sz of [-1.62, -0.68]) {
      addBox(body, 0.07, 0.95, 0.07, matDark, sx, 1.03, sz);
    }
  }
  addBox(body, 1.62, 0.07, 0.07, matDark, 0, 1.49, -1.62);
  addBox(body, 1.62, 0.07, 0.07, matDark, 0, 1.49, -0.68);
  addBox(body, 0.07, 0.07, 1.0, matDark, -0.79, 1.49, -1.15);
  addBox(body, 0.07, 0.07, 1.0, matDark, 0.79, 1.49, -1.15);

  // para-choques
  addBox(body, 2.12, 0.26, 0.3, truckChrome, 0, 0.2, 2.03);
  addBox(body, 2.12, 0.26, 0.3, truckChrome, 0, 0.2, -2.03);

  // grade e faróis
  addBox(body, 1.25, 0.26, 0.06, matDark, 0, 0.5, 2.01, false);
  addBox(body, 0.34, 0.18, 0.06, matHeadlight, 0.62, 0.55, 2.02, false);
  addBox(body, 0.34, 0.18, 0.06, matHeadlight, -0.62, 0.55, 2.02, false);
  addBox(body, 0.28, 0.16, 0.06, matTaillight, 0.68, 0.55, -2.02, false);
  addBox(body, 0.28, 0.16, 0.06, matTaillight, -0.68, 0.55, -2.02, false);

  // barra de luzes no teto
  addBox(body, 1.35, 0.12, 0.22, matDark, 0, 1.5, -0.3);
  for (let i = 0; i < 4; i++) {
    addBox(body, 0.18, 0.1, 0.12, matHeadlight, -0.51 + i * 0.34, 1.56, -0.3, false);
  }

  // escapamentos
  for (const sx of [-0.62, 0.62]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.11, 2.1, 8), truckChrome);
    pipe.position.set(sx, 1.12, -1.42);
    pipe.castShadow = true;
    body.add(pipe);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 8), matDark);
    tip.position.set(sx, 2.2, -1.42);
    body.add(tip);
  }

  // braços de suspensão
  for (const sx of [-0.86, 0.86]) {
    for (const sz of [-1.25, 1.25]) {
      const arm = addBox(body, 0.42, 0.12, 0.16, truckChrome, sx, -0.24, sz, false);
      arm.rotation.z = sx > 0 ? -0.16 : 0.16;
    }
  }

  // rodas
  const tireGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.62, 22, 1);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.67, 12);
  rimGeo.rotateZ(Math.PI / 2);
  const ringGeo = new THREE.TorusGeometry(0.47, 0.045, 6, 20);
  ringGeo.rotateY(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.72, 8);
  hubGeo.rotateZ(Math.PI / 2);

  const wheels = [];
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    pivot.position.copy(WHEEL_LOCALS[i]);
    body.add(pivot);

    const spin = new THREE.Group();
    pivot.add(spin);

    const tire = new THREE.Mesh(tireGeo, truckWheelMat);
    tire.castShadow = true;
    tire.receiveShadow = true;
    spin.add(tire);

    const rim = new THREE.Mesh(rimGeo, truckRimMat);
    rim.castShadow = true;
    spin.add(rim);

    for (const sx of [-0.3, 0.3]) {
      const ring = new THREE.Mesh(ringGeo, truckRimMat);
      ring.position.x = sx;
      spin.add(ring);
    }

    const hub = new THREE.Mesh(hubGeo, truckChrome);
    spin.add(hub);

    wheels.push({ pivot, spin });
  }

  scene.add(root);
  return { root, wheels };
}

const truckObj = buildTruck();

// ------------------------------------------------------------------ poeira
const DUST_N = 260;
const dustPositions = new Float32Array(DUST_N * 3);
for (let i = 0; i < DUST_N; i++) dustPositions[i * 3 + 1] = -999;
const dustVel = new Float32Array(DUST_N * 3);
const dustLife = new Float32Array(DUST_N);
let dustCursor = 0;

const dustGeo = new THREE.BufferGeometry();
const dustAttr = new THREE.BufferAttribute(dustPositions, 3);
dustAttr.setUsage(THREE.DynamicDrawUsage);
dustGeo.setAttribute('position', dustAttr);
const dust = new THREE.Points(
  dustGeo,
  new THREE.PointsMaterial({
    size: 1.15,
    map: softTex,
    color: '#d8a577',
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    sizeAttenuation: true,
  })
);
dust.frustumCulled = false;
scene.add(dust);

function emitDust(x, y, z, power = 1) {
  const i = dustCursor;
  dustCursor = (dustCursor + 1) % DUST_N;
  const j = i * 3;
  dustPositions[j] = x + rand(-0.35, 0.35);
  dustPositions[j + 1] = y + rand(0, 0.3);
  dustPositions[j + 2] = z + rand(-0.35, 0.35);
  const a = rand(0, Math.PI * 2);
  const r = rand(0.3, 1.5) * power;
  dustVel[j] = Math.cos(a) * r;
  dustVel[j + 1] = rand(0.5, 2.0) * power;
  dustVel[j + 2] = Math.sin(a) * r;
  dustLife[i] = rand(0.45, 1.0);
}

function dustBurst(pos, count) {
  const y = groundHeight(pos.x, pos.z) + 0.15;
  for (let i = 0; i < count; i++) {
    emitDust(pos.x + rand(-1.3, 1.3), y, pos.z + rand(-1.3, 1.3), 1.15);
  }
}

// ------------------------------------------------------------------ destroços
const DEBRIS_N = 90;
const debrisMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(0.32, 0.22, 0.44),
  new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.3 }),
  DEBRIS_N
);
debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
debrisMesh.frustumCulled = false;
debrisMesh.castShadow = false;
scene.add(debrisMesh);

const debris = [];
const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
for (let i = 0; i < DEBRIS_N; i++) {
  debris.push({
    active: false,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    rot: new THREE.Euler(),
    spin: new THREE.Vector3(),
    life: 0,
  });
  debrisMesh.setMatrixAt(i, zeroMatrix);
  debrisMesh.setColorAt(i, new THREE.Color('#ffffff'));
}
if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
let debrisCursor = 0;

function spawnDebris(x, y, z, color, count) {
  const col = new THREE.Color(color);
  for (let n = 0; n < count; n++) {
    let idx = -1;
    for (let k = 0; k < DEBRIS_N; k++) {
      const idx2 = (debrisCursor + k) % DEBRIS_N;
      if (!debris[idx2].active) {
        idx = idx2;
        break;
      }
    }
    if (idx < 0) idx = debrisCursor;
    debrisCursor = (idx + 1) % DEBRIS_N;

    const d = debris[idx];
    d.active = true;
    d.life = rand(1.0, 1.9);
    d.pos.set(x + rand(-0.7, 0.7), y + rand(0, 0.7), z + rand(-0.7, 0.7));
    d.vel.set(rand(-5, 5), rand(3.5, 9), rand(-5, 5));
    d.rot.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
    d.spin.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
    debrisMesh.setColorAt(idx, col);
  }
  if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
}

// ------------------------------------------------------------------- áudio
const audio = {
  ctx: null,
  master: null,
  gain: null,
  osc1: null,
  osc2: null,
  filter: null,
  noise: null,
  muted: false,
};

function initAudio() {
  if (audio.ctx) {
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  const master = ctx.createGain();
  master.gain.value = audio.muted ? 0 : 0.42;
  master.connect(ctx.destination);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  filter.Q.value = 3;

  const gain = ctx.createGain();
  gain.gain.value = 0;

  const osc1 = ctx.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.value = 55;
  const osc2 = ctx.createOscillator();
  osc2.type = 'square';
  osc2.frequency.value = 27.5;

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  osc1.start();
  osc2.start();

  const len = Math.floor(ctx.sampleRate * 0.4);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }

  Object.assign(audio, { ctx, master, gain, osc1, osc2, filter, noise: buffer });
}

function updateAudio() {
  if (!audio.ctx) return;
  const now = audio.ctx.currentTime;
  const playing = game.state === 'playing' && !game.crashed;
  const speed = truck.vel.length();
  const throttle = playing && input.gas ? 1 : 0;
  audio.gain.gain.setTargetAtTime(playing ? 0.035 + speed * 0.0014 + throttle * 0.02 : 0, now, 0.12);
  audio.osc1.frequency.setTargetAtTime(48 + speed * 3.4 + throttle * 16, now, 0.08);
  audio.osc2.frequency.setTargetAtTime(24 + speed * 1.7, now, 0.08);
  audio.filter.frequency.setTargetAtTime(230 + speed * 34, now, 0.1);
}

function thud(strength = 1) {
  if (!audio.ctx || audio.muted) return;
  const ctx = audio.ctx;
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = audio.noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 200;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.5 * strength, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audio.master);
  src.start(now);
  src.stop(now + 0.4);
}

function chime(level = 1) {
  if (!audio.ctx || audio.muted) return;
  const ctx = audio.ctx;
  const now = ctx.currentTime;
  const notes = level > 1 ? [660, 880, 1170] : [720, 960];
  notes.forEach((freq, i) => {
    const t = now + i * 0.055;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.075, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    osc.connect(gain);
    gain.connect(audio.master);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

// ------------------------------------------------------------------ entrada
const input = {
  gas: false,
  brake: false,
  left: false,
  right: false,
  steer: 0,
  flipFront: false,
  flipBack: false,
};
const EMPTY_INPUT = {
  gas: false,
  brake: false,
  left: false,
  right: false,
  steer: 0,
  flipFront: false,
  flipBack: false,
};

const keyMap = {
  KeyW: 'gas',
  ArrowUp: 'gas',
  KeyS: 'brake',
  ArrowDown: 'brake',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyQ: 'flipFront',
  KeyE: 'flipBack',
};

window.addEventListener('keydown', (e) => {
  const action = keyMap[e.code];
  if (action) {
    input[action] = true;
    e.preventDefault();
    return;
  }
  if (e.code === 'KeyR') {
    e.preventDefault();
    if (game.state === 'playing' && !game.crashed) resetTruckToSpawn();
  }
  if (e.code === 'Space') e.preventDefault();
});

window.addEventListener('keyup', (e) => {
  const action = keyMap[e.code];
  if (action) {
    input[action] = false;
    e.preventDefault();
  }
});

function bindHold(el, action) {
  const on = (e) => {
    e.preventDefault();
    input[action] = true;
    el.classList.add('active');
    if (el.setPointerCapture) {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };
  const off = (e) => {
    e.preventDefault();
    input[action] = false;
    el.classList.remove('active');
  };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

document.querySelectorAll('[data-act]').forEach((el) => bindHold(el, el.dataset.act));

// ------------------------------------------------------- joystick analógico
const joyEl = $('joy');
const joyKnob = $('joyKnob');
const JOY_DEAD = 0.12;
let joyPointer = null;

function joyUpdate(e) {
  const rect = joyEl.getBoundingClientRect();
  const max = rect.width * 0.26;
  let dx = e.clientX - (rect.left + rect.width / 2);
  // joystick só de direção: o eixo vertical fica travado no centro
  const len = Math.abs(dx);
  if (len > max) dx = (dx / len) * max;
  joyKnob.style.transform = `translate(${dx.toFixed(1)}px, 0px)`;
  const nx = dx / max;
  input.steer = Math.abs(nx) < JOY_DEAD ? 0 : Math.max(-1, Math.min(1, nx));
}

function joyRelease(e) {
  if (joyPointer !== null && e.pointerId !== joyPointer) return;
  joyPointer = null;
  input.steer = 0;
  joyEl.classList.remove('active');
  joyKnob.style.transform = '';
}

if (joyEl) {
  joyEl.addEventListener('pointerdown', (e) => {
    if (joyPointer !== null) return;
    e.preventDefault();
    joyPointer = e.pointerId;
    joyEl.classList.add('active');
    if (joyEl.setPointerCapture) {
      try {
        joyEl.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    if (navigator.vibrate) navigator.vibrate(8);
    joyUpdate(e);
  });
  joyEl.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joyPointer) return;
    e.preventDefault();
    joyUpdate(e);
  });
  joyEl.addEventListener('pointerup', joyRelease);
  joyEl.addEventListener('pointercancel', joyRelease);
  joyEl.addEventListener('lostpointercapture', joyRelease);
  joyEl.addEventListener('contextmenu', (e) => e.preventDefault());
}

// Se a detecção inicial falhar (ex.: notebook com tela touch), liga ao tocar.
window.addEventListener(
  'touchstart',
  () => document.documentElement.classList.add('touch'),
  { once: true, passive: true },
);

function clearInput() {
  for (const k of Object.keys(input)) input[k] = false;
  input.steer = 0;
}

window.addEventListener('blur', () => {
  clearInput();
  joyPointer = null;
  if (joyEl) {
    joyEl.classList.remove('active');
    joyKnob.style.transform = '';
  }
  document.querySelectorAll('.btn.active, .trick.active').forEach((el) => el.classList.remove('active'));
});

// ------------------------------------------------------------------ estado
let best = 0;
try {
  best = parseInt(localStorage.getItem('msa_best') || '0', 10) || 0;
} catch {
  best = 0;
}

const game = {
  state: 'menu',
  score: 0,
  time: 100,
  combo: 0,
  comboTimer: 0,
  shake: 0,
  crashed: false,
  crashTimer: 0,
  stuckTime: 0,
  bestTrick: 0,
  bestTrickLabel: '',
  airHint: false,
};

let truck = createTruckState(0, 1.3, -10);
let wheelSpin = 0;
let lastHintAt = 0;

const camPos = new THREE.Vector3(0, 5.5, -20);
const camLook = new THREE.Vector3(0, 2, -8);
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _fwdH = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _up = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
let menuAngle = 0.6;

// ------------------------------------------------------------------ funções
function popup(text, cls = 'gold') {
  const el = document.createElement('div');
  el.className = 'popup ' + cls;
  el.textContent = text;
  const holder = $('popups');
  holder.appendChild(el);
  while (holder.children.length > 4) holder.removeChild(holder.firstChild);
  window.setTimeout(() => el.remove(), 1800);
}

function addTrick(label, base) {
  game.combo += 1;
  game.comboTimer = 6;
  const mult = Math.min(game.combo, 5);
  const pts = Math.round(base * mult);
  game.score += pts;
  if (pts > game.bestTrick) {
    game.bestTrick = pts;
    game.bestTrickLabel = label;
  }
  popup(`${label}  +${fmt(pts)}` + (mult > 1 ? `  x${mult}` : ''), 'gold');
  chime(mult);
}

function resetTruckToSpawn(snapCamera = true) {
  truck = createTruckState(0, 1.3, -10);
  wheelSpin = 0;
  game.crashed = false;
  game.crashTimer = 0;
  game.stuckTime = 0;
  if (snapCamera) {
    camPos.set(truck.pos.x, 5.4, truck.pos.z - 9.5);
    camLook.set(truck.pos.x, 2.0, truck.pos.z + 3.5);
  }
}

function recoverTruck() {
  _fwd.set(0, 0, 1).applyQuaternion(truck.quat);
  const yaw = Math.atan2(_fwd.x, _fwd.z);
  truck.quat.setFromAxisAngle(Y, yaw);
  truck.pos.y = groundHeight(truck.pos.x, truck.pos.z) + 1.4;
  truck.vel.set(0, 0, 0);
  truck.angVel.set(0, 0, 0);
  truck.airTime = 0;
  truck.airPitch = 0;
  truck.airRoll = 0;
  truck.minVy = 0;
  truck.wasGrounded = false;
  truck.wheelSteer = 0;
  game.stuckTime = 0;
  if (game.combo > 0) {
    game.combo = 0;
    game.comboTimer = 0;
  }
  popup('DE PÉ!', 'info');
}

function wreck() {
  if (game.crashed || game.state !== 'playing') return;
  game.crashed = true;
  game.crashTimer = 1.8;
  game.combo = 0;
  game.comboTimer = 0;
  game.shake = Math.max(game.shake, 1.5);
  popup('DESTRUÍDO!', 'bad');
  thud(1.5);
  dustBurst(truck.pos, 26);
}

function startGame() {
  initAudio();
  if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  game.state = 'playing';
  game.score = 0;
  game.time = 100;
  game.combo = 0;
  game.comboTimer = 0;
  game.shake = 0;
  game.crashed = false;
  game.crashTimer = 0;
  game.stuckTime = 0;
  game.bestTrick = 0;
  game.bestTrickLabel = '';
  game.airHint = false;
  game.lastHintAt = 0;

  for (const car of cars) {
    car.alive = true;
    car.respawn = 0;
    car.pop = 1;
    car.group.visible = true;
    car.group.scale.setScalar(1);
    car.group.rotation.y = car.baseRot;
  }

  resetTruckToSpawn(true);
  clearInput();
  $('start').classList.add('hidden');
  $('over').classList.add('hidden');
  updateHud(true);
}

function endGame() {
  if (game.state !== 'playing') return;
  game.state = 'over';
  const finalScore = Math.floor(game.score);
  if (finalScore > best) {
    best = finalScore;
    try {
      localStorage.setItem('msa_best', String(best));
    } catch {
      /* ignore */
    }
  }
  $('finalScore').textContent = fmt(game.score);
  $('finalBest').textContent = fmt(best);
  $('finalTrick').textContent =
    game.bestTrick > 0 ? `${game.bestTrickLabel} · ${fmt(game.bestTrick)}` : '—';
  $('tricks').classList.remove('show');
  $('air').classList.remove('show');
  $('over').classList.remove('hidden');
  game.combo = 0;
  game.comboTimer = 0;
}

function crushCar(car) {
  car.alive = false;
  car.respawn = 12;
  car.group.visible = false;
  spawnDebris(car.x, 0.9, car.z, car.color, 12);
  game.shake = Math.max(game.shake, 0.9);
  thud(1.1);
  if (truck.vel.y < 0) truck.vel.y = Math.max(truck.vel.y, 6.5);
  truck.vel.x *= 0.86;
  truck.vel.z *= 0.86;
  addTrick(truck.airTime > 0.15 ? 'ESMAGOU NO AR' : 'ESMAGOU', 320);
}

function handleLanding(landed) {
  if (landed.impact > 4) {
    game.shake = Math.max(game.shake, Math.min(1.6, landed.impact / 12));
    thud(Math.min(1.4, landed.impact / 14));
    dustBurst(truck.pos, Math.min(26, 6 + landed.impact));
  }
  if (game.state !== 'playing' || game.crashed) return;
  if (landed.upDot < 0.2) {
    wreck();
    return;
  }
  if (landed.airTime < 0.35) return;

  const labels = [];
  let base = 0;
  if (landed.airTime > 0.45) {
    base += Math.round(landed.airTime * 100);
    labels.push(landed.airTime > 1.5 ? 'BIG AIR' : 'NO AR');
  }
  const flips = Math.floor((Math.abs(landed.pitch) + 0.4) / 5.9);
  if (flips > 0) {
    base += flips * 1200;
    const dir = landed.pitch < 0 ? 'MORTAL P/ TRÁS' : 'MORTAL P/ FRENTE';
    labels.push(dir + (flips > 1 ? ` x${flips}` : ''));
  }
  if (base > 0 && labels.length) addTrick(labels.join(' + '), base);
}

function updateStuck(dt) {
  if (game.state !== 'playing' || game.crashed) {
    game.stuckTime = 0;
    return;
  }
  const up = upDotOf(truck);
  if ((truck.grounded || truck.bodyContact) && truck.vel.length() < 2.5 && up < 0.6) {
    game.stuckTime += dt;
    if (game.stuckTime > 1.3) recoverTruck();
  } else {
    game.stuckTime = 0;
  }
}

function updateCars(dt) {
  for (const car of cars) {
    if (!car.alive) {
      car.respawn -= dt;
      if (car.respawn <= 0) {
        car.alive = true;
        car.pop = 0;
        car.group.visible = true;
        car.group.scale.setScalar(0.05);
      }
      continue;
    }

    if (car.pop < 1) {
      car.pop = Math.min(1, car.pop + dt * 3.4);
      const e = 1 - Math.pow(1 - car.pop, 3);
      car.group.scale.setScalar(0.05 + 0.95 * e);
    }

    if (game.state !== 'playing' || game.crashed) continue;

    const dx = truck.pos.x - car.x;
    const dz = truck.pos.z - car.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 6.2) continue;
    if (truck.pos.y - 0.55 > car.top + 0.6) continue;

    const speed = Math.hypot(truck.vel.x, truck.vel.z);
    const airborne = truck.airTime > 0.12;
    if (airborne || speed > 5 || truck.vel.y < -2) {
      crushCar(car);
    } else if (d2 > 0.0001) {
      // empurra o caminhão para fora do carro quando está devagar
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const nz = dz / d;
      truck.pos.x = car.x + nx * 2.6;
      truck.pos.z = car.z + nz * 2.6;
      const vn = truck.vel.x * nx + truck.vel.z * nz;
      if (vn < 0) {
        truck.vel.x -= vn * nx * 1.2;
        truck.vel.z -= vn * nz * 1.2;
      }
    }
  }
}

function updateVisuals(dt) {
  truckObj.root.position.copy(truck.pos);
  truckObj.root.quaternion.copy(truck.quat);

  _fwd.set(0, 0, 1).applyQuaternion(truck.quat);
  _fwdH.copy(_fwd).setY(0);
  if (_fwdH.lengthSq() < 1e-5) _fwdH.set(0, 0, 1);
  else _fwdH.normalize();

  const wheelSpeed = truck.vel.dot(_fwdH);
  wheelSpin += (wheelSpeed / WHEEL_RADIUS) * dt;

  for (let i = 0; i < truckObj.wheels.length; i++) {
    const w = truckObj.wheels[i];
    w.spin.rotation.x = wheelSpin;
    if (i < 2) w.pivot.rotation.y = -truck.wheelSteer;
    const targetY = WHEEL_LOCALS[i].y + (truck.grounded ? 0 : -0.1);
    w.pivot.position.y += (targetY - w.pivot.position.y) * Math.min(1, dt * 12);
  }

  matTaillight.emissiveIntensity = input.brake && game.state === 'playing' ? 3.2 : 0.8;

  if (
    game.state === 'playing' &&
    !game.crashed &&
    truck.grounded &&
    input.gas &&
    Math.abs(wheelSpeed) > 2.5 &&
    Math.random() < 0.75
  ) {
    for (const idx of [2, 3]) {
      _tmp.copy(WHEEL_LOCALS[idx]).applyQuaternion(truck.quat).add(truck.pos);
      emitDust(_tmp.x, 0.12, _tmp.z, 0.65);
    }
  }
}

function updateParticles(dt) {
  for (let i = 0; i < DUST_N; i++) {
    if (dustLife[i] <= 0) continue;
    dustLife[i] -= dt;
    const j = i * 3;
    if (dustLife[i] <= 0) {
      dustPositions[j + 1] = -999;
      continue;
    }
    dustVel[j] *= 0.985;
    dustVel[j + 1] += 1.4 * dt;
    dustVel[j + 2] *= 0.985;
    dustPositions[j] += dustVel[j] * dt;
    dustPositions[j + 1] += dustVel[j + 1] * dt;
    dustPositions[j + 2] += dustVel[j + 2] * dt;
    if (dustPositions[j + 1] < 0.05) dustPositions[j + 1] = 0.05;
  }
  dustGeo.attributes.position.needsUpdate = true;

  for (let i = 0; i < DEBRIS_N; i++) {
    const d = debris[i];
    if (!d.active) continue;
    d.life -= dt;
    if (d.life <= 0) {
      d.active = false;
      debrisMesh.setMatrixAt(i, zeroMatrix);
      continue;
    }
    d.vel.y -= 16 * dt;
    d.pos.addScaledVector(d.vel, dt);
    const gh = groundHeight(d.pos.x, d.pos.z) + 0.12;
    if (d.pos.y < gh) {
      d.pos.y = gh;
      d.vel.y *= -0.35;
      d.vel.x *= 0.7;
      d.vel.z *= 0.7;
      d.spin.multiplyScalar(0.7);
    }
    d.rot.x += d.spin.x * dt;
    d.rot.y += d.spin.y * dt;
    d.rot.z += d.spin.z * dt;
    _dummy.position.copy(d.pos);
    _dummy.rotation.copy(d.rot);
    _dummy.scale.setScalar(Math.min(1, d.life * 2));
    _dummy.updateMatrix();
    debrisMesh.setMatrixAt(i, _dummy.matrix);
  }
  debrisMesh.instanceMatrix.needsUpdate = true;
}

function updateCamera(dt) {
  const speed = truck.vel.length();

  if (game.state === 'menu') {
    menuAngle += dt * 0.22;
    _desired.set(
      truck.pos.x + Math.sin(menuAngle) * 9.5,
      truck.pos.y + 4.0,
      truck.pos.z + Math.cos(menuAngle) * 9.5
    );
    const groundAt = groundHeight(_desired.x, _desired.z) + 1.8;
    if (_desired.y < groundAt) _desired.y = groundAt;
    camPos.lerp(_desired, 1 - Math.exp(-2.6 * dt));
    _look.copy(truck.pos);
    _look.y += 1.2;
    camLook.lerp(_look, 1 - Math.exp(-4 * dt));
    camera.fov = lerp(camera.fov, 58, 1 - Math.exp(-2 * dt));
  } else {
    _fwd.copy(Z).applyQuaternion(truck.quat);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-5) _fwd.set(0, 0, 1);
    else _fwd.normalize();

    const back = 9.0 + Math.min(speed * 0.14, 3.2);
    const height = 3.6 + Math.min(speed * 0.05, 1.2) + (truck.airTime > 0.2 ? 1.1 : 0);
    _desired.copy(truck.pos).addScaledVector(_fwd, -back);
    _desired.y += height;
    const groundAt = groundHeight(_desired.x, _desired.z) + 2.0;
    if (_desired.y < groundAt) _desired.y = groundAt;

    camPos.lerp(_desired, 1 - Math.exp(-4.5 * dt));
    _look.copy(truck.pos).addScaledVector(_fwd, 3.6);
    _look.y += 1.3;
    const lookGround = groundHeight(_look.x, _look.z) + 1.0;
    if (_look.y < lookGround) _look.y = lookGround;
    camLook.lerp(_look, 1 - Math.exp(-7 * dt));
    camera.fov = lerp(camera.fov, 62 + Math.min(speed * 0.55, 11), 1 - Math.exp(-3 * dt));
  }

  camera.position.copy(camPos);
  if (game.shake > 0.002) {
    camera.position.x += rand(-1, 1) * game.shake * 0.55;
    camera.position.y += rand(-1, 1) * game.shake * 0.45;
    camera.position.z += rand(-1, 1) * game.shake * 0.55;
  }
  camera.lookAt(camLook);
  camera.updateProjectionMatrix();

  game.shake *= Math.exp(-5 * dt);
}

let hudScore = -1;
let hudTime = '';
let hudSpeed = -1;
let hudCombo = '';

function updateHud(force = false) {
  const score = Math.floor(game.score);
  if (force || score !== hudScore) {
    $('score').textContent = fmt(score);
    hudScore = score;
  }

  const total = Math.max(0, Math.ceil(game.time));
  const timeStr = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  if (force || timeStr !== hudTime) {
    $('time').textContent = timeStr;
    hudTime = timeStr;
  }

  const speed = Math.round(truck.vel.length() * 3.6);
  if (force || speed !== hudSpeed) {
    $('speed').textContent = String(speed);
    $('speedfill').style.width = `${Math.min(100, (speed / 95) * 100)}%`;
    hudSpeed = speed;
  }

  const comboStr = game.combo > 1 ? `COMBO x${Math.min(game.combo, 5)}` : '';
  if (force || comboStr !== hudCombo) {
    const el = $('combo');
    el.textContent = comboStr;
    el.classList.toggle('on', comboStr !== '');
    hudCombo = comboStr;
  }

  const airborne = game.state === 'playing' && !game.crashed && truck.airTime > 0.3;
  $('airtime').textContent = `${truck.airTime.toFixed(1)}s`;
  $('air').classList.toggle('show', airborne);

  const showTricks = game.state === 'playing' && !game.crashed && truck.airTime > 0.14;
  $('tricks').classList.toggle('show', showTricks);

  if (
    game.state === 'playing' &&
    !game.crashed &&
    !game.airHint &&
    truck.airTime > 0.4
  ) {
    game.airHint = true;
    popup('NO AR! SEGURE ↻ OU ↺', 'info');
  }
}

function updateCarsPopOnly(dt) {
  // usado apenas para animar carros quando o jogo está pausado
  for (const car of cars) {
    if (!car.alive) continue;
    if (car.pop < 1) {
      car.pop = Math.min(1, car.pop + dt * 3.4);
      const e = 1 - Math.pow(1 - car.pop, 3);
      car.group.scale.setScalar(0.05 + 0.95 * e);
    }
  }
}

// -------------------------------------------------------------------- loop
const FIXED = 1 / 120;
let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (game.state === 'playing') {
    game.time -= dt;
    if (game.time <= 0) {
      game.time = 0;
      endGame();
    }
    if (game.comboTimer > 0) {
      game.comboTimer -= dt;
      if (game.comboTimer <= 0) game.combo = 0;
    }
  }

  acc += dt;
  let steps = 0;
  while (acc >= FIXED && steps < 8) {
    const active = game.state === 'playing' && !game.crashed;
    const result = stepTruck(truck, active ? input : EMPTY_INPUT, FIXED);
    if (result.landed) handleLanding(result.landed);
    acc -= FIXED;
    steps++;
  }
  if (steps === 8) acc = 0;

  if (game.crashed) {
    game.crashTimer -= dt;
    if (game.crashTimer <= 0) {
      resetTruckToSpawn(false);
      popup('RECUPERADO', 'info');
    }
  }

  updateStuck(dt);
  if (game.state === 'playing') updateCars(dt);
  else updateCarsPopOnly(dt);

  updateVisuals(dt);
  updateParticles(dt);
  updateCamera(dt);
  updateAudio();
  updateHud();
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------- resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
});

document.addEventListener('visibilitychange', () => {
  last = performance.now();
  acc = 0;
});

// ------------------------------------------------------------------- botões
$('playBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', startGame);
$('resetBtn').addEventListener('click', () => {
  if (game.state === 'playing' && !game.crashed) resetTruckToSpawn(true);
});
$('muteBtn').addEventListener('click', () => {
  audio.muted = !audio.muted;
  $('muteBtn').textContent = audio.muted ? '🔇' : '🔊';
  if (audio.master) {
    audio.master.gain.setTargetAtTime(audio.muted ? 0 : 0.42, audio.ctx.currentTime, 0.05);
  }
});

$('startBest').textContent = fmt(best);

// estado inicial do HUD
updateHud(true);
resetTruckToSpawn(true);

if (new URLSearchParams(location.search).has('debug')) {
  window.__msa = {
    game,
    get truck() { return truck; },
    set truck(v) { truck = v; },
    input,
    cars,
    renderer,
    scene,
    camera,
    startGame,
    resetTruckToSpawn,
    stepTruck,
    groundHeight,
    upDotOf,
  };
}

requestAnimationFrame(frame);
