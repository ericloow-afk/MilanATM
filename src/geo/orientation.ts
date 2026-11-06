/**
 * Orienteringsmatematik utan three.js (ren TS). Kvaternion = [x, y, z, w].
 *
 * Världsram (samma som three.js-scenen): x = öst, y = upp, −z = norr.
 * "Norr" här är alpha-origo, som på iOS är godtyckligt; yawQuaternion + filtret rättar det mot kompassen.
 */
export type Quat = [x: number, y: number, z: number, w: number];
export type Vec3 = [x: number, y: number, z: number];

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const wrap360 = (a: number): number => ((a % 360) + 360) % 360;
/** Wrappar en vinkel (grader) till [−180, 180). */
export const wrap180 = (a: number): number => wrap360(a + 180) - 180;

export function qFromAxisAngle(axis: Vec3, rad: number): Quat {
  const s = Math.sin(rad / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(rad / 2)];
}

/** Hamilton-produkt a ⊗ b (först b, sedan a i världsramen). */
export function qMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function qNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export const qDot = (a: Quat, b: Quat): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

/** Vinkel (rad) mellan två orienteringar. */
export function qAngleBetween(a: Quat, b: Quat): number {
  return 2 * Math.acos(Math.min(1, Math.abs(qDot(a, b))));
}

/** Sfärisk interpolation längs kortaste vägen. */
export function qSlerp(a: Quat, b: Quat, t: number): Quat {
  let d = qDot(a, b);
  let bb = b;
  if (d < 0) {
    bb = [-b[0], -b[1], -b[2], -b[3]];
    d = -d;
  }
  if (d > 0.9995) {
    return qNormalize([a[0] + t * (bb[0] - a[0]), a[1] + t * (bb[1] - a[1]), a[2] + t * (bb[2] - a[2]), a[3] + t * (bb[3] - a[3])]);
  }
  const theta = Math.acos(d);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return [wa * a[0] + wb * bb[0], wa * a[1] + wb * bb[1], wa * a[2] + wb * bb[2], wa * a[3] + wb * bb[3]];
}

export function rotateVec(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  // t = 2 * cross(q.xyz, v); v' = v + w*t + cross(q.xyz, t)
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

const AXIS_X: Vec3 = [1, 0, 0];
const AXIS_Y: Vec3 = [0, 1, 0];
const AXIS_Z: Vec3 = [0, 0, 1];
/** −90° runt X: kameran tittar ut ur enhetens baksida i stället för uppåt ur skärmen. */
const Q_BACK_CAMERA: Quat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

/**
 * Kamerans orientering ur DeviceOrientationEvent (alpha, beta, gamma i grader) och skärmvinkel.
 * Samma formel som three.js DeviceOrientationControls:
 *   Euler(beta→X, alpha→Y, −gamma→Z) i ordning YXZ  →  ⊗ q1 (−90° runt X)  →  ⊗ (−skärmvinkel runt Z).
 */
export function deviceQuaternion(alphaDeg: number, betaDeg: number, gammaDeg: number, screenAngleDeg = 0): Quat {
  const qy = qFromAxisAngle(AXIS_Y, alphaDeg * D2R);
  const qx = qFromAxisAngle(AXIS_X, betaDeg * D2R);
  const qz = qFromAxisAngle(AXIS_Z, -gammaDeg * D2R);
  let q = qMul(qMul(qy, qx), qz);
  q = qMul(q, Q_BACK_CAMERA);
  q = qMul(q, qFromAxisAngle(AXIS_Z, -screenAngleDeg * D2R));
  return qNormalize(q);
}

/** Rotation som lägger +deg grader till alla riktningar (vänstermultiplicera: qMul(yaw, q)). */
export function yawQuaternion(deg: number): Quat {
  return qFromAxisAngle(AXIS_Y, -deg * D2R);
}

/** Riktning (grader från norr, medsols) för en vektor i världsramen. */
export const headingOfVec = (v: Vec3): number => wrap360(Math.atan2(v[0], -v[2]) * R2D);

/** Riktningen kameran tittar åt (odefinierad om den tittar rakt upp/ned). */
export function forwardHeading(q: Quat): number {
  return headingOfVec(rotateVec(q, [0, 0, -1]));
}

/** Riktningen skärmens/bildens överkant pekar åt. */
export function topHeading(q: Quat): number {
  return headingOfVec(rotateVec(q, [0, 1, 0]));
}

/**
 * Referensriktning som motsvarar iOS webkitCompassHeading (hypotes, ska verifieras i fält):
 * kamerans riktning när telefonen hålls upprätt, överkantens riktning när den ligger platt.
 * Mjuk viktning på hur horisontell kameran är, så att den inte hoppar.
 */
export function referenceHeading(q: Quat): number {
  const f = rotateVec(q, [0, 0, -1]);
  const u = rotateVec(q, [0, 1, 0]);
  const hf = Math.hypot(f[0], f[2]);
  const hu = Math.hypot(u[0], u[2]);
  const w = Math.min(1, Math.max(0, (hf - 0.3) / 0.4));
  // Tittar kameran uppåt pekar överkanten bakåt: vänd den.
  const sign = f[1] <= 0 ? 1 : -1;
  const fx = hf > 1e-9 ? f[0] / hf : 0;
  const fz = hf > 1e-9 ? f[2] / hf : 0;
  const ux = hu > 1e-9 ? (sign * u[0]) / hu : 0;
  const uz = hu > 1e-9 ? (sign * u[2]) / hu : 0;
  return headingOfVec([w * fx + (1 - w) * ux, 0, w * fz + (1 - w) * uz]);
}

/**
 * Omvänd väg för simulatorn: önskad riktning H, lutning P (0 = upprätt mot horisonten, +upp, −90 = platt, blick ned)
 * och godtyckligt alpha-origo O ger alpha/beta/gamma (gamma = 0).
 * Världsriktningen blir då H − O, som kompassen (som visar H) får rätta.
 */
export function eulerFromHeadingPitch(headingDeg: number, pitchDeg: number, alphaOriginDeg = 0) {
  return { alpha: wrap360(360 - headingDeg + alphaOriginDeg), beta: 90 + pitchDeg, gamma: 0 };
}
