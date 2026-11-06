# Replay av AR-filtret mot riktig sensorlogg

Logg: `test/fixtures/sensor-log-indoor-2026-11-06.csv` (144 samples, ca 5 Hz, 30 s, inomhus, telefonen upprätt → ned mot golvet → upp mot taket). Skapa rapporten med `npm run replay`; testerna ligger i `src/ar/replay.test.ts`.

## Parametrar (src/ar/filter.ts, `DEFAULT_FILTER_CONFIG`)

| parameter | värde | betydelse |
|---|---|---|
| tauQ | 0.1 | utjämning av vyn (slerp i kvaternionrymd), s |
| tauYaw | 5 | tidskonstant för yaw-korrigering mot kompassen, s (förstärkning ≈ dt / tauYaw) |
| maxCompassAccuracy | 25 | kompass med sämre headingAcc (°) ignoreras |
| goodCompassAccuracy | 15 | under detta väger kompassen fullt, därefter tonas vikten ned |
| minAccuracyWeight | 0.25 | lägsta vikt precis under maxCompassAccuracy |
| maxElevationDeg | 20 | kompass ignoreras när kameran tittar mer än så här uppåt (°) |
| maxRateDegPerSec | 120 | kompass ignoreras vid snabbare vridning (°/s) |
| innovationLimitDeg | 45 | skattning som avviker mer än så här (°) från offseten avvisas |
| reacquireAfterSec | 4 | avvisas oavbrutet så här länge: ta den nya nivån (s) |

Alla ändras på ett ställe: `new OrientationFilter({ tauYaw: 3, ... })` eller `DEFAULT_FILTER_CONFIG`.

## Resultat med standardparametrarna

- Kompassen användes i 110 av 144 samples. Övriga: inaccurate 12, looking-up 22.
- **a)** Största ökning av filtrerad jämfört med rå rotation mellan två samples: 0.72° (gräns 1,5°). Största enskilda steg i vyn 23.2° (rå: 23.6°).
- **b)** Yaw-offset ändras 0.0° kring uppåtvändningen och 0.1° kring nedåtvändningen (gräns 10°).
- **c)** Under headingAcc > 25° rör sig skattningen högst 0.0°/s (gräns 6°/s).
- **d)** 20:15:08–15: skattningen ligger inom ±4.1° av medianen 71.7° (gräns ±5°).

## Skattad offset över tid

yaw = filtrets skattning (grader). uppmätt = kompass − råreferens (det kompassen skulle ge ensam). tillstånd: ok = kompassen användes; inaccurate = headingAcc > 25°; looking-up = blick uppåt; moving = snabb vridning; jump = språng avvisat.

