# Progress

## Fas 0 – Riskkoll

| Punkt | Status |
|---|---|
| 1. ATM-probe (`docs/atm-probe.md`) | Ej gjord |
| 2. Sensortest-sida (kamera + GPS + kompass) | **Byggd, ej verifierad på iPhone** |
| 3. GTFS-validering | Ej gjord |

Klart-kriterium för punkt 2: sensortestet visar heading och GPS på din telefon över HTTPS. Det kan bara bekräftas av dig; fyll i checklistan nedan.

### Gjort
- Vite + TypeScript (vanilla), Vitest, three.js (används först i Fas 4).
- `sensor-test.html` + `src/sensor-test.ts`: knappen "Starta" begär, i klick-handlern, orientering (`DeviceOrientationEvent.requestPermission`), bakre kamera (`getUserMedia`) och GPS (`watchPosition`, high accuracy). Visar lat/lon, noggrannhet, `webkitCompassHeading`, alpha/beta/gamma och kamerabild som bakgrund. Varje API har egen statusrad med felnamn.
- Ren hjälpkod i `src/format.ts` med tester (`npm test`).
- `npm run build` ger `dist/` med relativ bas (`./`).
- GitHub Actions-workflow `.github/workflows/deploy.yml` deployar `dist/` till GitHub Pages vid push till `main`.

### Deploy till GitHub Pages (engångsuppsättning)
Mappen är inte ett git-repo än. Kör:

```bash
git init -b main
git add .
git commit -m "Fas 0: sensortest"
git remote add origin https://github.com/<användare>/<repo>.git   # skapa tomt repo på github.com först
git push -u origin main
```

Sedan på GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Fliken **Actions** visar bygget; när det är grönt finns sidan på:

`https://<användare>.github.io/<repo>/sensor-test.html`

(Om workflown redan körts före Pages-inställningen: kör om via Actions → "Run workflow".)

### Testa på iPhone
1. Öppna URL:en ovan i **Safari** (måste vara `https://`; hemskärms-PWA eller annan webbläsare kan bete sig annorlunda).
2. Tryck **Starta** och godkänn tre frågor: Kamera, Plats, Rörelse och orientering.
3. Du ska se kamerabild (bakre), lat/lon med noggrannhet i meter, och `webkitCompassHeading` som ändras när du vrider dig.

Felsökning:
- Första raden säger "NEJ" på HTTPS → du är på `http://`.
- Något "nekad": Inställningar → Safari → Kamera / Plats / Rörelse och orientering, eller ladda om och tryck Starta igen (iOS frågar ibland bara en gång per session; stäng fliken och öppna på nytt).
- Kompassen hoppar: håll telefonen borta från metall/magneter, rör den i en åtta.
- Ingen heading men alpha/beta/gamma finns: notera i checklistan, det påverkar Fas 4.

### Sensortestet – funktioner (uppdaterad)
- Orienteringsstatus byter till "tar emot data (X Hz)" när events kommer.
- Visar `webkitCompassAccuracy` (negativt = OKALIBRERAD), GPS-hastighet/riktning (ofta `–` när man står still), tidsstämpel på senaste orient- och GPS-event.
- "alpha-riktning" = (360 − alpha) mod 360 bredvid kompassriktningen, samt signerad skillnad (−180..180°).
- **Spela in 30 s**: en CSV-rad var 200 ms (`time,lat,lon,acc,heading,headingAcc,alpha,beta,gamma`). **Kopiera logg** lägger CSV i urklipp; om iOS vägrar visas den i ett textfält du kan markera och kopiera. Klistra in i chatten.
- On-screen-konsol längst ner visar fel från getUserMedia, geolocation, orientation och oväntade JS-fel (ingen webbinspektör behövs).
- Video: `playsinline`, `muted`, `facingMode: environment`. Safari på iOS kan inte låsa skärmrotation från webben: slå på **orienteringslås** i Kontrollcenter och håll telefonen stående.

### Öppna på mobildata (utomhus)
Dev-länken (`https://172.x.x.x:5174`) funkar bara på samma nät. Utomhus använder du GitHub Pages-adressen (se Deploy ovan): stäng av Wi-Fi på iPhone, öppna `https://<användare>.github.io/<repo>/sensor-test.html` i Safari på mobildata. Efter varje ändring måste du pusha till `main` och vänta tills Actions är grönt (ca 1 min); ladda om sidan (dra ned eller stäng fliken) så du inte får en cachad version.
**Status:** ej deployat än. Mappen är inget git-repo, så ingen HTTPS-adress finns att verifiera.

### Utomhus-testchecklista
**(a) Riktning mot gata.** Slå upp en gata i en kartapp där du kan läsa av riktningen i grader (kartappens kompass eller mät mot norr). Stå vid gatan, håll telefonen upprätt och rikta den längs gatan. Läs `webkitCompassHeading` och `alpha-riktning`.
- [ ] Gatans riktning enligt karta: ___°  (och motsatt håll: ___°)
- [ ] `webkitCompassHeading`: ___°   skillnad mot kartan: ___°
- [ ] `webkitCompassAccuracy`: ___ (negativt = okalibrerad: rör telefonen i en åtta och prova igen)
- [ ] alpha-riktning: ___°  diff mot kompass: ___° (stabil eller driver den?)

**(b) Inspelning vid lutning.** Tryck "Spela in 30 s". Under tiden: håll telefonen upprätt (kameran mot gatan), luta långsamt ned tills kameran pekar mot marken, och tillbaka upp. Tryck "Kopiera logg" och klistra in CSV i chatten. Vi tittar på om heading hoppar, driver eller blir `–` när beta närmar sig 90° / 0°.
- [ ] Loggen kopierad och inklistrad

**(c) GPS-noggrannhet.**
- [ ] `noggrannhet` vid start: ±___ m; efter 30 s: ±___ m
- [ ] Plats: öppen/gatukanjon, antal sekunder till första fix: ___

### Checklista – grundtest (fyll i efter test)
- [ ] Bakre kameran visas
- [ ] GPS lat/lon visas, noggrannhet: ___ m (utomhus / inomhus)
- [ ] `webkitCompassHeading` ändras när jag vrider mig; pekar rätt mot norr (±): ___°
- [ ] alpha/beta/gamma ändras vid lutning
- [ ] iOS-version: ___
