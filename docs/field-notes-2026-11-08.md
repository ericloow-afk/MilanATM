# Fältanteckningar 8 november 2026 (Maciachini och Dergano, M3)

Mätningar gjorda av användaren med AR-vyn och dess CSV-logg. Loggarna ska ligga i `test/fixtures/field-2026-11-08-*.csv` och får aldrig skrivas över.

> **Status 2026-11-14:** loggfilerna finns inte i repot eller på datorn där koden skrevs. Testerna som läser dem (`src/ar/field.test.ts`) hoppas över tills filerna finns och körs då automatiskt. Siffrorna nedan kommer från användarens beskrivning.

## Mätvärden

| Plats | Vad | Värde |
|---|---|---|
| Maciachini, perrongen | GPS | gpsAcc 1414 m och samma position på alla 120 rader (ingen fix under jord) |
| Maciachini, perrongen | Kompass | noggrannhet ±14–56° |
| Maciachini, perrongen | Resultat | "inga tåg inom 300 m" med ett riktigt tåg framför användaren |
| Dergano, ute | GPS | gpsAcc 21,8 → 10,6 m på 30 s. Positionen hoppade 5–9 m mellan uppdateringar (t.ex. 9 m på 0,7 s) |
| Dergano, ute | Kompass | noggrannhet ±10° |
| Dergano, ute | Tåg i bild | `trainsInView` blev 1 först när beta gick under ca 55° |
| Lutningstest | yawOffset | ned till beta ca 48° rörde sig yawOffset 1,4° totalt |
| Dergano | yawOffset | gled ca 9° (−102° → −110°) när beta gick 46° → 15° på 10 s |
| FOV | Horisontellt | ca 38° (lyktstolpe från vänster till höger kant) |
| FOV | Lodrätt | ca 64° enligt kamerans bildförhållande (appen antog 60°) |
| Spåret | Rät linje Maciachini → Affori FN | ca 334°/154° |
| Kompassmarkering | Längs gatan mot Maciachini | 169° |

## Del 1: spårets riktning ur shapen

Kommando: `node tools/track-bearing.mjs <lat> <lon> --line M3 --compare 334,154,169` (eller `--station NAMN`). Bäringarna räknas mellan punkterna ±50 m längs shapen runt närmaste punkt. De är i grader från **sann (geografisk) nord**. M3:s shape (`COMASINA___SAN DONATO`) har 330 punkter och är inte grov.

| Plats | Avstånd till shapen | mot Comasina (färd) | mot San Donato (färd) | Segmentets bäring |
|---|---|---|---|---|
| Dergano 45.5055, 9.1797 | 6 m | **334,3°** | **154,3°** | 335,6° / 155,6° |
| Maciachini 45.49806, 9.18472 | 3 m | **332,7°** | **152,7°** | 331,4° / 151,4° |
| Station Dergano (metro.json) | 0 m | 334,1° | 154,1° | 335,6° / 155,6° |
| Station Maciachini (metro.json) | 0 m | 332,9° | 152,9° | 334,3° / 154,3° |

Rät linje mellan stationerna i metro.json (Maciachini → Dergano): 334,1°. Mellan dina koordinater: 334,7°.

**Jämförelse:**
- Med din raka linje 334°/154°: shapen avviker 0,3° vid Dergano och 1,3° vid Maciachini. Tunneln går alltså i praktiken rakt mellan stationerna, och shapen stämmer med kartan.
- Med din kompassmarkering 169° längs gatan mot Maciachini: spåret går 154,3° (Dergano) respektive 152,7° (Maciachini), en skillnad på **14,7–16,3°**.

Tunneln är rak här, så skillnaden kan inte förklaras av en krökt shape. Den måste komma från något av:
- att gatan inte går parallellt med tunneln,
- kompassfel (magnetisk störning nära gatan, spårvagnsledningar, bilar),
- hur telefonen hölls (iOS referensriktning vid lutning, se Del 3).

Deklinationen förklarar den inte (nedan).

## Deklination

- **Värde:** +3,71° öst ±0,35° vid 45,5° N, 9,18° E den 8 november 2026, enligt NOAA:s kalkylator med WMM-2025: https://www.ngdc.noaa.gov/geomag/calculators/magcalc.shtml . Magnetisk nord ligger alltså 3,7° öster om sann nord, och sann bäring = magnetisk bäring + 3,7°.
- **Hur appen gör idag:** `webkitCompassHeading` används rakt av som mål för yaw-offseten i `OrientationFilter.update`, utan deklinationskorrigering (`src/ar/filter.ts`). Tågens positioner och shapes är i sann nord. Om `webkitCompassHeading` är magnetisk, vilket flera källor säger, ligger AR-världen vriden ca 3,7°. Ett tåg i sann bäring β ritas då ungefär 3,7° till höger om rätt riktning.
- **Källäge:** Apple dokumenterar inte entydigt om värdet är magnetiskt. Caniuse/MDN-relaterade källor säger "relative to magnetic north". Det är inte verifierat på din iPhone.
- **Effekt på din mätning:** om 169° var magnetisk blir det 172,7° sant, alltså 18,4° från spåret. Deklinationen gör skillnaden större, inte mindre.
- **Effekt på fixtures:** en konstant deklination flyttar yaw-offseten exakt lika mycket i varje sample. Replay-måtten a–d (stabilitet, vändningar, drift) ändras inte. Se `npm run replay` och testet i `src/ar/replay.test.ts`.
- **Beslut:** konstanten finns som `declinationDeg` i `FilterConfig`, standard **0** (oförändrat). Sätt 3,7 när ett fältprov med känd riktning (till exempel att rikta längs en perrong i stationsläget och jämföra med kompassen) visar att det blir bättre. Jag har inte ändrat beteendet.

