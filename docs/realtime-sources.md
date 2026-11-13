# Realtidskällor för Milanos metro (steg 0)

Undersökt 2026-11-13 (fredag, 23:00–23:30 Rom-tid). Bara läsning. Inget är registrerat, inget mejl skickat.

## Slutsats

**Det finns ingen öppen, användbar realtidskälla för M1–M5 i dag.** Inget GTFS-Realtime för ATM finns i Mobility Database eller Transitland, och inte heller på kommunens dataportal. ATM:s egen linjestatus i E015 kräver ett avtal som bara juridiska personer med säte och registrering i Italien kan teckna. Giromilano blockerar ärliga klienter (403). Därför byggs ingen adapter mot en extern källa och inget proxyskript (steg 3 utgår). Realtidslagret får manuell justering ("Tåget kom nu") och ett färdigt, oanslutet skelett för en framtida officiell feed.

## Översikt

| Källa | Täcker metro | Realtid eller schema | Kräver registrering | Villkor | Rekommendation |
|---|---|---|---|---|---|
| dati.comune.milano.it, DS929 GTFS | ja | schema (uppdateras ungefär varannan vecka) | nej | CC BY 4.0 | Används redan. Fortsätt |
| dati.comune.milano.it, övriga ATM-dataset (DS533–DS539, DS2952) | ja | schema/årsstatistik | nej | CC BY 4.0 | Inget nytt för realtid |
| Mobility Database (katalog) | – | ingen RT för ATM | nej (katalogen) | – | Bevaka. Ingen feed att ansluta |
| Transitland | – | ingen RT för ATM | nej (webbsidan) | – | Bevaka |
| ATM:s webbplats/öppna data | – | ingen utvecklarkanal hittad | – | – | Kontakt via kommun/Agenzia TPL (se nedan) |
| E015 "Stato Linee Metropolitane 2.0" (ATM) | delvis (linjestatus, inte tåg) | status (realtid oklart) | ja, E015-avtal | ATM:s policy: inte ändra data, visa senaste uppdateringstid | Inte möjligt för privatperson. StatusSource byggs mot fixture |
| E015 "GTFS Static e Real Time v2.0" | nej (Trenord, regionaltåg) | realtid | ja | – | Inte relevant för metron |
| Giromilano `tpl/stops/{kod}/linesummary` | nej (WaitMessage null för metro enligt dina tester) | väntetider buss/tram | nej, men blockerar | oofficiell | Används inte. 403 för ärlig klient |
| Nationell åtkomstpunkt (NAP, cciss.it) | oklart | NeTEx/SIRI | ja (inloggning) | okänt | Fråga i mejlet om Lombardiets RT finns där |
| Google Maps, Moovit, Citymapper, Apple Maps | – | – | – | förbjuder automatisk hämtning | Undersöks inte, skrapas inte |

## Källorna i detalj

### 1. Comune di Milano, dati.comune.milano.it
- Sökning på "tempo reale" gav **0 dataset**: https://dati.comune.milano.it/dataset?q=tempo+reale (2026-11-13).
- Sökning på "ATM" gav 10 dataset, alla statiska eller årsstatistik: https://dati.comune.milano.it/dataset?q=ATM
  - DS535 Fermate, DS539 Percorsi, DS537 Orari och DS533 Composizione percorsi för metrolinjerna (statiska).
  - DS2952 "Trasporto Pubblico Locale: dati sul servizio", årliga nyckeltal 2005–2025: https://dati.comune.milano.it/dataset/ds2952-trasporto-pubblico-locale-dati-sul-servizio
  - DS929 GTFS (den vi använder): https://dati.comune.milano.it/dataset/ds929-orari-del-trasporto-pubblico-locale-nel-comune-di-milano-in-formato-gtfs . Licens Creative Commons Attribution. Uppdateras "quindicinale" (ungefär varannan vecka). Utgivare: Direzione Mobilità, Ambiente e Energia. Underhåll: AMAT. Kontakt: `opendatamilano@comune.milano.it`. Beskrivningen säger att datan genereras ur "dati di programmato" (planerad trafik), alltså inte realtid.