| tid | beta | höjd° | °/s | headingAcc | uppmätt | yaw | tillstånd |
|---|---|---|---|---|---|---|---|
| 20:14:50.61 | 80 | -10 | 0 | 16 | 60.2 | 60.2 | ok |
| 20:14:51.61 | 81 | -9 | 1 | 16 | 65.9 | 60.9 | ok |
| 20:14:52.68 | 81 | -9 | 2 | 16 | 70.3 | 62.3 | ok |
| 20:14:53.73 | 81 | -9 | 4 | 16 | 69.6 | 63.7 | ok |
| 20:14:54.78 | 84 | -6 | 10 | 16 | 70.0 | 64.7 | ok |
| 20:14:55.83 | 82 | -7 | 52 | 15 | 73.0 | 65.9 | ok |
| 20:14:56.88 | 83 | -6 | 28 | 14 | 72.2 | 67.0 | ok |
| 20:14:57.93 | 82 | -8 | 13 | 14 | 67.9 | 67.4 | ok |
| 20:14:58.98 | 41 | -49 | 35 | 15 | 64.8 | 67.3 | ok |
| 20:15:00.03 | 28 | -62 | 30 | 14 | 64.1 | 66.7 | ok |
| 20:15:01.08 | 29 | -61 | 45 | 14 | 61.5 | 66.0 | ok |
| 20:15:02.13 | 29 | -61 | 70 | 14 | 63.3 | 65.5 | ok |
| 20:15:03.18 | 35 | -55 | 24 | 13 | 66.6 | 65.4 | ok |
| 20:15:04.23 | 45 | -45 | 14 | 13 | 69.5 | 66.0 | ok |
| 20:15:05.28 | 46 | -44 | 2 | 24 | 77.2 | 67.3 | ok |
| 20:15:06.33 | 44 | -46 | 28 | 39 | 78.2 | 67.6 | inaccurate |
| 20:15:07.38 | 43 | -47 | 62 | 32 | 80.1 | 67.6 | inaccurate |
| 20:15:08.43 | 5 | -84 | 45 | 25 | 80.7 | 67.7 | ok |
| 20:15:09.48 | 9 | -81 | 85 | 22 | 80.5 | 68.7 | ok |
| 20:15:10.53 | 18 | -72 | 101 | 19 | 81.8 | 70.2 | ok |
| 20:15:11.58 | 16 | -74 | 86 | 18 | 80.8 | 71.7 | ok |
| 20:15:12.63 | 11 | -79 | 110 | 18 | 80.8 | 73.2 | ok |
| 20:15:13.68 | 10 | -80 | 70 | 17 | 80.1 | 74.4 | ok |
| 20:15:14.73 | 33 | -57 | 74 | 16 | 75.0 | 75.2 | ok |
| 20:15:15.78 | 101 | 10 | 61 | 14 | 76.8 | 75.5 | ok |
| 20:15:16.83 | 151 | 60 | 41 | 13 | -96.2 | 75.5 | looking-up |
| 20:15:17.88 | -161 | 71 | 48 | 13 | -97.4 | 75.5 | looking-up |
| 20:15:18.93 | -148 | 58 | 33 | 13 | 67.1 | 75.5 | looking-up |
| 20:15:19.98 | 143 | 53 | 72 | 13 | -101.2 | 75.5 | looking-up |

## Parameterscan (tauYaw × maxRateDegPerSec)

rms = RMS-avstånd mellan skattning och uppmätt offset när kompassen användes (lägre = följer kompassen tätare; behöver inte vara bättre, se nedan). d) = största avvikelse från medianen 20:15:08–15 (gräns 5, ✗ = över). c) = största yaw-hastighet i headingAcc-fönstret.

| tauYaw | maxRate | rms (°) | d) ± (°) | c) (°/s) | max yaw-hastighet (°/s) | a) max ökning (°) | b) flip1 / flip2 (°) |
|---|---|---|---|---|---|---|---|
| 1 | 60 | 3.1 | 2.0 | 0.0 | 5.4 | 1.05 | 0.0 / 0.0 |
| 2 | 60 | 4.5 | 1.6 | 0.0 | 4.1 | 0.88 | 0.0 / 0.0 |
| 3 | 60 | 5.2 | 1.3 | 0.0 | 3.1 | 0.82 | 0.0 / 0.0 |
| 5 | 60 | 5.9 | 0.9 | 0.0 | 2.1 | 0.73 | 0.0 / 0.0 |
| 8 | 60 | 6.7 | 0.6 | 0.0 | 1.5 | 0.70 | 0.0 / 0.0 |
| 1 | 120 | 2.9 | 7.0 ✗ | 0.0 | 5.4 | 0.93 | 0.0 / 0.0 |
| 2 | 120 | 4.4 | 6.8 ✗ | 0.0 | 3.7 | 0.83 | 0.0 / 0.0 |
| 3 | 120 | 5.3 | 5.7 ✗ | 0.0 | 2.7 | 0.79 | 0.0 / 0.0 |
| 5 | 120 | 6.5 | 4.1 | 0.0 | 1.8 | 0.72 | 0.0 / 0.1 **← standard** |
| 8 | 120 | 7.6 | 3.1 | 0.0 | 1.2 | 0.70 | 0.0 / 0.1 |
| 1 | 200 | 2.9 | 7.0 ✗ | 0.0 | 5.4 | 0.93 | 0.0 / 0.0 |
| 2 | 200 | 4.4 | 6.8 ✗ | 0.0 | 3.7 | 0.83 | 0.0 / 0.0 |
| 3 | 200 | 5.3 | 5.7 ✗ | 0.0 | 2.7 | 0.79 | 0.0 / 0.0 |
| 5 | 200 | 6.5 | 4.1 | 0.0 | 1.8 | 0.72 | 0.0 / 0.1 |
| 8 | 200 | 7.6 | 3.1 | 0.0 | 1.2 | 0.70 | 0.0 / 0.1 |

