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

## Realtidslager och justering för hand (2026-11-13)

Inget officiellt realtidsflöde för metron finns (se `docs/realtime-sources.md`). Lagret i `src/realtime` och `src/engine/fuse.ts` justerar tidtabellen med observationer, och utan observationer är resultatet exakt tidtabellen.

**Observation** (`RealtimeObservation`): källa, linje, riktning (eller null), station, typ (`arrival`, `departure`, `wait`, `status`), tid och säkerhet (confidence). `wait` = sekunder kvar till ankomst, `status` = linjestatus som visas oförändrad och aldrig flyttar tåg.

**Matchning (uppskattning):** en observation kopplas till den trip på samma linje och riktning som passerar stationen närmast i tid, inom ±10 min. Planerad tid = motorns effektiva tid, alltså ankomst enligt uppehållsmodellen. **Begränsning:** med 2–5 minuters turtäthet kan en försening som är större än halva turintervallet matchas mot nästa tåg i stället. Det märks inte i UI:t; loggen visar vilken trip (`trip`) som valdes.

**Försening framåt (uppskattning, inte uppmätt):**
- Hela tripen fram till och med observerad station förskjuts med förseningen.
- Efter stationen halveras förseningen per 5 stopp.
- Tåget kan inte köra ikapp hur som helst: körtiden mellan två stationer kortas högst till 85 % av den planerade, och uppehållen behåller sin längd. Med den kortaste körtiden 98 s tar tåget igen högst ca 15 s per sträcka.
- Observationer äldre än 15 min används inte. Observationer mer än 60 s efter kartans klocka ignoreras, till exempel när klockan är spolad bakåt.
- Flera observationer för samma tåg: den senaste gäller. Observationer inom 30 s från den senaste vägs ihop efter confidence (manuell knapp 0,8, trip update 0,9, fordon vid station 0,5).

**Ingen rörelse bakåt:** om en justering lägger tåget bakom den position som just visades står det still (fart 0, "väntar in justeringen") tills den justerade tidtabellen hunnit ikapp (`PositionGuard`). Vakten nollställs när klockan spolas.

**Källmärkning:** `schedule` → "tidtabell", `adjusted` (källa `manual`) → "justerad +N", `live` (annan källa) → "live".

**"Tåget kom nu":** en ankomstobservation vid vald station, med verklig tid på kartan (bara när klockan visar Nu) och simulerad tid i AR-simulatorn. Den sparas i `localStorage` (`mmar.realtime.manual.v1`) och tas bort efter 20 min räknat på väggklockan. Simulatorns tider sparas inte. **Logg** (`mmar.realtime.log.v1`, högst 5 000 rader, ingen utgång), exporteras som CSV med kolumnerna:
- `datum, veckodag, timme`
- `linje, riktning, station`
- `planerad`: tidtabellens tid. Feeden har ankomst = avgång, så det är passertiden.
- `observerad`
- `differens_s`: observerad − planerad, positivt betyder sent.
- `modell_ankomst, differens_modell_s`: jämförelse med uppehållsmodellens ankomst.
- `typ, kalla, trip`

För en ankomst är `differens_s` normalt något negativ även när tåget går i tid, eftersom tåget kommer in före avgångstiden. Medelvärdet per linje och timme visar ändå om tidtabellen ligger före eller efter.

**Konfiguration** (Vite-miljövariabler, inga nycklar i repot):
- `VITE_RT_OFFICIAL_URL`, `VITE_RT_OFFICIAL_KEY`, `VITE_RT_OFFICIAL_KEY_HEADER`: OfficialAtmSource (GTFS-Realtime som JSON).
- `VITE_RT_STATUS_URL`, `VITE_RT_STATUS_KEY`, `VITE_RT_STATUS_KEY_HEADER`: StatusSource.

Utan dessa är källorna avstängda. Allt med `VITE_` byggs in i den publika sidan, så en riktig nyckel hör hemma i en lokal proxy, inte här. Se `.env.example`. Mockade källor finns bara i dev (`?rt=mock`) och tas bort ur produktionsbygget.