### 2. Mobility Database
- Hela katalogen hämtades som CSV (https://share.mobilitydata.org/catalogs-csv, som pekar till `storage.googleapis.com/.../mdb-csv/o/sources.csv`). Den har 3 630 rader, varav 1 080 GTFS-RT.
- ATM Milano finns bara som **mdb-2666, GTFS Schedule** (producer-URL `https://dati.comune.milano.it/gtfs.zip`, tjänsteperiod 26 okt–30 nov 2026): https://mobilitydatabase.org/feeds/gtfs/mdb-2666
- **Ingen GTFS-RT-post refererar till mdb-2666.** Italienska RT-flöden finns för till exempel Rom (Roma Servizi per la Mobilità), Turin (GTT), Venedig (ACTV) och flera BusOne-proxyflöden, men inget för Milano.

### 3. Transitland
- Sökning på "milano": https://www.transit.land/feeds?search=milano. Där finns `f-u0nd-comunedimilano` (statisk GTFS, CC-BY-4.0, operatör ATM) och ett Pavia-Milano-flöde. Inget GTFS-RT.
- Flödessidan https://www.transit.land/feeds/f-u0nd-comunedimilano listar inga realtidsflöden.

### 4. ATM:s egen öppna data
- Ingen sektion för öppna data eller utvecklare hittades på atm.it. Kontaktsidorna (se nedan) har ingen kanal för data eller partnerskap.
- ATM:s app och webb visar realtidsinformation (väntetider vid hållplatser, hissar och rulltrappor via https://isb.atm.it/), men utan något dokumenterat öppet gränssnitt.

### 5. E015 (Regione Lombardia)
- **"Stato Linee Metropolitane 2.0"**, leverantör ATM: https://www.e015.regione.lombardia.it/site/api-detail?id=299 . Sidan beskriver den som information om metrolinjernas regelbundenhet ("regolarità delle linee metropolitane"), alltså linjestatus och inga tåg eller ankomster. Fältformat redovisas inte publikt.
- ATM:s användningspolicy (PDF, https://www.e015.regione.lombardia.it/site/download-policy?id=299):
  - det är förbjudet att manipulera eller ändra datan,
  - tidpunkten för senaste uppdatering ska visas för användaren,
  - reklam får inte visas utan ATM:s godkännande,
  - användaren förutsätts känna till ATM:s etiska kod och modell 231.
- **Vem kan ansluta:** exempelavtalet (Contratto di adesione, länkat från https://www.e015.regione.lombardia.it/site/guidelines) definierar "Aderente" som "operatore economico, società, ente pubblico o privato" med "sede legale" och registrering i handelsregistret. Den som ansluter måste också uppfylla de allmänna kraven för avtal med offentlig förvaltning (art. 80 D.Lgs 50/2016). Deltagandet är gratis. Avtalet gäller till 31 december 2026. Inloggningen sker via SPID/CIE/CNS (italiensk e-legitimation).
- **"GTFS Static e Real Time v2.0"** är Trenord (regionaltåg), inte ATM. Det bygger på din tidigare kontroll och är inte omverifierat av mig.

### 6. Giromilano (oofficiellt, ATM:s webbackend)
- 2026-11-13 kl. 22:17 UTC (23:17 i Milano) skickades **ett** anrop: `GET https://giromilano.atm.it/proxy.tpportal/api/tpPortal/tpl/stops/-308/linesummary` med `User-Agent: MilanoMetroAR-hobby/0.1`, `Accept: application/json` och inga cookies.
- Svaret var **403 Access Denied**, en HTML-sida från Akamai (`errors.edgesuite.net`). Rått svar och headers finns i `test/fixtures/giromilano/2026-11-13T2217Z/`.
- Enligt reglerna stoppades proben där. Inga fler stationer, ingen andra omgång (rusning) och inga andra headers.
- **WaitMessage för metro kan därför inte stängas av mig med nya mätningar.** Det som finns är dina tidigare manuella tester (M2 `-9` och `-2`, M5 `-308`), där WaitMessage var null för metro, och att `tpl/stops/{kod}/timetable` gav null. Frågan spelar ingen praktisk roll: källan är oofficiell och blockerar ärliga klienter, så den kan inte användas i appen.
- `tools/probe-atm.mjs` finns för framtida dokumentation. Det håller 30 s mellan anrop, använder ärlig User-Agent och inga cookies, stoppar vid 401/403/429/HTML och sparar råa svar som fixtures.

### 7. Nationell åtkomstpunkt (NAP) för multimodal reseinformation
- Italiens NAP (CCISS) listar "Regione Lombardia" som dataleverantör men inte ATM: https://www.cciss.it/nap/mmtis/public/en/static/multimodal . Data levereras som NeTEx (schema) och SIRI (realtid). Om Milanos metro finns med i realtid gick inte att se utan inloggning. **Oklart.** Därför finns frågan med i mejlmallen.

## Vad du kan göra själv (ingenting är gjort åt dig)

### E015, om du någon gång har ett italienskt bolag eller en organisation bakom dig
1. Logga in via "Accedi | Registrati" på https://www.e015.regione.lombardia.it/ . Det kräver SPID, CIE eller CNS.
2. Fyll i anslutningen. Avtalet (Contratto di adesione) genereras och godkänns av Regione Lombardia via automatiskt mejl.
3. Begär användning av API 299 ("Stato Linee Metropolitane 2.0") i katalogen. Leverantören (ATM) godkänner.
4. Följ ATM:s policy: visa senaste uppdateringstid och ändra inte datan. E015-loggan ska synas i appen enligt avtalet art. 4.12.

Som privatperson i Sverige uppfyller du enligt exempelavtalet sannolikt inte kraven (säte och handelsregister). Det är min tolkning av avtalstexten och inte bekräftat av E015.

### Kontaktvägar (bara uppgifter från organisationernas egna sidor)

| Organisation | Kontakt | Källa | Kommentar |
|---|---|---|---|
| Comune di Milano, Open Data | `opendatamilano@comune.milano.it` | https://dati.comune.milano.it/dataset/ds929-orari-del-trasporto-pubblico-locale-nel-comune-di-milano-in-formato-gtfs (fältet Manutentore/kontakt) | Kontakt för GTFS-datasetet. **Rekommenderad första kontakt** |
| Agenzia TPL (Milano, Monza Brianza, Lodi, Pavia) | `segreteria@agenziatpl.it`, PEC `protocollo@pec.agenziatpl.it`, tel. 02 8844 1673, via Tommaso Pini 1, 20134 Milano | https://www.agenziatpl.it/ (sidfoten; kontaktsidan https://www.agenziatpl.it/contatti är inte öppnad av mig) | Beställare och tillsyn av kollektivtrafiken. Publicerar egen GTFS (https://www.agenziatpl.it/open-data/gtfs) |
| ATM | Postadress Foro Buonaparte 61, 20121 Milano. Infoline 02 48 607 607 | https://www.atm.it/en/Pages/Contacs.aspx | **Ingen verifierad kanal för data eller utvecklare.** Reklamationsformuläret (https://areariservata.atm.it/reclami/insert) är för klagomål. Pressbyrån och appsupporten är inte rätt mottagare. Jag har inte kunnat verifiera en lämplig mejladress till ATM |
| E015, Technical Management Board | `e015-tmb@regione.lombardia.it` | https://www.e015.regione.lombardia.it/ | Kopplad till publicering av API:er. Kan svara på om privatpersoner kan ansluta |

AMAT underhåller GTFS-filen men har ingen egen verifierad kontakt för detta. Kommunens adress ovan är den som anges på datasetet.

## Mejlmallar (skicka själv om du vill)

### Italienska

> **Oggetto:** Richiesta di accesso a dati in tempo reale della metropolitana (uso non commerciale)
>
> Buongiorno,
>
> sono uno sviluppatore privato e sto realizzando, a titolo di hobby e senza scopo commerciale, un'applicazione web che mostra la posizione stimata dei treni delle linee M1–M5 a partire dal GTFS pubblicato su dati.comune.milano.it (DS929), con attribuzione CC BY 4.0 a Comune di Milano / ATM.
>
> Vorrei chiedere se esiste, o se è prevista, una fonte ufficiale di dati in tempo reale per la metropolitana, ad esempio GTFS-Realtime (Trip Updates o Vehicle Positions) oppure SIRI tramite il Punto di Accesso Nazionale, e se sia possibile accedervi per un uso personale e non commerciale. Se la richiesta va rivolta a un altro ufficio o ad ATM, vi sarei grato se poteste indicarmi il contatto corretto.
>
> Rispetterò le condizioni d'uso indicate, compresi limiti di frequenza delle richieste e attribuzione.
>
> Grazie per l'attenzione e cordiali saluti,
> [Nome Cognome]
> [Paese]

### Engelska

> **Subject:** Request for access to real-time metro data (non-commercial use)
>
> Hello,
>
> I am a private developer building a non-commercial hobby web app that shows the estimated positions of trains on Milan metro lines M1–M5, based on the GTFS published on dati.comune.milano.it (DS929), with CC BY 4.0 attribution to Comune di Milano / ATM.
>
> I would like to ask whether an official real-time data source for the metro exists or is planned, for example GTFS-Realtime (Trip Updates or Vehicle Positions) or SIRI via the National Access Point, and whether it could be accessed for personal, non-commercial use. If this request should go to another office or to ATM directly, I would be grateful if you could point me to the right contact.
>
> I will follow any terms of use, including request rate limits and attribution.
>
> Thank you for your time. Kind regards,
> [Name Surname]
> [Country]

## Rekommenderad nästa kontakt
1. Skicka det italienska mejlet till **Comune di Milano Open Data** (`opendatamilano@comune.milano.it`). De publicerar GTFS:en och är angiven kontakt för den.
2. Sätt **Agenzia TPL** (`segreteria@agenziatpl.it`) som kopia. Agenturen beställer trafiken och kan veta om ATM har skyldighet att leverera realtidsdata till den nationella åtkomstpunkten.
3. Om svaret pekar på E015: fråga `e015-tmb@regione.lombardia.it` om en privatperson utanför Italien kan ansluta.
