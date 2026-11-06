# Uppehållstider (avgång − ankomst)

Källa: `public/metro.json` (GTFS stop_times). Viktat med antal trips. Ändstationer redovisas separat.

## Sammanfattning (feeden)
- Mellanliggande stopp: 171710 stopphändelser, min 0 s, median 0 s, max 0 s, nollor 100.0 %
- Ändstationer: 15768 stopphändelser, min 0 s, median 0 s, max 0 s, nollor 100.0 %

**Slutsats:** feeden innehåller inga uppehållstider. Ankomst = avgång på alla stopp, även ändstationerna. Utan modell rullar tågen igenom stationerna utan att stanna.

## Per linje (mellanliggande stopp, feeden)

| linje | stopphändelser | min | median | max | nollor |
|---|---|---|---|---|---|
| M1 | 69045 | 0 | 0 | 0 | 100.0 % |
| M2 | 29992 | 0 | 0 | 0 | 100.0 % |
| M3 | 21926 | 0 | 0 | 0 | 100.0 % |
| M4 | 23921 | 0 | 0 | 0 | 100.0 % |
| M5 | 26826 | 0 | 0 | 0 | 100.0 % |

## Uppehållsmodell (estimate: true)

Standard 22 s, ändstation 60 s (före avgång och efter ankomst), körtiden kortas högst 35 % och aldrig under 30 s. Undantag: DUOMO M1 35 s, DUOMO M3 35 s, CENTRALE FS 40 s, CADORNA FN M1 35 s, CADORNA FN M2 35 s, LORETO M1 35 s, LORETO M2 35 s, LOTTO FIERAMILANOCITY 32 s, LOTTO M5 32 s, GARIBALDI FS 35 s, ZARA 30 s, SAN BABILA 32 s, S.AMBROGIO 30 s, SAN AMBROGIO 30 s, P.TA GENOVA F.S. 30 s, LAMBRATE FS 30 s, ROGOREDO FS 30 s, CAIROLI 28 s, MONTENAPOLEONE 28 s.

