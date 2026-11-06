# CLAUDE.md – Milano Metro AR (webb-prototyp)

Prototyp: visa tågen på Milanos tunnelbana (M1–M5) i AR i iPhone-Safari. Läs `PLAN.md` först. Arbeta en fas i taget. Omfattning är bara MVP/prototyp.

## Regler
- Data från officiell GTFS: `https://dati.comune.milano.it/gtfs.zip`. Ladda ner till `data/raw/` (gitignorerad).
- Tågpositioner beräknas från tidtabell i webbläsaren (`TrainEngine`). Ingen backend. Ingen realtid i MVP.
- ATM:s Giromilano-endpoint är **oofficiell**. Skicka aldrig förfalskade webbläsarheaders eller återanvänd cookies. Ärligt `User-Agent`, max 1 anrop/s. Kräver den cookie eller blockerar: stoppa och rapportera, kringgå inte.
- Hitta inte på djupvärden. Platshållare märks `estimate: true`.
- GTFS-tider kan vara över 24:00:00. Hantera det.
- Visa attribution (CC BY 4.0, Comune di Milano / ATM) i appens "Om"-vy.

## Stack
TypeScript, Vite, Vitest, three.js, MapLibre GL (eller Leaflet). Dataskript i Node (`tools/*.mjs`). Allt i ett språk.

## Webb-AR på iOS
- Kamera, geolocation och sensorer kräver HTTPS. Testa på riktig iPhone via deploy eller HTTPS-tunnel, inte `http://` på lokalnätet.
- `DeviceOrientationEvent.requestPermission()` måste anropas från en knapptryckning.
- Kompassriktning: `webkitCompassHeading` på iOS. Släta ut (lågpassfilter). Ge användaren manuell kalibrering.

## Kommandon
- Utveckla: `npm run dev`
- Test: `npm test`
- Bygg data: `node tools/build-metro.mjs data/raw/gtfs.zip`
- Probe ATM: `node tools/probe-atm.mjs <stop_id>`

## Arbetssätt
- Skriv test först för `TrainEngine` och geo-matematiken.
- Avsluta varje fas med att klart-kriteriet i `PLAN.md` är uppfyllt; notera i `docs/progress.md`.
- Håll beroenden få. Fråga innan du lägger till nya tunga bibliotek.
