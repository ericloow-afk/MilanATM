import type { OrientationSample } from './filter';

export interface SourceReading {
  /** t = fixens tidpunkt (epoch-ms), så att varje ny fix kan kännas igen */
  position: { lat: number; lon: number; accuracy: number; t?: number } | null;
  orientation: OrientationSample | null;
  /** "nu" – riktig klocka, eller simulerad tid */
  now: Date;
}

/** Gemensamt gränssnitt för riktiga sensorer och simulatorn. */
export interface SensorSource {
  readonly kind: 'real' | 'sim';
  /** fel/varningar att visa i on-screen-konsolen */
  readonly errors: string[];
  /** dt = sekunder sedan förra anropet (simulatorn använder det för att spola tiden) */
  read(dt: number): SourceReading;
  stop(): void;
}
