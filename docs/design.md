# Design – Strata × Duomo

Mörk, lugn och underjordisk (Strata), med marmor, guld och spetsbågar hämtade från Milanos Duomo. Tokens finns i `src/styles/tokens.css`; ändra värden där, inte i komponenter. Designspåret rör inte motor, data eller sensorlogik.

## Idé
- **Strata:** appens poäng är djupet under fötterna. Djupet är motivet: en lodrät djupmätare (skala med ticks) i HUD och infopanel, lager på lager i panelerna.
- **Duomo:** tre sparsamma inslag.
  1. *Marmor:* varm vit text (`--text`), en nästan osynlig marmoråder över paneler (`--marble-veil`), och på kartan ljust "marmor/papper" i stället för rent vitt.
  2. *Spetsbåge:* linjemärken och chips får lancettform (`--clip-lancet`), sheets en grund gavelspets i toppkanten (`--clip-gable`).
  3. *Madonnina:* guld (`--gold`) används **bara** för ordmärket och "0 m"-markeringen (marknivå) på djupmätaren. **Aldrig två guldelement i samma vy**: ordmärket hör till start-/om-skärmar och "0 m" till AR-vyns djupmätare, och de visas inte samtidigt. Guld används aldrig för valt tåg (för likt M3:s gula, kontrast 1,87:1).
- **Valt tåg:** vit ring med mörk ytterkant och glöd (`--select-ring`), som syns på både mörk och ljus bakgrund och inte krockar med någon linjefärg.
- Ingen kopia av Subwhere, ATM eller andra varumärken. Linjefärgerna är fasta ur GTFS (M1 röd, M2 grön, M3 gul, M4 blå, M5 lila).

## Färg
| Roll | Mörk (standard, AR) | Ljus (karta) |
|---|---|---|
| Bakgrund | `#0E1114` grafit | `#F4F1EA` marmor/papper |
| Text | `#F2EFE8` (16,5:1) | `#15181C` (15,8:1) |
| Dämpad text | `#B3AEA3` (8,6:1) | `#5B5750` (6,4:1) |
| Accent (interaktivt) | `#3DD6C6` aqua (10,5:1) | `#08766C` (4,9:1) |
| Guld (identitet) | `#D9B15B` (9,4:1) | `#7A5C12` (5,5:1) |

Kontrastvärdena är uträknade (WCAG) mot respektive bakgrund. Aqua väljs för att den inte krockar med någon linjefärg. Status: `--success` (aqua), `--warning`, `--danger`, `--info`.

**Linjefärger:** använd alltid `--line-mN` med motsvarande `--line-mN-ink` som textfärg (mörk på M1, M2, M3 och M5, vit på M4; alla ≥ 4,5:1) och en mörk kontur (`--line-halo`, 2 px) runt märken så att gult och grönt syns även på ljus bakgrund.

## Typografi
- Ett enda typsnitt: systemtypsnittet (SF Pro på iOS). Inga webbfonter.
- Skala 12/14/16/18/22/28/36 px (`--fs-*`). Lägsta vikt över bilden är 500; rubriker och siffror 600–700. Inga tunna typsnitt.
- **Tider, avstånd och hastigheter:** klassen `.num` (tabular-nums) så att siffror inte hoppar.
- Små etiketter i versaler med `--tracking-caps`.

## AR-läsbarhet (kontrast och läsbarhet först)
- All text över kameran ligger på en suddad halvtransparent panel (`.glass`: `--surface-1`, `--blur-panel`, 1 px hårlinje). Utan `backdrop-filter` används ogenomskinlig `--surface-solid`.
- Text som måste ligga direkt på bilden får `--text-halo`.
- Paneler är inte genomskinligare än 0,72 i alfa; text mot panel ≥ 4,5:1.
- AR-sidor är alltid mörka (`<html class="force-dark">`). Kartan följer `prefers-color-scheme`.

## Mobil först (iPhone Safari)
- `<meta name="viewport" content="..., viewport-fit=cover">` på alla sidor.
- Safe areas: `--safe-top/-right/-bottom/-left` (`env(safe-area-inset-*)`); sidomarginal `--gutter`. Kontroller i hörn och kanter lägger alltid till safe area.
- Höjd: `--vh-full` (`100dvh`, med `100vh` som reserv) i stället för `100vh`, så att Safaris adressfält inte klipper UI.
- Tryckytor minst 44 px (`--tap-min`); primära knappar 52 px (`--tap-comfort`). Minst 8 px (`--space-2`) mellan intilliggande tryckytor. Tumzon: primära kontroller längst ned, status längst upp.

## Form, skuggor, lager
- Radier: 14 px standardpanel, 20 px sheets, 999 px pill, 10 px små kontroller.
- Skuggor: `--shadow-1` (panel), `--shadow-2` (sheet/modal), plus `--shadow-inset` för överkantens ljuskant.
- Z-index endast via `--z-*` (bg, video, canvas, labels, hud, toolbar, panel, sheet, banner, toast, modal).

## Rörelse
- `--dur-fast` 140 ms (tryck), `--dur-base` 220 ms (paneler), `--dur-slow` 380 ms (sheets). Kurvor: `--ease-out`, `--ease-in-out`, `--ease-spring` (sparsamt).
- Respekterar `prefers-reduced-motion` (tokens sätts till nästan 0 ms).
- Animera `transform` och `opacity`, inte layout.

## Regler
- Inga nya tunga bibliotek utan att fråga; CSS-variabler och vanlig CSS räcker.
- Nya färger, storlekar och tider läggs som tokens först.
- Allt tillämpas senare komponent för komponent (nästa designsteg): `ar.html`, HUD, infopanel, kalibrerings- och simulatorpaneler, startskärm och kartan.

## Status
- D0: tokens och principer klara (denna fil, `src/styles/tokens.css`). Inte kopplat till några sidor än och inte granskat visuellt på enhet.

## Kartvyn (D1)
- Kartfärger är tokens (`--map-*`) och följer `prefers-color-scheme`; AR förblir alltid mörkt.
- Linjer ritas med mörk kontur och linjens egen färg; grov spårgeometri streckad. Tågmarkörer: 28 px cirkel med linjebricka (tryckyta 44 px), riktningspil i linjefärg, pulserande ring vid uppehåll, **vit ring med mörk ytterkant för valt tåg**.
- Bottenpanelens topp har Duomo-gaveln (`--clip-gable`); ingen guld används i kartvyn.
