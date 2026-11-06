/**
 * Uppehållsmodell (ESTIMATE). Feeden har ankomst = avgång på alla metrostopp (se docs/dwell-report.md),
 * så utan modell rullar tågen igenom stationerna utan att stanna. Värdena här är UPPSKATTNINGAR, inte uppmätta,
 * och dokumenteras i docs/data-notes.md.
 *
 * Princip: den schemalagda AVGÅNGEN står kvar. Tåget ankommer `d` sekunder tidigare och står still till avgång,
 * så att körtiden före stationen kortas. `d` begränsas så att ingen körtid blir negativ eller orimligt kort.
 * Feedens egna uppehåll (> 0) används som de är.
 *
 * Filen är fristående (inga importer) så att Node-verktygen i tools/ kan läsa den direkt.
 */

export interface DwellConfig {
  /** alltid true: värdena är uppskattningar */
  estimate: true;
  /** vanlig station (s) */
  defaultSec: number;
  /** ändstation: tåget står så här länge före avgång från första stoppet och efter ankomst till sista (vändtid) */
  terminusSec: number;
  /** körtiden mellan två stationer får aldrig bli kortare än så här (s) */
  minTravelSec: number;
  /** uppehållet får ta högst den här andelen av den schemalagda körtiden före stationen */
  maxTravelShare: number;
  /** undantag per stop_id (s) */
  stations: Record<string, number>;
}

export const DEFAULT_DWELL: DwellConfig = {
  estimate: true,
  defaultSec: 22,
  terminusSec: 60,
  minTravelSec: 30,
  maxTravelShare: 0.35,
  stations: {
    // Bytesstationer och centrala stationer: längre uppehåll (uppskattning)
    'DUOMO M1': 35,
    'DUOMO M3': 35,
    'CENTRALE FS': 40,
    'CADORNA FN M1': 35,
    'CADORNA FN M2': 35,
    'LORETO M1': 35,
    'LORETO M2': 35,
    'LOTTO FIERAMILANOCITY': 32,
    'LOTTO M5': 32,
    'GARIBALDI FS': 35,
    ZARA: 30,
    'SAN BABILA': 32,
    'S.AMBROGIO': 30,
    'SAN AMBROGIO': 30,
    'P.TA GENOVA F.S.': 30,
    'LAMBRATE FS': 30,
    'ROGOREDO FS': 30,
    'CAIROLI': 28,
    'MONTENAPOLEONE': 28,
  },
};

export function dwellFor(cfg: DwellConfig, stopId: string): number {
  return cfg.stations[stopId] ?? cfg.defaultSec;
}

/** Effektiva tider för ett mönster, i sekunder relativt tripens schemalagda start. */
export interface Timing {
  /** ankomst per stopp */
  arr: number[];
  /** avgång per stopp (= schemalagd avgång) */
  dep: number[];
  /** tåget syns från (≤ arr[0]) */
  visibleFrom: number;
  /** tåget syns till (exklusivt; ≥ sista ankomsten) */
  visibleTo: number;
  /** true där uppehållet kommer från modellen (uppskattning) och inte från feeden */
  modelled: boolean[];
}

/**
 * Räknar fram effektiva ankomst-/avgångstider.
 * a = schemalagd ankomst relativt start, w = feedens uppehåll; cfg = null ger tidtabellen oförändrad.
 */
export function effectiveTiming(a: number[], w: number[], stopIds: string[], cfg: DwellConfig | null): Timing {
  const n = a.length;
  const dep = a.map((x, i) => x + w[i]);
  const arr = a.slice();
  const modelled = a.map(() => false);
  if (!cfg) return { arr, dep, visibleFrom: arr[0], visibleTo: a[n - 1], modelled };

  for (let i = 1; i < n - 1; i++) {
    if (w[i] > 0) continue; // feedens eget uppehåll
    const travel = a[i] - dep[i - 1];
    const maxD = Math.max(0, Math.min(travel - cfg.minTravelSec, travel * cfg.maxTravelShare));
    const d = Math.min(dwellFor(cfg, stopIds[i]), maxD);
    if (d > 0) {
      arr[i] = a[i] - d;
      modelled[i] = true;
    }
  }
  // Ändstationer: står före avgång och efter ankomst (vändtid), om feeden inte redan har ett uppehåll där
  if (w[0] <= 0) {
    arr[0] = a[0] - cfg.terminusSec;
    modelled[0] = true;
  }
  const post = w[n - 1] > 0 ? w[n - 1] : cfg.terminusSec;
  dep[n - 1] = a[n - 1] + post;
  modelled[n - 1] = w[n - 1] <= 0;
  return { arr, dep, visibleFrom: arr[0], visibleTo: dep[n - 1], modelled };
}

/**
 * Rörelseprofil mellan två stationer: trapets (acceleration, marschfart, inbromsning) med samma ankomsttid.
 * u = andel av körtiden (0..1). Returnerar andel av sträckan p och relativ hastighet v (= dp/du, medel = 1).
 * rampFraction = andel av körtiden som går åt till acceleration (lika lång inbromsning), 0 < r ≤ 0,5.
 */
export function trapezoid(u: number, rampFraction: number): { p: number; v: number } {
  const x = Math.min(1, Math.max(0, u));
  const r = Math.min(0.5, Math.max(1e-6, rampFraction));
  const vmax = 1 / (1 - r);
  if (x < r) return { p: (vmax * x * x) / (2 * r), v: (vmax * x) / r };
  if (x > 1 - r) {
    const y = 1 - x;
    return { p: 1 - (vmax * y * y) / (2 * r), v: (vmax * y) / r };
  }
  return { p: vmax * (x - r / 2), v: vmax };
}

/** Rampens andel för en körtid: ca 18 s acceleration (metro ≈ 1 m/s²), högst 45 % av körtiden. */
export function rampFractionFor(travelSec: number): number {
  return Math.min(0.45, 18 / Math.max(travelSec, 1));
}
