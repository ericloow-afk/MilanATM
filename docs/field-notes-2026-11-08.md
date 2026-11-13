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
