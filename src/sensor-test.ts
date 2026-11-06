import { CSV_HEADER, csvRow, formatReading, rateHz, type Reading } from './format';

type PermissionApi = { requestPermission?: () => Promise<'granted' | 'denied'> };

const video = document.getElementById('cam') as HTMLVideoElement;
const out = document.getElementById('out') as HTMLPreElement;
const consoleEl = document.getElementById('console') as HTMLPreElement;
const csvBox = document.getElementById('csv') as HTMLTextAreaElement;
const startBtn = document.getElementById('start') as HTMLButtonElement;
const recBtn = document.getElementById('rec') as HTMLButtonElement;
const copyBtn = document.getElementById('copy') as HTMLButtonElement;

const reading: Reading = {
  secure: window.isSecureContext,
  hasOrientationPermissionApi:
    typeof (DeviceOrientationEvent as unknown as PermissionApi).requestPermission === 'function',
  status: { orientation: 'ej startad', camera: 'ej startad', gps: 'ej startad' },
  hz: 0,
  now: Date.now(),
};

// Försök låsa till stående (stöds inte i iOS-Safari; då gäller iOS orienteringslås i kontrollcentret).
try {
  void (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
    .lock?.('portrait')
    .catch(() => {});
} catch {
  /* ignoreras */
}

// --- on-screen-konsol ---
const logLines: string[] = [];
function logError(source: string, e: unknown) {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  logLines.push(`${new Date().toLocaleTimeString('sv-SE')} ${source}: ${msg}`);
  if (logLines.length > 6) logLines.shift();
  consoleEl.textContent = 'konsol:\n' + logLines.join('\n');
}
window.addEventListener('error', (e) => logError('window', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => logError('promise', e.reason));

// --- rendering ---
const orientStamps: number[] = [];
function render() {
  const now = Date.now();
  reading.now = now;
  reading.hz = rateHz(orientStamps, now);
  if (orientStamps.length > 200) orientStamps.splice(0, orientStamps.length - 200);
  out.textContent = formatReading(reading);
  requestAnimationFrame(render);
}

// --- sensorer ---
async function startOrientation() {
  try {
    // Måste anropas först i klick-handlern, medan användargesten är aktiv (iOS).
    const api = DeviceOrientationEvent as unknown as PermissionApi;
    if (typeof api.requestPermission === 'function') {
      const res = await api.requestPermission();
      if (res !== 'granted') {
        reading.status.orientation = 'nekad';
        logError('orientation', 'tillstånd nekat');
        return;
      }
    }
    window.addEventListener('deviceorientation', (e) => {
      const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number };
      const ts = Date.now();
      orientStamps.push(ts);
      reading.orient = {
        alpha: ev.alpha,
        beta: ev.beta,
        gamma: ev.gamma,
        compass: ev.webkitCompassHeading ?? null,
        compassAccuracy: ev.webkitCompassAccuracy ?? null,
        ts,
      };
    });
    reading.status.orientation = 'OK (väntar på data)';
  } catch (e) {
    reading.status.orientation = 'fel';
    logError('orientation', e);
  }
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    reading.status.camera = 'OK';
  } catch (e) {
    reading.status.camera = 'fel';
    logError('getUserMedia', e);
  }
}

function startGps() {
  if (!('geolocation' in navigator)) {
    reading.status.gps = 'saknas';
    logError('geolocation', 'API saknas');
    return;
  }
  reading.status.gps = 'väntar på position…';
  navigator.geolocation.watchPosition(
    (p) => {
      reading.gps = {
        lat: p.coords.latitude,
        lon: p.coords.longitude,
        accuracy: p.coords.accuracy,
        speed: p.coords.speed,
        heading: p.coords.heading,
        ts: Date.now(),
      };
      reading.status.gps = 'OK';
    },
    (err) => {
      reading.status.gps = 'fel';
      logError('geolocation', `kod ${err.code}: ${err.message}`);
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
  );
}

// --- inspelning ---
const REC_MS = 30_000;
const REC_INTERVAL = 200;
let rows: string[] = [];
let recTimer: number | undefined;

function stopRecording() {
  clearInterval(recTimer);
  recTimer = undefined;
  recBtn.disabled = false;
  recBtn.textContent = `Spela in 30 s (${rows.length} rader)`;
  copyBtn.disabled = rows.length === 0;
}

recBtn.addEventListener('click', () => {
  rows = [];
  csvBox.style.display = 'none';
  recBtn.disabled = true;
  copyBtn.disabled = true;
  const t0 = Date.now();
  recTimer = window.setInterval(() => {
    const now = Date.now();
    rows.push(csvRow(now, reading.gps, reading.orient));
    recBtn.textContent = `Spelar… ${Math.ceil((REC_MS - (now - t0)) / 1000)} s`;
    if (now - t0 >= REC_MS) stopRecording();
  }, REC_INTERVAL);
});

copyBtn.addEventListener('click', async () => {
  const csv = [CSV_HEADER, ...rows].join('\n');
  try {
    await navigator.clipboard.writeText(csv);
    copyBtn.textContent = 'Kopierat!';
  } catch (e) {
    logError('urklipp', e);
    // Reserv: visa CSV i ett textfält som kan markeras och kopieras manuellt.
    csvBox.value = csv;
    csvBox.style.display = 'block';
    csvBox.focus();
    csvBox.select();
    copyBtn.textContent = 'Markera & kopiera ovan';
  }
});

startBtn.addEventListener('click', () => {
  startBtn.disabled = true;
  recBtn.disabled = false;
  // Alla tre startas synkront från klicket (orientation först), inget await emellan.
  void startOrientation();
  void startCamera();
  startGps();
});

requestAnimationFrame(render);
