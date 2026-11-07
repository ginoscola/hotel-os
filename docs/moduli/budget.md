<!-- Spostato da CLAUDE.md il 07/11/2026, testo invariato: dove si legge "questa sezione" o "in CLAUDE.md" si intende questo file. Le regole generali restano in CLAUDE.md. -->

## Modulo Budget
4 input settimanali: occupancy_budget (%), adr_budget, adr_fnb_budget, adr_extra_budget.
`rooms_sold_budget = round(occupancy/100 * rooms_available)`. KPI derivati calcolati in `budget_calculator.py`.
**Mese contabile**: mese con più giorni nella settimana (≥4, nessuna parità possibile).
**Versioning**: v1 = ufficiale; v2+ copiate da source_version, completamente indipendenti.
**Proiezione** (v3.25.0, `_proiezione_hotel()` in `budget.py`, usata anche da `/gruppo/{anno}/proiezione`):
per ogni settimana di budget, rispetto all'ultima snapshot Revenue ≤ oggi dell'anno di budget:
`consuntivo` (tutti i giorni prima della snapshot) → dati Revenue; `in_corso`/`previsione` → **previsione
pickup** (`services/pickup_forecast.py::previsione_stagione`); `otb` (in corso senza storico) → prenotato;
`budget` (nessuna snapshot o nessuno storico) → budget. Trend: 'sopra/sotto_budget/in_linea' (soglia 5%).
Previsione pickup: per la settimana W a D giorni dall'arrivo, settimane di riferimento = W − 364gg·k (anni
precedenti) ±2 settimane; per ognuna OTB alla snapshot con lo stesso anticipo (la più vicina entro 4gg) e
valore finale; previsione = 50% OTB × (ΣFinale/ΣOTB) + 50% (OTB + media(Finale−OTB)), anni pesati 2:1.
Previsti a parte camere vendute e ricavi camere/F&B/extra; camere ≤ disponibili. Il correttivo % (per mese o
stagione) agisce solo sul pickup previsto, mai sull'OTB.
**Regolazione da Admin** (v3.26.0, `?s=budget-previsione` → `pages/admin/AdminBudgetPrevisione.jsx`,
router `budget_previsione.py` con prefix **`/budget-previsione`**, separato da `/budget` per non collidere
con `/budget/{hotel_code}/{season_year}`):
- **Correttivi** tabella `budget_previsione_correttivi` (`budgetprev001_2026`): per hotel × stagione × mese,
  **mese 0 = stagione** (non NULL, così la UNIQUE funziona), mese prevale su stagione (mese = prevalente
  nella settimana), da −90% a +200%. `GET /correttivi?anno=` (griglia hotel con stagione × mesi di
  stagione), `PUT /correttivi` (`correttivo_pct: null` = cancella). Nella tab Proiezione la risposta
  espone `correttivi` (non nulli) e ogni riga `correttivo_pct`; mostrati in viola `colors.accent`.
- **Parametri algoritmo** in `app_config['budget_previsione_parametri']` (JSON, creato al primo
  salvataggio): `peso_moltiplicativo`, `finestra_settimane`, `tetto_coefficiente`, `peso_anni`,
  `tolleranza_giorni` — `leggi_parametri()`/`valida_parametri()` in `pickup_forecast.py` (default se riga
  assente o corrotta). `GET|PUT /parametri` (PUT parziale: le chiavi non inviate restano).
- **Controllo dell'algoritmo** (v3.27.0, `GET /budget-previsione/controllo?anno=`, prima card della pagina
  Admin): `controllo_previsione()` in `pickup_forecast.py`, nessuna tabella — tutto ricalcolato dalle
  snapshot. Per ogni settimana chiusa rifà la previsione **senza correttivo** alla snapshot di 2/4/8
  settimane prima (`ANTICIPI_CONTROLLO`, la più vicina entro la tolleranza) via `_prevedi()` (stessa
  funzione della proiezione) e la confronta col finale: errore medio, scostamento (> 0 = sovrastima),
  vendite previste/reali, **correttivo suggerito = Σ vendite reali / Σ vendite previste − 1** (per distanza
  e complessivo; `None` sotto `MIN_SETTIMANE_SUGGERIMENTO` = 3). "Applica alla stagione" scrive il
  complessivo come correttivo mese 0. Ritmo: OTB per mese solare alla snapshot corrente vs anno precedente
  alla snapshot più vicina a −364gg (`StoricoAnno.otb_mese`/`finale_mese`) — informativo, già incorporato
  dall'algoritmo, non da trasformare in correttivo. Utile solo da giugno 2027 (precisione) / marzo 2027
  (ritmo): sul 2026 manca il 2025 come storico.
