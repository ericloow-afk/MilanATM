# Datanoteringar: uppskattningar i motorn

## Uppehållsmodell (`estimate: true`)

**Varför:** Milanos GTFS-feed har ankomst = avgång på alla 187 478 metrostopp, även ändstationerna (se `docs/dwell-report.md`, `node tools/dwell-report.mjs`). Utan modell rullar tågen igenom stationerna utan att stanna, vilket inte stämmer med verkligheten.

**Var:** `src/engine/dwell.ts` (`DEFAULT_DWELL`). Motorn använder den som standard (`DEFAULT_OPTIONS`); `SCHEDULE_ONLY` ger tidtabellen exakt utan modell.

**Värden (uppskattningar, inte uppmätta):**
| Typ | Uppehåll |
|---|---|
| Vanlig station | 22 s |
| Bytes- och centrala stationer (Duomo, Centrale, Cadorna, Loreto, Lotto, Garibaldi, San Babila, Zara m.fl.) | 28–40 s, se tabellen i `dwell.ts` |
| Ändstation | 60 s före avgång från första stoppet och 60 s efter ankomst till sista (vändtid) |

**Regler:**
- Tidtabellens **avgångstider står kvar**. Tåget ankommer tidigare och står still till avgång; körtiden före stationen kortas.
- Uppehållet begränsas så att körtiden kortas högst 35 % och aldrig blir under 30 s; är den schemalagda körtiden redan under 30 s blir det inget uppehåll. Testat för alla mönster i `public/metro.json` och för slumpade mönster (`src/engine/dwell.test.ts`).
- Feedens egna uppehåll (> 0 s) används som de är (finns inga i nuvarande feed).
- Ankomsten till ändstationen är tidtabellens; tåget syns sedan 60 s till.

**Konsekvens:** körtiderna mellan stationer blir kortare än i tidtabellen, så medelfarten stiger (median ca 10 m/s mot 7,7 m/s utan modell; se `docs/segment-speed-report.md`). Ett M1-segment får toppfart strax över 25 m/s i rörelseprofilen.

## Rörelseprofil

Mellan två stationer används en trapetsprofil (`trapezoid` i `dwell.ts`): acceleration ca 18 s (högst 45 % av körtiden), marschfart, lika lång inbromsning. Samma avgångs- och ankomsttid som konstant hastighet; farten är aldrig negativ. Också en uppskattning.

## Djup

Se `src/depth/depth.json`: samma platshållare (15 m) för alla linjer, `estimate: true`.
