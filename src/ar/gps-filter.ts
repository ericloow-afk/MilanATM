/**
 * GPS-utjämning för AR-vyn (ren TS). Fältloggen från Dergano 8/11 visade hopp på 5–9 m mellan fixar
 * (t.ex. 9 m på 0,7 s) när man stod still; på perrongen vid Maciachini gav iOS bara gpsAcc 1414 m.
 *
 * Modell: 2D Kalman (positionen som slumpvandring) i lokala meter kring första fixen.
 * - Processbrus: gångfart. Varians per axel ökar med (walkSpeed · dt)² mellan fixar.
 * - Mätbrus: från fixens noggrannhet (gpsAcc² per axel; iOS anger en radie, ungefär 1σ).
 * - Fixar med gpsAcc > maxAccuracyM ignoreras helt (underjord, inomhus).
 * - Korrigeringen per uppdatering begränsas: aldrig fortare än maxSpeed (3 m/s) och vid täta fixar högst ca 2 m,
 *   så att positionen aldrig "springer" eller hoppar när man står still.
 * - Avviker flera fixar i rad långt från skattningen (eller efter ett långt uppehåll) startas filtret om på fixen.
 */
import { fromLocalMeters, toLocalMeters, type LatLonPoint } from '../geo/enu';

export interface GpsFix {
  lat: number;
  lon: number;
  /** gpsAcc i meter (iOS horizontalAccuracy) */
  accuracy: number;
  /** epoch-ms för fixen */
  t: number;
}

export interface GpsFilterConfig {
  /** fixar sämre än så här (m) används inte */
  maxAccuracyM: number;
  /** processbrus: gångfart (m/s) */
  walkSpeedMps: number;
  /** utskattningen flyttas aldrig snabbare än så här (m/s) */
  maxSpeedMps: number;
  /** vid täta fixar flyttas skattningen högst så här långt per uppdatering (m); vid glesa fixar gångfart · dt */
  maxStepM: number;
  /** golv för mätbruset (m), så att en orimligt säker fix inte låser filtret */
  minAccuracyM: number;
  /** en fix längre bort än max(gateM, gateSigma · σ) räknas som avvikande */
  gateM: number;
  gateSigma: number;
  /** så många avvikande fixar i rad startar om filtret */
  reinitAfter: number;
  /** längre uppehåll än så här (s) mellan godkända fixar startar om filtret */
  reinitAfterGapSec: number;
}

export const DEFAULT_GPS_CONFIG: GpsFilterConfig = {
  maxAccuracyM: 100,
  walkSpeedMps: 2,
  maxSpeedMps: 3,
  maxStepM: 2,
  minAccuracyM: 3,
  gateM: 60,
  gateSigma: 4,
  reinitAfter: 3,
  reinitAfterGapSec: 20,
};

export type GpsUpdate = 'init' | 'accepted' | 'ignored-accuracy' | 'duplicate' | 'outlier' | 'reinit';

export interface GpsEstimate {
  lat: number;
  lon: number;
  /** skattningens osäkerhet (m, 1σ per axel) */
  accuracy: number;
  /** senast godkända fix (epoch-ms) */
  t: number;
}

export class GpsFilter {
  readonly config: GpsFilterConfig;
  private origin: LatLonPoint | null = null;
  private x = 0;
  private y = 0;
  /** varians per axel (m²) */
  private P = 0;
  private lastT = 0;
  private lastRaw: GpsFix | null = null;
  private outliers = 0;

  constructor(cfg: Partial<GpsFilterConfig> = {}) {
    this.config = { ...DEFAULT_GPS_CONFIG, ...cfg };
  }

  get estimate(): GpsEstimate | null {
    if (!this.origin) return null;
    const p = fromLocalMeters(this.origin, this.x, this.y);
    return { lat: p.lat, lon: p.lon, accuracy: Math.sqrt(this.P), t: this.lastT };
  }

  reset(): void {
    this.origin = null;
    this.lastRaw = null;
    this.outliers = 0;
  }

  update(fix: GpsFix): GpsUpdate {
    const c = this.config;
    const prev = this.lastRaw;
    if (prev && prev.t === fix.t && prev.lat === fix.lat && prev.lon === fix.lon) return 'duplicate';
    this.lastRaw = fix;
    if (!(fix.accuracy <= c.maxAccuracyM)) return 'ignored-accuracy';
    const R = Math.max(fix.accuracy, c.minAccuracyM) ** 2;
    if (!this.origin) return this.init(fix, R, 'init');
    const dt = Math.max(0, (fix.t - this.lastT) / 1000);
    if (dt > c.reinitAfterGapSec) return this.init(fix, R, 'reinit');

    const m = toLocalMeters(this.origin, fix.lat, fix.lon);
    const Pp = this.P + (c.walkSpeedMps * dt) ** 2;
    const ix = m.east - this.x;
    const iy = m.north - this.y;
    const innov = Math.hypot(ix, iy);
    if (innov > Math.max(c.gateM, c.gateSigma * Math.sqrt(Pp + R))) {
      this.outliers++;
      if (this.outliers >= c.reinitAfter) return this.init(fix, R, 'reinit');
      this.P = Pp;
      this.lastT = fix.t;
      return 'outlier';
    }
    this.outliers = 0;
    const K = Pp / (Pp + R);
    let dx = K * ix;
    let dy = K * iy;
    const maxStep = Math.min(c.maxSpeedMps * dt, Math.max(c.maxStepM, c.walkSpeedMps * dt));
    const step = Math.hypot(dx, dy);
    if (step > maxStep) {
      dx *= maxStep / step;
      dy *= maxStep / step;
    }
    this.x += dx;
    this.y += dy;
    this.P = (1 - K) * Pp;
    this.lastT = fix.t;
    return 'accepted';
  }

  private init(fix: GpsFix, R: number, kind: 'init' | 'reinit'): GpsUpdate {
    this.origin = { lat: fix.lat, lon: fix.lon };
    this.x = 0;
    this.y = 0;
    this.P = R;
    this.lastT = fix.t;
    this.outliers = 0;
    return kind;
  }
}

/**
 * GPS-läget för HUD och banner.
 * - weak: senaste användbara fix har noggrannhet över 30 m ("Svag GPS", tågen visas ändå).
 * - noFix: ingen användbar fix (gpsAcc > 100 m eller ingen alls) i mer än 5 s ("Är du på en perrong?").
 */
export class GpsStatus {
  private badSince: number | null;
  lastAccuracy: number | null = null;

  constructor(
    startedAt: number,
    private weakAboveM = 30,
    private unusableAboveM = 100,
    private noFixAfterMs = 5000,
  ) {
    this.badSince = startedAt;
  }

  /** Anropas för varje avläsning (även utan fix: accuracy = null). */
  update(now: number, accuracy: number | null): void {
    this.lastAccuracy = accuracy;
    const usable = accuracy != null && accuracy <= this.unusableAboveM;
    if (usable) this.badSince = null;
    else if (this.badSince == null) this.badSince = now;
  }

  get weak(): boolean {
    return this.lastAccuracy != null && this.lastAccuracy > this.weakAboveM && this.lastAccuracy <= this.unusableAboveM;
  }

  noFix(now: number): boolean {
    return this.badSince != null && now - this.badSince > this.noFixAfterMs;
  }
}
