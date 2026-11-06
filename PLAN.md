# Milano Metro AR – plan för MVP/prototyp (webb-AR på iPhone)

Mål: en webbapp som du öppnar i Safari på iPhone, riktar mot marken och ser tunnelbanetågen på M1–M5 "under fötterna". Inspirerad av Subwhere (Stockholm) av Stefan Almqvist. Omfattning: **bara MVP och prototyp**. Ingen App Store, ingen backend, ingen realtid i första versionen.

## 1. Utgångsläge

**Data (verifierat 2026-11-06)**
- Officiell statisk GTFS: `https://dati.comune.milano.it/gtfs.zip` (ATM, metro/spårvagn/buss, licens CC BY 4.0 enligt datasetsidan DS929). Ingen officiell GTFS-Realtime hittad.
- ATM-realtid finns bara som oofficiell webb-backend: `POST https://giromilano.atm.it/proxy.tpportal/proxy.ashx`, body `url=tpPortal/geodata/pois/stops/{stop_id}`, svar med `Lines[]` (`BookletUrl2` = linje, `WaitMessage` = "in arrivo" / "N min"). Väntetid per station, inga fordonspositioner. **Inte testat än** (min miljö blockerade anropet); kör probe-skriptet själv.
- Referensprojektet `Planetech0071/milanopt` (MIT) använder detta, men förfalskar webbläsarheaders och har en inkopierad session-cookie. Kopiera inte det. Dess "fordon" är bara punkter vid stationer ("in arrivo").
- Git LFS-filerna i repot saknas (~130-byte pekare). Hämta GTFS själv. `FINAL.json` är riktig men verkar ha bara en gren av M1/M2. Använd GTFS som sanning.

**Beslut: schema som bas.** Tågpositioner beräknas från tidtabellen. UI märker dem "enligt tidtabell". Realtid är utanför MVP.

## 2. Plattform: webb-AR

iPhone-Safari saknar WebXR, men har det som behövs för en enkel AR-upplevelse:
- `getUserMedia` (kamerabild)
- `geolocation` (GPS)
- `DeviceOrientationEvent` med tillstånd (telefonens lutning och kompass; iOS ger `webkitCompassHeading`)
- three.js för 3D ovanpå kameravyn

**Krav och fallgropar**
- Kamera och sensorer kräver **HTTPS**. Testa genom att deploya till GitHub Pages, Netlify eller Cloudflare Pages, inte via `http://192.168.x.x`.
- iOS kräver att sensortillstånd begärs i en knapptryckning (`DeviceOrientationEvent.requestPermission()`).
- Träffsäkerheten är sämre än ARKit: kompassen darrar och GPS i gatukanjoner kan vara fel med flera meter. Därför: släta ut heading, visa GPS-noggrannhet, och ha en manuell "vrid kalibrering"-justering.
- Detta är en prototyp. Nästa steg (efter Stefan) är native ARKit.

## 3. Arkitektur

```
tools/build-metro.mjs  gtfs.zip ─▶ public/metro.json   (M1–M5 endast)
src/engine/            TrainEngine: trains(at: Date) -> Train[]   (ren TS, testad)
src/geo/               lat/lon ↔ lokala meter, avstånd, bäring
src/depth/             depth.json: djup per linje, märkt estimate:true
src/map/               2D-karta med rörliga tåg  (reservdemo)
src/ar/                kamera + sensorer + three.js
```

Stack: TypeScript, Vite, Vitest, three.js, MapLibre GL eller Leaflet (välj det enklaste). En enda språk för både dataskript och app.

**Positionsmotor:** `metro.json` innehåller stationer, shapes per linje/riktning, trips med tider (sekunder från midnatt, kan överstiga 86400) och kalender. Motorn hittar aktiva trips, interpolerar längs shapen mellan stationerna, hanterar uppehåll, och ger linje, riktning, lat/lon, kurs, hastighet.

**Djup:** GTFS saknar djup. MVP använder ett värde per linje i `depth.json`, märkt `estimate: true`. Researcha riktiga värden senare, hitta inte på dem.

