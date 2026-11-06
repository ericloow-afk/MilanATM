# Design – Strata × Duomo

Ett lugnt, exakt verktyg: mörk grafit, marmorvit text, aqua som enda funktionella accent och guld bara för ordmärket. Tokens finns i `src/styles/tokens.css`, delade komponenter i `src/styles/components.css`. Ändra värden i tokens, inte i komponenterna.

## Idé
- **Strata:** appens poäng är djupet under fötterna. Hierarki uppnås med storlek och vikt, inte med färg.
- **Duomo:** marmor och guld, sparsamt.
  1. *Marmor:* varm vit text (`--text`), på kartan ljust "marmor/papper" (`--bg` i ljust läge) i stället för rent vitt.
  2. *Madonnina:* guld (`--gold`) används **bara** för ordmärket (startsidan och AR-startvyn) och framtida "0 m"-markering. **Aldrig två guldelement i samma vy** och aldrig för valt tåg (för likt M3:s gula).
- **Valt tåg:** vit ring med mörk ytterkant (`--select-ring`), ingen glöd.
- Ingen kopia av Subwhere, ATM eller andra varumärken. Linjebrickan är en neutral kvadrat med siffra, inte ATM:s logotyp.

## Bort och kvar
- **Bort:** helt rundade pillerformer, glas/blur (`backdrop-filter`), glöd, pulserande effekter, gradienter på ytor, emoji och "LIVE"-etiketter (positionerna är beräknade ur tidtabellen, inte realtid). Spetsbåge och gavel är borttagna ur tokens.
- **Kvar:** solida ytor (`--surface-1…3`), 1 px hårlinjer (`--hairline`), radie 6–10 px (`--radius-sm/md/lg`), `tabular-nums` för tider och avstånd (klassen `.num`), en typsnittsfamilj (systemstack, SF Pro på iOS).

## Färg
| Roll | Mörk (standard, AR) | Ljus (karta) |
|---|---|---|
| Bakgrund | `#0E1114` grafit | `#F4F1EA` marmor/papper |
| Text | `#F2EFE8` | `#15181C` |
| Dämpad text | `#A8A398` | `#5B5750` |
| Accent (interaktivt) | `#3DD6C6` aqua | `#08766C` |
| Guld (ordmärke) | `#D9B15B` | `#7A5C12` |

Kontrasten (≥ 4,5:1 för text mot alla ytor) kontrolleras av `src/styles/tokens.test.ts`, som läser tokens.css.

### Linjefärger
GTFS-färgen är källan (M1 `#ff0000`, M2 `#73ff01`, M3 `#fcff01`, M4 `#0000ee`, M5 `#c876b1`). Visningsfärgen (`--line-m1…5`) är den som används överallt. Enda ändringen är **M4: `#0000ee` → `#4d7cff`** (samma blå nyans, ljusare) eftersom den ursprungliga hade 1,9:1 mot den mörka kartan; visningsfärgen har 4,9:1 (krav: ≥ 3:1). Brickatext är alltid `--line-ink` (nästan svart): ≥ 4,5:1 mot alla fem. Testat.

### Kartfärger
`--map-*` följer `prefers-color-scheme`. Bakgrundskartans ortnamn (`--map-place`) är medvetet dämpade och små; stationsnamn (`--map-station-label`) har klart högre kontrast och är fetare, så att tunnelbanan är det tydligaste. AR är alltid mörkt (`<html class="force-dark">`).

## Komponenter (delade)
- **LineBadge** (`src/ui/line-badge.ts`, `.lb` i components.css): kvadratisk rundad bricka (radie 22 %), platt färg, ingen kontur, `aspect-ratio: 1`, `flex: none` (så att den aldrig sträcks till oval). 22×22 på kartan och i AR-etiketter, 28×28 i listor och paneler. Används i kartlistan, bottenpanelen, kartmarkörerna, AR-etiketterna och kantpilarna. På ljus karta får brickan en tunn mörk kant (box-shadow) så att gult och grönt syns.
- **Knappar** (`.btn`): primär (aqua), sekundär (outline), ghost, ikon. 44 px.
- **Panel** (`.panel`): solid yta, 1 px hårlinje, radie 8 px.
- **Segmenterad kontroll** (`.seg`): valfritt antal knappar, vald markeras med en 2 px aqua-linje under.
- **Reglage** (`input.range`): 44 px beröringsyta, tunt spår, rektangulärt handtag.
- **Statuspunkt** (`.status-dot`): grön/gul/röd.

