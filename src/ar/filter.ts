/** Orienteringsfilter: slerp-utjämning i kvaternionrymd + yaw-offset-komplementärfilter mot kompassen. Ren TS. */
import { deviceQuaternion, qMul, qSlerp, referenceHeading, wrap180, yawQuaternion, type Quat } from '../geo/orientation';

export interface OrientationSample {
  alpha: number;
  beta: number;
  gamma: number;
  /** skärmens rotation i grader (0 i porträtt) */
  screenAngle: number;
  /** webkitCompassHeading (grader) eller null */
  compass: number | null;
  /** webkitCompassAccuracy: negativ = okalibrerad */
  compassAccuracy: number | null;
}

export type CompassState = 'none' | 'uncalibrated' | 'inaccurate' | 'ok';

export interface FilterOptions {
  /** tidskonstant (s) för kvaternion-utjämning */
  tauQ?: number;
  /** tidskonstant (s) för yaw-korrigering mot kompassen (låg förstärkning) */
  tauYaw?: number;
  /** kompassvärden med sämre noggrannhet (grader) ignoreras */
  maxCompassAccuracy?: number;
}

export class OrientationFilter {
  private readonly tauQ: number;
  private readonly tauYaw: number;
  private readonly maxAcc: number;
  private qSmooth: Quat | null = null;
  private yaw = 0;
  private manual = 0;
  private haveYaw = false;

  compassState: CompassState = 'none';
  /** senaste fel (grader): (kompass + manuell) − (referens + yaw); 0 om ingen kompass användes */
  headingError = 0;

  constructor(opts: FilterOptions = {}) {
    this.tauQ = opts.tauQ ?? 0.1;
    this.tauYaw = opts.tauYaw ?? 5;
    this.maxAcc = opts.maxCompassAccuracy ?? 25;
  }

  /** Slutlig kameraorientering (utjämnad + yaw). */
  get quaternion(): Quat {
    return qMul(yawQuaternion(this.yaw), this.qSmooth ?? [0, 0, 0, 1]);
  }
  get yawDeg(): number {
    return this.yaw;
  }
  get manualDeg(): number {
    return this.manual;
  }

  /** Manuell kalibrering: vrider vyn direkt och flyttar kompassens mål lika mycket, så filtret inte drar tillbaka. */
  nudgeManual(deg: number): void {
    this.manual += deg;
    this.yaw += deg;
  }
  resetManual(): void {
    this.yaw -= this.manual;
    this.manual = 0;
  }

  update(dt: number, s: OrientationSample): void {
    const raw = deviceQuaternion(s.alpha, s.beta, s.gamma, s.screenAngle);
    this.qSmooth = this.qSmooth ? qSlerp(this.qSmooth, raw, 1 - Math.exp(-dt / this.tauQ)) : raw;

    this.headingError = 0;
    if (s.compass == null || Number.isNaN(s.compass)) {
      this.compassState = 'none';
      return;
    }
    if (s.compassAccuracy != null && s.compassAccuracy < 0) {
      this.compassState = 'uncalibrated';
      return;
    }
    if (s.compassAccuracy != null && s.compassAccuracy > this.maxAcc) {
      this.compassState = 'inaccurate';
      return;
    }
    this.compassState = 'ok';
    const ref = referenceHeading(this.qSmooth);
    const e = wrap180(s.compass + this.manual - (ref + this.yaw)); // wrap180 = cirkulärt medelvärde
    this.headingError = e;
    if (!this.haveYaw) {
      this.yaw += e; // första giltiga värdet: snappa
      this.haveYaw = true;
    } else {
      this.yaw += (1 - Math.exp(-dt / this.tauYaw)) * e;
    }
  }
}
