/** Datatyper för TrainEngine. Matchar public/metro.json (se tools/lib/build-metro-lib.mjs). Ren TS, inga DOM-beroenden. */

export type ShapeQuality = 'ok' | 'coarse';
export type LatLon = [lat: number, lon: number];

export interface MetroData {
  meta: { validFrom: string; validTo: string } & Record<string, unknown>;
  lines: { id: string; name: string; color: string | null }[];
  stops: { id: string; name: string; lat: number; lon: number }[];
  directions: { id: string; line: string; terminus: string; name: string }[];
  shapeGeoms: LatLon[][];
  shapes: Record<string, number>;
  patterns: {
    line: string;
    dir: number;
    shape: string;
    shapeQuality: ShapeQuality;
    /** index i `stops` */
    stops: number[];
    /** meter längs shapen från dess start, strikt växande */
    sd: number[];
    /** ankomst relativt tripens start (sekunder) */
    a: number[];
    /** uppehållstid (sekunder); avgång = a + w */
    w: number[];
  }[];
  services: { id: string; add: number[]; remove: number[] }[];
  /** [mönsterindex, tjänstindex, starttid i sekunder från midnatt (kan vara > 86400)] */
  trips: [pattern: number, service: number, start: number][];
}

export type DataStatus = 'ok' | 'expired' | 'notYetValid';

export interface Train {
  /** Stabilt id: mönster, tjänst, tjänstedygn och starttid. Samma tåg ger samma id mellan anrop. */
  id: string;
  /** linje-id, t.ex. "M2" */
  line: string;
  /** riktnings-id i `directions`, t.ex. "M2>ABBIATEGRASSO" */
  direction: string;
  lat: number;
  lon: number;
  /** grader från norr, medsols, [0, 360) */
  headingDeg: number;
  /** m/s; 0 under uppehåll */
  speedMps: number;
  /** stop_id. Under uppehåll är fromStation === toStation. */
  fromStation: string;
  toStation: string;
  /** 0..1 längs segmentet from→to (0 under uppehåll) */
  progress: number;
  status: 'moving' | 'dwelling';
  shapeQuality: ShapeQuality;
}