- **Spiegazione** `components/SpiegazionePrevisione.jsx` (pulsante "ⓘ Come funziona la previsione?" +
  `Modal`, con i parametri in uso letti da `/budget-previsione/parametri`): nella tab Proiezione e in
  Admin. **Se cambia l'algoritmo, aggiornare anche quel testo.**
Prova sul 2026 (settimane vicine dello stesso anno come proxy dell'anno precedente, quindi ottimistica):
errore sul ricavo di stagione 1–2,5% già da marzo, contro 40–70% del solo OTB; un tetto al coefficiente
(×4) peggiorava l'inizio stagione (DPH vende molto sotto data, coefficienti ×9 a 20 settimane normali).
Imparare il coefficiente solo dalle settimane già chiuse della stagione in corso sbaglia molto (maggio/giugno
non somigliano ad agosto): serve lo storico degli anni precedenti, quindi dal 2027 (primi dati 2026).
⚠️ Fino alla v3.24.x la proiezione contava come "completata" ogni settimana con righe in `daily_revenue`,
comprese quelle future (ogni snapshot PlanningForecast copre l'intera stagione): proiezione = prenotato.
⚠️ Fino alla v3.24.3 la soglia del trend era confrontata con `5` invece di `0.05` (`sd()` dà una frazione):
il giudizio risultava quasi sempre "in linea". Corretto in v3.24.4 (`test_proiezione_trend_soglia_5_per_cento`).

Endpoint chiave: `PUT /budget/{hotel}/{year}/{week_start}`, `GET /budget/{hotel}/{year}/confronto[/mensile]`, `GET /budget/{hotel}/{year}/proiezione`, `POST /budget/{hotel}/{year}/import-excel`, `GET /budget/gruppo/{year}/confronto|proiezione`.
Frontend: 4 tab (Inserimento / Confronto Actual vs Budget / Proiezione / Gruppo).

**Riempi con dati anno precedente** (v3.18.0, ottobre 2026): `POST /budget/{hotel}/{anno}/precompila-anno-precedente?version=&sovrascrivi=false`
(admin) + pulsante "Riempi con dati {anno-1}" nella tab Inserimento. Sorgente = **consuntivo** (statistiche
`daily_revenue`, snapshot più recente via `_actual_settimanale()`), non il budget dell'anno prima. Settimana
corrispondente = `week_start − 364gg` (sabato↔sabato). Copia i 4 input (occupancy %, ADR, F&B ed Extra per
camera venduta = revenue/rooms_sold della settimana); camere vendute e revenue ricalcolati da
`_calcola_e_salva()` sulle camere disponibili dell'anno di budget (stagioni diverse → settimane parziali
scalate). Settimane senza consuntivo (es. CLB 2027 apre il 22/05, nel 2026 chiuso) restano vuote e sono
elencate nella risposta; già compilate saltate salvo `sovrascrivi`. Budget 2027 v1 di DPH/CLB/INT compilato
così il 07/10/2026 (note riga "Da consuntivo 2026 (sett. …)").
**Esporta tab Inserimento** (v3.24.0, ottobre 2026): `GET /budget/{hotel}/{anno}/export?version=&formato=xlsx|csv|pdf`
(`ExportMenu` nella barra della tab). Tutte le settimane di stagione (anche senza budget) + riga TOTALE (KPI
sui totali, stessa logica della riga TOTALE a schermo), dati **salvati** in DB. L'**xlsx è reimportabile** con
"Importa da Excel": intestazioni scelte tra gli alias di `budget_importer._MAPPING` (`Settimana` = data del
sabato, `Occupancy%`, `ADR`, `ADR F&B`, `ADR Extra`, `Note`; le altre colonne sono informative e ignorate).
Nell'xlsx (v3.24.2) Settimana/Mese/Cam. Disponibili e i 4 input sono valori, il resto sono **formule
Excel** (camere vendute `ROUND(occ/100×disp)` — mezzo per eccesso come l'app —, Inc. F&B %, RevPAR,
TRevPAR, Rev. Totale; riga TOTALE con `SUM`/`SUMPRODUCT`, KPI sui totali): modificando un input in Excel
riga e totale si ricalcolano. Come la tab, camere vendute e KPI solo con occupazione **e** ADR compilati.
openpyxl non salva il risultato delle formule (`fullCalcOnLoad`, le calcola Excel all'apertura): l'importer
legge solo le colonne fisse, quindi il file resta reimportabile anche senza essere aperto. CSV/PDF: valori.
L'importer salta la riga `TOTALE` e le righe senza occupazione/ADR/camere vendute (come la tab, che non salva
una settimana senza occupazione né ADR). Se si rinomina una colonna dell'export, verificare che resti un
alias dell'importer (`test_export_budget_reimport_identico`). Il CSV (`;`, virgola decimale) non è
reimportabile: l'import accetta solo xlsx.
⚠️ Camere vendute budget = occupancy × disponibili arrotondato **con il mezzo per eccesso** (150,5 → 151):
`calcola_kpi_budget()` usa `math.floor(x + 0.5)`, uguale a `Math.round()` della tab. Fino alla v3.24.0 usava
`round()` di Python (arrotonda al pari, 150,5 → 150) e la tab mostrava 1 camera in più di quanto salvato/
esportato; corretto in v3.24.1 (nessuna riga in DB era a ,5, nessun ricalcolo necessario). Mai `round()` qui.
**Tabelle per mese** (v4.17.0, solo frontend): in Inserimento e Proiezione, hotel e ristoranti, sola lettura; ogni settimana intera nel mese con la maggioranza dei giorni, regola del mese contabile (`perMeseContabile()` in `pages/budget/helpers.js`), KPI sui totali. Inserimento si aggiorna mentre si digita.
**Budget ristoranti** (v4.6.0, 30/10/2026, scheda "Ristoranti" → `pages/budget/TabRistoranti.jsx`): tabella
`budget_ristoranti` (`budgetrist001_2026`; struttura MMS|BON, anno, settimana, versione, importo, note), non
righe in `hotels`/`budget_entries` (Dashboard e Forecast iterano `hotels`; occupazione/ADR non hanno senso).
Un solo importo settimanale di **incasso IVA inclusa** (aliquota unica 10%). **MMS = solo clienti esterni**:
gli ospiti Du Parc restano nel F&B del budget DPH, quindi nessun doppio conteggio e nessun budget del Mare
Mosso nel suo complesso. Consuntivo = `corrispettivi_manuali.arrangiamenti_lordo` (non test), per settimana.
Logica in `services/budget_ristoranti.py`, router `budget_ristoranti.py` (prefix `/budget-ristoranti`:
`GET /{anno}`, `PUT /{anno}/{week_start}` — importo null cancella —, `POST /{anno}/precompila` = settimana −364
gg, `GET /{anno}/export`). Griglia: dalla prima apertura all'ultima chiusura degli hotel + settimane con dati
(nessuna stagione propria). Scostamento **solo su settimane chiuse con budget e consuntivo**; proiezione =
consuntivo delle chiuse, altrimenti budget (niente pickup: nessuna prenotazione). `GET /budget/gruppo/{anno}/
confronto` espone `ristoranti`: la scheda Gruppo li somma ai ricavi, KPI camere solo hotel. La Home usa
`_confronto_gruppo_dati()`, che resta solo hotel. Le versioni non si clonano come per gli hotel: una versione
nuova si riempie a mano o da anno precedente. Tesoreria Fase 3: leggere gli incassi da qui.
**Confronto e Proiezione anche per i ristoranti** (v4.7.0): MMS/BON nel selettore delle due schede (non in
Inserimento: passandoci con un ristorante selezionato si torna su DPH), `pages/budget/VisteRistorante.jsx` sui
dati di `GET /budget-ristoranti/{anno}` (`fonte` per settimana, `trend` con soglia 5%, `settimane_chiuse/totali`).
Niente camere, OTB e pickup. Helper comuni in `pages/budget/helpers.js`.
Scheda Gruppo (v4.7.1, `riepilogo_gruppo()`): senza settimane confrontabili lo scostamento è actual − budget,
come gli hotel, così la colonna non resta vuota; le schede del singolo ristorante restano sulle settimane chiuse.
⚠️ **`daily_revenue.hotel_id` era NULL su tutti gli upload dal 15/06/2026** (bug reale, trovato qui):
`_upsert_daily_revenue` in `upload.py` non valorizzava mai `hotel_id` (le righe precedenti erano state
riempite da una migrazione), e `_actual_settimanale()` filtrava proprio su `hotel_id` → Confronto Actual vs
Budget, Proiezione e il gauge "vs budget" della Home usavano per ogni data l'ultimo snapshot fino all'08/06
(es. DPH Ferragosto 12% invece di 90%). Fix: `_actual_settimanale()` filtra su `hotel_code`, l'upload
valorizza `hotel_id`, backfill di 5.520 righe. I test di integrazione (`test_budget.py` ecc.) girano
sul DB dedicato `hotel_os_test` (vedi "Comandi sviluppo") — mai puntarli al DB reale, il fixture fa
TRUNCATE di `hotels`.
⚠️ **Tab Inserimento mostrava tutte le settimane vuote anche con budget in DB** (bug reale, v3.18.1):
`tutteLeSettimane` in `Budget.jsx` generava le chiavi settimana con `toISOString()` (UTC) — in Italia la
mezzanotte del sabato diventa venerdì 22:00Z, quindi le chiavi erano venerdì e non combaciavano con i
`week_start` (sabato) del DB; un valore digitato a mano sarebbe stato salvato con `week_start` di venerdì.
Fix: data formattata in ora locale. Mai `toISOString()` per ricavare una data da un `Date` locale.
⚠️ **Le celle della tab Inserimento salvavano il valore senza l'ultimo tasto** (bug reale, v3.24.3): il
salvataggio ritardato (`setTimeout` 500ms in `handleCellChange`) chiamava `salvaSettimana` del render in
cui era stato creato, quindi leggeva `localEdit` senza l'ultima modifica — "70" salvato come 7, 70→70,1 con
la freccetta salvato 70; a schermo sembrava giusto finché non si ricaricava la pagina. Fix: `editRef`/
`settimaneRef` con i valori correnti, letti da `salvaSettimana`. Mai leggere stato React dentro un
`setTimeout` di debounce: usare un ref o passare il valore.
Riga **TOTALE** in fondo alla tab Inserimento (v3.18.2): somme di stagione e KPI sui totali (occupancy =
Σcamere vendute/Σcamere disponibili, ADR/F&B/Extra per camera = Σrevenue/Σcamere vendute, RevPAR/TrevPAR su
Σdisponibili). Le camere disponibili includono anche le settimane ancora senza budget (contano 0 vendute):
l'occupancy totale è quella della stagione intera, non solo delle settimane compilate. Calcolo per riga
estratto in `valoriRiga()`, usato sia dalle righe sia dal totale.

⚠️ **3 bug reali scoperti e corretti (luglio 2026)**, trovati risolvendo i 401 mascherati nei test
di integrazione (`test_budget.py`/`test_config.py`/`test_dashboard_gruppo_modalita.py`: le fixture
`client` sovrascrivevano solo `get_db`, non l'autenticazione — override diretto di `richiedi_admin`/
`richiedi_utente_attivo` ora applicato ovunque, come già in `test_backup.py`). Tolto quel mascheramento,
sono emersi fallimenti reali — **`budget_entries` aveva 0 righe nel database di produzione**, il
salvataggio di una singola settimana non aveva mai funzionato dal 25/05/2026:
1. `PUT /budget/{hotel}/{year}/{week_start}` richiedeva `week_start` anche nel body JSON (schema
   condiviso con l'endpoint bulk, dove serve davvero). Il frontend (`Budget.jsx`) non lo manda mai →
   422 sistematico. Fix: `BudgetSettimanaSingolaInput` (senza `week_start`) solo per l'endpoint singolo.
2. `occupancy_budget`/`inc_rooms_budget`/`inc_fnb_budget`/`inc_extra_budget` erano `Numeric(5,4)`
   (max 9,9999) ma l'app vi salva percentuali 0-100 → overflow garantito su ogni valore realistico.
   Migrazione `budgetfix001_2026` → `Numeric(5,2)` (come le gemelle `pct_fnb_budget`/`pct_extra_budget`
   nella stessa migrazione originale, già corrette). Aggiornato anche il modello SQLAlchemy.
3. L'endpoint di clonazione versione (`POST /budget/{hotel}/{year}/version`) referenziava ancora
   `pct_fnb_budget`/`pct_extra_budget`: colonne rimosse dalla migrazione `y5z6a7b8c9d0` (26/05/2026,
   sostituite da `adr_fnb_budget`/`adr_extra_budget`), mai aggiornato di conseguenza. Corretto a
   `adr_fnb_budget`/`adr_extra_budget`.
   ⚠️ I test di questo modulo creano lo schema con `Base.metadata.create_all()` dal modello SQLAlchemy,
   non dalla catena di migrazioni Alembic: non rilevano drift modello↔migrazioni↔DB reale come questo.
   Verificare a vista con `alembic current`/`\d budget_entries` se si sospetta disallineamento.