| linje | station | ändstation | feed median (s) | modell min/median/max (s) |
|---|---|---|---|---|
| M1 | Amendola |  | 0 | 22 / 22 / 22 |
| M1 | Bande Nere |  | 0 | 22 / 22 / 22 |
| M1 | Bisceglie | ja | 0 | 60 / 60 / 60 |
| M1 | Bonola |  | 0 | 22 / 22 / 22 |
| M1 | Buonarroti |  | 0 | 22 / 22 / 22 |
| M1 | Cadorna FN |  | 0 | 31 / 33 / 35 |
| M1 | Cairoli |  | 0 | 28 / 28 / 28 |
| M1 | Conciliazione |  | 0 | 22 / 22 / 22 |
| M1 | Cordusio |  | 0 | 22 / 22 / 22 |
| M1 | De Angeli |  | 0 | 22 / 22 / 22 |
| M1 | Duomo |  | 0 | 23 / 30 / 35 |
| M1 | Gambara |  | 0 | 22 / 22 / 22 |
| M1 | Gorla |  | 0 | 22 / 22 / 22 |
| M1 | Inganni |  | 0 | 22 / 22 / 22 |
| M1 | Lampugnano |  | 0 | 22 / 22 / 22 |
| M1 | Lima |  | 0 | 22 / 22 / 22 |
| M1 | Loreto |  | 0 | 30 / 31 / 34 |
| M1 | Lotto Fieramilanocity |  | 0 | 29 / 32 / 32 |
| M1 | Molino Dorino | ja | 0 | 22 / 22 / 60 |
| M1 | P.ta Venezia |  | 0 | 22 / 22 / 22 |
| M1 | Pagano |  | 0 | 22 / 22 / 22 |
| M1 | Palestro |  | 0 | 22 / 22 / 22 |
| M1 | Pasteur |  | 0 | 22 / 22 / 22 |
| M1 | Pero |  | 0 | 22 / 22 / 22 |
| M1 | Precotto |  | 0 | 22 / 22 / 22 |
| M1 | Primaticcio |  | 0 | 22 / 22 / 22 |
| M1 | QT8 | ja | 0 | 22 / 22 / 60 |
| M1 | Rho Fieramilano | ja | 0 | 60 / 60 / 60 |
| M1 | Rovereto |  | 0 | 22 / 22 / 22 |
| M1 | S.Leonardo | ja | 0 | 22 / 22 / 60 |
| M1 | San Babila |  | 0 | 28 / 32 / 32 |
| M1 | Sesto 1 Maggio FS | ja | 0 | 60 / 60 / 60 |
| M1 | Sesto Marelli | ja | 0 | 22 / 22 / 60 |
| M1 | Sesto Rondo |  | 0 | 22 / 22 / 22 |
| M1 | Turro |  | 0 | 22 / 22 / 22 |
| M1 | Uruguay |  | 0 | 22 / 22 / 22 |
| M1 | Villa S.G. | ja | 0 | 22 / 22 / 60 |
| M1 | Wagner |  | 0 | 22 / 22 / 22 |
| M2 | Abbiategrasso | ja | 0 | 60 / 60 / 60 |
| M2 | Assago Milanofiori Forum | ja | 0 | 60 / 60 / 60 |
| M2 | Assago Milanofiori Nord |  | 0 | 22 / 22 / 22 |
| M2 | Bussero |  | 0 | 22 / 22 / 22 |
| M2 | Cadorna FN |  | 0 | 31 / 35 / 35 |
| M2 | Caiazzo |  | 0 | 22 / 22 / 22 |
| M2 | Cascina Antonietta | ja | 0 | 22 / 22 / 60 |
| M2 | Cascina Burrona |  | 0 | 22 / 22 / 22 |
| M2 | Cascina Gobba | ja | 0 | 22 / 22 / 60 |
| M2 | Cassina De Pecchi |  | 0 | 22 / 22 / 22 |
| M2 | Centrale FS |  | 0 | 27 / 34 / 40 |
| M2 | Cernusco sul Naviglio |  | 0 | 22 / 22 / 22 |
| M2 | Cimiano |  | 0 | 22 / 22 / 22 |
| M2 | Cologno Centro |  | 0 | 22 / 22 / 22 |
| M2 | Cologno Nord | ja | 0 | 60 / 60 / 60 |
| M2 | Cologno Sud |  | 0 | 22 / 22 / 22 |
| M2 | Crescenzago |  | 0 | 22 / 22 / 22 |
| M2 | Famagosta | ja | 0 | 22 / 22 / 60 |
| M2 | Garibaldi FS |  | 0 | 35 / 35 / 35 |
| M2 | Gessate | ja | 0 | 60 / 60 / 60 |
| M2 | Gioia |  | 0 | 22 / 22 / 22 |
| M2 | Gorgonzola | ja | 0 | 22 / 22 / 60 |
| M2 | Lambrate FS |  | 0 | 30 / 30 / 30 |
| M2 | Lanza |  | 0 | 22 / 22 / 22 |
| M2 | Loreto |  | 0 | 35 / 35 / 35 |
| M2 | Moscova |  | 0 | 22 / 22 / 22 |
| M2 | P.ta Genova F.S. |  | 0 | 30 / 30 / 30 |
| M2 | Piola |  | 0 | 22 / 22 / 22 |
| M2 | Romolo |  | 0 | 22 / 22 / 22 |
| M2 | S.Agostino |  | 0 | 22 / 22 / 22 |
| M2 | S.Ambrogio |  | 0 | 25 / 28 / 30 |
| M2 | Udine |  | 0 | 22 / 22 / 22 |
| M2 | Villa Fiorita |  | 0 | 22 / 22 / 22 |
| M2 | Villa Pompea |  | 0 | 22 / 22 / 22 |
| M2 | Vimodrone |  | 0 | 22 / 22 / 22 |
| M3 | Affori Centro |  | 0 | 22 / 22 / 22 |
| M3 | Affori FN |  | 0 | 22 / 22 / 22 |
| M3 | Brenta |  | 0 | 22 / 22 / 22 |
| M3 | Centrale FS |  | 0 | 31 / 33 / 37 |
| M3 | Comasina | ja | 0 | 60 / 60 / 60 |
| M3 | Corvetto |  | 0 | 21 / 22 / 22 |
| M3 | Crocetta |  | 0 | 22 / 22 / 22 |
| M3 | Dergano |  | 0 | 22 / 22 / 22 |
| M3 | Duomo |  | 0 | 34 / 35 / 35 |
| M3 | Lodi T.I.B.B. |  | 0 | 22 / 22 / 22 |
| M3 | Maciachini |  | 0 | 22 / 22 / 22 |
| M3 | Missori |  | 0 | 22 / 22 / 22 |
| M3 | Montenapoleone |  | 0 | 23 / 28 / 28 |
| M3 | Porta Romana |  | 0 | 22 / 22 / 22 |
| M3 | Porto di Mare |  | 0 | 22 / 22 / 22 |
| M3 | Repubblica |  | 0 | 22 / 22 / 22 |
| M3 | Rogoredo FS |  | 0 | 27 / 30 / 30 |
| M3 | San Donato | ja | 0 | 60 / 60 / 60 |
| M3 | Sondrio |  | 0 | 22 / 22 / 22 |
| M3 | Turati |  | 0 | 22 / 22 / 22 |
| M3 | Zara |  | 0 | 25 / 29 / 30 |
| M4 | Argonne |  | 0 | 22 / 22 / 22 |
| M4 | Bolivar |  | 0 | 22 / 22 / 22 |
| M4 | California |  | 0 | 22 / 22 / 22 |
| M4 | Coni Zugna |  | 0 | 22 / 22 / 22 |
| M4 | Dateo |  | 0 | 22 / 22 / 22 |
| M4 | De Amicis |  | 0 | 22 / 22 / 22 |
| M4 | Frattini |  | 0 | 22 / 22 / 22 |
| M4 | Gelsomini |  | 0 | 22 / 22 / 22 |
| M4 | Linate Aeroporto | ja | 0 | 60 / 60 / 60 |
| M4 | Repetti |  | 0 | 22 / 22 / 22 |
| M4 | San Ambrogio |  | 0 | 28 / 30 / 30 |
| M4 | San Babila |  | 0 | 32 / 32 / 32 |
| M4 | San Cristoforo | ja | 0 | 60 / 60 / 60 |
| M4 | Santa Sofia |  | 0 | 22 / 22 / 22 |
| M4 | Segneri |  | 0 | 22 / 22 / 22 |
| M4 | Sforza-policlinico |  | 0 | 22 / 22 / 22 |
| M4 | Stazione Forlanini |  | 0 | 22 / 22 / 22 |
| M4 | Susa |  | 0 | 22 / 22 / 22 |
| M4 | Tolstoj |  | 0 | 22 / 22 / 22 |
| M4 | Tricolore |  | 0 | 22 / 22 / 22 |
| M4 | Vetra |  | 0 | 22 / 22 / 22 |
| M5 | Bicocca |  | 0 | 22 / 22 / 22 |
| M5 | Bignami | ja | 0 | 60 / 60 / 60 |
| M5 | Ca Granda |  | 0 | 22 / 22 / 22 |
| M5 | Cenisio |  | 0 | 22 / 22 / 22 |
| M5 | Domodossola |  | 0 | 22 / 22 / 22 |
| M5 | Garibaldi FS |  | 0 | 34 / 35 / 35 |
| M5 | Gerusalemme |  | 0 | 22 / 22 / 22 |
| M5 | Isola |  | 0 | 22 / 22 / 22 |
| M5 | Istria |  | 0 | 22 / 22 / 22 |
| M5 | Lotto |  | 0 | 30 / 31 / 32 |
| M5 | Marche |  | 0 | 22 / 22 / 22 |
| M5 | Monumentale |  | 0 | 22 / 22 / 22 |
| M5 | Ponale |  | 0 | 22 / 22 / 22 |
| M5 | Portello |  | 0 | 22 / 22 / 22 |
| M5 | San Siro Ippodromo |  | 0 | 22 / 22 / 22 |
| M5 | San Siro Stadio | ja | 0 | 60 / 60 / 60 |
| M5 | Segesta |  | 0 | 22 / 22 / 22 |
| M5 | Tre Torri |  | 0 | 22 / 22 / 22 |
| M5 | Zara |  | 0 | 30 / 30 / 30 |