## Del 2–4: GPS, synlighet och perrongläge (2026-11-14)

- **GPS** (`src/ar/gps-filter.ts`): 2D Kalman i lokala meter.
  - Processbrus motsvarande gångfart 2 m/s, mätbrus gpsAcc².
  - Fixar med gpsAcc > 100 m ignoreras.
  - Steget begränsas till högst 3 m/s, och vid täta fixar högst ca 2 m per uppdatering.
  - Syntetiska tester enligt Dergano: fixar som hoppar 5–9 m blir steg på högst 2,2 m, och efter 10 s under 1,5 m. Perrongen: ingen position alls.
  - De riktiga loggarna testas i `src/ar/field.test.ts` när de finns.
- **Synfält:** 64° lodrätt som konstant (`AR_CONFIG.fovVerticalDeg`, uppmätt ca, stående läge).
- **Yaw-glidningen vid brant lutning** (`npm run replay`, avsnittet "Lutning nedåt" i `docs/filter-replay.md`):
  - Inomhusloggen visar samma glidning (ca 8°). Men kompassens offset i upprätt läge efteråt har också flyttat sig (70,5° → 77,2°). Glidningen följer alltså en verklig förändring, troligen att iOS gyro-alpha driver mot kompassen.
  - Att frysa korrigeringen under −40° gör felet när man kommer tillbaka upprätt större (2,0° → 9,4°). Spärren finns därför bara som avstängt förslag (`minElevationDeg: null`).
  - Dergano-loggen avgör: kör `npm run replay` när den ligger i `test/fixtures/`.
- **Perrongläget:** position = stationens koordinat, kompassen av, "Rikta längs spåret" sätter offseten mot bäringen ur shapen. Maciachini mot Comasina: tågen kommer från 152,9° (Zara-hållet).

## Del 5: det blå fältet

**Diagnos.** Mätt i simulatorn i 390×844 med felsökningsknapparna i `?debug=1`. Simulatorns bakgrund var avstängd och tiden pausad. Medelfärgen gäller nedre delen av bilden:

| Läge | Lager | Medel-RGB | blått − rött |
|---|---|---|---|
| vågrätt | allt utom tåg | 27, 37, 45 | +18 |
| vågrätt | utan markplan | 24, 26, 29 | +5 |
| vågrätt | utan rutnät | 27, 37, 44 | +17 |
| vågrätt | canvas dold | 23, 25, 28 | +5 |
| lutad ned 60° | allt utom tåg | 27, 38, 44 | +17 |
| lutad ned 60° | utan markplan | 24, 27, 29 | +5 |
| lutad ned 60° | canvas dold | 23, 26, 28 | +5 |

- **Renderaren:** `alpha: true`, `premultipliedAlpha: true`, clearColor svart med alfa 0, ingen `scene.background` och ingen dimma. Canvasen är alltså genomskinlig.
- **Orsaken till blåtonen:** markplanet, 600 × 600 m (radie 424 m), `#3399cc`, opacitet 0,1, `DoubleSide`, i gatuhöjd. Från ögonhöjd 1,6 m träffar varje blick under horisonten planet, så hela den delen av bilden tonades blå. Utan planet blir bilden densamma som med canvasen dold.
- **De blå linjerna:** två `GridHelper` i `#66ddff` (600 m och 100 m, opacitet 0,3 och 0,5) ut till horisonten. De ändrar medelfärgen lite, men det är de som syns som linjer.

**Åtgärd** (`src/ar/scene.ts`, `src/ar/ground.ts`):
- Inga fyllda ytor.
- Spårlinje och lodlinjer har högst 0,25 i opacitet.
- Rutnätet är av som standard. Påslaget syns det bara i ett band ca 30 m runt spåret och högst 80 m från kameran, och bara när det finns tåg inom 300 m och en användbar fix, eller i perrongläget (på golvet).
- Skärmdumpar med Chromes falska kamera visar kamerabilden tydligt i alla lägen: vågrätt, 45° och rakt ned, rutnät av/svagt/normalt, och bordet utan tåg i närheten.