## Slutsatser och förslag

1. **Grindarna fungerar på den här loggen.** Båda kompassvändningarna (≈170°) fångas av höjdgrinden (maxElevationDeg 20° ≈ beta 110°) och, om den stängs av, av innovationsgränsen (45°): testerna visar båda. Utan grindar flyttar vändningen skattningen mer än 10°.
2. **Kamerarotationen blir kontinuerlig** när kvaternionen byggs av alla tre vinklarna: alpha och gamma hoppar upp till ca 70° mellan samples nära beta ≈ 90° (20:15:15.6), men den verkliga rotationen är högst ca 24° per sample och filtret ökar den aldrig med mer än ca 1°.
3. **"Kompassen släpar vid snabb vridning" syns knappt när alla tre vinklarna används.** Offset-beräkningen heading + alpha (som bara tittar på alpha) sjunker ca 25° vid 20:14:55–57, men med referensriktningen ur hela kvaternionen (gamma ≈ 20–30° då) ändras offseten bara ca 3°. En del av det "släp" som syntes var alltså gamma som saknades i beräkningen, inte kompassen. Hastighetsgrinden är därför satt högt (120°/s, loggens max är 113°/s) och i praktiken inaktiv här. Med den satt till 60°/s fryser skattningen under hela den snabba vridningen 20:15:09–14 och står kvar vid ca 69° medan kompassen visar ca 81° (ett fel på ca 12° som inte syns i rms-kolumnen, där bara samples räknas som faktiskt användes). Sänk den utomhus bara om du ser släp där.
4. **Offseten driver 22° på 30 s inomhus (60° → 82°)**, troligen magnetisk störning inomhus snarare än fel i gyrot. En långsam skattning är därför oftast bättre än en som följer kompassen tätt, även om "rms" blir högre. Obs: d) passerar delvis för att skattningen är långsam; under 20:15:08–15 är den fortfarande på väg mot kompassens ca 81° (från ca 68° till ca 75°), så den "stabila" nivån är inte riktigt inhämtad.
5. **Förslag:** `tauYaw` = 5 s (standard). Kortare (1–3 s) följer kompassen tätare men ger d) över 5° i den snabba vridningen och mer jitter; längre (8 s) är lugnare (jitter 1,2°/s) men släpar mer efter kompassen (rms 7,6°). Efter utomhustestet: om vyn driftar mot kompassen, sänk `tauYaw` mot 3 s; om vyn darrar, höj den mot 8 s. `maxRateDegPerSec` 120, `maxElevationDeg` 20 och `innovationLimitDeg` 45 är rimliga utgångsvärden.

## Begränsningar

- Loggen är **inomhus** och 5 Hz. Riktiga sensorhändelser kommer ofta med ~60 Hz; tauQ (0,1 s) är avsedd för det och ger nästan ingen utjämning vid 5 Hz.
- Vi har ingen sann riktning (facit), bara kompass och gyro. "rms" mäter därför bara hur tätt skattningen följer kompassen, inte hur rätt den är.
- Loggen innehåller en kompassvändning upp och en ned. Lutning åt andra håll och andra sätt att hålla telefonen är inte provade.
