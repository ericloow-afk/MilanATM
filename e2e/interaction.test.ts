/**
 * Interaktionstest: varje knapp i startsidan, kartvyn och AR-vyn ska gå att trycka på (touch, 390×844).
 * För varje knapp kontrolleras att elementFromPoint(mittpunkt) är knappen eller ett barn till den, alltså att den inte är
 * övertäckt och inte har pointer-events: none. Därefter trycks den med riktig touch och effekten verifieras.
 *
 * Kör: npm run test:ui  (kräver Chrome eller Edge; sätt CHROME_PATH om den inte hittas. E2E_REQUIRE=1 gör att testet
 * misslyckas i stället för att hoppas över när ingen webbläsare finns.)
 */
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((p): p is string => !!p);
const exe = CANDIDATES.find((p) => existsSync(p));
if (!exe && process.env.E2E_REQUIRE) throw new Error('Ingen Chrome/Edge hittades (sätt CHROME_PATH).');

let server: ViteDevServer;
let browser: Browser;
let base = '';

beforeAll(async () => {
  if (!exe) return;
  process.env.NO_SSL = '1'; // ren http på localhost (localhost räknas som säker kontext)
  server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  base = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
  browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function newPage(opts: { width?: number; height?: number } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 390, height: opts.height ?? 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    geolocation: { latitude: 45.4642, longitude: 9.19, accuracy: 10 },
    permissions: ['geolocation', 'camera'],
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    // Räkna anrop till platstjänsten så att testet kan se att platsknappen faktiskt ber om position
    const w = window as unknown as { __geo: number };
    w.__geo = 0;
    const g = navigator.geolocation;
    const orig = g.watchPosition.bind(g);
    g.watchPosition = (...a) => {
      w.__geo++;
      return orig(...a);
    };
  });
  return { ctx, page };
}

interface Hit {
  ok: boolean;
  pointerEvents: string;
  hit: string;
  x: number;
  y: number;
}

/** Är elementets mittpunkt tryckbar? (inte övertäckt, ingen pointer-events: none, inom skärmen) */
async function hittable(page: Page, selector: string): Promise<Hit> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return { ok: false, pointerEvents: '', hit: `saknas: ${sel}`, x: 0, y: 0 };
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    const ok = !!hit && (hit === el || el.contains(hit)) && getComputedStyle(el).pointerEvents !== 'none' && r.width > 0 && r.height > 0;
    return { ok, pointerEvents: getComputedStyle(el).pointerEvents, hit: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 40)}#${hit.id}` : 'ingenting', x, y };
  }, selector);
}

async function expectHittable(page: Page, selector: string): Promise<Hit> {
  const h = await hittable(page, selector);
  expect(h.ok, `${selector} är övertäckt eller har pointer-events: none (träffar ${h.hit}, pointer-events ${h.pointerEvents})`).toBe(true);
  return h;
}

/** Tryck med riktig touch på elementets mittpunkt. */
async function tap(page: Page, selector: string): Promise<void> {
  const h = await expectHittable(page, selector);
  await page.touchscreen.tap(h.x, h.y);
}

/** Alla synliga knappar och knapplänkar i nuvarande läge ska vara tryckbara (markörer och etiketter undantas). */
async function sweep(page: Page, label: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>('button, a.btn, input:not([type=hidden]), summary').forEach((el) => {
      if (el.closest('.tm, .label, [hidden]')) return;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') return;
      // Knappar som rullats ur en rullbar panel (eller klipps av den) räknas inte som synliga
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p);
        if (/(auto|scroll|hidden)/.test(o.overflowX + o.overflowY) && p !== document.body && p !== document.documentElement) {
          const pr = p.getBoundingClientRect();
          if (cx < pr.left || cx > pr.right || cy < pr.top || cy > pr.bottom) return;
        }
      }
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) {
        out.push(`${el.tagName.toLowerCase()}#${el.id}.${String(el.className).slice(0, 30)} utanför skärmen`);
        return;
      }
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === el || el.contains(hit)) || cs.pointerEvents === 'none') {
        out.push(`${el.tagName.toLowerCase()}#${el.id}.${String(el.className).slice(0, 30)} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}" täcks av ${hit ? hit.tagName.toLowerCase() + '.' + String(hit.className).slice(0, 30) : 'ingenting'}`);
      }
    });
    return out;
  });
  expect(bad, `${label}: övertäckta eller otryckbara knappar`).toEqual([]);
}

