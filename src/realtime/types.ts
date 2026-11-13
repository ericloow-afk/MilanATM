/**
 * Realtidslager: gemensamma typer. Ren TS, inga DOM-beroenden.
 *
 * Ett realtidsflöde (eller ingen alls) levererar observationer. src/engine/fuse.ts kombinerar dem med tidtabellen.
 * Utan observationer visar appen ren tidtabell, precis som tidigare.
 */

export type ObservationKind = 'arrival' | 'departure' | 'wait' | 'status';

/** Var tågets position kommer ifrån: ren tidtabell, justerad för hand, eller ett realtidsflöde. */
export type TrainSource = 'schedule' | 'adjusted' | 'live';

export interface RealtimeObservation {
  /** källans id, t.ex. "manual", "official-atm", "e015-status", "mock" */
  source: string;
  /** linje-id i metro.json, t.ex. "M2" */
  line: string;
  /** riktnings-id i metro.json (t.ex. "M2>GESSATE"), eller null om källan inte vet riktningen */
  direction: string | null;
  /** stop_id i metro.json, eller null (linjestatus) */
  stopId: string | null;
  kind: ObservationKind;
  /** epoch-ms då observationen gjordes eller publicerades */
  observedAt: number;
  /**
   * arrival, departure: epoch-ms då tåget ankom eller avgick.
   * wait: sekunder kvar till ankomst, räknat från observedAt.
   * status: linjestatus som text (visas, ändras inte; ATM:s E015-villkor förbjuder att datan ändras).
   */
  value: number | string;
  /** 0..1, hur säker källan är */
  confidence: number;
}

export interface RealtimeSource {
  /** samma id som i observationernas `source` */
  readonly id: string;
  /** manual = justering för hand, live = realtidsflöde, status = bara linjestatus */
  readonly kind: 'manual' | 'live' | 'status';
  /** Kortaste tid mellan två hämtningar (ms). 0 för lokala källor. Nätkällor: minst 30 000. */
  readonly minIntervalMs: number;
  /** false om källan saknar konfiguration (till exempel nyckel) och aldrig levererar något */
  readonly enabled: boolean;
  observe(now: number): Promise<RealtimeObservation[]>;
}

/** Observationer äldre än så här används inte (ren tidtabell). */
export const OBSERVATION_MAX_AGE_MS = 15 * 60_000;

/** Den tidpunkt observationen säger att tåget var (eller kommer att vara) vid stationen, i epoch-ms. null för status. */
export function eventTimeMs(o: RealtimeObservation): number | null {
  if (o.kind === 'status' || typeof o.value !== 'number' || !Number.isFinite(o.value)) return null;
  return o.kind === 'wait' ? o.observedAt + o.value * 1000 : o.value;
}

/** Stabil nyckel för en observation (för cache och dubblettkontroll). */
export function observationKey(o: RealtimeObservation): string {
  return `${o.source}|${o.line}|${o.direction ?? ''}|${o.stopId ?? ''}|${o.kind}|${o.observedAt}|${o.value}`;
}
