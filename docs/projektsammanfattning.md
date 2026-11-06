# Milano Metro AR – sammanfattning av arbetet

Prototyp som visar tågen på Milanos tunnelbana (M1–M5) i webbläsaren: som karta och som AR-vy i iPhone-Safari. Positionerna beräknas ur tidtabellen (officiell GTFS) i webbläsaren, utan backend och utan realtid. Status: 2026-11-06.

**Publicerad sida:** `https://ericloow-afk.github.io/MilanATM/` (GitHub Pages). Sidor: `map.html` (karta), `ar.html` (AR, `?sim=1` för simulator), `sensor-test.html` (sensortest).

## 1. Fas 0 – Riskkoll
- **Sensortest** (`sensor-test.html`, `src/sensor-test.ts`): kamera, GPS och kompass (`webkitCompassHeading`) som text över kamerabilden. Verifierad på iPhone i Safari över HTTPS (inomhus): GPS ca ±9 m, kompass ca ±12–15°, alpha/beta/gamma fungerar. Har inspelning av en CSV-rad var 200 ms, markeringsknapp, on-screen-konsol och byggtid.
- **Deploy:** GitHub Actions bygger och publicerar `dist/` till GitHub Pages vid push till `main`. Dev-server med självsignerat HTTPS för test över nätverket.
- **GTFS-validering** (`tools/inspect-gtfs.mjs`, `docs/gtfs-notes.md`): feeden har M1–M5, men `calendar.txt` är tom (all tjänstedata i `calendar_dates`), `direction_id` är tom, och feeden gäller bara **26 okt–30 nov 2026**. 3 av 33 shapes är mycket grova (4–9 punkter, 58 trips).
- **ATM-probe** (`docs/atm-probe.md`): inte gjord. Du kör proben själv och klistrar in resultatet.

## 2. Fas 1 – Data
- `tools/build-metro.mjs` (`npm run build:data`) strömmar `stop_times.txt` och skriver `public/metro.json` (277 KB, gzip 49 KB): linjer, stationer med rensade visningsnamn, riktningar (tripens sista station), deduplicerade shapes, mönster (stoppföljd, `sd` = distans längs shapen, relativa ankomst-/uppehållstider, `shapeQuality`), tjänster (add/remove-datum) och trips `[mönster, tjänst, start]`.
- Kvalitetskontroller: `sd` strikt växande, stationer >30 m från shapen rapporteras (Garibaldi FS 72 m och Cascina Gobba 39 m på M2), validTo = det senare av `mm_end_date` och sista tillagda datum.
- Test: alla 7 884 trips återskapas förlustfritt ur mönstren mot originalfilen (noll skillnader).
- `npm run next -- --line M2 --stop Garibaldi` skriver nästa avgångar. **Klart-kriteriet (jämförelse mot ATM:s app) är inte uppfyllt förrän du har jämfört själv.**

## 3. Fas 2 – TrainEngine (`src/engine`, `src/geo`)
- `trains(data, at)`, `dataStatus()` (`ok`/`expired`/`notYetValid`), Europe/Rome-tid, tider över 24:00 från föregående tjänstedygn, tjänst ur `calendar_dates`, tripens eget `shape_id`, `shapeQuality` följer med.
- Geo-matematik i `src/geo`: haversine, bäring, position längs shape, lokala meter, kvaternioner.
- Hastighetsrapport (`node tools/segment-speeds.mjs`, `docs/segment-speed-report.md`): inga segment över 25 m/s eller under 1 m/s.

## 4. Fas 4 – AR-vy (`ar.html`, `src/ar`)
- Kameravideo + transparent three.js-canvas, tåg inom 300 m som block i linjefärg på −15 m (**platshållardjup, `estimate: true`, inte researchat**), lodlinjer, marknivårutnät, etiketter, kantpilar, tryck på tåg ger info.
- **Orientering:** kvaternion ur alpha/beta/gamma (three.js-formeln), slerp-utjämning i kvaternionrymd, yaw-offset som korrigeras långsamt mot kompassen, manuell kalibrering (dra), kompassreferens (kamerans riktning upprätt, skärmens överkant platt).
- **Simulatorläge** (`?sim=1`): reglage för position, riktning, lutning, alpha-origo, kompassbrus, tidsspolning, förinställda stationer.
- **Fältlogg:** Spela in 30 s, Markera, Kopiera logg (CSV), byggtid i HUD.
- **Filter mot riktig logg** (`docs/filter-replay.md`, `npm run replay`): grindar för kompassen (headingAcc ≤ 25°, kamerahöjd ≤ 20°, vinkelhastighet ≤ 120°/s, innovationsgräns 45°), accuracy-viktad förstärkning, alla parametrar i `DEFAULT_FILTER_CONFIG` (`tauYaw` 5 s). Replay-testerna a–d går igenom mot din inomhuslogg (`test/fixtures/sensor-log-indoor-2026-11-06.csv`). Fynd: det "släp" som syntes vid snabb vridning kom till stor del från att gamma saknades i `heading + alpha`.

