/** Simulator: ger samma data som riktiga sensorer, men styrd av reglage/pekare. */
import { eulerFromHeadingPitch, wrap360 } from '../geo/orientation';
import type { SensorSource, SourceReading } from './source';

export interface SimPlace {
  name: string;
  lat: number;
  lon: number;
}

export class SimSource implements SensorSource {
  readonly kind = 'sim' as const;
  readonly errors: string[] = [];

  lat: number;
  lon: number;
  /** sann riktning (grader från norr) */
  headingDeg = 0;
  /** 0 = upprätt mot horisonten, +upp, −90 = platt med blicken nedåt */
  pitchDeg = -35;
  /** godtyckligt alpha-origo, som på iOS; filtret ska rätta upp det mot kompassen */
  alphaOriginDeg = 137;
  /** kompassbrus ± grader */
  compassNoiseDeg = 6;
  /** webkitCompassAccuracy att rapportera (negativ = okalibrerad) */
  compassAccuracy = 10;
  /** hastighet för simulerad tid: 0 = paus */
  timeScale = 1;
  gpsAccuracy = 8;
  private timeMs: number;

  constructor(place: SimPlace, startTime: Date = new Date()) {
    this.lat = place.lat;
    this.lon = place.lon;
    this.timeMs = startTime.getTime();
  }

  get time(): Date {
    return new Date(this.timeMs);
  }
  setTime(d: Date): void {
    this.timeMs = d.getTime();
  }
  teleport(p: SimPlace): void {
    this.lat = p.lat;
    this.lon = p.lon;
  }
  /** flytta i meter relativt nuvarande riktning (fram, höger) */
  move(forwardM: number, rightM: number): void {
    const h = (this.headingDeg * Math.PI) / 180;
    const east = forwardM * Math.sin(h) + rightM * Math.cos(h);
    const north = forwardM * Math.cos(h) - rightM * Math.sin(h);
    this.lat += north / 111194.9;
    this.lon += east / (111194.9 * Math.cos((this.lat * Math.PI) / 180));
  }
  look(dHeadingDeg: number, dPitchDeg: number): void {
    this.headingDeg = wrap360(this.headingDeg + dHeadingDeg);
    this.pitchDeg = Math.max(-90, Math.min(90, this.pitchDeg + dPitchDeg));
  }

  read(dt: number): SourceReading {
    this.timeMs += dt * 1000 * this.timeScale;
    const { alpha, beta, gamma } = eulerFromHeadingPitch(this.headingDeg, this.pitchDeg, this.alphaOriginDeg);
    const noise = (Math.random() * 2 - 1) * this.compassNoiseDeg;
    return {
      position: { lat: this.lat, lon: this.lon, accuracy: this.gpsAccuracy },
      orientation: {
        alpha,
        beta,
        gamma,
        screenAngle: 0,
        compass: wrap360(this.headingDeg + noise),
        compassAccuracy: this.compassAccuracy,
      },
      now: new Date(this.timeMs),
    };
  }

  stop(): void {}
}
