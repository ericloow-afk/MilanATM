# Progress

## Fas 0 – Riskkoll

| Punkt | Status |
|---|---|
| 1. ATM-probe (`docs/atm-probe.md`) | Väntar: användaren kör skriptet och klistrar in resultatet |
| 2. Sensortest-sida (kamera + GPS + kompass) | **Byggd och verifierad på iPhone** (Safari, HTTPS, inomhus). Utomhustestet återstår |
| 3. GTFS-validering | **Gjord 2026-11-06**, se `docs/gtfs-notes.md` (`tools/inspect-gtfs.mjs`). Viktigast: feeden gäller bara till 2026-11-30, `calendar.txt` är tom, `direction_id` är tom |

Klart-kriterium för punkt 2: sensortestet visar heading och GPS på din telefon över HTTPS. **Uppfyllt** (verifierat av användaren på iPhone i Safari över HTTPS, inomhus):
- Kamera fungerar (bakre).
- GPS fungerar, noggrannhet ca ±9 m inomhus.
- `webkitCompassHeading` fungerar, `webkitCompassAccuracy` ca ±12–15° inomhus.
- alpha/beta/gamma fungerar.

**Återstår:** utomhustestet (checklistan nedan): kompassriktning mot känd gata, 30 s-inspelning vid lutning, GPS-noggrannhet utomhus.

### Gjort
- Vite + TypeScript (vanilla), Vitest, three.js (används först i Fas 4).
- `sensor-test.html` + `src/sensor-test.ts`: knappen "Starta" begär, i klick-handlern, orientering (`DeviceOrientationEvent.requestPermission`), bakre kamera (`getUserMedia`) och GPS (`watchPosition`, high accuracy). Visar lat/lon, noggrannhet, `webkitCompassHeading`, alpha/beta/gamma och kamerabild som bakgrund. Varje API har egen statusrad med felnamn.
- Ren hjälpkod i `src/format.ts` med tester (`npm test`).
- `npm run build` ger `dist/` med relativ bas (`./`).
- GitHub Actions-workflow `.github/workflows/deploy.yml` deployar `dist/` till GitHub Pages vid push till `main`.

### Deploy till GitHub Pages (engångsuppsättning)
Mappen är inte ett git-repo än. Kör:

```bash
git init -b main
git add .
git commit -m "Fas 0: sensortest"
git remote add origin https://github.com/<användare>/<repo>.git   # skapa tomt repo på github.com först
git push -u origin main
```

Sedan på GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Fliken **Actions** visar bygget; när det är grönt finns sidan på:

`https://<användare>.github.io/<repo>/sensor-test.html`

(Om workflown redan körts före Pages-inställningen: kör om via Actions → "Run workflow".)

### Testa på iPhone
1. Öppna URL:en ovan i **Safari** (måste vara `https://`; hemskärms-PWA eller annan webbläsare kan bete sig annorlunda).
2. Tryck **Starta** och godkänn tre frågor: Kamera, Plats, Rörelse och orientering.
3. Du ska se kamerabild (bakre), lat/lon med noggrannhet i meter, och `webkitCompassHeading` som ändras när du vrider dig.

Felsökning:
- Första raden säger "NEJ" på HTTPS → du är på `http://`.
- Något "nekad": Inställningar → Safari → Kamera / Plats / Rörelse och orientering, eller ladda om och tryck Starta igen (iOS frågar ibland bara en gång per session; stäng fliken och öppna på nytt).
- Kompassen hoppar: håll telefonen borta från metall/magneter, rör den i en åtta.
- Ingen heading men alpha/beta/gamma finns: notera i checklistan, det påverkar Fas 4.

### Sensortestet – funktioner (uppdaterad)
- Orienteringsstatus byter till "tar emot data (X Hz)" när events kommer.
- Visar `webkitCompassAccuracy` (negativt = OKALIBRERAD), GPS-hastighet/riktning (ofta `–` när man står still), tidsstämpel på senaste orient- och GPS-event.
- "alpha-riktning" = (360 − alpha) mod 360 bredvid kompassriktningen, samt signerad skillnad (−180..180°).
- **Spela in 30 s**: en CSV-rad var 200 ms (`time,lat,lon,acc,heading,headingAcc,alpha,beta,gamma`). **Kopiera logg** lägger CSV i urklipp; om iOS vägrar visas den i ett textfält du kan markera och kopiera. Klistra in i chatten.
- On-screen-konsol längst ner visar fel från getUserMedia, geolocation, orientation och oväntade JS-fel (ingen webbinspektör behövs).
- Video: `playsinline`, `muted`, `facingMode: environment`. Safari på iOS kan inte låsa skärmrotation från webben: slå på **orienteringslås** i Kontrollcenter och håll telefonen stående.

