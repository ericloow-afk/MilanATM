/** Kartans klocka: live eller spolad (simulerad) tid. Ren TS; väggklockan skickas in så att den går att testa. */
export class MapClock {
  private live = true;
  private baseSim: number;
  private baseWall: number;
  private rate = 1;

  constructor(wallMs: number = Date.now()) {
    this.baseSim = wallMs;
    this.baseWall = wallMs;
  }

  get isLive(): boolean {
    return this.live;
  }
  /** 0 = pausad. I live-läge alltid 1. */
  get scale(): number {
    return this.live ? 1 : this.rate;
  }
  get paused(): boolean {
    return !this.live && this.rate === 0;
  }

  nowMs(wallMs: number): number {
    return this.live ? wallMs : this.baseSim + (wallMs - this.baseWall) * this.rate;
  }
  now(wallMs: number): Date {
    return new Date(this.nowMs(wallMs));
  }

  /** Byt hastighet utan att tiden hoppar. ×1 i live-läge ändrar ingenting; annars lämnas live-läget. */
  setScale(scale: number, wallMs: number): void {
    if (this.live && scale === 1) return;
    const cur = this.nowMs(wallMs);
    this.live = false;
    this.baseSim = cur;
    this.baseWall = wallMs;
    this.rate = scale;
  }

  /** Sätt en viss tid. Klockan går vidare i nuvarande hastighet (×1 om den var live eller pausad). */
  setTime(date: Date, wallMs: number): void {
    const keep = this.live || this.rate === 0 ? 1 : this.rate;
    this.live = false;
    this.baseSim = date.getTime();
    this.baseWall = wallMs;
    this.rate = keep;
  }

  pause(wallMs: number): void {
    this.setScale(0, wallMs);
  }
  resume(wallMs: number): void {
    this.setScale(1, wallMs);
  }

  goLive(wallMs: number): void {
    this.live = true;
    this.baseSim = wallMs;
    this.baseWall = wallMs;
    this.rate = 1;
  }
}
