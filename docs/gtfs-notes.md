# GTFS-anteckningar (Fas 0, punkt 3)

Källa: `https://dati.comune.milano.it/gtfs.zip`, hämtad 2026-11-06 (25 MB, i `data/raw/gtfs.zip`, gitignorerad). Kontrollen görs med `node tools/inspect-gtfs.mjs data/raw/gtfs.zip [YYYY-MM-DD]` (zip via `fflate`, dev-beroende). Hela körningen tar ca 4 s.

## Fynd

**Feed**
- `feed_info`: version 425, `feed_start_date` 2026-10-26. Ingen standard `feed_end_date`; i stället icke-standardfälten `surface_end_date` och `mm_end_date`, båda **2026-11-30**.
- `calendar.txt` är **tom** (bara rubrikrad). All tjänstedata ligger i `calendar_dates.txt` (4417 rader, 2026-10-26 … 2026-11-30, alla `exception_type=1`). Idag (2026-11-06, fredag) täcks: 5 aktiva metro-`service_id` ger 2770 metro-trips.
- Agency: ATM, tidszon `Europe/Rome`.

**Rutter (route_type 1)** – exakt fem, M1–M5:

| route_id | short_name | färg (GTFS) |
|---|---|---|
| M1 | 1 | ff0000 |
| M2 | 2 | 73ff01 |
| M3 | 3 | fcff01 |
| M4 | 4 | 0000ee |
| M5 | 5 | c876b1 |

`route_text_color` saknas. Övriga rutter: 17 spårvagn (type 0), 148 buss (type 3).

**Stationer:** 130 unika metro-`stop_id` (M1 38, M2 35, M3 21, M4 21, M5 19; summerar till mer än 130 eftersom bytesstationer delas). Alla har koordinater (lat 45.40–45.55, lon 9.09–9.44).

**Trips och shapes (alla datum i feeden, inte bara idag):** M1 2577 trips/11 shapes, M2 1316/16, M3 1154/2, M4 1259/2, M5 1578/2.

**Saknade shapes:** inga. Alla metro-trips har `shape_id`, och alla finns i `shapes.txt` (33 shapes används).

**Tider över 24:00:00:** 3999 `stop_times`-rader, t.ex. `ABBIATEGRASSO___CASCINA GOBBA_f_20261004_152` vid CRESCENZAGO `24:00:30`. Inga rader där tiden minskar inom ett trip (monotona).

## Risker och beslut för Fas 1–2

1. **Feeden löper ut 2026-11-30** (24 dagar). Appen ska visa/logga feedens slutdatum och `build-metro.mjs` ska kunna köras om. Efter det datumet finns inga tåg alls enligt schemat.
2. **`calendar.txt` är tom.** Aktiv tjänst måste beräknas enbart från `calendar_dates` (`exception_type=1` för datumet). En motor som bara läser `calendar.txt` hittar noll tåg.
3. **`direction_id` är tom** för alla metro-trips. Riktning måste härledas, t.ex. från `trip_headsign` eller shape-namnet (`ORIGIN___DEST`). Skriptet grupperar därför per headsign. Obs: `trip_headsign` är destinationen, inte linjens ändhållplats; kortare turer (t.ex. M1 mot Molino Dorino, bara 5 trips) är egna grupper.
4. **Många shape-varianter på M1 (11) och M2 (16)** pga. grenar och korta turer (Gessate, Gorgonzola, Cascina Antonietta, Famagosta, Sesto Marelli osv.). Använd trippens egen `shape_id`, inte "en shape per linje".
5. **Grova shapes:** `CASCINA ANTONIETTA___GESSATE` (4 punkter, 22 trips), `GORGONZOLA___GESSATE` (9, 1 trip), `SESTO MARELLI___SESTO 1 MAGGIO FS` (6, 35 trips) är bara raka linjer mellan få punkter. Interpolering längs dem blir rak; förväntad avvikelse från riktig tunnelsträckning. Märk som ungefärligt, eller projicera på en finare shape om samma sträcka finns.
6. **`service_id` följer ett mönster med datum i namnet** (`l_10001_20260907`, `s_…`, `f_…`, `sfi_…`, `ffi_…`; troligen vardag/lördag/helg + särskilda dagar). Datumdelen ändras mellan feedversioner; lita bara på `calendar_dates`, tolka inte namnen.
7. **Över-24:00-tider hör till föregående tjänstedygn.** För "nu" kl. 00:30 måste motorn även titta på gårdagens service med tider +86400 s, annars försvinner nattens tåg.
8. **`stop_id` är stationsnamn** (`CRESCENZAGO`), inga `parent_station`, alla `location_type=0`. Bytesstationer är ibland samma id (ZARA M3/M5, GARIBALDI FS M2/M5, CENTRALE FS M2/M3, SAN BABILA M1/M4) och ibland olika för samma plats (`S.AMBROGIO` M2 vs `SAN AMBROGIO` M4). Jag har inte gått igenom alla bytesstationer för fler sådana fall. Det spelar liten roll för tågpositioner men påverkar stationsetiketter.
9. **Färger i GTFS** (M2 `73ff01`, M3 `fcff01`) är ljusa; PLAN.md anger M2 grön, M3 gul, och de stämmer. Textfärg saknas, så välj kontrast själv i UI.
10. **Skala:** `stop_times.txt` är 308 MB okomprimerad (≈187 000 rader för metro). `build-metro.mjs` ska filtrera på metro-trips strömmande (som inspektionsskriptet gör), inte läsa filen som en sträng.

## Inte kontrollerat
- Att tidtabellen stämmer mot ATM:s app/verkligheten (hör till Fas 1:s klart-kriterium).
- Shapes geometriska kvalitet utöver punktantal.
- Licens: datasetsidan ska kontrolleras innan publik distribution (PLAN.md §7).