## Typografi
- Systemtypsnitt (SF Pro på iOS). Inga webbfonter.
- Skala 12/14/16/18/22/28/32 px (`--fs-*`). Lägsta vikt 400 för brödtext, 500–700 för etiketter och siffror.
- Tider, avstånd och hastigheter: `.num` (tabular-nums).

## Mobil först (iPhone Safari)
- `viewport-fit=cover`; safe areas via `--safe-*` och `--gutter`; höjd via `--vh-full` (`100dvh`).
- Tryckytor minst 44 px (`--tap-min`).
- Bottenpanelens höjder räknas från `visualViewport` och den uppmätta nedre safe-arean, så Safaris verktygsfält inte döljer innehåll.

## Kartvyn
- **Toppfält:** ett enda fält (en rad, 44 px). Vänster: klockan HH:MM (sekunder bara när klockan spolas eller pausas). Höger: statuspunkt och "Tidtabell". Tryck öppnar en panel med "Giltig till 30 nov 2026", statusen, klockkontrollen (Nu, Paus, ×10, ×60, snabbval, datum och tid) och byggtid. Ingen text avkortas med "…".
- **Tåg:** under zoom 12 prickar (8 px), 12–13 prickar (10 px), från zoom 13 en LineBadge (22 px) med liten riktningspil (döljs under uppehåll). Prickar har mörk kontur. Valt tåg har vit ring.
- **Kontroller:** lista och plats i en vertikal grupp ovanför bottenpanelen till höger; zoomknapparna döljs på touch (pinch). Gruppen följer panelen men stannar under toppfältet.
- **Bottenpanel:** minimiläge visar bara handtag och rubrik ("52 tåg" + "närmast kartans mitt"), aldrig en avklippt listrad. Listrad: LineBadge, "mot X", andra raden "står vid Y" eller "A → B", avstånd högerställt. Valt tåg: nästa station med nedräkning, framsteg längs sträckan, avstånd till dig.

## AR
- **Startvy:** rubrik, en mening ("Tågen under dina fötter, beräknade ur tidtabellen. Positionerna är ungefärliga."), en primär knapp ("Starta AR") och en sekundär ("Simulator").
- **HUD:** en rad ("2 tåg inom 300 m"); tryck fäller ut tekniken (GPS, kompass, tid, tidtabell, djup, bygge). `?debug=1` öppnar den och verktygen från start.
- **Knappar:** "Kalibrera" syns i sensorläge. Utvecklarverktygen (Spela in 30 s, Markera, Kopiera logg) ligger bakom "Verktyg".
- **Simulator:** nedfällbar bottenpanel, stängd som standard med handtag. Egna reglage, segmenterade val och platsknappar. Etiketter och kantpilar ligger under panelerna.

## Rörelse och tillgänglighet
- Inga dekorativa animationer. Kvar: rotation av laddningsikonen och en kort panel-glidning (`--dur-slow`); båda avstängda med `prefers-reduced-motion`. Markörerna rör sig för att tågen rör sig; med reducerad rörelse uppdateras de en gång per sekund.
- Aria-etiketter på alla kontroller, fokus flyttas till panelens rubrik vid val och tillbaka vid stängning (Esc).

## Regler
- Inga nya tunga bibliotek utan att fråga.
- Nya färger, storlekar och tider läggs som tokens först; nya återanvändbara element som komponent i components.css, inte patchade per sida.
- Skriv svenska i gränssnittet. Skriv inte "t.o.m." (skriv "till 30 nov 2026"), inga avkortade etiketter.