**AR-geometri:** räkna ut varje tågs position som meter öst/nord relativt användaren, sätt y = −djup, och rotera three.js-kameran med enhetens orientering (alpha/beta/gamma) korrigerad med `webkitCompassHeading`. Rita bara tåg inom ca 300 m. Visa pilar eller etiketter för tåg utanför bild.

## 4. Faser (varje fas = en Claude Code-session)

**Fas 0 – Riskkoll (en kväll)**
1. Kör `node tools/probe-atm.mjs <stop_id>` (eller `probe_atm.py`) och spara resultat i `docs/atm-probe.md`. Endast dokumentation, ingen byggd beroende.
2. Bygg en minimal testsida (kamera + kompass + GPS som text) och öppna den på iPhone över HTTPS. *Detta avgör om webbspåret fungerar.*
3. Ladda ner GTFS och validera: finns M1–M5, ser `shapes.txt` rimliga ut, täcker kalendern dagens datum?
*Klart när:* sensortestet visar heading och GPS på din telefon och GTFS-kontrollen är dokumenterad.

**Fas 1 – Data**
`build-metro.mjs` → `public/metro.json`. Enhetstester: alla 5 linjer finns, tider monotona, tider över 24:00 hanteras.
*Klart när:* "nästa 5 avgångar på M2 från Garibaldi" stämmer mot ATM:s app.

**Fas 2 – TrainEngine (testdriven)**
*Klart när:* test visar tåg vid rätt station vid rätt sekund, inga tåg utanför servicetid, rätt service_id för vardag/helg.

**Fas 3 – Karta (reservdemo)**
Kartvy med linjefärger (M1 röd, M2 grön, M3 gul, M4 blå, M5 lila), rörliga tåg, tryck på tåg visar linje/riktning/nästa station.
*Klart när:* fungerar på mobil och desktop. Detta är det du visar om AR strular.

**Fas 4 – AR**
Kameravy, sensortillstånd, three.js-lager, tåg på djup under fötterna, heading-utjämning, manuell kalibrering, GPS-noggrannhetsindikator.
*Klart när:* du står vid en riktig station och ser ett tåg dyka upp i ungefär rätt riktning och takt.

**Fas 5 – Deploy och demo**
Publicera på HTTPS, lägg till som hemskärmsikon (PWA-manifest), "Om"-vy med attribution, kort demoskript.
*Klart när:* du kan öppna länken på telefonen utomhus och visa upp den.

## 5. Risker

| Risk | Åtgärd |
|---|---|
| Kompassdrift gör att tågen hamnar fel | Utjämning, manuell kalibrering, tydlig "ungefärlig"-märkning |
| GPS-fel i gatukanjoner | Visa noggrannhet, rita tåg som zoner snarare än exakta punkter om nödvändigt |
| Djupdata saknas | Platshållare märkta `estimate: true` |
| iOS-sensorer nekas eller ej HTTPS | Fas 0 testar detta först; kartdemon som reserv |
| GTFS-feeden löper ut (giltighet i veckor) | Skriptet kan köras om; kontrollera `feed_info.txt` |
| Strejker syns inte i schemat | UI märker "enligt tidtabell" |

## 6. Utanför MVP (senare)
Realtid (ATM väntetider, via egen liten backend och med tillåtelse), native ARKit-app, riktiga tunneldjup, widgets, fler städer.

## 7. Licens och attribution
Milanos öppna data är CC BY 4.0: ange källa i "Om"-vyn. Kontrollera licensen på datasetsidan innan publik distribution. Behåller du kod från referensprojektet gäller MIT-texten.

## 8. Frågor till Stefan
- Hur löste du positioneringen i Subwhere (ARKit/ARCore geo tracking, egen lösning)?
- Var kommer tunneldjupen ifrån?
- Hur hanterar du städer utan öppen realtidsdata?
- Var ärlig med att Milano här är schemabaserat och webb-AR är ungefärligt.
