/**
 * ManualSource: justering för hand ("Tåget kom nu"). Fungerar utan någon extern källa.
 * Observationerna sparas i localStorage och gäller i 20 minuter.
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
  ) {
    const saved = readJson<unknown[]>(store, key, []);
    this.items = Array.isArray(saved) ? saved.filter(isObservation) : [];
  }

  add(o: RealtimeObservation, now: number): void {
    this.items = [...this.prune(now), o];
    writeJson(this.store, this.key, this.items);
  }

  /** Observationer som inte gått ut. Utgångna tas bort ur lagringen. */
  list(now: number): RealtimeObservation[] {
    const kept = this.prune(now);
    if (kept.length !== this.items.length) {
      this.items = kept;
      writeJson(this.store, this.key, kept);
    }
    return this.items.slice();
  }

  observe(now: number): Promise<RealtimeObservation[]> {
    return Promise.resolve(this.list(now));
  }

  /** Tar bort den senaste observationen (ångra). */
  undoLast(now: number): RealtimeObservation | null {
    const kept = this.prune(now);
    const last = kept.pop() ?? null;
    this.items = kept;
    writeJson(this.store, this.key, kept);
    return last;
  }

  clear(): void {
    this.items = [];
    writeJson(this.store, this.key, []);
  }

  private prune(now: number): RealtimeObservation[] {
    // Utgång räknas på väggklockan: observationer äldre än 20 min (eller orimligt långt fram) tas bort
    return this.items.filter((o) => now - o.observedAt <= this.ttlMs && o.observedAt - now <= this.ttlMs);
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