### Öppna på mobildata (utomhus)
Dev-länken (`https://172.x.x.x:5174`) funkar bara på samma nät. Utomhus använder du GitHub Pages-adressen (se Deploy ovan): stäng av Wi-Fi på iPhone, öppna `https://<användare>.github.io/<repo>/sensor-test.html` i Safari på mobildata. Efter varje ändring måste du pusha till `main` och vänta tills Actions är grönt (ca 1 min); ladda om sidan (dra ned eller stäng fliken) så du inte får en cachad version.
**Status:** sensortestet har körts på iPhone över HTTPS (inomhus). Test på mobildata utomhus återstår.

### Utomhus-testchecklista
**(a) Riktning mot gata.** Slå upp en gata i en kartapp där du kan läsa av riktningen i grader (kartappens kompass eller mät mot norr). Stå vid gatan, håll telefonen upprätt och rikta den längs gatan. Läs `webkitCompassHeading` och `alpha-riktning`.
- [ ] Gatans riktning enligt karta: ___°  (och motsatt håll: ___°)
- [ ] `webkitCompassHeading`: ___°   skillnad mot kartan: ___°
- [ ] `webkitCompassAccuracy`: ___ (negativt = okalibrerad: rör telefonen i en åtta och prova igen)
- [ ] alpha-riktning: ___°  diff mot kompass: ___° (stabil eller driver den?)

**(b) Inspelning vid lutning.** Tryck "Spela in 30 s". Under tiden: håll telefonen upprätt (kameran mot gatan), luta långsamt ned tills kameran pekar mot marken, och tillbaka upp. Tryck "Kopiera logg" och klistra in CSV i chatten. Vi tittar på om heading hoppar, driver eller blir `–` när beta närmar sig 90° / 0°.
- [ ] Loggen kopierad och inklistrad

**(c) GPS-noggrannhet.**
- [ ] `noggrannhet` vid start: ±___ m; efter 30 s: ±___ m
- [ ] Plats: öppen/gatukanjon, antal sekunder till första fix: ___

### Checklista – grundtest (fyll i efter test)
- [x] Bakre kameran visas
- [x] GPS lat/lon visas, noggrannhet: ±9 m inomhus (utomhus: ___ m)
- [x] `webkitCompassHeading` fungerar, `webkitCompassAccuracy` ca ±12–15° inomhus (pekar rätt mot norr, utomhus: ___°)
- [x] alpha/beta/gamma fungerar
- [ ] iOS-version: ___

## Fas 1 – Data (byggd 2026-11-06, väntar på din jämförelse mot ATM:s app)
- `npm run build:data` (= `node tools/build-metro.mjs data/raw/gtfs.zip`) skriver `public/metro.json` (277 KB, gzip 49 KB) och `docs/metro-build-report.md`. `stop_times.txt` strömmas; hela filen hålls aldrig i minnet.
- Schema: lines, stops (id + rensat visningsnamn), directions (terminus), shapeGeoms + shapes (deduplicerade), patterns (stoppföljd, `sd`, `a` ankomst, `w` uppehåll, `shapeQuality`), services (add/remove per datum), trips `[mönster, tjänst, startsek]`.
- Test: `npm test` (29 st) inkl. förlustfri återskapning av alla 7884 metro-trips stop_times mot originalfilen (0 skillnader).
- Nästa avgångar: `npm run next -- --line M2 --stop Garibaldi [--date 2026-11-06 --time 12:00]`.
- **Klart-kriterium (ej uppfyllt förrän du jämfört):** "nästa 5 avgångar på M2 från Garibaldi" stämmer mot ATM:s app.

## Fas 2 – TrainEngine (byggd 2026-11-06)
- `src/geo` (haversine, bearing, shapeIndex/pointAlong, distanceToPolyline) och `src/engine` (`trains(data, at)`, `dataStatus`, `romeServiceTime`). Ren TS, samma plana projektion som `tools/lib/project.mjs`.
- Tester: 79 gröna totalt (geo 9, motor 36 inkl. 3 mot verkliga metro.json, hastighetsrapport 5, Fas 1-tester 20, övriga 9).
- Hastighetsrapport: `node tools/segment-speeds.mjs` → `docs/segment-speed-report.md`. 0 segment över 25 m/s eller under 1 m/s; median 7,7 m/s, min 2,8 (M2 Caiazzo → Loreto), max 16,3 (M4 Repetti → Linate).
- Känd begränsning: Rom-väggklocka för tjänstedygn (ingen exakt GTFS-hantering av dagar med sommartidsskifte; ingen sådan dag i feeden).

