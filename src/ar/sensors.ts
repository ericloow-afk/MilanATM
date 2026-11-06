/** Riktiga sensorer i iPhone-Safari: kamera, GPS, orientering. Kräver HTTPS och anropas från en knapptryckning. */
import type { OrientationSample } from './filter';
import type { SensorSource, SourceReading } from './source';

type PermissionApi = { requestPermission?: () => Promise<'granted' | 'denied'> };
type OrientationEventIOS = DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number };

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

function screenAngle(): number {
  const a = screen.orientation?.angle;
  if (typeof a === 'number') return a;
  const w = (window as unknown as { orientation?: number }).orientation;
  return typeof w === 'number' ? w : 0;
}

export class RealSource implements SensorSource {
  readonly kind = 'real' as const;
  readonly errors: string[] = [];
  private position: SourceReading['position'] = null;
  private orientation: OrientationSample | null = null;
  private watchId: number | null = null;
  private stream: MediaStream | null = null;
  private onOrient = (e: Event) => {
    const ev = e as OrientationEventIOS;
    if (ev.alpha == null || ev.beta == null || ev.gamma == null) return;
    this.orientation = {
      alpha: ev.alpha,
      beta: ev.beta,
      gamma: ev.gamma,
      screenAngle: screenAngle(),
      compass: ev.webkitCompassHeading ?? null,
      compassAccuracy: ev.webkitCompassAccuracy ?? null,
    };
  };

  /**
   * Måste anropas direkt från ett klick. Orienteringstillståndet begärs FÖRST och synkront
   * (iOS kräver användargest), därefter kamera och GPS utan await emellan.
   */
  start(video: HTMLVideoElement): Promise<void> {
    if (!window.isSecureContext) this.errors.push('Inte HTTPS: kamera och sensorer fungerar inte.');
    const api = DeviceOrientationEvent as unknown as PermissionApi;
    const orientationReq = typeof api.requestPermission === 'function' ? api.requestPermission() : Promise.resolve('granted' as const);
    const camera = this.startCamera(video);
    this.startGps();
    return Promise.all([
      orientationReq.then(
        (r) => {
          if (r !== 'granted') this.errors.push('orientation: tillstånd nekat');
          else window.addEventListener('deviceorientation', this.onOrient);
        },
        (e) => this.errors.push(`orientation: ${errText(e)}`),
      ),
      camera,
    ]).then(() => undefined);
  }

  private async startCamera(video: HTMLVideoElement): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = this.stream;
      await video.play();
    } catch (e) {
      this.errors.push(`getUserMedia: ${errText(e)}`);
    }
  }

  private startGps(): void {
    if (!('geolocation' in navigator)) {
      this.errors.push('geolocation: saknas');
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (p) => {
        this.position = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy };
      },
      (err) => this.errors.push(`geolocation: kod ${err.code}: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
  }

  read(): SourceReading {
    return { position: this.position, orientation: this.orientation, now: new Date() };
  }

  stop(): void {
    window.removeEventListener('deviceorientation', this.onOrient);
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.watchId = null;
    this.stream = null;
  }
}