const skip = !exe;
describe.skipIf(skip)('startsidan (390×844, touch)', () => {
  it('knapparna och länkarna går att trycka på och leder rätt', async () => {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/`);
    await sweep(page, 'startsidan');
    for (const [sel, url] of [
      ['a.btn.primary', /\/map\.html$/],
      ['a.btn.secondary', /\/ar\.html\?sim=1$/],
      ['header a.nowrap', /\/ar\.html$/],
      ['footer a', /\/sensor-test\.html$/],
    ] as const) {
      await page.goto(`${base}/`);
      await tap(page, sel);
      await page.waitForURL(url);
    }
    await ctx.close();
  });
  it('länken "AR-vyn" bryts inte på två rader (390 och 375 px)', async () => {
    for (const width of [390, 375]) {
      const { ctx, page } = await newPage({ width, height: 800 });
      await page.goto(`${base}/`);
      const rects = await page.evaluate(() => document.querySelector('header a.nowrap')!.getClientRects().length);
      expect(rects, `bruten på ${width} px`).toBe(1);
      await ctx.close();
    }
  });
  it('texten under "Vad som saknas" är den nya och nämner inget inofficiellt gränssnitt', async () => {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/`);
    const text = await page.locator('#h-missing + p').innerText();
    expect(text).toBe('Realtid för M1–M5. Ingen öppen realtidskälla för tunnelbanan hittades. ATM:s webbtjänst ger bara väntetider för buss och tram, inte för metro.');
    expect(text).not.toMatch(/inofficiell/i);
    await ctx.close();
  });
});

