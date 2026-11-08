// Física arcade do monster truck.
// Roda tanto no navegador quanto no Node (só usa a matemática do three).
import { Vector3, Quaternion, MathUtils } from '../vendor/three.module.js';

export const WHEEL_RADIUS = 0.64;
export const BOUNDS = 44.5;

// Posição local das rodas: +Z é a frente, +Y é para cima.
// Índices 0/1 = dianteiras, 2/3 = traseiras (tração).
export const WHEEL_LOCALS = Object.freeze([
  new Vector3(-1.02, -0.42, 1.25),
  new Vector3(1.02, -0.42, 1.25),
  new Vector3(-1.02, -0.42, -1.25),
  new Vector3(1.02, -0.42, -1.25),
]);

// Rampas: caem no chão a partir da borda de baixo e sobem até a borda de cima.
// angle gira a rampa em torno de Y (0 = sobe para +Z).
export const RAMPS = [
  { x: 0, z: 16, w: 12, l: 14, h: 4.6, rise: 0.8, angle: 0 },
  { x: -15, z: 4, w: 9, l: 12, h: 3.2, rise: 0.8, angle: -0.45 },
  { x: 15, z: 4, w: 9, l: 12, h: 3.2, rise: 0.8, angle: 0.45 },
  { x: 0, z: -24, w: 13, l: 13, h: 3.6, rise: 0.85, angle: Math.PI },
  { x: -28, z: 23, w: 8, l: 11, h: 3.0, rise: 0.85, angle: -0.55 },
  { x: 28, z: 27, w: 8, l: 11, h: 3.0, rise: 0.85, angle: 0.55 },
];

// Sobe a rampa em linha reta e depois mantém o topo (tabletop).
export function groundHeight(x, z, ramps = RAMPS) {
  let height = 0;
  for (let i = 0; i < ramps.length; i++) {
    const r = ramps[i];
    const dx = x - r.x;
    const dz = z - r.z;
    const c = Math.cos(-r.angle);
    const s = Math.sin(-r.angle);
    const lx = dx * c + dz * s;
    const lz = -dx * s + dz * c;
    if (Math.abs(lx) > r.w / 2 || Math.abs(lz) > r.l / 2) continue;
    const t = (lz + r.l / 2) / r.l;
    const climb = MathUtils.clamp(t / r.rise, 0, 1);
    const h = r.h * climb;
    if (h > height) height = h;
  }
  return height;
}

export function createTruckState(x = 0, y = 1.2, z = -10, yaw = 0) {
  return {
    pos: new Vector3(x, y, z),
    vel: new Vector3(),
    quat: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw),
    angVel: new Vector3(),
    wheelSteer: 0,
    wheelContacts: [false, false, false, false],
    groundHeight: 0,
    grounded: false,
    wasGrounded: false,
    bodyContact: false,
    airTime: 0,
    airPitch: 0,
    airRoll: 0,
    minVy: 0,
  };
}

// ---------------------------------------------------------------- constantes
const GRAVITY = 21;
const SPRING_K = 280;
const SPRING_C = 16;
const SPRING_MAX = 200;
const ENGINE = 13; // por roda traseira
const BRAKE = 18;
const REVERSE = 8;
const DRAG = 0.04;
const ROLL_RESISTANCE = 0.35;
const LATERAL_GRIP = 4.5;
const LATERAL_MAX = 35;
const INV_INERTIA = 0.35;
const MAX_ANG = 9;
const STEER_MAX = 0.62;
const STEER_RATE = 9;
const TURN_RATE = 1.7; // rad/s de guinada com esterço total
const TURN_MIN_FACTOR = 0.22; // guinada mínima enquanto acelera devagar
const AIR_PITCH = 46;
const FLIP_RATE = 8.2;
const AIR_YAW = 5;
const AIR_DAMP = 0.2;
const GROUND_DAMP = 5;
const BODY_CLEARANCE = 0.45;

const _forward = new Vector3();
const _right = new Vector3();
const _fwdH = new Vector3();
const _rightH = new Vector3();
const _acc = new Vector3();
const _torque = new Vector3();
const _r = new Vector3();
const _rDrive = new Vector3();
const _wp = new Vector3();
const _vAt = new Vector3();
const _f = new Vector3();
const _t2 = new Vector3();
const _dq = new Quaternion();
const _up = new Vector3();