## Fas 4 – AR-vy (byggd 2026-11-06, ej testad på enhet)
- `ar.html` (`src/ar/*`): kameravideo + transparent three.js-canvas, tåg inom 300 m som block (90×3×3,5 m i linjefärg) på y = −djup, lodlinje + ring på marken, marknivårutnät (20 m och 5 m), etiketter, kantpilar, tryck/klick på etikett eller tåg ger info (linje, riktning, från→till, avstånd, km/h, djup uppskattat, "enligt tidtabell", "ungefärlig" vid grov shape), GPS-noggrannhet och kompasstatus i HUD, banner "tidtabellen har gått ut".
- Matematik i `src/geo` (`enu.ts`, `orientation.ts`) och `src/ar/filter.ts`, testad: kvaternion från alpha/beta/gamma (three.js-formeln), slerp-utjämning i kvaternionrymd, yaw-offset-komplementärfilter mot `webkitCompassHeading` (τ ≈ 5 s, snappar vid första giltiga värdet), kompass ignoreras vid noggrannhet < 0 eller > 25°, manuell kalibrering (dra i Kalibrera-panelen, sparas i localStorage). 133 tester gröna, `tsc` strikt ren, `npm run build` ok.
- Djup: `src/depth/depth.json`, enhetligt platshållarvärde 15 m för alla linjer, `estimate: true`, inte researchat.
- Simulator: `ar.html?sim=1` (eller knappen "Simulator"). Dra = titta runt, WASD/pilar = gå, reglage för riktning/lutning/alpha-origo/kompassbrus/kompassnoggrannhet, tidsspolning (⏸ ×1 ×10 ×60), 12:00/18:00/00:30, "Nästa tåg", förinställda stationer. Växla källa med knappen uppe till höger.
- Desktop-test: `https://localhost:5174/` är självsignerat och många webbläsare nekar det; kör i stället ren http på localhost: `$env:NO_SSL="1"; npx vite --port 5180` och öppna `http://localhost:5180/ar.html?sim=1`.

### Verifierat / ej verifierat
- Verifierat i simulatorn (desktop): scenen renderar, tåg syns under marknivå, kantpilar, etiketter, info-panel, tidsspolning, yaw-filtret rättar ett godtyckligt alpha-origo mot kompassen.
- **Ej verifierat på iPhone:** att `webkitCompassHeading` motsvarar kamerans riktning (upprätt) respektive överkantens riktning (platt) enligt hypotesen i `referenceHeading`; kamerans FOV (60° är en gissning, justera i Kalibrera); GPS mot verkligt spår; prestanda. Klart-kriterium Fas 4 (stå vid riktig station och se ett tåg i ungefär rätt riktning och takt) återstår.

### Fälttest Fas 4 (på iPhone)
1. Öppna `…/ar.html` över HTTPS, tryck "Starta AR", godkänn kamera/plats/rörelse.
2. Stå ute vid en station. Notera `kompass: ok/OKALIBRERAD` och "fel" i HUD.
3. Håll telefonen upprätt, rikta mot norr (kartapp). Röd linje på marken i bilden = norr enligt appen. Justera med Kalibrera (dra) om den pekar fel.
4. Luta telefonen från upprätt ned mot marken och tillbaka: stannar den röda linjen kvar åt samma håll? Om den vrider sig är referensriktningen fel: kopiera logg och rapportera.
5. Jämför tågens riktning/takt mot ATM-appen eller tidtabellen vid stationen.

### AR-vyns fältlogg och buildId
- **Spela in 30 s** (uppe till höger i `ar.html`): en CSV-rad var 200 ms. **Markera** lägger till en extra rad med `mark=1` vid exakt tryckögonblick (bara under inspelning). **Kopiera logg** lägger CSV i urklipp; om iOS vägrar visas ett markerat textfält att kopiera från. Klistra in CSV:n i chatten.
- Kolumner: `time,lat,lon,gpsAcc,rawCompassHeading,compassAcc,alpha,beta,gamma,filteredYawDeg,yawOffsetDeg,manualDeg,trainsInView,mark,source,buildId`. `filteredYawDeg` = appens skattade kamerariktning (referensriktningen: kamerans riktning upprätt, överkantens riktning platt), `yawOffsetDeg` = automatisk yaw mot kompassen, `manualDeg` = manuell kalibrering, `trainsInView` = tåg med etikett i bild. Tomma fält = värde saknas.
- **buildId** = byggtid (UTC) från Vite (`__BUILD_ID__`), syns på sista raden i HUD och i varje loggrad. Efter en deploy: ladda om (stäng fliken om Safari cachar) och kontrollera att tiden är ny. I dev sätts den när dev-servern startar.
- Inget sparas i localStorage utom manuell kalibrering, och det sker i try/catch.
- Test: `src/ar/log.test.ts` (8 tester). Provkört i simulatorn: CSV-format, markering, buildId och urklippsreserv fungerar; inspelning med riktiga bildrutor kräver att fliken är synlig (den dolda webbläsarpanelen pausar animation).

