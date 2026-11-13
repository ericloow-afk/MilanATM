/** Källa som levererar det en funktion ger. För mock i dev (?rt=mock) och tester; inget nätanrop. */
import type { RealtimeObservation, RealtimeSource } from './types';

export class ScriptedSource implements RealtimeSource {
  readonly enabled = true;
  constructor(
    readonly id: string,
    readonly kind: RealtimeSource['kind'],
    private fn: (now: number) => RealtimeObservation[] | Promise<RealtimeObservation[]>,
    readonly minIntervalMs = 0,
  ) {}
  async observe(now: number): Promise<RealtimeObservation[]> {
    return this.fn(now);
  }
}