/**
 * Avança a simulação em um passo fixo.
 * input: { gas, brake, left, right, steer }
 * `steer` (opcional, -1 a 1) tem prioridade sobre left/right (joystick analógico).
 * Retorna { landed } quando o caminhão toca o chão depois de um voo.
 */
export function stepTruck(t, input, dt) {
  const gas = input.gas ? 1 : 0;
  const brake = input.brake ? 1 : 0;
  const analog = typeof input.steer === 'number' ? Math.max(-1, Math.min(1, input.steer)) : 0;
  const steerIn = analog !== 0 ? analog : (input.right ? 1 : 0) - (input.left ? 1 : 0);

  const q = t.quat;
  _forward.set(0, 0, 1).applyQuaternion(q);
  _right.set(1, 0, 0).applyQuaternion(q);

  _fwdH.copy(_forward).setY(0);
  if (_fwdH.lengthSq() < 1e-5) _fwdH.set(0, 0, 1);
  else _fwdH.normalize();
  _rightH.copy(_right).setY(0);
  if (_rightH.lengthSq() < 1e-5) _rightH.set(1, 0, 0);
  else _rightH.normalize();

  _acc.set(0, -GRAVITY, 0);
  _torque.set(0, 0, 0);

  const speed = t.vel.length();
  _acc.addScaledVector(t.vel, -DRAG * speed);

  const headingSpeed = t.vel.dot(_fwdH);

  // suaviza o volante
  t.wheelSteer += (steerIn * STEER_MAX - t.wheelSteer) * Math.min(1, STEER_RATE * dt);

  let contacts = 0;
  for (let i = 0; i < 4; i++) {
    _r.copy(WHEEL_LOCALS[i]).applyQuaternion(q);
    _wp.copy(t.pos).add(_r);
    const gh = groundHeight(_wp.x, _wp.z);
    const pen = gh + WHEEL_RADIUS - _wp.y;
    t.wheelContacts[i] = pen > 0;
    if (pen <= 0) continue;

    contacts++;
    _vAt.copy(t.angVel).cross(_r).add(t.vel);

    // mola + amortecedor da suspensão
    let spring = SPRING_K * Math.min(pen, 0.5) - SPRING_C * _vAt.y;
    spring = MathUtils.clamp(spring, 0, SPRING_MAX);
    _acc.y += spring;
    _torque.x += -_r.z * spring;
    _torque.z += _r.x * spring;

    // tração nas rodas traseiras
    if (i >= 2) {
      let drive = 0;
      if (gas) drive += ENGINE;
      if (brake) drive -= headingSpeed > 0.8 ? BRAKE : REVERSE;
      if (drive !== 0) {
        _f.copy(_forward).multiplyScalar(drive);
        _acc.add(_f);
        // aplica a tração um pouco acima do centro da roda para segurar o empinado
        _rDrive.set(_r.x, -0.2, _r.z);
        _t2.crossVectors(_rDrive, _f);
        _torque.add(_t2);
      }
    }

    // aderência lateral
    const lat = _vAt.dot(_rightH);
    const grip = MathUtils.clamp(-lat * LATERAL_GRIP, -LATERAL_MAX, LATERAL_MAX);
    _f.copy(_rightH).multiplyScalar(grip);
    _acc.add(_f);
    _t2.crossVectors(_r, _f);
    // parte do torque lateral é ignorada para a direção arcade responder melhor
    _torque.addScaledVector(_t2, 0.35);

    // resistência de rolagem
    const lon = _vAt.dot(_fwdH);
    _f.copy(_fwdH).multiplyScalar(-lon * ROLL_RESISTANCE);
    _acc.add(_f);
  }

  // direção: guinada controlada por esterço e velocidade.
  // +estilo = direita na tela (a câmera olha para +Z, então direita = -X).
  // Aplicada depois das forças laterais para o atrito não anular a curva.
  if (contacts > 0) {
    const speedAbs = Math.abs(headingSpeed);
    let speedFactor = Math.min(speedAbs / 7, 1);
    if (gas && speedFactor < TURN_MIN_FACTOR) speedFactor = TURN_MIN_FACTOR;
    const direction = headingSpeed < -0.2 ? -1 : 1;
    const targetYaw = -t.wheelSteer * direction * TURN_RATE * speedFactor;
    const response = Math.min(1, (5 + 9 * speedFactor) * dt);
    t.angVel.y += (targetYaw - t.angVel.y) * response;
  }

  // controle no ar: botões de mortal + leme suave
  if (contacts === 0) {
    const flip = (input.flipBack ? 1 : 0) - (input.flipFront ? 1 : 0);
    if (flip !== 0) {
      // velocidade de giro previsível: um mortal completo dura ~0,85 s
      const current = t.angVel.dot(_right);
      const target = -flip * FLIP_RATE;
      t.angVel.addScaledVector(_right, (target - current) * Math.min(1, 20 * dt));
    }
    if (steerIn !== 0) _torque.y -= steerIn * AIR_YAW;
  }

  const damp = contacts > 0 ? GROUND_DAMP : AIR_DAMP;
  if (contacts > 0) {
    // no chão, segura firme o arfagem e o rolamento (evita cambalhotas involuntárias)
    t.angVel.x *= Math.exp(-damp * dt);
    t.angVel.z *= Math.exp(-damp * dt);
    t.angVel.y *= Math.exp(-1.2 * dt);
  } else if (input.flipBack || input.flipFront) {
    t.angVel.multiplyScalar(Math.exp(-damp * dt));
  } else {
    // soltou os botões: freia o giro para dar para controlar o pouso
    const k = Math.exp(-2.4 * dt);
    const pitchRate = t.angVel.dot(_right);
    const rollRate = t.angVel.dot(_forward);
    t.angVel.addScaledVector(_right, (k - 1) * pitchRate);
    t.angVel.addScaledVector(_forward, (k - 1) * rollRate);
    t.angVel.y *= Math.exp(-0.6 * dt);
  }

  // integração
  t.vel.addScaledVector(_acc, dt);
  t.angVel.addScaledVector(_torque, INV_INERTIA * dt);
  const ang = t.angVel.length();
  if (ang > MAX_ANG) t.angVel.multiplyScalar(MAX_ANG / ang);

  if (contacts === 0) {
    t.airTime += dt;
    t.airPitch += t.angVel.dot(_right) * dt;
    t.airRoll += t.angVel.dot(_forward) * dt;
    if (t.vel.y < t.minVy) t.minVy = t.vel.y;
  }

  _dq.set(t.angVel.x, t.angVel.y, t.angVel.z, 0).multiply(q);
  q.x += 0.5 * dt * _dq.x;
  q.y += 0.5 * dt * _dq.y;
  q.z += 0.5 * dt * _dq.z;
  q.w += 0.5 * dt * _dq.w;
  q.normalize();

  t.pos.addScaledVector(t.vel, dt);

  // limites da arena
  if (t.pos.x > BOUNDS) {
    t.pos.x = BOUNDS;
    if (t.vel.x > 0) t.vel.x *= -0.35;
  } else if (t.pos.x < -BOUNDS) {
    t.pos.x = -BOUNDS;
    if (t.vel.x < 0) t.vel.x *= -0.35;
  }
  if (t.pos.z > BOUNDS) {
    t.pos.z = BOUNDS;
    if (t.vel.z > 0) t.vel.z *= -0.35;
  } else if (t.pos.z < -BOUNDS) {
    t.pos.z = -BOUNDS;
    if (t.vel.z < 0) t.vel.z *= -0.35;
  }

  // rede de segurança: o chassi nunca atravessa o chão
  const gh = groundHeight(t.pos.x, t.pos.z);
  t.bodyContact = false;
  if (t.pos.y < gh + BODY_CLEARANCE) {
    t.pos.y = gh + BODY_CLEARANCE;
    if (t.vel.y < 0) t.vel.y *= -0.12;
    t.vel.x *= 0.9;
    t.vel.z *= 0.9;
    t.angVel.multiplyScalar(0.85);
    t.bodyContact = true;
  }

  t.groundHeight = gh;
  t.grounded = contacts > 0;

  let landed = null;
  const wasAir = !t.wasGrounded;
  if (t.grounded && wasAir && t.airTime > 0.05) {
    _up.set(0, 1, 0).applyQuaternion(q);
    landed = {
      airTime: t.airTime,
      pitch: t.airPitch,
      roll: t.airRoll,
      impact: Math.max(0, -t.minVy),
      upDot: _up.y,
    };
  }

  if (t.grounded) {
    t.airTime = 0;
    t.airPitch = 0;
    t.airRoll = 0;
    t.minVy = 0;
  }
  t.wasGrounded = t.grounded;

  return { landed };
}

export function upDotOf(t) {
  return _up.set(0, 1, 0).applyQuaternion(t.quat).y;
}
