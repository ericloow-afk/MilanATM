/**
 * StatusSource: linjestatus (E015 "Stato Linee Metropolitane 2.0", ATM). Ger bara status per linje, aldrig tågpositioner.
 *
 * E015 kräver ett anslutningsavtal (se docs/realtime-sources.md) och dess svarsformat är inte publikt. Källan läser
 * därför ett eget, enkelt JSON-format (nedan) som en lokal adapter/proxy kan översätta till. Utan URL och nyckel är
 * källan avstängd och levererar ingenting. Testerna och ?rt=mock (bara i dev) använder fixturen
 * src/realtime/fixtures/line-status.sample.json, som är påhittad testdata.
 *
 * ATM:s villkor: datan får inte ändras, och tidpunkten för senaste uppdatering ska visas. Texten skickas därför vidare
 * oförändrad i `value`, och `observedAt` är källans uppdateringstid.
 *
 * Format:
 *   { "updatedAt": "2026-11-13T22:15:00Z", "lines": [ { "line": "M1", "status": "regolare", "message": "..." } ] }
 */
import { getJson, type HttpConfig } from './http';
import type { RealtimeObservation, RealtimeSource } from './types';

export interface LineStatusPayload {
  updatedAt: string | number;
  lines: { line: string; status: string; message?: string }[];
}

export function parseLineStatus(json: unknown, sourceId = 'e015-status'): RealtimeObservation[] {
  const p = json as Partial<LineStatusPayload> | null;
  if (!p || !Array.isArray(p.lines)) return [];
  const t = typeof p.updatedAt === 'number' ? p.updatedAt : Date.parse(String(p.updatedAt ?? ''));
  if (!Number.isFinite(t)) return [];
  return p.lines
    .filter((l) => l && typeof l.line === 'string' && typeof l.status === 'string')
    .map((l) => ({
      source: sourceId,
      line: l.line,
      direction: null,
      stopId: null,
      kind: 'status' as const,
      observedAt: t,
      value: l.message ? `${l.status}: ${l.message}` : l.status,
      confidence: 1,
    }));
}

export interface StatusConfig extends Partial<HttpConfig> {
  /** källans id (standard e015-status; mock i dev använder ett eget) */
  id?: string;
  /** ersätter nätanropet (tester, mock med fixture) */
  load?: () => Promise<unknown>;
}

export class StatusSource implements RealtimeSource {
  readonly id: string;
  readonly kind = 'status' as const;
  readonly minIntervalMs = 60_000;
  readonly enabled: boolean;

  constructor(private cfg: StatusConfig) {
    this.id = cfg.id ?? 'e015-status';
    this.enabled = !!cfg.load || !!(cfg.url && cfg.apiKey);
  }

  async observe(): Promise<RealtimeObservation[]> {
    if (!this.enabled) return [];
    const json = this.cfg.load ? await this.cfg.load() : await getJson(this.cfg as HttpConfig);
    return parseLineStatus(json, this.id);
  }
}
