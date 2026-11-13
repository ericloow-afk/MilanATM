/**
 * ManualSource: justering för hand ("Tåget kom nu"). Fungerar utan någon extern källa.
 *
 * Två klockor:
 * - Väggklockan bestämmer vad som sparas i localStorage: observationer äldre än 20 min (verklig tid) tas bort.
 * - Vyns klocka (verklig tid på kartan, simulerad tid i AR-simulatorn) bestämmer vad som levereras: bara
 *   observationer inom 20 min från vyns "nu". En observation gjord i simulatorn kl. 12:00 sparas därför inte
 *   permanent, men gäller medan simulatorn står nära 12:00, och raderar aldrig riktiga observationer.
 */
import { readJson, writeJson, type KeyValueStore } from './store';
import type { RealtimeObservation, RealtimeSource } from './types';

export const MANUAL_TTL_MS = 20 * 60_000;
export const MANUAL_KEY = 'mmar.realtime.manual.v1';
/** Hur säker en knapptryckning är (personen ser tåget, men trycker kanske några sekunder sent) */
export const MANUAL_CONFIDENCE = 0.8;

const isObservation = (o: unknown): o is RealtimeObservation => {
  const x = o as RealtimeObservation;
  return !!x && typeof x.line === 'string' && typeof x.observedAt === 'number' && typeof x.kind === 'string';
};

export class ManualSource implements RealtimeSource {
  readonly id = 'manual';
  readonly kind = 'manual' as const;
  readonly minIntervalMs = 0;
  readonly enabled = true;
  private items: RealtimeObservation[];

  constructor(
    private store: KeyValueStore | null,
    private key = MANUAL_KEY,
    private ttlMs = MANUAL_TTL_MS,
    private wallNow: () => number = () => Date.now(),
  ) {
    const saved = readJson<unknown[]>(store, key, []);
    this.items = (Array.isArray(saved) ? saved.filter(isObservation) : []).filter((o) => this.freshByWall(o));
  }

  add(o: RealtimeObservation, now: number): void {
    this.housekeep(now);
    this.items.push(o);
    this.persist();
  }

  /** Observationer inom 20 min från `now` (vyns klocka). */
  list(now: number): RealtimeObservation[] {
    this.housekeep(now);
    return this.items.filter((o) => now - o.observedAt <= this.ttlMs && o.observedAt - now <= this.ttlMs);
  }

  observe(now: number): Promise<RealtimeObservation[]> {
    return Promise.resolve(this.list(now));
  }

  /** Tar bort den senast tillagda observationen (ångra). */
  undoLast(_now?: number): RealtimeObservation | null {
    const last = this.items.pop() ?? null;
    this.persist();
    return last;
  }

  clear(): void {
    this.items = [];
    writeJson(this.store, this.key, []);
  }

  private freshByWall(o: RealtimeObservation): boolean {
    const w = this.wallNow();
    return w - o.observedAt <= this.ttlMs && o.observedAt - w <= this.ttlMs;
  }

  /** Släpper observationer som är för gamla både på väggklockan och vyns klocka; sparar om något togs bort. */
  private housekeep(now: number): void {
    const keep = this.items.filter((o) => this.freshByWall(o) || Math.abs(now - o.observedAt) <= this.ttlMs);
    if (keep.length !== this.items.length) {
      this.items = keep;
      this.persist();
    }
  }

  /** Bara observationer som är färska på väggklockan sparas (simulatorns påhittade tider sparas inte). */
  private persist(): void {
    writeJson(this.store, this.key, this.items.filter((o) => this.freshByWall(o)));
  }
}

/** Observation för knappen "Tåget kom nu": tåget ankommer till stationen just nu. */
export function trainArrivedNow(p: { line: string; direction: string; stopId: string; now: number }): RealtimeObservation {
  return {
    source: 'manual',
    line: p.line,
    direction: p.direction,
    stopId: p.stopId,
    kind: 'arrival',
    observedAt: p.now,
    value: p.now,
    confidence: MANUAL_CONFIDENCE,
  };
}