## 5. Design och kartvy
- **Designriktning "Strata × Duomo"** (`src/styles/tokens.css`, `docs/design.md`): mörk grafit, marmorvit text, aqua-accent, guld bara för ordmärket och "0 m"-markeringen (aldrig för valt tåg), spetsbåge och gavel som formmotiv, vit ring för valt tåg. Mobil först: tryckytor ≥ 44 px, safe areas, `dvh`, `prefers-reduced-motion`.
- **Kartvy** (`map.html`, `src/map`): MapLibre GL 6.16 med egen ljus/mörk stil över **OpenFreeMap**. Linjer i GTFS-färg, stationsprickar med namn som tonar in, tåg som markörer med linjebricka och riktningspil, pulserande ring vid uppehåll, bottenpanel (peek/half/full) för valt tåg med nedräkning och framsteg, klockkontroll (live/spola), utfällbar chip för tidtabellens giltighet, "Min position", tomma lägen och fel (natt, utgången tidtabell, ingen GPS, tiles fail), synlig felbanner.
- **Fix efter iPhone-test:** MapLibres worker-fil saknades på GitHub Pages (404), vilket gjorde att varken kartbakgrund eller linjer ritades. Pekas nu ut med `setWorkerUrl`.

## 6. Rörelse och realism (F1)
- Feeden har **0 s uppehåll på alla 187 478 stopphändelser** (`docs/dwell-report.md`), så tågen rullade igenom stationerna.
- **Uppehållsmodell** (`src/engine/dwell.ts`, `docs/data-notes.md`, `estimate: true`): 22 s standard, 28–40 s på bytes-/centrala stationer, 60 s vändtid vid ändstationer. Avgångstiderna står kvar, körtiden kortas högst 35 % och aldrig under 30 s.
- **Trapetsprofil** (acceleration, marschfart, inbromsning) med samma ankomsttid.
- **Rendering per bildruta:** `activeTrips()` en gång per sekund, `positionAt()` per `requestAnimationFrame` från en kontinuerlig klocka.
- Dold FPS-/JS-mätare (långtryck på klockan eller `?perf=1`).

## 7. Tester och kommandon
| Kommando | Gör |
|---|---|
| `npm run dev` | dev-server (självsignerat HTTPS) |
| `npm test` | 212 tester (Vitest) |
| `npm run build` | `tsc` + produktionsbygge till `dist/` |
| `npm run build:data` | bygger `public/metro.json` ur `data/raw/gtfs.zip` |
| `npm run next -- --line M2 --stop Garibaldi` | nästa avgångar |
| `npm run replay` | filter-replay → `docs/filter-replay.md` |
| `node tools/dwell-report.mjs` | uppehållsrapport |
| `node tools/segment-speeds.mjs` | hastighetsrapport |

Ren http på localhost för desktop-test (webbläsarpanelen litar inte på det självsignerade certifikatet): `$env:NO_SSL="1"; npx vite --port 5180`.

## 8. Kända begränsningar och öppna punkter
- **Feeden gäller bara till 2026-11-30.** Efter det visar appen "tidtabellen har gått ut". Datan måste hämtas och byggas om (`npm run build:data`).
- **Allt är uppskattningar där det står `estimate: true`:** tunneldjup (15 m, samma för alla linjer), uppehållstider och rörelseprofil. Inget av det är uppmätt.
- **Grova spårgeometrier** (3 shapes) ritas streckade och märks "ungefärlig". Garibaldi FS och Cascina Gobba ligger 72 m och 39 m från M2:s shape.
- **Ej verifierat på enhet:** kartvyns rörelse och FPS på iPhone, AR-vyn utomhus (kompassreferensen platt/upprätt, FOV 60° är en gissning, GPS mot verkligt spår), touch-drag av bottenpanelen.
- **Ej gjort:** ATM-proben (`docs/atm-probe.md`), jämförelse av nästa avgångar mot ATM:s app, "Om"-vy med attribution och PWA/hemskärm (Fas 5).
- **Ej pushat:** den senaste committen (AR-filtret och replay-testerna) är stagad men inte pushad, eftersom pushen blockerades. Kör `git commit` och `git push origin main` själv.
- **Realtid ligger utanför MVP.** ATM:s Giromilano-endpoint är oofficiell; skicka aldrig förfalskade headers eller återanvänd cookies.

## 9. Källor och licens
- Tidtabell: Comune di Milano / ATM, CC BY 4.0 (`https://dati.comune.milano.it/gtfs.zip`).
- Bakgrundskarta: OpenFreeMap, © OpenMapTiles, data från OpenStreetMap (attribution visas i kartan).
- Bibliotek: three.js, MapLibre GL, Vite, Vitest, TypeScript, fflate.

## 10. Dokument i `docs/`
`progress.md` (löpande logg per fas), `gtfs-notes.md`, `metro-build-report.md`, `segment-speed-report.md`, `dwell-report.md`, `data-notes.md`, `design.md`, `filter-replay.md`, och den här filen.