describe.skipIf(skip)('kartvyn (390×844, touch)', () => {
  async function openMap(): Promise<{ ctx: BrowserContext; page: Page }> {
    const r = await newPage();
    await r.page.goto(`${base}/map.html`);
    await r.page.waitForSelector('.sheet');
    await r.page.waitForSelector('#bar-btn');
    return r;
  }

  it('alla knappar är tryckbara i grundläget', async () => {
    const { ctx, page } = await openMap();
    await sweep(page, 'kartan, grundläge');
    await ctx.close();
  });

  it('listknappen (Visa tåglistan) fäller upp bottenpanelen', async () => {
    const { ctx, page } = await openMap();
    expect(await page.locator('.sheet').getAttribute('data-state')).toBe('peek');
    await tap(page, 'button[aria-label="Visa tåglistan"]');
    await expect.poll(() => page.locator('.sheet').getAttribute('data-state')).toBe('half');
    await tap(page, 'button[aria-label="Visa tåglistan"]');
    await expect.poll(() => page.locator('.sheet').getAttribute('data-state')).toBe('peek');
    await ctx.close();
  });

  it('platsknappen (Visa min position) ber om position och flyttar kartan', async () => {
    const { ctx, page } = await openMap();
    await page.evaluate(() => (window as unknown as { __map: { jumpTo(o: unknown): void } }).__map.jumpTo({ center: [9.3, 45.55], zoom: 11 }));
    await tap(page, 'button[aria-label="Visa min position"]');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __geo: number }).__geo)).toBeGreaterThan(0);
    await expect
      .poll(() => page.evaluate(() => { const c = (window as unknown as { __map: { getCenter(): { lat: number; lng: number } } }).__map.getCenter(); return Math.hypot(c.lat - 45.4642, c.lng - 9.19); }), { timeout: 10_000 })
      .toBeLessThan(0.02);
    await ctx.close();
  });

  it('fältet i toppen öppnar detaljer och klockkontrollen fungerar', async () => {
    const { ctx, page } = await openMap();
    await tap(page, '#bar-btn');
    await expect.poll(() => page.locator('#bar-panel').isVisible()).toBe(true);
    expect(await page.locator('#bar-btn').getAttribute('aria-expanded')).toBe('true');
    expect(await page.locator('#bar-panel').innerText()).toMatch(/Giltig till \d+ \w+ \d{4}/);
    await sweep(page, 'kartan, toppfältets panel öppen');
    await tap(page, '#bar-panel button[data-scale="10"]');
    await expect.poll(() => page.locator('#bar-note').innerText()).toContain('spolad ×10');
    await tap(page, '#bar-panel button[data-act="live"]');
    await expect.poll(() => page.locator('#bar-note').innerText()).toBe('');
    await tap(page, '#bar-btn');
    await expect.poll(() => page.locator('#bar-panel').isVisible()).toBe(false);
    await ctx.close();
  });

  it('attributionsknappen är en enda 44×44-knapp, hopfälld på smal skärm, fäller ut vid tryck och täcker inte bottenpanelen', async () => {
    const { ctx, page } = await openMap();
    const sel = '.attrib button';
    const box = (await page.locator(sel).boundingBox())!;
    expect(Math.round(box.width)).toBe(44);
    expect(Math.round(box.height)).toBe(44);
    await expect.poll(() => page.locator('#attrib-panel').isVisible()).toBe(false);
    await tap(page, sel);
    await expect.poll(() => page.locator('#attrib-panel').isVisible()).toBe(true);
    expect(await page.locator(sel).getAttribute('aria-expanded')).toBe('true');
    const panel = (await page.locator('#attrib-panel').boundingBox())!;
    const sheet = (await page.locator('.sheet').boundingBox())!;
    expect(panel.y + panel.height, 'panelen ligger över bottenpanelen').toBeLessThanOrEqual(sheet.y + 0.5);
    expect(box.y + box.height, 'knappen ligger över bottenpanelen').toBeLessThanOrEqual(sheet.y + 0.5);
    expect(await page.locator('#attrib-panel').innerText()).toMatch(/OpenFreeMap/);
    expect(await page.locator('#attrib-panel').innerText()).toMatch(/OpenStreetMap/);
    await tap(page, sel);
    await expect.poll(() => page.locator('#attrib-panel').isVisible()).toBe(false);
    await ctx.close();
  });

  it('kontrollerna överlappar varandra och bottenpanelen inte; zoomknapparna är dolda på touch', async () => {
    const { ctx, page } = await openMap();
    const boxes = await Promise.all(
      ['button[aria-label="Visa tåglistan"]', 'button[aria-label="Visa min position"]', '.attrib button', '.sheet'].map(async (s) => (await page.locator(s).boundingBox())!),
    );
    const [list, locate, attrib, sheet] = boxes;
    const overlap = (a: typeof list, b: typeof list) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(overlap(list, locate)).toBe(false);
    expect(overlap(list, attrib)).toBe(false);
    expect(overlap(locate, attrib)).toBe(false);
    for (const b of [list, locate, attrib]) expect(b.y + b.height).toBeLessThanOrEqual(sheet.y + 0.5);
    expect(await page.locator('.maplibregl-ctrl-zoom-in').isVisible()).toBe(false);
    await ctx.close();
  });

  it('bottenpanelens handtag och ett tåg i listan/på kartan går att trycka på', async () => {
    const { ctx, page } = await openMap();
    await tap(page, '.sheet-handle');
    await expect.poll(() => page.locator('.sheet').getAttribute('data-state')).toBe('half');
    // välj ett giltigt datum och tid så att tåg finns oavsett dagens datum
    await tap(page, '#bar-btn');
    await page.locator('#bar-date').fill('2026-11-06');
    await page.locator('#bar-time-in').fill('12:00');
    await tap(page, '#bar-btn');
    await page.waitForSelector('.list .row');
    await sweep(page, 'kartan, panelen halvt uppe med tåglista');
    await tap(page, '.list .row');
    await expect.poll(() => page.locator('#sel-title').count()).toBe(1);
    await expect.poll(() => page.locator('.sheet .head .lb').isVisible()).toBe(true);
    await tap(page, '[data-close]');
    await expect.poll(() => page.locator('#sel-title').count()).toBe(0);
    await ctx.close();
  });
});