## Designspår D0 – Strata × Duomo (2026-11-06)
- `src/styles/tokens.css` (färger mörk/ljus, typografi, spacing, radier, skuggor, z-index, rörelse, Duomo-motiv) och `docs/design.md` (principer). Inte kopplat till några sidor än. Utvecklingen av AR (Fas 4 fälttest) är pausad.

## D1 – Kartvyn (2026-11-06)
- `map.html` + `src/map/*`: MapLibre GL 6.16 (nytt beroende, godkänt) med egen ljus/mörk stil ovanpå **OpenFreeMap** (vektor-tiles utan nyckel; attribution "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" + "Tidtabell: Comune di Milano / ATM (CC BY 4.0)" visas i attributionskontrollen). Färgerna läses ur `--map-*`-tokens och följer `prefers-color-scheme`. Bundle för kartsidan ≈ 1,1 MB (308 KB gzip).
- Linjer i GTFS-färg med mörk kontur (grov spårgeometri streckad), stationsprickar (bytesstationer större) med namn som tonar in vid zoom.
- Tåg som DOM-markörer: färgad cirkel med M1–M5, riktningspil, pulserande ring vid uppehåll, vit ring när valt (`--select-ring`). Motorn körs 1 gång/s med 1 s framförhållning och positionerna interpoleras mellan tick (`src/map/anim.ts`).
- Bottenpanel (peek/half/full, dra eller piltangenter) för valt tåg: linje, mot terminus, nästa station med nedräkning (avgång vid uppehåll), framsteg längs sträckan, stationsnummer, avstånd till mig. Utan val: lista över tåg närmast (dig/kartans mitt), som också är tangentbordsvägen till tågen.
- Klockkontroll (live/spola ×1/×10/×60, paus, datum och tid i Rom), badge "Positioner enligt tidtabell", giltighetsfält med dagar kvar, "Min position"-knapp, zoomknappar.
- Tomma lägen och fel: ingen trafik (nästa tåg + "Spola till första tåget"), tidtabell utgången/inte giltig än ("Visa en giltig dag"), ingen/nekad GPS, tiles som inte laddas (linjer och tåg visas ändå), metro.json som inte laddas (försök igen).
- Tillgänglighet: skip-länk, aria-label på alla kontroller och markörer, fokus flyttas till panelens rubrik vid val och tillbaka vid stängning (Esc), tåg nås via tåglistan, `prefers-reduced-motion` (ingen pulsering, ingen kamerasvep, ingen mjuk interpolation).
- Tester: klocka, animation, schema/nedräkning/giltighet, GeoJSON, trafik, panelens lägen. 175 tester gröna, `tsc` ren, `npm run build` ok.
- Verifierat i webbläsarpanelen (desktop och 375×812, mörkt och ljust): kartan renderar, tåg på linjerna, val av tåg och panel, nattläge, utgången tidtabell. **Ej verifierat på iPhone** (touch-drag av panelen, safe areas, prestanda med ~120 markörer, GPS). Ren http på localhost för desktop-test: `$env:NO_SSL="1"; npx vite --port 5180`, öppna `http://localhost:5180/map.html`.

### D1-fix efter iPhone-test (2026-11-06)
- **Orsak till tom karta på GitHub Pages:** Vites produktionsbygge kopierade inte MapLibres worker (`assets/maplibre-gl-worker.mjs` gav 404). Utan worker ritas varken tiles eller vår GeoJSON, bara DOM-markörerna. Åtgärd: workern importeras med `?url` och pekas ut med `setWorkerUrl` i `src/map/main.ts`; bygget innehåller nu `assets/maplibre-gl-worker-<hash>.mjs`. Verifierat med `vite preview` av produktionsbygget (lokalt), inte på Pages/iPhone än.
- Linjer/stationer läggs till vid `style.load` (och direkt om stilen redan är laddad), oberoende av tiles. Synlig felbanner för MapLibres error-händelser (tiles, glyfer, stil, worker, våra lager, JS-fel) med rubriken "Kartbakgrunden kunde inte laddas" vid tile-fel, plus vakthund efter 12 s.
- Bottenpanelens minimiläge visar bara handtag + rubrik; höjderna räknas från `visualViewport` + uppmätt safe area, och uppdateras när Safaris verktygsfält ändrar höjd.
- "Positioner enligt tidtabell" och giltigheten är nu en tryckbar chip som fäller ut detaljer (giltighet, status, källa, bygge).
- Tågprickar har ljus kontur på mörk karta (`--marker-outline`), mörk på ljus.
- 179 tester gröna, bygget ok.
