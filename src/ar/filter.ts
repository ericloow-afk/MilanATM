/**
 * Orienteringsfilter: slerp-utjämning i kvaternionrymd + yaw-offset-komplementärfilter mot kompassen. Ren TS.
 *
 * - Kvaternionen byggs av ALLA tre vinklarna (alpha, beta, gamma) i varje sample och slätas i kvaternionrymd.
 *   Vinklarna slätas aldrig var för sig (de hoppar nära beta ≈ 90° och ±180°, Euler-singularitet).
 * - Yaw-offseten ψ korrigeras långsamt mot kompassen. Kompassvärden används bara när alla grindar släpper igenom
 *   (se FilterConfig). Parametrarna samlas i ett objekt så att de är lätta att finjustera.
 * - Kompassreferensen räknas på den RÅA kvaternionen (samma ögonblick som kompassvärdet), inte den utjämnade.
 */
import { deviceQuaternion, qAngleBetween, qMul, qSlerp, referenceHeading, rotateVec, wrap180, yawQuaternion, type Quat } from '../geo/orientation';

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

/** Varför kompassen användes eller ignorerades i senaste samplet. */
export type CompassState = 'none' | 'uncalibrated' | 'inaccurate' | 'looking-up' | 'moving' | 'jump' | 'ok';

/** Alla justerbara parametrar på ett ställe. Ändra här (eller skicka delar av objektet till OrientationFilter). */
export interface FilterConfig {
  /** tidskonstant (s) för kvaternion-utjämning av vyn (50–150 ms är rimligt vid 60 Hz) */
  tauQ: number;
  /** tidskonstant (s) för yaw-korrigering mot kompassen: större = långsammare, lugnare. Ersätter "förstärkning": gain ≈ dt / tauYaw */
  tauYaw: number;
  /** kompass med sämre noggrannhet (grader) ignoreras */
  maxCompassAccuracy: number;
  /** under den här noggrannheten (grader) väger kompassen fullt; mellan den och maxCompassAccuracy tonas vikten ned */
  goodCompassAccuracy: number;
  /** lägsta vikt (0–1) precis under maxCompassAccuracy */
  minAccuracyWeight: number;
  /** kompass ignoreras när kameran tittar uppåt mer än så här (grader över horisonten; iOS-kompassen vänder ~170° vid beta ≈ 130–140°) */
  maxElevationDeg: number;
  /** kompass ignoreras när telefonen vrids snabbare än så här (grader/s; kompassen släpar vid snabba vridningar) */
  maxRateDegPerSec: number;
  /** avvisa en skattning som avviker mer än så här (grader) från nuvarande offset (innovationsgräns) */
  innovationLimitDeg: number;
  /** om skattningar avvisas oavbrutet så här länge (s) accepteras den nya nivån (offseten har flyttat sig på riktigt) */
  reacquireAfterSec: number;
}

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  tauQ: 0.1,
  tauYaw: 5,
  maxCompassAccuracy: 25,
  goodCompassAccuracy: 15,
  minAccuracyWeight: 0.25,
  maxElevationDeg: 20,
  maxRateDegPerSec: 120,
  innovationLimitDeg: 45,
  reacquireAfterSec: 4,
};

/** Bakåtkompatibelt alias: delmängd av FilterConfig. */
export type FilterOptions = Partial<FilterConfig>;

const R2D = 180 / Math.PI;

export class OrientationFilter {
  readonly config: FilterConfig;
  private qSmooth: Quat | null = null;
  private lastRaw: Quat | null = null;
  private yaw = 0;
  private manual = 0;
  private haveYaw = false;
  private jumpSec = 0;

  compassState: CompassState = 'none';
  /** senaste fel (grader) mellan kompass och skattning när kompassen användes, annars 0 */
  headingError = 0;
  /** senaste kameravinkelhastighet (grader/s) ur råa kvaternioner */
  rateDegPerSec = 0;
  /** senaste kamerahöjd över horisonten (grader) */
  elevationDeg = 0;

  constructor(opts: FilterOptions = {}) {
    this.config = { ...DEFAULT_FILTER_CONFIG, ...opts };
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
    const c = this.config;
    const raw = deviceQuaternion(s.alpha, s.beta, s.gamma, s.screenAngle);
    this.rateDegPerSec = this.lastRaw && dt > 1e-4 ? (qAngleBetween(this.lastRaw, raw) * R2D) / dt : 0;
    this.lastRaw = raw;
    this.elevationDeg = Math.asin(Math.max(-1, Math.min(1, rotateVec(raw, [0, 0, -1])[1]))) * R2D;
    this.qSmooth = this.qSmooth ? qSlerp(this.qSmooth, raw, 1 - Math.exp(-dt / c.tauQ)) : raw;

    this.headingError = 0;
    const reject = (state: CompassState) => {
      this.compassState = state;
      if (state !== 'jump') this.jumpSec = 0;
    };
    if (s.compass == null || Number.isNaN(s.compass)) return reject('none');
    if (s.compassAccuracy != null && s.compassAccuracy < 0) return reject('uncalibrated');
    if (s.compassAccuracy != null && s.compassAccuracy > c.maxCompassAccuracy) return reject('inaccurate');
    if (this.elevationDeg > c.maxElevationDeg) return reject('looking-up');
    if (this.rateDegPerSec > c.maxRateDegPerSec) return reject('moving');

    const e = wrap180(s.compass + this.manual - (referenceHeading(raw) + this.yaw));
    if (!this.haveYaw) {
      this.yaw += e; // första giltiga värdet: snappa
      this.haveYaw = true;
      this.compassState = 'ok';
      this.headingError = e;
      return;
    }
    if (Math.abs(e) > c.innovationLimitDeg) {
      this.jumpSec += dt;
      if (this.jumpSec > c.reacquireAfterSec) {
        this.yaw += e; // avvisades länge: offseten har flyttat sig, ta den nya nivån
        this.jumpSec = 0;
        this.compassState = 'ok';
        this.headingError = e;
      } else {
        this.compassState = 'jump';
      }
      return;
    }
    this.jumpSec = 0;
    this.compassState = 'ok';
    this.headingError = e;
    const acc = s.compassAccuracy;
    const w =
      acc == null || acc <= c.goodCompassAccuracy
        ? 1
        : Math.max(c.minAccuracyWeight, 1 - ((acc - c.goodCompassAccuracy) / Math.max(1e-6, c.maxCompassAccuracy - c.goodCompassAccuracy)) * (1 - c.minAccuracyWeight));
    this.yaw += (1 - Math.exp(-dt / c.tauYaw)) * w * e;
  }
}