describe.skipIf(skip)('AR-vyn (390×844, touch)', () => {
  it('startvyns knappar går att trycka på; Starta AR visar verktygsfältet med Kalibrera', async () => {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/ar.html`);
    await sweep(page, 'AR, startvy');
    await tap(page, '#s-real');
    await expect.poll(() => page.locator('#start').isVisible()).toBe(false);
    await expect.poll(() => page.locator('#b-cal').isVisible()).toBe(true);
    await sweep(page, 'AR, sensorläge');
    await tap(page, '#b-cal');
    await expect.poll(() => page.locator('#cal').isVisible()).toBe(true);
    await sweep(page, 'AR, kalibreringspanel öppen');
    await tap(page, '#cal-close');
    await expect.poll(() => page.locator('#cal').isVisible()).toBe(false);
    await ctx.close();
  });

  it('Simulator öppnar simulatorläget med nedfällbar panel som är stängd som standard', async () => {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/ar.html`);
    await tap(page, '#s-sim');
    await expect.poll(() => page.locator('#simsheet').isVisible()).toBe(true);
    await expect.poll(() => page.locator('#sim-body').isVisible()).toBe(false);
    await tap(page, '#sim-handle');
    await expect.poll(() => page.locator('#sim-body').isVisible()).toBe(true);
    await sweep(page, 'AR, simulatorpanelen öppen');
    await tap(page, '#sim-a button[data-a="20"]');
    expect(await page.locator('#sim-a button[data-a="20"]').getAttribute('aria-pressed')).toBe('true');
    await tap(page, '#sim-ts button[data-ts="10"]');
    expect(await page.locator('#sim-ts button[data-ts="10"]').getAttribute('aria-pressed')).toBe('true');
    await tap(page, '#sim-places button[data-i="1"]');
    expect(await page.locator('#sim-places button[data-i="1"]').getAttribute('aria-pressed')).toBe('true');
    await tap(page, '#sim-handle');
    await expect.poll(() => page.locator('#sim-body').isVisible()).toBe(false);
    await ctx.close();
  });

  it('HUD-raden fäller ut tekniken och Verktyg fäller ut utvecklarknapparna', async () => {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/ar.html?sim=1`);
    await page.waitForSelector('#hud-btn');
    await expect.poll(() => page.locator('#hud-details').isVisible()).toBe(false);
    await tap(page, '#hud-btn');
    await expect.poll(() => page.locator('#hud-details').isVisible()).toBe(true);
    expect(await page.locator('#hud-details').innerText()).toMatch(/Bygge/);
    await tap(page, '#hud-btn');
    await expect.poll(() => page.locator('#tools').isVisible()).toBe(false);
    await tap(page, '#b-tools');
    await expect.poll(() => page.locator('#tools').isVisible()).toBe(true);
    await sweep(page, 'AR, verktyg öppna');
    await tap(page, '#b-rec');
    await expect.poll(() => page.locator('#b-mark').isEnabled()).toBe(true);
    await ctx.close();
  });

  it('Verktyg-knappen ser inte inaktiverad ut: samma textfärg och full opacitet som övriga kontroller', async () => {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/ar.html`);
    await tap(page, '#s-real');
    const style = (sel: string) => page.evaluate((s) => { const cs = getComputedStyle(document.querySelector(s)!); return { color: cs.color, opacity: cs.opacity }; }, sel);
    const tools = await style('#b-tools');
    const cal = await style('#b-cal');
    expect(tools).toEqual(cal);
    expect(tools.opacity).toBe('1');
    await ctx.close();
  });

  it('kantindikatorerna ligger minst 8 px innanför skärmkanten', async () => {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/ar.html?sim=1`);
    await page.waitForSelector('#sim-handle');
    await tap(page, '#sim-handle');
    // gå till ett giltigt datum och 12:00 så att tåg finns, och titta bort från dem för att få kantindikatorer
    await tap(page, '#sim-tp button[data-tp="noon"]');
    await page.waitForSelector('.label', { timeout: 15_000 });
    for (const heading of [0, 90, 180, 270]) {
      await page.locator('#sim-h').evaluate((el, v) => { (el as HTMLInputElement).value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, heading);
      await page.waitForTimeout(400);
      const rects = await page.evaluate(() => [...document.querySelectorAll('.label.arrow')].map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
      for (const r of rects) {
        expect(r.l, `vänsterkant vid riktning ${heading}`).toBeGreaterThanOrEqual(7.5);
        expect(r.r, `högerkant vid riktning ${heading}`).toBeLessThanOrEqual(390 - 7.5);
        expect(r.t, `överkant vid riktning ${heading}`).toBeGreaterThanOrEqual(7.5);
      }
    }
    await ctx.close();
  });
});
