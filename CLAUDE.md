# HotelOS — Istruzioni per Claude Code

> **Prima di scrivere codice**: presentare strategia, file coinvolti, rischi. Attendere conferma.
> **Aggiornare questo file** a ogni sessione con modifiche significative (endpoint, modelli, logica business).
> **Dopo ogni modifica testata e funzionante**: committare i file coinvolti e fare `git push origin main` per tenere GitHub aggiornato.
> **Versionamento** (`frontend/src/version.js`): PATCH x.x.+1 = fix/tweaks; MINOR x.+1.0 = nuova funzionalità/sezione; MAJOR +1.0.0 = nuovo modulo o redesign architetturale. Aggiornare APP_VERSION e APP_VERSION_DATE a ogni commit.

## Progetto e stack
Gestione alberghiera per gruppo (CLB=Club Hotel 45cam, DPH=Du Parc 43cam, INT=International 45cam).
Replica sistema Google Sheets + Apps Script. Lingua: italiano.
Stack: FastAPI + SQLAlchemy + Alembic + PostgreSQL / React + Vite / openpyxl + reportlab / pytest.

## Stagioni operative
Tabella `hotel_seasons` (hotel_id, season_year, open_date, close_date, total_rooms, notes).
Stagioni 2026: DPH 01/05–19/09, CLB e INT 30/05–19/09.
Parser con filtro stagionale: date fuori range → WARNING (non errore), contatore `righe_fuori_stagione`.

## Struttura cartelle
```
backend/
  app/
    services/   → logica business (parser, calculator, aggregator)
    routers/    → endpoint FastAPI (vedi sezioni moduli)
    models/     → SQLAlchemy (revenue.py, corrispettivi.py, analisi_ricavi.py, rooms.py, shared.py)
    schemas/    → Pydantic
    utils/
      locale_it.py  → MESI_IT, GIORNI_IT, formatta_data_it() — UNICA sorgente localizzazione
  alembic/versions/ → migrazioni (ordine cronologico via down_revision, non per nome file)
frontend/src/
  pages/      → pagine React
    admin/    → sotto-pagine sezione Admin (es. AdminBackup.jsx)
  components/ → componenti riutilizzabili
  utils/format.js → utility formattazione (vedi sezione)
scripts/      → script operativi (es. backup automatico, vedi sezione dedicata)
uploads/      → CSV/PDF caricati (non committare)
```

## Regole critiche Revenue CSV
File sempre in coppia: file1 = RICAVI TRAT comprensivi ristorante, file2 = solo alloggio.
- `revenue_rooms = file2.RICAVI_TRAT`
- `revenue_fnb = file1.RICAVI_TRAT - file2.RICAVI_TRAT` (mai negativo)
- `revenue_extra = EXTRA_TRATT` (in entrambi i file)
- `revenue_total = rooms + fnb + extra`

Scartare righe con "(SDLY)" o "(LY)" nel campo DATA, o senza data dd/mm/yyyy.
Numeri: virgola decimale. Date: dd/mm/yyyy (es. 30/05/2026 sab).
Convenzione nome file: `YYYYMMDD_PlanningForecast-HOTELCODE[12].xlsx/csv` — il suffisso `[12]` è
solo estetico, **ignorato dal parser**: `parse_coppia()` auto-rileva quale file è il "comprensivo
ristorante" confrontando la somma dei ricavi tra i due file (quello con somma maggiore è file1).
⚠️ **`parse_coppia()` rifiuta con `ValueError` se i due file sono identici riga per riga**
(`dati_a == dati_b`, confronto strutturale su tutti i campi, non solo sulla somma — evita falsi
positivi nel raro caso di zero F&B legittimo): bug reale (luglio 2026) in cui lo stesso file era
stato caricato due volte come file1 e file2 per CLB, producendo `revenue_fnb=0` su ogni riga
dell'import (F&B azzerato, ricavi camere gonfiati) e un calo innaturale nel grafico Ritmo
prenotazioni di gruppo. Non serve controllare i nomi file: il controllo è sul contenuto.

## KPI — regole invarianti
**MAI fare medie semplici — usare sempre i totali aggregati.**
- occupancy = rooms_sold / rooms_available → percentuale (non €)
- adr = revenue_rooms / rooms_sold
- revpar = revenue_rooms / rooms_available
- trevpar = revenue_total / rooms_available
- rmc = revenue_total / rooms_sold
- inc_fnb/inc_rooms = revenue_fnb/rooms / revenue_total

Divisioni per zero → None. KPISchema include `revenue_total: Optional[float]`.
**Aggregazione gruppo**: ADR = Σrooms_revenue / Σrooms_sold. MAI media dei KPI singoli hotel.
**Settimana commerciale**: Sabato→Venerdì. KPI settimanali calcolati su TOTALI, non media giornaliera.

## Funzioni centrali — non duplicare
- `aggrega_totali_righe(righe)` in `kpi_calculator.py` → unica funzione per sommare RigaRevenue
- `_carica_righe(db, hotel_code, snapshot_date, da, a)` in `dashboard.py` → unica funzione per leggere daily_revenue; `_raggruppa_per_hotel(righe)` per dict hotel→righe
- `kpi_stagione` è il campo canonico in DashboardHotelResponse (non `kpi_periodo`)
- Merge confronto settimanale in DashboardGruppo.jsx: per chiave `week_start`, non per indice

## Schema database — vincoli chiave
- `daily_revenue.snapshot_date` NOT NULL; UNIQUE `uq_hotel_data_snapshot` su (hotel_code, data, snapshot_date)
- `imports`: UNIQUE `uq_import_hotel_snapshot` su (hotel_code, snapshot_date)
- `daily_revenue.hotel_id` FK→hotels nullable; hotel_code rimane per compatibilità
- `budget_entries`: UNIQUE su (hotel_id, season_year, week_start, version)

## Configurazione app (app_config)
Chiavi attive: `week_start_weekday`='5', `anno_confronto_giorni_offset`='364', `anno_confronto_tolleranza_giorni`='30', `cors_origins`, `app_name`, `cc_colori_reparti` (JSON hex per grafici Dipendenti).
- `main.py` legge `cors_origins` al startup (fallback localhost:5173)
- `weekly_aggregator._leggi_week_start()` usa cache in-process; resettabile con `_reset_week_start_cache()` nei test
- Endpoint: `GET/PUT /config/`, `GET /config/{key}`, `GET|PUT /config/cc-colori/mappa`

## Autenticazione
Ruoli: `admin` (accesso completo) / `viewer` (sola lettura).
JWT HS256, 8h, `SECRET_KEY` da .env. Token in `localStorage('auth_token')`.
Dipendenze FastAPI: `richiedi_utente_attivo` / `richiedi_admin`.
Credenziali default: admin / admin2024.
- Lettura (dashboard, export, config): `richiedi_utente_attivo`
- Scrittura (upload, budget, admin/*): `richiedi_admin`
- Login: nessuna auth (rate limit 5/15min per IP)
- `api/client.js`: allega Bearer, gestisce 401 → redirect `/login?sessione_scaduta=1`

## Architettura modulare
Moduli: `revenue` (/dashboard/gruppo), `produzione` (/statistiche-produzione — Statistiche Produzione, vedi sezione dedicata), `budget` (/budget), `usali` (/usali — Conto Economico + Movimenti Attivi, vedi sezione dedicata), `dipendenti` (/dipendenti), `corrispettivi` (/corrispettivi), `forecast` (/forecast).
Tabelle: `modules` (code PK, name, icon, route, ordine, attivo, colore), `module_permissions` (module_code, ruolo, puo_vedere, puo_modificare, puo_importare).
NavBar L1: tab moduli da `GET /modules/`; L2: sotto-nav del modulo attivo.
Permessi: al login → `localStorage['moduli_permessi']`; ProtectedRoute verifica `puo_vedere`.
**Aggiungere modulo**: riga in `modules` → righe `module_permissions` → pagina JSX → `<Route moduleCode="">` in App.jsx. Appare automaticamente in NavBar (tab L1 + link).
⚠️ **Ma il tab NON risulta evidenziato come attivo se la sua route non è aggiunta anche in
`rilevaModuloAttivo()`** (`NavBar.jsx`): quella funzione decide quale tab colorare come "attivo"
con una whitelist manuale di prefissi (`pathname.startsWith('/budget')` ecc.), separata dal routing
vero e proprio di React Router — non basata su `m.route` dei moduli caricati da `GET /modules/`.
Bug reale (trovato settembre 2026): mancavano sia `produzione` (`/statistiche-produzione`, aggiunto
da `prod004_2026` come modulo separato da USALI) sia `forecast` (`/forecast`), quindi su quelle pagine
restava evidenziato "Statistiche" (default di fallback della funzione). Corretto aggiungendo entrambi
i prefissi mancanti — ma resta un passo manuale da ricordare a ogni nuovo modulo, non automatico.
Placeholder: `WorkInProgress.jsx`.

## Area Admin (`/admin` → AdminUnificato.jsx, sidebar `?s=`)
**Comune**: `utenti` (CRUD), `stagioni` (stagioni operative), `moduli` (attiva/disattiva/permessi)
**Revenue**: `revenue-import` (bulk import), `revenue-test` (cancella is_test)
**Dipendenti**: `dip-cc` (AdminCentriDiCosto), `dip-colori` (colori CC), `dip-test`
**Corrispettivi**: `corr-tipi-doc`, `corr-pagamenti`, `corr-classificazione` (CorrClassificazioneTrattamenti)
**USALI**: `usali-kpi` (range KPI), `usali-cc` (mappatura costi lavoro), `usali-movimenti` (righe Movimenti Attivi per struttura)
**Statistiche Produzione**: `prod-categorie` (ProdCategorie), `prod-mapping` (ProdMappingDettagli — mapping testo Welcome→categoria)
Stagioni: `GET /hotels/{code}/seasons/{year}`, `POST /hotels/{code}/seasons` (upsert).
Dati test: flag `is_test`; `GET|DELETE /admin/test-stats|test-data`, `GET|DELETE /dipendenti/admin/test-stats|test-data`.

**Sidebar collassabile** (luglio 2026, troppi gruppi/voci per stare tutti espansi): ogni gruppo si
apre/chiude cliccando il titolo, più due bottoni "Espandi"/"Comprimi" in cima per tutti i gruppi
insieme. Stato in `localStorage('admin_sidebar_collassate')` (Set di nomi gruppo collassati). Default
al primo accesso (nessun localStorage): tutti chiusi tranne il gruppo della sezione corrente, così la
voce attiva resta visibile senza dover già sapere di aprire qualcosa. Se si naviga verso una sezione
il cui gruppo è chiuso (es. link diretto da un'altra pagina), quel gruppo si riapre automaticamente
senza toccare lo stato degli altri. Aggiungere un nuovo gruppo in `SEZIONI` non richiede altro codice:
eredita comportamento e persistenza automaticamente.

## Variabili ambiente e deploy
Frontend: `VITE_API_URL` in `.env` / `.env.production`. **Mai URL hardcoded.**
`api/client.js` usa `import.meta.env.VITE_API_URL || 'http://localhost:8000'`.
Deploy Linux: nginx (reverse proxy) → uvicorn (systemd) → PostgreSQL. SSL via certbot.
Aggiornare `cors_origins` in DB dopo deploy.

## Comandi sviluppo
```bash
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev
cd backend && source venv/bin/activate && pytest tests/ -v
```
File test: `uploads/PlanningForecast-{CLB,DPH,INT}{1,2}.csv`.
⚠️ La fixture `client` nei test di integrazione deve sovrascrivere anche `richiedi_admin`/
`richiedi_utente_attivo` (non solo `get_db`), altrimenti gli endpoint protetti rispondono 401 e i
fallimenti a cascata mascherano bug reali — vedi Modulo Budget più sotto, dove questo mascheramento
ha nascosto per mesi che il salvataggio budget non funzionava mai. Pattern corretto in tutti i file
test a luglio 2026: `app.dependency_overrides[richiedi_admin] = lambda: SimpleNamespace(id=None)`
(id=None se il codice usa `utente.id` per popolare FK verso `users`, altrimenti `lambda: None` basta).
⚠️ Alcuni test (`test_parser_e_bulk.py`, `test_navigazione_confronto_export.py`, `test_upload_endpoint.py`)
falliscono con traceback che punta a `/Users/ginoscola/revenue-master/` invece di `hotel-os` — sono
un'altra directory di progetto, non file di questo repo: ignorare, non nel nostro ambito.

⚠️ **`app/models/__init__.py` importa tutti i moduli modello attivi** (revenue, rooms, corrispettivi,
analisi_ricavi, usali, produzione, shared — non `fiscal.py`, dismesso) per registrare in SQLAlchemy le
`relationship()` che referenziano una classe per stringa (es. `Hotel.rooms` → `"Room"`, definita in
un modulo diverso da dove viene dichiarata la relationship). Senza questo, uno script/test che importa
solo `app.models.revenue` fallisce con `InvalidRequestError: ... failed to locate a name ('Room')` —
bug reale che nascondeva un problema più serio in `test_dipendenti.py` (vedi sotto).

⚠️ **`tests/test_dipendenti.py` usa CF_TEST/ANNO_TEST sintetici, mai i CF/anno reali del PDF di test**:
non esiste un DB di test separato (nessun `conftest.py`, i test girano sullo stesso database di
sviluppo/produzione). Il fixture `_pulisci_db()` cancellava Employee/EmployeeMonthly/PayrollEntry per
codice fiscale SENZA distinguere test da produzione — dato che i CF nel PDF fixture sono di dipendenti
reali (Balducci Annie, Sanchioni Manuel, Palazzi Alice, ecc.), eseguire questi test ha azzerato i loro
dati reali su tutti i mesi (incidente reale, luglio 2026, recuperato nella stessa sessione — mascherato
per mesi dal bug del mapper sopra, che falliva prima di arrivare al cleanup). Fix: `dati_pdf_isolato`
(fixture) sostituisce CF e anno con valori sintetici (`ZZTEST00NA01A000A`, anno 1901) prima di
chiamare `importa_payroll()` — mai passare `dati_pdf` grezzo a `importa_payroll()` in un test.

⚠️ **Se il backend non raggiunge più le stampanti RT** (`import-da-stampante` → "No route to host"
persistente, pur con rete/permessi a posto): il processo uvicorn potrebbe essere acceso da prima che
un permesso macOS (es. Rete locale per l'app da cui è partito il terminale) fosse concesso o cambiato.
`--reload` ricarica solo il codice Python, non riavvia il processo del sistema operativo, quindi non
recepisce cambi di permessi avvenuti dopo l'avvio. Soluzione: killare il processo uvicorn e riavviarlo
da zero (non basta salvare un file per far scattare il reload).

## Localizzazione
`MESI_IT`, `GIORNI_IT`, `formatta_data_it()` definiti SOLO in `locale_it.py`. Non ridefinire nei router.
UI: date in italiano, euro con €, percentuali con %.  occupancy sempre come % (mai €).

## Utility frontend (format.js)
- `formatEuro(v)`, `formatEuroK(v)` (≥1000 → "Xk €"), `formatPerc(v)`, `formatN(v)`, `formatData(iso)`, `addDays(isoDate, n)`, `calcolaDelta(val, ref)`
- `mostraErrore(e)` — **OBBLIGATORIO in ogni catch block**. Se `localStorage('debug_errori')==='true'` → stack trace completo; altrimenti prima riga. **Mai** usare inline `e.response?.data?.detail || e.message`.

## Componenti grafici condivisi
**`PastReferenceArea`** (`frontend/src/components/PastReferenceArea.jsx`): sfondo scuro sui periodi già trascorsi in un grafico Recharts, per distinguere visivamente "maturato" (passato) da "OTB" (futuro).
- Props: `data` (array punti), `dateKey` (chiave ISO YYYY-MM-DD per confronto con oggi), `displayKey` (chiave usata su XAxis se diversa da `dateKey`)
- Usato in: DashboardHotel (3 grafici), DashboardGruppo (4 grafici), Budget (2 grafici), Forecast (1 grafico)
- **⚠️ Usare come funzione inline, non come componente JSX** — Recharts riconosce i figli per tipo e ignora componenti wrapper custom. Usare `{pastReferenceArea(data, 'week_start', 'label')}` dentro il chart.
- Aggiungere a ogni nuovo grafico con asse temporale: `{pastReferenceArea(data, 'week_start', 'label')}`
- Se il grafico usa date ISO direttamente sull'XAxis: `{pastReferenceArea(data, 'data')}`
- Nota: se `grafici[]` usa `label=week_start.slice(5)`, includere `week_start` nell'oggetto per poter usare `dateKey="week_start"`

---

## Home / Cruscotto gruppo (settembre 2026)
Landing page dopo il login (`/` → redirect a `/home`), **non un modulo** registrato in `modules`/
`module_permissions`: sempre visibile a ogni utente attivo, nessun `moduleCode` sulla `<Route>`,
nessun tab evidenziato in NavBar (`rilevaModuloAttivo()` la riconosce come caso speciale `'home'`,
un code che non esiste in `modules`, invece di ricadere sul default `'revenue'`). Aggrega dati già
esposti dagli altri moduli — non ha tabelle applicative proprie a parte le soglie dei tachimetri.

**Due endpoint separati per fascia di visibilità**, non un solo endpoint con branching sul ruolo —
un utente `viewer` deve ricevere un 403 pulito sul blocco riservato, non un payload silenziosamente
più povero:
- `GET /home/cruscotto` (`richiedi_utente_attivo`) → occupancy/RevPAR/ADR/RevPAR vs budget, pickup
  7gg, ritmo prenotazioni (mese corrente + confronto anno precedente se disponibile — oggi non lo è,
  primi dati 2026), mix canali/categorie (Produzione), % contante e tassa di soggiorno incassata
  (Corrispettivi), commissioni OTA (placeholder, sempre 0 finché Welcome non valorizza la colonna),
  semaforo per hotel, striscia di freschezza dati.
- `GET /home/cruscotto/admin` (`richiedi_admin`) → costo del lavoro per struttura, labor cost ratio,
  margine di contribuzione parziale (ricavi − solo costo lavoro, nessun altro costo operativo), Δ RT
  vs PMS sull'intera stagione, mix trattamento/tipo ospite, heatmap occupancy per giorno di stagione.
  Tutto ciò che deriva dal costo del lavoro (Dipendenti/payroll) è qui, mai nell'endpoint pubblico —
  scelta esplicita dell'utente, non solo un raggruppamento per "quanto è interessante" il dato.
- `GET|PUT /home/soglie` → cutoff rosso/arancio/verde dei tachimetri, tabella `dashboard_kpi_soglie`
  (migrazione `home001_2026`, seed con le soglie di default). Ogni riga ha `direzione` (`alto_meglio`
  / `basso_meglio` / `target` — quest'ultima bidirezionale, per gauge centrati su un target come
  Δ RT-PMS o vs-budget). `hotel_code` nullable: NULL = default gruppo; il modello supporta override
  per singolo hotel ma in questa v1 sono seminate solo le righe di default, non ancora esposte
  nell'admin per-hotel. Admin: `?s=home-soglie` → `AdminCruscottoSoglie.jsx`.

**Non duplica logica**: `routers/home.py` chiama direttamente funzioni già esistenti negli altri
router — molte sono semplici funzioni Python decorate `@router.get(...)` (il decoratore restituisce
la funzione invariata), quindi chiamabili come funzioni normali passando `db` esplicito, stesso
pattern già in uso in `produzione_export.py` (riusa `get_trattamenti()`/`get_reparti()`/`get_gruppo()`).
Due funzioni sono state estratte per essere riusabili (comportamento invariato per i chiamanti
originali):
- `_confronto_gruppo_dati(season_year, version, db)` in `budget.py` (prima logica inline
  nell'endpoint `confronto_gruppo`)
- `_costo_lavoro_per_struttura(import_ids, db)` in `dipendenti.py` (stessa distribuzione
  proporzionale per CC già usata da `report_mensile`/`report_annuale_riepilogo`, qui isolata perché
  la Home ha bisogno solo dei totali per struttura, non del report per-dipendente completo)

**Tachimetri — SVG custom, non Recharts** (`frontend/src/pages/home/GaugeKpi.jsx`): valutato anche
`RadialBarChart` di Recharts, scartato perché è pensato per un anello di progresso singolo, non per
un vero tachimetro (fasce colorate fisse + lancetta) — mancherebbe comunque la lancetta (va disegnata
a mano sopra) e il caso bidirezionale (Δ RT-PMS, target 0, valori anche negativi) non si adatta al
modello "riempimento da 0" di RadialBarChart. Componente unico e riusato per ogni gauge della pagina
(non una configurazione diversa per ognuno): arco fisso disegnato dai cutoff di `dashboard_kpi_soglie`
(3 fasce per `alto_meglio`/`basso_meglio`, 5 per `target` — rosso-arancio-verde-arancio-rosso attorno
al target), lancetta ruotata via trigonometria sul valore. Il resto della pagina (ritmo prenotazioni,
mix ricavi) resta su Recharts come tutto il resto del progetto.

Sotto-pagina "Ricavi camere" di Produzione (`TabRicaviCamere.jsx`) e questo modulo condividono la
stessa fonte `prod_righe` ma per scopi diversi: non collegati tra loro.

---

## Dashboard Hotel
- Snapshot: `GET /snapshots/{hotel_code}` → navigazione con frecce. Settimana di riferimento = settimana Sab–Ven contenente snapshot_date.
- `kpi_periodo` = KPI solo sulla settimana di riferimento; evidenziata in grafici (ReferenceArea) e tabella.
- Confronto snapshot precedente (mutuamente esclusivo con anno precedente, offset 364gg ±30gg tolleranza).
- Revenue giornaliero: senza confronto → BarChart impilato (Camere/F&B/Extra); con confronto → LineChart `revenue_total` corrente vs confronto.
- Dati giornalieri: collassabili, stato solo in-memory (`useState`), **sempre compresso all'apertura
  della pagina**, come i blocchi "Dati mensili" (non più persistito in localStorage).
- **Sezione "Dati mensili"** (`SezioneDatiMensili` + helper `aggregaGiorniPerMese` in `DashboardHotel.jsx`,
  tra "Aggregati settimanali" e "Dati giornalieri"): un blocco collassabile per ogni mese solare della
  stagione (Mag/Giu/Lug/Ago/Set), ciascuno con tutte le righe giornaliere del mese (stesse colonne di
  "Dati giornalieri") + riga "TOTALE {mese}" con KPI ricalcolati sui totali del mese (mai media dei
  giornalieri). Stato apertura solo in-memory (`useState`), tutti i mesi compressi all'apertura pagina.
  Ogni blocco mese ha il proprio tasto **Esporta** (xlsx/csv/pdf): riusa `/export/hotel/{code}/giornaliero`
  con `da`/`a` = prima/ultima data effettiva del mese (`m.giorni[0].data`..`m.giorni.at(-1).data`),
  filename `{hotel}_giornaliero_{YYYY-MM}`. Nessun endpoint dedicato.
- SettimanaDashboard include: rooms_sold, rooms_available, occupancy, adr, rmc, revpar, trevpar, revenue_*, inc_rooms, inc_fnb, inc_extra.

## Dashboard Gruppo
Tre modalità (toggle, `localStorage('gruppo_modalita')`):
- **Settimana**: `GET /dashboard/gruppo?modalita=settimana&settimana=&snapshot=`
- **Stagione intera**: `GET /dashboard/gruppo?modalita=stagione&snapshot=`; 3 grafici trend (RevPAR/TRevPAR, Revenue, Occupazione).
- **Ritmo prenotazioni** (`SezionePace` in `DashboardGruppo.jsx`): crescita OTB di un mese target
  (frecce ◀▶ mese/anno) attraverso tutti gli snapshot, un `LineChart` con una linea per hotel
  (`COLORI_HOTEL`). Dati da `GET /forecast/pace-gruppo?anno=&mese=` — stessa logica di
  `/forecast/pace` (singolo hotel) ma per tutti gli hotel in un'unica risposta, fattorizzata in
  `_pace_punti()` in `routers/forecast.py`. Il merge dei punti per `snapshot_date` avviene client-side
  (`chartData` in `SezionePace`), assumendo che gli snapshot siano allineati tra hotel (verificato:
  lo sono, stesso `snapshot_date` per import contemporanei).
  Toggle **Valore assoluto / Crescita indicizzata** (`localStorage('pace_vista')`): la vista assoluta
  mostra il revenue OTB cumulativo (utile per il volume totale) ma penalizza visivamente un hotel con
  fatturato complessivo inferiore anche quando sta accelerando di più — la sua curva resta comunque
  sotto le altre. La vista indicizzata (`chartDataIndicizzato`) porta ogni hotel a base 100 sulla prima
  snapshot disponibile, con `ReferenceLine` a y=100: mostra la FORMA della crescita (pickup relativo)
  a prescindere dal volume assoluto, per confrontare correttamente chi sta accelerando di più.
- `GET /dashboard/gruppo/snapshots` → lista snapshot aggregate.
- Merge confronto per chiave `week_start` (non indice) per evitare sfasamenti tra stagioni diverse.
- `Hotel` (model) non ha un campo `attivo`: `_hotels_per_codice("all", ...)` in `forecast.py` restituisce
  tutti gli hotel in anagrafica (bug preesistente corretto — filtrava su un campo inesistente,
  mai eseguito finché non è servito da `/forecast/pace-gruppo`).

## Export
- Hotel: `GET /export/hotel/{code}/settimanale|mensile|giornaliero?snapshot=&da=&a=&formato=xlsx|csv|pdf`
  (tutti e tre chiudono con una riga "TOTALE" — KPI sui totali del periodo, mai medie — anche il
  giornaliero, usato sia per la stagione intera sia per il singolo mese via `da`/`a`)
- Gruppo: `GET /export/gruppo?da=&a=&formato=`
- `/hotel/{code}/mensile`: aggregati per **mese solare** (non mese contabile Budget), stesse 16 colonne
  del settimanale con prima colonna "Mese", replica di `aggregaMensile()`/`TabellaAggregatiMensili` in
  `DashboardHotel.jsx` (KPI sui totali mensili, `giorni`=giorni con camere vendute, mesi senza vendite
  esclusi). Helper `_aggrega_mesi`/`_riga_mens`/`_totale_mens`/`_xlsx|_csv|_pdf_hotel_mens` in
  `export.py`, riusa `_scrivi_riga_sett`. Pulsante Esporta in `TabellaAggregatiMensili` via `SezioneHeader`.
- Excel: revenue `#,##0.00 "€"`, percentuali `0.0"%"`, interi `#,##0`. Intestazioni bold bianco su blu, righe alternate grigio.
- PDF: landscape A4, 8pt.
- Gruppo Excel: 2 fogli (aggregati settimanali + dettaglio hotel).

---

## Modulo Dipendenti
Parser PDF cedolini paghe (pdfplumber): layout fisso, 13 voci in ordine fisso (`VOCI_ORDINE` in `payroll_parser.py`).
Voci: ret_netta, contr_prev_dip, contr_san_dip, irpef, altre_trattenute, anticipi_inps, tot_lordo | contr_prev_az, contr_san_az, inail, altri_enti, tfr, tot_costo_az.

**CC — gerarchia 3 livelli** (struttura → categoria → reparto, self-referencing `parent_id` in `cost_centers`):
- `albero_centri(db)` in `cost_center_service.py` → unica fonte di verità per l'albero
- `_trova_struttura(cc, tutti_by_id)` in `dipendenti.py`: risale da reparto a struttura
- Report usano `struttura_code`/`struttura_name` (non `parent_code`)
- Colori CC: `app_config.cc_colori_reparti` (JSON) → `GET|PUT /config/cc-colori/mappa`
- `GET /cost-centers/albero` → tutti i CC (attivi e inattivi)

Strutture extra-alberghiere: `BON` (ristorante), `KMDIMARE` (aggregatore virtuale gruppo).

**Assegnazione CC**: `employee_cc_default` (granularità anno/mese); `EmployeeCostCenterMonthly` per split su più CC (somma % = 100).
Idempotenza import: UNIQUE su (mese, anno, societa). Reimport: `DELETE /dipendenti/import/{id}?conferma=true`.
⚠️ **Cancellare più import consecutivi dello stesso dipendente svuota `employee_cc_default`**:
`_elimina_dipendenti_orfani()` (`dipendenti.py:402`) cancella esplicitamente `employee_cc_default` +
`EmployeeCostCenterMonthly` per ogni dipendente rimasto senza `employee_monthly` residuo, PRIMA di
cancellare il dipendente stesso (per evitare il blocco del vincolo FK, non perché sia "sicuro").
Se si cancellano import successivi (es. gen-mag) uno per uno, i dipendenti diventano orfani solo
all'ULTIMA cancellazione (finché hanno almeno un altro import restano non-orfani) — a quel punto
`employee_cc_default` viene svuotata per **tutti**, comprese le ripartizioni impostate a mano.
Il fatto che la cancellazione riesca senza errore NON dimostra che non ci fosse nulla in
`employee_cc_default` (il codice la svuota apposta prima) — controllare sempre
`SELECT * FROM employee_cc_default WHERE employee_id IN (...)` PRIMA di cancellare import multipli
dello stesso dipendente, non dopo. Nessun backup/WAL su Postgres locale: perso = non recuperabile
(incidente reale, luglio 2026 — reimport gennaio-maggio KM DI MARE per recuperare dipendenti mancanti
dal parsing, ripartizioni CC di tutti i 32 dipendenti azzerate).
Aggiungere voce di costo: riga in `payroll_cost_types` + aggiornare `VOCI_ORDINE`.

Endpoint chiave:
- `POST /dipendenti/import`, `GET /dipendenti/report/mensile?mese=&anno=`, `GET /dipendenti/report/annuale-riepilogo?anno=`
- `GET /dipendenti/report/annuale/dettaglio-cc?anno=&cc_code=|cc_name=|cat_name=&strutture=`
- `POST /dipendenti/ricalcola-cc-anno?anno=`
- `GET /cost-centers/albero`

Frontend `Dipendenti.jsx`: 3 sezioni (report / anagrafica / import). Vista analisi CC: per struttura / categoria / reparto. `trasformaCentri(centri, vista)` con `_aggrega`. `isAdmin` → mostra/nasconde import e ricalcolo.
Tab Analisi CC (agosto 2026): filtro checkbox "Categorie" (macrocategorie ricavate dinamicamente dai
dati, es. Camere/Food & Beverage/Struttura/Amministrazione), tutte selezionate di default. Applicato
a monte (`filtraCategorie()`, su `parent_name` dei centri grezzi) così tabella, torta e grafico a
barre restano coerenti tra loro quando si deseleziona una categoria — stesso pattern del filtro
strutture già esistente (`barStruttureSel`).
`GET /dipendenti/` (lista anagrafica) restituisce anche `centri_di_costo` (lista completa, non solo
il primo CC come `centro_di_costo`/`centro_di_costo_id` — mantenuti per compatibilità): bug corretto
in cui la riga riassuntiva di `AnagraficaCard` mostrava un solo CC per dipendenti con ripartizione su
più centri (es. Balducci Annie su 3 reparti Pasticceria CLB/DPH/INT), visibili tutti solo dopo aver
espanso la card (che li carica separatamente da `GET /dipendenti/{id}/centri-di-costo`).
File test: `uploads/202604_costi  aziendali .pdf` (8 dipendenti, aprile 2026).

⚠️ **`payroll_parser.py` non usa più indici di riga fissi per indirizzo/qualifica/mansione/sommario**:
per alcuni tirocinanti/stagisti il PDF non stampa affatto la riga "indirizzo dipendente" (campo vuoto),
il che scalava di una posizione tutte le righe successive e faceva leggere uno dei 13 valori numerici
finali come "incidenza%" — bug reale (luglio 2026, import giugno 2026) che produceva l'errore
"attese 13 voci numeriche, trovate 12" su più pagine (tutti i tirocinanti/stagisti del cedolino).
Fix: la riga "sommario" (le uniche due righe con due numeri decimali separati da spazio, dopo la
riga cognome/CF) viene localizzata dinamicamente via regex; qualifica/mansione sono le due righe
immediatamente precedenti, indirizzo è tutto ciò che sta prima (0+ righe, non più esattamente 1).
⚠️ **Numeri negativi con segno meno in coda** (es. `396,53-` per un IRPEF a credito, non `-396,53`):
`_parse_numero()` li scartava come non-numerici (`float("396,53-")` fallisce), causando lo stesso
identico errore "attese 13 voci numeriche, trovate 12" per un motivo diverso dal precedente — riga
sommario/qualifica/mansione lette correttamente, ma una delle 13 voci saltata perché il segno meno
è in fondo alla stringa. Fix: `_parse_numero()` riconosce il `-` finale e lo applica come segno.

---

## Modulo Corrispettivi

**Backend diviso per dominio** (stesso prefix `/corrispettivi`, `main.py` invariato):
`routers/corrispettivi.py` (aggregatore sottile, solo `include_router`), `corrispettivi_shared.py`
(costanti/helper comuni: `STRUTTURE_HOTEL`, `NOME_STRUTTURA`, `_to_float`, `_d`, ecc.),
`corrispettivi_import.py`, `corrispettivi_documenti.py`, `corrispettivi_report.py`, `corrispettivi_rt.py`.
Prima di aggiungere un endpoint: importare le costanti da `corrispettivi_shared`, non ridefinirle.

### Contesto fiscale (non modificare senza capire)
- **Scontrini e fatture sono registri separati per legge** (SC/SCA → cassa RT + AdE; F → SDI).
- **Imponibile = lordo / (1 + aliquota)** — MAI `lordo - iva` (errori arrotondamento).
- **Caparre (CP, FD) = escluse** — doppio conteggio IVA. Salvate con `tipo='escluso'` per audit.
- **CHECK giornaliero**: totale scontrini deve coincidere con chiusura RT trasmessa ad AdE.
- **MMS/BON**: inserimento manuale, IVA 10%, imponibile auto-calcolato.

Strutture: DPH/CLB/INT → import Excel (Welcome PMS); MMS (Maremosso), BON (Buona Onda) → manuale.

### Formati Excel
Auto-detect dal set colonne. **Base** (18 col): Data, Numero, Suffisso, Totale, Imponibile, Iva, Annullato…
**Esteso** (36 col): aggiunge Tassa di soggiorno, Data annullamento, Sigla, Numero Scontrino + 15 altri.
- `tassa_soggiorno` nel DB: valore esatto dal formato esteso (NULL = base)
- Suffisso `{prefisso}-{tipo}`: D→DPH, C→CLB, I→INT; SC/SCA→scontrino, F→fattura, CP/FD/altri→escluso

**Categorizzazione IVA** (tolleranza ±0.5%): arrangiamenti≈10%, shop≈22%, tassa_soggiorno≈0%+imponibile>0, penali≈0%+imponibile=0, altro=fuori range.
Annullamenti negativi: usare `abs(imponibile)` nella categorizzazione (non `imponibile > 0`).

**Disaggregazione tassa soggiorno**: formato esteso → `lordo_ts = tassa_soggiorno` (esatto); base → inferenza `IVA×11`.
**Confronto RT**: usare colonna `tassa_soggiorno` (TS embedded in arrangiamenti) + `categoria='tassa_soggiorno'` (standalone). Non usare solo `totale_lordo WHERE categoria='tassa_soggiorno'`.

### Tabelle DB principali
- `corrispettivi_documenti`: UNIQUE(struttura_code, data_documento, numero, suffisso, camera, codice_prenotazione, numero_scontrino); audit trail (`modificato_manualmente`, `*_originale`); `camera` e `codice_prenotazione` TEXT (prenotazioni gruppo = liste lunghe).
  ⚠️ Welcome PMS assegna `numero=0` a **tutte** le righe di storno/annullo non numerate emesse in un
  giorno per una struttura (non è un identificativo): con ≥2 annullamenti nello stesso giorno/struttura,
  una chiave troppo corta li tratta come lo stesso documento e ne scarta uno in silenzio
  (`ON CONFLICT DO NOTHING`) — causa di delta RT-PMS reali già osservati in campo. Non rimuovere il
  vincolo per "risolvere" (già fatto per errore sul precursore `fiscal_documents`, ora dismesso):
  estendere invece la chiave. Storia: prima aggiunte camera+codice_prenotazione (`corrfix001_2026`),
  poi — non bastavano quando la stessa prenotazione/camera ha più scontrini annullati lo stesso giorno —
  aggiunto anche `numero_scontrino`, il numero fiscale di stampa (`corrfix002_2026`). Assente nel
  formato Excel base (18 colonne): lì resta solo la protezione camera+codice_prenotazione.
- `corrispettivi_manuali`: UNIQUE(data_giorno, struttura_code).
- `rt_chiusure`: UNIQUE(data_chiusura, rt_code); RT1→[DPH,CLB], RT2→[INT]. Audit trail `modificato_manualmente`
  (come `corrispettivi_documenti`): tutte le righe inserite prima di luglio 2026 sono marcate `True` (protette).
  Campi dettaglio da CORRISP.xml: `progressivo`, `imponibile_10/22`, `imposta_10/22`, `esente_n1`,
  `tassa_soggiorno_nrs`, `num_documenti`, `pagato_contanti`, `pagato_elettronico` — tutti nullable
  (assenti sulle righe manuali che non arrivano da import XML).

### Idempotenza import
- **salta** (default): ON CONFLICT DO NOTHING
- **aggiorna**: aggiorna campi MA protegge `modificato_manualmente=True`
- DELETE /import/{id}: rimuove doc non modificati, scollega (import_id=NULL) quelli modificati

### Endpoint API (prefix `/corrispettivi`)
- `POST /import?is_test=&on_conflict=salta|aggiorna`
- `GET|PUT /documenti/{id}`, `GET /scontrini`, `GET /fatture` (alias)
- `POST|PUT|GET /manuali`
- `GET /report/giornaliero?data_da=&data_a=&struttura_code=&tipo=` → valori lordi; toggle IVA client-side
- `GET /export/giornaliero?anno=&mese=&tipo=&lordo=` → export Excel della tabella mensile di
  "Corrispettivi giornalieri" (`TabGiornalieri.jsx`), riusando `report_giornaliero()` invece di
  riaggregare (stesso pattern di `export_fatturati`/`report_fatturati`). Stessa struttura a schermo:
  per DPH/CLB/INT le 4 categorie visibili (Arrangiamenti/Tassa Soggiorno/Penali/Shop) + Tot. (che
  include anche 'altro', non mostrato come colonna propria — replica fedele di una scelta già fatta
  a schermo, non una novità), poi MMS/BON (valore manuale) e TOT. GIORNO. Solo xlsx (nessun csv/pdf,
  non richiesti): bottone dedicato in `TabGiornalieri.jsx`, non il componente generico `ExportMenu`
  (che offrirebbe csv/pdf non implementati) — stesso pattern già in uso per `/export/fatturati`.
  Riga di titolo in cima al foglio con mese/anno e "IVA INCLUSA"/"IVA ESCLUSA" esplicito (il file
  deve restare comprensibile anche aperto fuori dall'app, senza il contesto del toggle a schermo) +
  bordo verticale marcato (`Border(left=Side('medium'))`) a inizio di ogni blocco struttura
  (DPH/CLB/INT/MMS/BON/TOT. GIORNO), replica del borderLeft più spesso già usato a schermo per la
  stessa ragione — senza non è facile distinguere dove finisce un hotel e inizia il successivo.
- `GET /report/fatturati?anno=&lordo=` → tassa soggiorno esclusa dal totale (transito Comune)
- `GET /check?data_da=&data_a=`
- `POST|GET|DELETE /rt-chiusure` (scrittura: admin)
- `POST /rt-chiusure/import-xml?rt_code=RT1|RT2&on_conflict=salta|aggiorna` (multipart `file`, admin) →
  parsing CORRISP.xml caricato manualmente (`services/corrisp_xml_parser.py`), popola `rt_chiusure`.
- `POST /rt-chiusure/import-da-stampante` (JSON `{rt_code, data, on_conflict}`, admin) → il **backend**
  (non il browser) si collega alla stampante, legge l'elenco `http://{ip}/www/dati-rt/{YYYYMMDD}/`
  (HTML con `<a href="...">`), trova il file `*CORRISP*.xml` (la cartella contiene anche `*ESITO-{id}.xml`
  e `*ZREPORT.txt`, ignorati) e lo importa. IP risolto via `Hotel.rt_printer_id → RtPrinter.ip`
  (RT1→hotel DPH/CLB, RT2→hotel INT). Risposta include `nome_file`.
  ⚠️ **Chiamata lato backend, non browser, e via socket grezzo (`_get_raw_http()`), non `httpx`**:
  il file server `/www/dati-rt/` della stampante invia una risposta HTTP malformata — header
  `Transfer-Encoding: chunked` duplicato (RFC 7230 §3.3.3), corpo in realtà non chunked — che sia
  `fetch()` nel browser sia `httpx`/h11 in Python rifiutano come possibile request/response smuggling.
  La navigazione diretta nel browser funziona comunque (non passa da questa validazione) e dà un falso
  senso di raggiungibilità da script. `_get_raw_http()` legge i byte grezzi ignorando del tutto
  `Transfer-Encoding`. `fpmate.cgi` (comandi X/Z/Status in `TabStampanteRT`) invece manda risposte
  corrette e resta raggiungibile da `fetch()` diretto browser→stampante.
  `_get_raw_http()` ritenta fino a 3 volte (pausa 1s) su errori di rete transitori (es. "No route to
  host" intermittente): il web server integrato nella stampante è hardware limitato e a volte non
  risponde in tempo, es. se occupato in una stampa.
  Un file CORRISP.xml copre un RT intero (RT1 = DPH+CLB, RT2 = INT), non un singolo hotel.
  **Formula totale**: Σ (`ImportoParziale` + `Imposta`) per le righe con `AliquotaIVA` (10%, 22%, ...,
  solo se `ImportoParziale` > 0) + Σ `ImportoParziale` per le righe con `Natura` (N1=tassa di soggiorno,
  N2=penali, solo `ImportoParziale`, esenti da imposta). Questo è tutto e solo ciò che viene trasmesso
  ad AdE. ⚠️ `<Ammontare>` **non** è imponibile+imposta come suggerirebbe il nome — va ignorato.
  `<NonRiscossoServizi>` (→ `tassa_soggiorno_nrs`) sono **sospesi non trasmessi ad AdE**: tracciati come
  dettaglio grezzo, non entrano in nessun totale né confronto.
  Popola anche i campi legacy `totale_10/22/ts/penali` usati dal confronto per categoria vs PMS
  (`totale_10/22` = `ImportoParziale+Imposta` per aliquota, `totale_ts` = `esente_n1` — **non**
  `tassa_soggiorno_nrs`, coerente con l'etichetta "Esente N1 (T. Soggiorno)" già nel form manuale —
  `totale_penali` = `ImportoParziale` di `Natura N2`).
  Protegge sempre `modificato_manualmente=True` anche con `on_conflict=aggiorna` (risponde `esito=saltato`).
  Logica di upsert condivisa tra i due endpoint: `_upsert_rt_chiusura_da_xml()`.
  Frontend: pulsante "Importa CORRISP.xml" in `TabControlloRT` (dentro `Corrispettivi.jsx`), due modalità:
  **Dalla cartella stampante** (default, sceglie solo RT + data) e **Carica da PC** (selezione manuale file,
  multi-file).
  ⚠️ Nel file XML reale `<Imposta>` è annidato dentro `<IVA>` insieme a `<AliquotaIVA>` (non fratello
  diretto di `<IVA>` sotto `<Riepilogo>` come nell'esempio iniziale): il parser gestisce entrambe le forme.
  ⚠️ **`<TotaleAmmontareAnnulli>` non veniva letto affatto fino ad agosto 2026**: bug reale (trovato
  14/08/2026, RT1) — il campo, presente in ogni `<Riepilogo>` (aliquota IVA o Natura), è l'imponibile
  degli scontrini annullati lo stesso giorno fiscale prima della chiusura Z (lo stesso importo
  stampato come "Totale giorno annullamenti" sullo scontrino di chiusura). Il parser calcolava il
  totale giorno dal solo `ImportoParziale` (lordo, pre-annullo): un giorno con annullamenti importava
  un totale sistematicamente più alto del PMS, di un importo pari esattamente all'annullato (caso
  reale: 7.806,18€ importati invece di 6.332,68€, +1.473,50€ = imponibile annullato lordizzato).
  Sembrava un problema di cassa (storno non registrato sul registratore), mentre il dato era nel file
  fin dall'inizio, solo non letto. Fix: `imponibile_netto = ImportoParziale - TotaleAmmontareAnnulli`;
  l'imposta si ricalcola da `imponibile_netto × aliquota/100` (`<Imposta>` non riporta mai il valore
  già al netto dell'annullato, ma corrisponde sempre esattamente a `ImportoParziale × aliquota/100`,
  quindi ricalcolare dal netto non introduce scostamenti). Riguarda ogni chiusura storica con
  annullamenti lo stesso giorno: da riverificare/correggere le altre giornate della stagione con
  delta sospetto (richiede il file `CORRISP.xml` originale di quel giorno, non ricostruibile dai
  soli dati già salvati in `rt_chiusure`, che non conserva l'XML grezzo).
  ⚠️ **Più chiusure Z nello stesso giorno solare vanno sommate, non solo l'ultima considerata**: bug
  reale (luglio 2026) — un giorno con un problema che ha richiesto riapertura e nuova chiusura produce
  due file `*CORRISP*.xml` nella stessa cartella-giorno della stampante (`/www/dati-rt/{YYYYMMDD}/`),
  ma `import-da-stampante` prendeva solo l'ultimo (`nomi_trovati[-1]`), scartando il totale della prima
  chiusura → la giornata non quadrava vs PMS. Fix: entrambi gli endpoint (`import-da-stampante` e
  `import-xml`, quest'ultimo ora accetta `files` multipli) leggono/parsano tutti i CORRISP.xml trovati
  e li sommano con `somma_dati_corrisp()` (`corrisp_xml_parser.py`) — somma tutti i campi Decimal e
  `num_documenti`, tiene il `progressivo` più alto, verifica che tutti i file siano dello stesso
  `data_chiusura`. Risposta include `n_chiusure`. Frontend "Carica da PC": input file con `multiple`.

**Alert tassa di soggiorno**: `esente_n1` (Natura N1) di un giorno deve essere multiplo esatto della
tariffa per persona/notte (`TARIFFA_TS_PER_PERSONA`), altrimenti c'è quasi certamente un errore di
conteggio. RT2 = 2,00€ (solo International, tariffa unica). **RT1 = 0,50€** (non 2,50€!): condivide
la cassa fiscale tra Du Parc (2,50€/persona) e Club Hotel (2,00€/persona), quindi qualunque
combinazione di persone-notte tra i due hotel è un totale legittimo — verificabile solo sul MCD tra
le due tariffe (0,50€), non su 2,50€ da sola (avrebbe dato falsi allarmi su quasi ogni giorno). Flag
`n1_non_quadra` calcolato in `_n1_non_quadra()`, incluso nella risposta `GET /rt-chiusure` per ogni
rt1/rt2. Frontend: icona ⚠️ accanto al totale RT in `TabControlloRT` con tooltip sull'importo esente N1.
⚠️ `esente_n1` va tenuto sincronizzato con `totale_ts` anche sul salvataggio manuale (`POST /rt-chiusure`,
non solo sull'import XML): altrimenti dopo una correzione manuale di `totale_ts` l'alert continua a
basarsi sul vecchio `esente_n1` da XML, non aggiornato (bug corretto luglio 2026, con backfill
`esente_n1 = totale_ts` sulle righe `modificato_manualmente=True` già in DB).

`GET /rt-chiusure` include anche `imponibile_10/22`, `imposta_10/22` per rt1/rt2: il pannello di
inserimento manuale (`FormRT`) li usa per pre-compilare i sotto-campi "Imposta"/"Importo Parziale"
delle aliquote quando si apre un giorno già importato da XML (prop `resetKey` = data selezionata,
altrimenti lo stato locale `sub` resterebbe quello del giorno aperto in precedenza).

**Colonna Δ (differenza RT-PMS)**: positivo = verde, negativo = rosso, ≈0 (±0,01€) = ✓ verde
(`fmtDelta` in `TabControlloRT.jsx`, `deltaInfo` nel pannello `FormRT` — stessa convenzione).

**Somma differenze mese/stagione** (`TabControlloRT.jsx`): riga sotto la nav mese che mostra la somma
algebrica delle Δ giornaliere per RT1/RT2, per capire se le differenze si compensano nel tempo (somma
vicina a zero) o indicano un bias sistematico. Somma mese calcolata client-side da `dati.giorni` già
caricato (`sommaMese`); somma stagione da `GET /rt-chiusure/riepilogo-stagione?anno=` (nuovo endpoint,
`riepilogo_stagione_rt()` in `corrispettivi_rt.py`) — riletta solo al cambio anno, non ad ogni mese.
Range di stagione per RT: il più ampio tra le stagioni (`hotel_seasons`) degli hotel che condividono
quella cassa fiscale (RT1 = DPH+CLB con aperture sfasate: usa apertura Du Parc + chiusura più tardiva).
Stesso criterio di calcolo del confronto giornaliero (somma `totale_lordo` scontrini PMS, **include**
gli annullati, coerente con `_pms_agg()` esistente — non filtrare qui altrimenti i due numeri
diventerebbero incoerenti tra vista giornaliera e vista aggregata).
⚠️ `_somma_rt_pms()` somma il PMS **solo sui giorni in cui esiste una chiusura RT** (`giorni_con_rt`,
incluso nella risposta), mai su tutto l'intervallo di date della stagione: un giorno con corrispettivi
PMS ma senza chiusura RT (es. import saltato) andrebbe altrimenti a gonfiare la differenza in modo
artificiale (bug reale, scoperto confrontando la somma stagionale con la somma dei delta mese per
mese). Stessa semantica del confronto giornaliero, dove un giorno senza RT ha `delta=None` ed è
escluso dalla somma.

**Inserimenti da Menu** (solo RT1, campo `rt_chiusure.menu_diretto`): a volte il software del
ristorante di Du Parc/Club Hotel — non collegato a Welcome — stampa un pagamento diretto sulla
stessa cassa fiscale RT1. Quell'incasso è reale e nel totale RT, ma non comparirà **mai** in
Welcome/PMS. Campo manuale nel pannello `FormRT` (solo RT1), valore **lordo** (compresa IVA),
aliquota 10%. Si somma al lato **PMS** del confronto in `_confronta()` (non al lato RT, che resta
il dato letto dal registro): `delta = totale_giorno − (pms.totale + menu_diretto)`, stesso criterio
per la riga Aliquota 10% (`pms.arr + menu_diretto`). Incide anche su `_somma_rt_pms()` (somma
mese/stagione), sommando `menu_diretto` sul periodo — altrimenti la somma stagionale non
tornerebbe coerente col confronto giornaliero. `sommaMese` (client-side) non richiede modifiche:
somma `g.rt1.delta`, già calcolato server-side con l'aggiustamento.
Sotto "Somma differenze" c'è anche una riga "Inserimenti da Menu (RT1)" con il totale mese
(`menuMese`, client-side da `dati.giorni`) e stagione (`riepilogoStagione.RT1.somma_menu`) — utile
per vedere quanto incasso extra-Welcome è stato dichiarato, non solo la differenza residua.

⚠️ **Chiusura fatta "il giorno dopo" disallinea i sotto-campi XML**: se la chiusura RT di un
giorno viene fatta la mattina successiva, i campi dettaglio (`imponibile_10/22`, `imposta_10/22`,
`tassa_soggiorno_nrs` — non `totale_10/22/ts/penali` né `esente_n1`, quelli restano sul giorno
giusto) possono finire salvati sotto la data sbagliata (quella della chiusura, non quella
dell'incasso). Sintomo: `imponibile_10+imposta_10` del giorno D coincide con `totale_10` di
**D-1**, non con quello proprio di D — se combacia sistematicamente su più giorni consecutivi è
questo bug, non un errore puntuale. Diagnosi: confrontare `imponibile_10+imposta_10` di ogni giorno
con `totale_10` del giorno precedente, non con il proprio. Fix: ricopiare i sotto-campi sul giorno
giusto (l'ultimo giorno di un blocco "shiftato" resta senza dato sorgente e va azzerato).

**`GET /report/pagamenti` (tab Riepilogo Fatturati → Forme di pagamento)**: per ogni documento
fiscale (solo scontrino/fattura), `pagato = totale_lordo + deposito - sospeso` (tassa_soggiorno
NON sottratta: se pagata in contanti è contante vero). ⚠️ **`deposito` è quasi sempre <= 0**
(verificato 2026: 459 righe negative contro 2 sole positive): è una caparra incassata su un
documento PRECEDENTE (con la sua forma di pagamento già registrata allora) e applicata in
detrazione sul conto attuale — confermato dall'utente. Bug reale (agosto 2026, scoperto perché
"Contante" 2026 risultava 178.793€ invece di ~148.226€ reali): la vecchia formula sottraeva
`deposito`, e sottrarre un negativo lo riaggiunge, riconteggiando come "pagato oggi" una caparra
già incassata mesi prima. Il campo `incassato` di Welcome NON è un'alternativa affidabile:
0 su 1.681 documenti su 3.254 (51,6%, dati 2026) pur totalmente pagati — non riflette "è stato
pagato" in questo dataset, va ignorato per questo report.
⚠️ **Un documento può elencare più metodi nel testo grezzo della colonna Pagamenti** (es.
"Contante 8,00€ / Bancomat 300,00€ /"): la vecchia normalizzazione (prefix-match sull'inizio
stringa) attribuiva l'intero `pagato` al primo metodo citato. Fix: quando il testo riporta
importi per metodo, `pagato` si distribuisce tra i metodi effettivamente citati (parsing per
tipo); il prefix-match resta solo per righe a singolo metodo senza importo nel testo (es.
"Contante" da sola). Verificato sui 3.254 documenti 2026: 0 scarti tra `pagato` calcolato e
somma degli importi espliciti nel testo.
Riga "Caparra" nella tabella mostra **`-deposito`** (segno invertito, quindi quasi sempre
positivo): sommando pagato + Caparra + Sospeso si ricostruisce esattamente `totale_lordo` (di
scontrini/fatture + manuali MMS/BON) — verificato che il totale del report ora coincide al
centesimo con `SUM(totale_lordo)`. Diverge intenzionalmente dal totale di `report/fatturati`
(quello esclude la tassa di soggiorno, essendo un pass-through verso il Comune; questo la
include, perché il denaro fisico è comunque arrivato tramite un metodo di pagamento).

⚠️ **Il fix sopra (distribuzione per metodo) era codice morto finché `tipo_pagamento` veniva
troncato in fase di import**: `_estrai_tipo_pagamento()` in `corrispettivi_excel_parser.py`
riduceva il testo grezzo della colonna Pagamenti al solo primo metodo citato ("Contante 2.450,00 €
/ Carta Credito 1.940,00 € /" → "Contante"), **scartando importi e metodi secondari prima ancora
che arrivassero al DB**. `report_pagamenti()` si aspettava il testo completo per la distribuzione
per metodo, ma non lo trovava mai (quasi tutti i documenti con più metodi cadevano nel fallback
`pagato` = intero importo, attribuito al primo metodo) — bug reale (agosto 2026, scoperto perché
l'utente, confrontando con un'analisi indipendente sul file grezzo Welcome, segnalava "Contante"
2026 ~96.000€ contro i 148.225,97€ mostrati dall'app). Verificato su documenti reali: es. scontrino
D-SC 1278 (12/08, totale 4.890€) salvato come "Contante" puro → intero importo contato come
contante, mentre il testo originale era "Contante 2.450,00 € / Carta Credito 1.940,00 € /"; altri
casi (C-SC 449, I-SC 405, I-SC 344) avevano `tipo_pagamento` salvato come "Contante" quando il
pagamento reale era **Carta Credito** — non solo un problema di granularità, il metodo salvato
poteva essere proprio sbagliato. Fix: rimossa `_estrai_tipo_pagamento()`, il parser salva ora il
testo grezzo completo in `tipo_pagamento` (nessun altro punto del codice ne dipendeva dalla forma
troncata). Backfill una tantum eseguito sui documenti 2026 già in DB, riconciliando `tipo_pagamento`
con `Conti 2026.xlsx` (stesso formato esteso, mai troncato) per chiave (struttura, data, numero,
suffisso) — esclusi `numero=0` (storni/annulli non numerati con chiave ambigua, stesso motivo di
corrfix001/002 sopra) e righe `modificato_manualmente=True`. Contante 2026 dopo il fix: 94.927,20€.
Se in futuro riemerge uno scarto vistoso tra Contante atteso e mostrato, controllare per prima cosa
se `tipo_pagamento` in DB contiene testo completo con importi ("Contante 8,00 € / ...") o solo il
nome del metodo — quest'ultimo indica che la riga proviene da un import precedente al fix e non è
mai stata corretta dal backfill.

Toggle IVA: backend restituisce SEMPRE lordi; `applyToggle()` client-side; `localStorage('corrispettivi_lordo')`.
Correzione manuale: `PUT /documenti/{id}` → `modificato_manualmente=true`, salva valori originali in `*_originale`.
⚠️ **Eccezione**: `GET /corrispettivi/check` fa il calcolo netto **lato server** (accetta `lordo` come
query param, non un semplice passthrough di lordi) perché aggrega totali per struttura senza
breakdown per categoria — il client non potrebbe applicare `applyToggle()` con l'aliquota giusta
per categoria come fa altrove. `TabGiornalieri.jsx` non passava `lordo` in questa chiamata (bug
reale, luglio 2026): i tre box del riquadro CHECK (Hotel/Ristoranti/Per sede fisica) e il TOTALE
GENERALE restavano sempre lordi anche col toggle "IVA esclusa" attivo, mentre la tabella giornaliera
sopra (calcolata client-side) cambiava correttamente — sintomo per riconoscere questa classe di bug:
se un endpoint accetta `lordo` come query param invece di restituire sempre lordo, verificare che il
chiamante lo passi sempre, non solo che esista un `applyToggle()` da qualche parte nel componente.

### Analisi Ricavi (tab in Corrispettivi.jsx)
Tabelle: `trattamenti_classificazione` (codice PK, nome_display, categoria, escludi, ordine, colore), `analisi_ricavi_imports`, `analisi_ricavi_trattamenti`, `analisi_ricavi_reparti`.
Migrazioni: ar001_2026 (tabelle), ar002_2026 (colore su classificazione).
Parser CSV: auto-detect da intestazione; encoding utf-8-sig→utf-8→latin-1; `_pulisci_valore()` gestisce `€` corrotto.
**Ridistribuzione Non Def**: codici `escludi=true` esclusi, valore redistribuito proporzionalmente a query-time (`_applica_ridistribuzione()`).

Endpoint (prefix `/analisi-ricavi`):
- `POST /import`, `POST /import/sovrascrivi`, `GET /import/storico`, `DELETE /import/{id}`
- `GET /trattamenti?hotel_code=&anno=&mese=[&mese_fine=]` → classificazione + ridistribuzione
- `GET /reparti?hotel_code=&anno=&mese=[&mese_fine=]` → revenue_module solo per mese singolo
- `GET /gruppo?anno=&mese=[&mese_fine=]` → aggregato tutti gli hotel; `mese_fine` per range
- `GET|POST|PUT /classificazione[/{codice}]` → include campo `colore`
- `GET /export?hotel_code=&anno=&mese=[&mese_fine=]&vista_dettaglio=` → export Excel della vista
  corrente di `TabAnalisiRicavi.jsx` (riusa `get_trattamenti()`/`get_reparti()`/`get_gruppo()`, non
  riaggrega). `hotel_code='GRUPPO'` → 2 fogli con una colonna per hotel; hotel singolo → 2 fogli
  semplici. Il toggle Dettaglio/Macrocategorie esiste SOLO per Trattamenti (i Reparti non hanno
  questo toggle a schermo, sempre dettaglio) — per la vista macro l'aggregazione per categoria è
  fatta lato Python in `_aggrega_per_categoria()`, replica esatta della funzione `bycat` già in uso
  client-side (il backend restituisce sempre il dettaglio completo, l'aggregazione a schermo è solo
  frontend). Non esporta la colonna "Δ Revenue" dei Trattamenti: a schermo è solo un placeholder
  (sempre "—", mai calcolato) — nulla di reale da esportare lì. Il confronto Reparti vs Revenue
  module invece è reale (`revenue_module`, solo mese singolo) ed è incluso in fondo al foglio Reparti
  quando disponibile. Titolo di ogni foglio include "IVA inclusa": a differenza di
  Corrispettivi/Produzione questo modulo non ha né un campo IVA né un toggle lordo/netto — il
  "valore" è preso così com'è dal CSV Passbi (Dashboard Analisi Ricavi), che è sempre IVA inclusa
  (confermato dall'utente) — dicitura fissa, non uno stato dinamico da un toggle inesistente.

Frontend `TabAnalisiRicavi.jsx`: bottoni hotel [DPH][CLB][INT][Gruppo]; frecce ◀▶ mese/anno; toggle Range (mese_fine); toggle dettaglio/macrocategorie; toggle Δ Revenue (solo hotel singolo). Default: mese precedente a quello corrente. Colori: priorità DB → `CATEGORIA_COLORI` → palette.
Admin `corr-classificazione`: `CorrClassificazioneTrattamenti` con colonna Colore (swatch + hex).

### Frontend Corrispettivi.jsx (10 tab)
Import | Corrispettivi giornalieri (drawer cella→documenti) | Scontrini | Fatture | Penali | Riepilogo Fatturati | Controllo RT | Stampante RT | Analisi Ricavi | Dati di test.
`PerHotelView`: generico per scontrini/fatture, `localStorage('scontrini_vista'|'fatture_vista')`.
Tab attiva: `localStorage('corrispettivi_tab')`.

**Diviso per file** (stesso pattern dello split backend — `Corrispettivi.jsx` è solo tab bar + routing,
~130 righe invece di ~3000): `frontend/src/utils/corrispettiviHelpers.js` (costanti/helper condivisi:
`STRUTTURE_HOTEL`, `NOMI`, `NOME_CAT`, `thSt`/`tdSt`/`inpSt`, `isAdmin`, `fmtD`, `meseNome`,
`primoGiorno`/`ultimoGiorno`, `giornoSettimana`, `applyToggle`/`fmtToggle` — import da qui, non
ridefinire), `TabImport.jsx`, `TabDocumenti.jsx` (+ `ModalModifica`, `PerHotelView`, `CameraCell` —
componenti privati usati solo da scontrini/fatture), `TabGiornalieri.jsx` (+ `DrawerDocumenti`),
`TabTest.jsx`, `TabFatturati.jsx`, `TabControlloRT.jsx` (+ `FormRT`), `TabPenali.jsx`.
`TabAnalisiRicavi.jsx` e `TabStampanteRT.jsx` erano già file separati da prima. Prima di aggiungere
codice a un tab: verificare se l'helper serve anche altrove — se sì va in `corrispettiviHelpers.js`,
non duplicato nel file del tab.

**Tab "Penali"** (`TabPenali.jsx`, luglio 2026): elenco documenti (scontrini + fatture insieme, con
colonna Tipo per distinguerli — categoria `penali` esiste su entrambi) filtrato server-side su
`GET /corrispettivi/penali` (nuovo alias in `corrispettivi_documenti.py`, stesso pattern di
`/scontrini`/`/fatture` sopra `_lista_documenti()`), colonne Data/N. Documento/Tipo/Struttura/
Intestatario (`intestazione`)/Importo. Filtri data/struttura/numero documento, stessa paginazione di
Scontrini/Fatture. Bottone export `GET /corrispettivi/export/penali?formato=xlsx|csv|pdf` (nuovo
endpoint in `corrispettivi_documenti.py`, stessi filtri della tab, nessuna paginazione) tramite il
componente riutilizzabile `ExportMenu` — helper `_xlsx_tabella`/`_csv_tabella`/`_pdf_tabella`/
`_risposta_tabella` self-contained in quel file (stesso pattern generico intestazioni+righe di
`produzione_export.py`, non riusato da lì perché quel modulo è volutamente self-contained per dominio).

⚠️ **`_determina_categoria()` assegna 'penali' anche a documenti con importo 0€, che non sono penali
reali**: la regola è aliquota IVA≈0% + imponibile=0 → 'penali' (fallback quando non è distinguibile
una tassa di soggiorno vera — vedi commento nella funzione in `corrispettivi_excel_parser.py`), un
criterio che intercetta *qualunque* documento a zero con quell'aliquota, non solo le penali. Sui dati
reali: 36 documenti su 62 in categoria 'penali' avevano `totale_lordo=0` — solo 4 annullati, gli altri
32 scontrini/fatture regolari (ospiti reali, camera, prenotazione) con saldo a zero per motivi propri
del PMS (es. gestito su un altro documento della stessa prenotazione), scambiati per penali solo dal
fallback di categorizzazione. Fix (non nel parser, che assegna la categoria all'import e non va
toccato senza rischiare regressioni altrove — vedi filosofia "Funzioni centrali" in cima al file):
`GET /penali` e `GET /export/penali` filtrano `totale_lordo != 0` (parametro `escludi_zero` aggiunto a
`_lista_documenti()`), quindi la tab mostra solo penali con importo reale. Il dato a 0€ resta comunque
in `corrispettivi_documenti` per audit, visibile solo da Scontrini/Fatture con filtro categoria=Penali.

⚠️ **Categoria assegnata all'import, mai ricalcolata sui documenti già in DB**: a differenza di
Statistiche Produzione (`POST /produzione/ricalcola-categorie`), Corrispettivi non ha un endpoint di
ricalcolo bulk — se `_determina_categoria()` cambia (es. il fix TS-vs-penali sopra), i documenti già
importati restano con la categoria assegnata al momento dell'import, anche se rieseguendo la funzione
con gli stessi valori oggi darebbe un risultato diverso. Caso reale (agosto 2026): scontrino 402/D del
23/06/2026 (280€, imponibile=280, IVA 0%, colonna TS=0 nel formato esteso) importato il 24/06/2026 con
categoria `tassa_soggiorno` — corretto sarebbe `penali` (TS=0 → non è tassa di soggiorno vera), ma la
riga non si era mai riallineata. Diagnosi: rieseguire `_determina_categoria()` con gli stessi valori
esatti del documento (aliquota_pct, imponibile, causale_cancellazione, tassa_soggiorno, colonna_ts_presente
tutti letti dalla riga) e confrontare col campo `categoria` salvato — se diverso, è questo bug, non un
errore sui dati. Verificato sull'intero DB: caso isolato (1 solo documento), quindi corretto a mano via
`PUT /documenti/{id}` (stesso percorso di "Modifica" in UI, audit trail `modificato_manualmente`/
`categoria_originale`) invece di costruire un endpoint di ricalcolo bulk non ancora giustificato dal
volume — se in futuro dovessero emergere più casi dopo un cambio a `_determina_categoria()`, considerare
lo stesso pattern di `ricalcola-categorie` di Produzione.

**`SOGLIA_MAX_TASSA_SOGGIORNO = 100.0`** (`corrispettivi_excel_parser.py`, agosto 2026): la tassa di
soggiorno per singolo documento non supera mai questa cifra nella pratica reale del gruppo (confermato
dall'utente — verificato anche sui dati: il documento tassa_soggiorno più alto mai importato è 70€).
`_determina_categoria()` ora usa questa soglia sull'importo esente (0% IVA) sia in formato esteso
(oltre alla regola TS-colonna=0→penali già esistente, anche TS-colonna > soglia → penali, nel caso
Welcome valorizzi quella colonna con un importo anomalo) sia in formato base (nessuna colonna TS
disponibile per distinguere — prima assumeva sempre tassa_soggiorno per qualunque importo, ora
imponibile > soglia → penali). Verificato rieseguendo la funzione su tutti gli 867 documenti storici
già in categoria tassa_soggiorno/penali: nessuna discrepanza (il fix vale quindi solo per import
futuri, oltre al caso isolato 402/D già corretto sopra).

⚠️ "Controllo RT" (tab id `rt`, riconciliazione scontrini vs `rt_chiusure` trasmesse ad AdE) e "Stampante RT"
(tab id `rt-stampante`, comandi hardware Epson) sono due sezioni distinte — nomi simili ma nessuna relazione.

### Stampante RT — comandi Epson FP-81 II (`TabStampanteRT.jsx`)
Invia comandi X/Z/STATUS al registratore telematico via SOAP/HTTP (`fpmate.cgi`), **chiamata diretta
browser → stampante** (nessun proxy backend: si è verificato empiricamente che l'RT non blocca CORS).
- **Tabella `rt_printers`** (id, nome, ip univoco): un registratore può essere condiviso da più hotel
  (es. Du Parc + Club Hotel sullo stesso IP `192.168.100.134`). `hotels.rt_printer_id` FK nullable
  (NULL = RT non configurato per quell'hotel). Endpoint gestione: `routers/rt_printers.py`
  (`GET|POST /rt-printers/`, `PUT|DELETE /rt-printers/{id}`, `PUT /rt-printers/hotels/{hotel_code}`
  per associare/disassociare — scrittura solo admin).
- Admin unificata: `corr-rt-stampanti` → `CorrStampantiRT` (CRUD stampanti + select associazione per hotel).
- Frontend carica l'elenco da `GET /rt-printers/` (non più da `hotels`), un solo elemento per stampante
  condivisa. Badge VPN/LAN calcolato client-side: IP fuori da `192.168.100.x` → VPN.
- **"Stato stampante" (`verificaStato`) è un semplice controllo di raggiungibilità di rete**, non un
  comando fiscale: `fetch(http://{ip}/, {mode:'no-cors', timeout 3s})` senza alcun body SOAP — nessuna
  stampa fisica generata. In precedenza riusava il payload di `X` (`printXReport`, l'Epson non espone
  un comando di stato dedicato via `fpmate.cgi`), il che stampava un report reale a ogni verifica di
  stato: cambiato perché indesiderato (consumo carta, comando fiscale per un controllo che dovrebbe
  essere innocuo). Con `mode:'no-cors'` la risposta è opaca (non leggibile) per design — serve solo a
  sapere se la connessione TCP va a buon fine, non a leggerne il contenuto.
- Risposta RT: XML con `<response success="" code="" status="">` (attributi, non elementi annidati).
- **fetch() con `Content-Type: text/plain` e nessun header custom** (niente `SOAPAction`): con
  `text/xml` + header custom il browser manda prima una OPTIONS di preflight CORS, e la fpmate.cgi
  (non distinguendo i verbi HTTP) esegue la stampa su entrambe le richieste → stampa duplicata
  (bug osservato e corretto in campo su Report X).
- **Nessuna enforcement server-side sul comando Z** — il pulsante è visibile solo se `isAdmin()` lato
  frontend, ma chiunque abbia accesso di rete alla stampante può inviare comandi direttamente:
  il controllo è solo di interfaccia, non di sicurezza
- Dialog di conferma Z: pulsante abilitato dopo 2s (`CONFERMA_Z_DELAY_MS`), per evitare click accidentali
- Testare sempre prima con Report X prima di una Chiusura Z (irreversibile)

---

## Modulo Forecast & OTB
- **OTB**: da `daily_revenue`, identificato da `snapshot_date`
- **Maturato**: override manuale OTB, un record per (hotel_id, anno, mese)
- **Pickup rate**: % incremento su base (maturato se presente, altrimenti OTB)
- **Consuntivo**: snapshot più recente per ogni data

Tabelle (`forecast_maturato`, `forecast_budget`, `forecast_pickup_config`): UNIQUE per (hotel_id, anno, mese).
Endpoint: `GET /forecast/summary?anno=&hotel_code=` (hotel_code=all → aggregato), `GET /forecast/pace`, `PUT /forecast/maturato|budget|pickup-config`, `DELETE /forecast/maturato/{id}`.

---

## Modulo Budget
4 input settimanali: occupancy_budget (%), adr_budget, adr_fnb_budget, adr_extra_budget.
`rooms_sold_budget = round(occupancy/100 * rooms_available)`. KPI derivati calcolati in `budget_calculator.py`.
**Mese contabile**: mese con più giorni nella settimana (≥4, nessuna parità possibile).
**Versioning**: v1 = ufficiale; v2+ copiate da source_version, completamente indipendenti.
**Proiezione**: settimane con actual da `daily_revenue` (snapshot più recente); senza actual → stima budget. Trend: 'sopra/sotto_budget/in_linea' (soglia 5%).

Endpoint chiave: `PUT /budget/{hotel}/{year}/{week_start}`, `GET /budget/{hotel}/{year}/confronto[/mensile]`, `GET /budget/{hotel}/{year}/proiezione`, `POST /budget/{hotel}/{year}/import-excel`, `GET /budget/gruppo/{year}/confronto|proiezione`.
Frontend: 4 tab (Inserimento / Confronto Actual vs Budget / Proiezione / Gruppo).

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

---

## Modulo Statistiche Produzione
Modulo separato (non più dentro USALI — spostato su richiesta esplicita dopo la prima versione),
route `/statistiche-produzione`, code modulo `produzione`, in NavBar tra Statistiche (revenue) e
Budget. `StatisticheProduzione.jsx` è il tab router (Import, Produzione giornaliera, Analisi canali,
Analisi trattamenti, Analisi tipo ospite, Report mensile, Ricavi camere, Dati di test — 8 tab), toggle
IVA globale `localStorage('produzione_lordo')` su tutte tranne Import/Dati di test. `Usali.jsx` ha 2 tab proprie:
"Conto Economico" (`UsaliContoEconomico.jsx`, invariato) e "Movimenti Attivi" (`UsaliMovimentiAttivi.jsx`,
vedi sezione dedicata più sotto) — quest'ultima aggiunta dopo la prima separazione dei moduli, legge
dati aggregati da Produzione/Corrispettivi.

Import analitico riga-per-riga da **StatisticheProduzione.xlsx** (Welcome PMS): un record per ogni
singolo addebito (Quota Alloggio, Colazione, Cena, Parcheggio, voci bar/spiaggia, ecc.), **registro
gestionale distinto dal registro fiscale di Corrispettivi** (`listaConti.xlsx` / `corrispettivi_documenti`)
— nessun controllo incrociato tra i due, dati e finalità diverse (uno è analitico per revenue
management, l'altro è il registro trasmesso ad AdE).

⚠️ **Le colonne reali del file NON corrispondono a nomi "leggibili" intuitivi** — verificato contro un
export reale (giugno 2026, 488 righe) prima di scrivere il parser, perché la spec iniziale del modulo
assumeva nomi colonna diversi da quelli effettivi di Welcome:
- `Reparto`→descrizione, `VoceAddebito`→sotto_descrizione, `Articolo`→dettaglio_originale (qui, non in
  una colonna "Dettaglio"), `Risorsa`→camera (presente su ogni riga, incluse quelle Bar/Ristorante/
  Parcheggio/Spiaggia: l'addebito è sempre legato alla camera dell'ospite), `UbicazioneRisorsa`→nome
  struttura (fallback), `Totale`→prezzo_lordo (= Imponibile+Iva; non esiste una colonna "Prezzo Netto"
  distinta — `prezzo_netto = Totale − Commissione`, oggi sempre uguale al lordo perché `Commissione` è
  0 in questo export, ma corretto se Welcome in futuro valorizza le commissioni OTA per canale).
- ⚠️ **`ParametroMercato` e `ParametroSegmento` sono scambiati rispetto al nome**: `ParametroMercato`
  contiene i valori di segmento (Leasure, Eventi Generici) → mappato su `segmento`;
  `ParametroSegmento` contiene i valori di tipo ospite (Coppia, Famiglia, Weekend, Single, Genitore
  single) → mappato su `tipo_ospite`. Confermato confrontando i valori reali con gli esempi attesi,
  non deducibile dal nome colonna — se Welcome cambia export in futuro, verificare che questo scambio
  sia ancora valido prima di fidarsi ciecamente del mapping.
`app/services/prod_parser.py` mappa dalle colonne reali, con gli alias "leggibili" come fallback.

**Struttura da camera**: non esiste (e non serve) un file `struttura_resolver.py` dedicato come
inizialmente ipotizzato — `app/utils/struttura_resolver.py` fa lookup a cascata: 1) tabella `rooms`
(fonte autoritativa, verificato che tutte le camere di un export reale esistono già lì) 2) fallback
prefisso camera (`D→DPH, C→CLB, I→INT`, speciali `AIRE/AGUA/TIERRA/FUEGO→DPH`, stessa logica —
duplicata volutamente, non refactorizzata per non rischiare il modulo esistente — di
`PREFISSO_A_STRUTTURA`/`CAMERA_SPECIALE_A_STRUTTURA` in `corrispettivi_excel_parser.py`) 3) fallback sul
nome struttura letto dal file (`UbicazioneRisorsa`).

**Regola Riassetto**: righe con `Articolo`='Riassetto' (valore sempre 0) hanno `is_riassetto=true`:
salvate nel DB (utili in futuro per conteggi pulizie) ma escluse da `query_report()`
(`produzione_shared.py`) e dalla view `v_prod_report`, che devono restare sincronizzate a mano (la
prima è l'implementazione effettiva usata dai router per comporre filtri dinamici, la seconda è per
accesso diretto/BI — stessa condizione WHERE in entrambe: `is_riassetto=false AND
categoria.includi_report=true`).

**Categorie NON hardcoded, incluso il mapping testo→categoria** (non solo la definizione delle
categorie): tabella `prod_categorie` (code, name, includi_report, ordine, colore, attivo) +
`prod_dettaglio_categoria` (testo esatto colonna `Articolo` del file → categoria, match
case-insensitive via indice `uq_prod_dettaglio_categoria_lower` su `lower(dettaglio_originale)`).
Il vecchio design (`prod001_2026`) aveva solo la definizione categoria configurabile da admin, con
il mapping testo→categoria fisso in un dizionario Python (`ARTICOLO_A_CATEGORIA`) — sostituito in
`prod004_2026` perché non copriva un caso reale: **il parcheggio va diviso in due categorie
distinte** (`parcheggio_hotel` / `parcheggio_esterno`, non più un'unica `parcheggio` con
sotto-tipo interno via `per_tipo` nel report), con nomi e mapping interamente editabili da admin
(`?s=prod-mapping` → `ProdMappingDettagli` in AdminUnificato.jsx) senza toccare il parser — utile
se Welcome rinomina l'Articolo o cambiano le tariffe l'anno prossimo. Endpoint:
`GET|POST /produzione/mapping-dettagli`, `PUT|DELETE /produzione/mapping-dettagli/{id}`.
Nessun match in `prod_dettaglio_categoria` (o categoria disattivata) → fallback su `altro`.
`dettaglio_originale` su `prod_righe` preserva comunque sempre il testo originale del file.

**Assegnazione per prezzo, non solo per testo** (`prod005_2026`): alcune voci Welcome non hanno un
testo che le distingua (es. "Parcheggio extra" può essere sia Area Hotel 20€/notte sia Area Esterna
13€/notte — verificato su dati reali: gli importi sono sempre multipli esatti di una delle due
tariffe). `prod_categorie.tariffa_riferimento` (editabile da admin, tab Categorie) +
`prod_dettaglio_categoria.categoria_da_prezzo` (checkbox "assegna per prezzo" in `ProdMappingDettagli`):
quando true, il parser (`_categoria_da_prezzo()` in `prod_parser.py`) ignora il testo e sceglie la
categoria attiva la cui tariffa divide esattamente `prezzo_lordo` (tariffe più alte verificate per
prime), `categoria_id` della riga di mapping resta come fallback se nessuna tariffa combacia. Se la
tariffa stagionale cambia, si aggiorna solo il campo in admin, nessuna modifica al parser.

**Pannello "Da smistare" in `ProdMappingDettagli`** (`GET /produzione/altro-da-smistare`, solo admin):
mostra le voci `Articolo` che cadono ancora in "Altro" su dati reali, ordinate per importo totale
decrescente, con assegnazione rapida — nato da un caso reale in cui "Servizio Spiaggia" valeva
€18.996/mese ed era invisibile dentro "Altro" finché non è stato ispezionato a mano via SQL.

⚠️ **Creare/modificare un mapping in `prod_dettaglio_categoria` NON tocca le righe già importate**:
`categoria_id` viene scritto una sola volta in fase di import (`prod_parser.parse_xlsx`), leggendo
il mapping presente in quel momento — bug reale (luglio 2026): l'utente ha smistato "Caffè" da
"Altro" a "Bar Caffetteria" dal pannello sopra, ma la categoria restava vuota in Produzione
giornaliera perché le righe di giugno erano già in `prod_righe` con `categoria_id` vecchio. Fix:
`POST /produzione/ricalcola-categorie` (`richiedi_admin`) rilegge tutte le `prod_righe` reali
(`is_test=false`) e riapplica `_categoria_id_da_articolo()` (stessa funzione usata dal parser)
contro il mapping attuale, senza ri-importare i file — stesso pattern di
`POST /dipendenti/ricalcola-cc-anno`. Bottone "Ricalcola categorie righe esistenti" in cima a
`ProdMappingDettagli`: va rilanciato ogni volta che si smista una voce da "Altro" o si cambia un
mapping esistente, altrimenti l'effetto è visibile solo sui prossimi import.

**Categoria `escluso_pensione`** (`includi_report=false`, luglio 2026): usa per la prima volta in
pratica il flag `includi_report` a livello di categoria (finora usato solo concettualmente, come
per `is_riassetto` a livello di riga) per nascondere completamente una voce dai report — non solo
dalla vista raggruppata, ma da **tutti** i totali (giornaliero/settimanale/mensile/canali/
trattamenti/tipo-ospite), perché `query_report()` filtra `ProdCategoria.includi_report.is_(True)`
a livello SQL prima di qualunque aggregazione. Caso reale: `VOUCHER PRANZO 25€`/`VOUCHER  CENA 35€`
(quest'ultimo con doppio spazio esatto nel testo Welcome — il match è case-insensitive ma non
collassa spazi interni) non sono vendite ma sconti che coprono la quota pasto già inclusa nella
tariffa mezza/pensione completa (il cliente paga solo l'eccedenza al ristorante): contarli come
ricavo aggiuntivo avrebbe gonfiato artificialmente il fatturato. Pattern riusabile per qualunque
altra voce "non reale" che dovesse emergere in futuro da un export Welcome (non serve una nuova
colonna/flag: basta una categoria con `includi_report=false` e il mapping testo→categoria).

**Toggle IVA — diverso dal pattern Corrispettivi**: qui il backend restituisce per ogni aggregato
`{lordo, imponibile, iva, n_righe}` già calcolati esattamente (somma reale per riga, non
un'approssimazione via aliquota unica di categoria) — il frontend sceglie solo quale campo mostrare
(`campoValore()` in `produzioneHelpers.js`), senza applicare alcuna formula client-side.

**Endpoint aggiuntivi non nella spec iniziale, necessari per la UI**: `GET /produzione/righe` (righe
analitiche di dettaglio per il drawer di Produzione giornaliera — nessun endpoint copriva questo
caso), `POST /produzione/categorie` + `PUT /produzione/categorie/{id}` (scrittura per il pannello
admin, la spec elencava solo il `GET` di lettura).

⚠️ **`POST /produzione/import` rifiuta un secondo import con stesso file+periodo** (409, non
duplica): stesso pattern UX già in uso nel modulo Dipendenti ("Import già presente..."). Questo
controllo da solo non basta contro i duplicati: protegge solo dal ri-caricare *esattamente* lo stesso
file (stesso nome, stesso `data_da`/`data_a`), non da un file diverso (es. l'export del mese intero)
che si sovrappone a un periodo già importato — per quello serve la chiave anti-duplicati a livello di
riga, vedi sotto. `prod_imports` ha comunque un proprio vincolo UNIQUE su `(data_da, data_a,
nome_file)` che va gestito esplicitamente prima di provare l'insert, altrimenti il secondo import
fallisce con 500 invece di un errore chiaro (bug trovato scrivendo il test di idempotenza).

⚠️ **Chiave anti-duplicati di `prod_righe` = `(is_test, oid_welcome)`, non una tupla di campi
(cambiata due volte, entrambe da bug reali)**:
1. La prima versione (`UNIQUE(import_id, struttura_code, data_riferimento, camera,
   dettaglio_originale, ospite, prezzo_lordo)`, dalla spec originale) proteggeva solo DENTRO la
   stessa sessione di import: importando un file diverso (es. mese intero) che copre un giorno già
   importato, le righe di quel giorno raddoppiavano, perché `import_id` differiva tra le due sessioni
   — riprodotto in campo (401→802 righe reimportando lo stesso giorno con nome file diverso).
   Fix (`prod002_2026`): tolto `import_id` dalla chiave (deduplica globale, non per sessione),
   aggiunto `is_test` (altrimenti un import reale sovrapposto a dati di test verrebbe scartato come
   "duplicato" di quelli, e quelle righe non comparirebbero mai nei report reali).
2. Questo fix ne ha esposto un altro, opposto: quando `ospite` è vuoto (prenotazioni di gruppo senza
   nome cliente associato a ogni singolo addebito — reale nel file) più righe **realmente distinte**
   possono condividere identici struttura/data/camera/dettaglio/prezzo (es. 3 colazioni identiche per
   3 persone diverse nella stessa camera) e collidere sulla stessa chiave, venendo scartate come falsi
   duplicati — riprodotto: 34 righe su 487 nel file di test, 220 in un import reale di un mese intero.
   Fix definitivo (`prod003_2026`): la colonna `Oid` del file (identificativo univoco Welcome per ogni
   singolo addebito, sempre intero, sempre distinto — non serviva alcuna tupla di campi) sostituisce
   l'intera logica precedente. `oid_welcome` è obbligatorio: righe senza Oid valido vengono scartate
   (`n_righe_escluse`), non salvate con chiave incerta.

Router diviso per dominio come Corrispettivi (`produzione.py` aggregatore sottile,
`produzione_shared.py`, `produzione_import.py`, `produzione_report.py`, `produzione_export.py`), tutti
sotto prefix `/produzione`. `DELETE /produzione/import/{id}` allineato a Corrispettivi (`prod004_2026`):
elimina qualunque import (non solo di test) con `?conferma=true`, cascade sulle righe collegate — utile
per correggere un import sbagliato dalla UI (tab Import → "Elimina", visibile per ogni import, non solo
quelli di test) senza dover intervenire a mano sul database.
File test: `uploads/StatisticheProduzione.xlsx` (487 righe valide, 86 riassetto, giugno 2026, 3 strutture).

**`TabGiornaliera.jsx` — layout diverso per "Tutte le strutture" vs singola struttura** (luglio 2026):
con una struttura sola la tabella Data×Categoria è già compatta e resta invariata; con "Tutte le
strutture" una singola tabella con 3 hotel × tutte le categorie come colonne diventava troppo larga
(~14 categorie × 3 hotel + totali ≈ 47 colonne). Fix: niente hotel-come-colonne — sopra un riepilogo
compatto (`RiepilogoTutteStrutture`, solo Data | Tot. per hotel | TOT. GIORNO), sotto tre blocchi
accordion impilati (`BloccoHotel`), uno per hotel, ciascuno contenente la stessa tabella Data×Categoria
di sempre (`TabellaHotel`, estratta e riusata in entrambe le modalità — non due implementazioni
separate). Stato aperto/chiuso per hotel in memoria component (non persistito), tutti aperti di default
perché lo scopo è vedere tutti i dati, non nasconderli — l'accordion serve solo a non avere tre tabelle
larghe fuse in una sola riga di colonne.

⚠️ **Import di un mese intero (~13.000 righe) andava in timeout lato frontend** (`axios` timeout
30s, `api/client.js`) pur completando correttamente lato server — bug reale, non solo un limite di
timeout da alzare: il parser risolveva la struttura di ogni riga con una query `rooms` separata
(`struttura_da_camera()` chiamata riga per riga, non camera per camera — problema N+1, ~13.000 query
singole per un file con sole ~100 camere distinte) e l'import inseriva le righe una alla volta
(`INSERT` singolo per riga in loop Python). Fix: `carica_mappa_rooms(db)` precarica tutta `rooms` in
un'unica query prima del ciclo (`struttura_da_camera()` ora prende `rooms_map` già in memoria, non
più `db`), e `produzione_import.py` inserisce a blocchi da 500 righe (`CHUNK_SIZE`) invece che uno
alla volta. Verificato: mese sintetico da 13.636 righe, 12,5s (era già oltre i 30s prima del fix,
causa del timeout osservato in campo). Se il backend riceve un timeout dal frontend su un import
grande, controllare prima nei log/DB se l'import è comunque andato a buon fine (`GET
/produzione/import/storico`) prima di far ricaricare il file: il commit lato server può completare
anche dopo che il browser ha già mostrato l'errore.

### Tab "Ricavi camere" (`produzione/TabRicaviCamere.jsx`, settembre 2026 — nata in Corrispettivi, spostata qui subito perché la fonte è `prod_righe`)
Ricavi per singola camera in un periodo scelto (default: 01/01–31/12 anno solare corrente), per
struttura `[DPH][CLB][INT][Gruppo]`. Toggle vista **Per categoria** ↔ **Per trattamento**
(`localStorage('prod_ricavi_camere_vista')`, hotel in `prod_ricavi_camere_hotel`): stesse righe
(camere), colonne diverse (categorie di ricavo `prod_categorie` con swatch colore | tipi di
trattamento BB/HB/FB/AI/Solo Pernottamento/OTA/n·d). Checkbox "Mostra camere a zero" (join con
anagrafica `rooms`). Camere ordinate per numero crescente (prefisso hotel escluso: `D101`→101;
`_num_camera()` backend, `numCamera()` frontend — camere senza cifre, es. FUEGO/AIRE, in fondo),
raggruppate per struttura; click su "TOTALE" nell'header passa all'ordine per ricavo decrescente.
Casella di ricerca testo (client-side): se combacia con codice/tipo camera filtra le righe, se
combacia con un'etichetta di colonna filtra le colonne — filtri indipendenti. Riga TOTALE con sfondo
su ogni `<td>`, ricalcolata sulle righe/colonne visibili. Usa il toggle IVA globale del modulo (prop
`lordo`).
Dati a **maturato** (quota spalmata notte per notte su `data_riferimento`), non a fatturato come i
Corrispettivi (documento emesso alla partenza): sul singolo mese solare divergono per i soggiorni a
cavallo di fine mese (effetto marcato su CLB/INT, a pacchetto settimanale sab-sab; piccolo su DPH);
riconciliano sulla stagione. Restano differenze strutturali che non si compensano (tassa di
soggiorno e penali/fatture eventi solo nei Corrispettivi; voucher pensione scontato solo qui).
Backend: `produzione_ricavi_camere.py` (sotto-router incluso da `produzione.py`), riusa
`query_report()` di `produzione_shared` (esclude già `is_riassetto` e categorie `includi_report=false`
come `escluso_pensione`), `_categorie_attive()` di `produzione_report` e `_risposta()` di
`produzione_export`. Aggregazione in SQL (GROUP BY camera×categoria e camera×trattamento). Endpoint:
- `GET /produzione/ricavi-camere?hotel_code=DPH|CLB|INT|GRUPPO&data_da=&data_a=&includi_zero=`
- `GET /produzione/ricavi-camere/export?...&vista=categoria|trattamento&lordo=&formato=xlsx|csv|pdf`
  (sotto-path per non collidere con la rotta catch-all `/produzione/export/{dimensione}`).

## Modulo USALI — Movimenti Attivi
Seconda tab di `Usali.jsx` (`UsaliMovimentiAttivi.jsx`), accanto a "Conto Economico". Tabella
Reparto/Conto/Imponibile mensile (formato di un foglio di inserimento esterno preesistente),
**per struttura** (DPH/CLB/INT/BON, selettore in cima alla tab) — non a livello di gruppo come nella
primissima versione: le voci non sono le stesse per ogni struttura (DPH ha il Ristorante Mare Mosso
con redirect automatico; CLB e INT hanno un Ristorante proprio, senza redirect; BON — come Maremosso,
nessun dato Welcome/PMS — ha un set minimo tutto manuale). Maremosso (MMS) **non** è una struttura
selezionabile qui: è inglobato dentro DPH come suo ristorante esterno.

**Righe NON hardcoded**: tabella `usali_movimenti_righe` (struttura_code, reparto, conto, riga_code,
tipo, categoria_produzione, ordine, attivo), gestita da admin (`?s=usali-movimenti` →
`UsaliMovimentiRighe` in AdminUnificato.jsx, selettore struttura + CRUD righe con frecce ordine).
Endpoint: `GET /usali/movimenti-righe?struttura=`, `POST /usali/movimenti-righe`,
`PUT|DELETE /usali/movimenti-righe/{id}`. Seed iniziale in `usali002_2026` — un punto di partenza
ragionevole, non definitivo: l'elenco esatto di voci per CLB/INT/BON va rifinito da admin.

Ogni riga ha un `tipo`: **auto** (calcolata a query-time da Produzione/Corrispettivi, mai salvata, non
modificabile — `PUT /usali/movimenti-attivi` risponde 400) o **manuale** (letta/scritta su
`usali_voci_manuali`, riusata dalla stessa tabella del Conto Economico con lo `struttura_code` reale
— non più una sentinella 'GRUPPO` — namespace di `voce_code` distinto con prefisso `mov_`, endpoint
separati `GET|PUT /usali/movimenti-attivi` che non toccano la validazione di `PUT /usali/voce`).
Tipi auto:
- `auto_produzione` (+ `categoria_produzione`) → `SUM(imponibile)` da `prod_righe` filtrato per
  struttura E categoria (`_somma_produzione_categoria()`) — usato sia per le voci comuni
  (Parcheggio Hotel/Esterno, Colazione, Camere Individuali, Bar, Spiaggia) sia per il Ristorante
  proprio di CLB/INT (categoria `pranzo`/`cena` filtrata su quella struttura, senza redirect).
  Bar/Spiaggia mostrano 0 finché non si fa lo smistamento da "Altro" (vedi sopra).
- `auto_corrispettivi_penali` → `SUM(imponibile)` da `corrispettivi_documenti` categoria `'penali'`
  per quella struttura (esclusi annullati) — solo DPH/CLB/INT, BON non ha questo concetto.
- `auto_maremosso` → **solo DPH**, riga "Alimenti -> Altri Alimenti - Hotel" (`_somma_maremosso()`,
  invariata): righe Welcome con `Reparto='Maremosso'` (qualunque struttura/camera) + Pranzo e Cena
  attribuiti al Du Parc in Produzione, perché gli ospiti del Du Parc consumano pranzo/cena
  fisicamente al Maremosso (esterno, non la cucina del Du Parc). Tutto confluisce per ora in
  un'unica voce (non ancora scorporato per Vino/Alcolici/Analcolici — verrà fatto in un secondo
  momento).
- `auto_maremosso_esterni` → **solo DPH**, riga "Alimenti -> Altri Alimenti - Clienti Esterni"
  (`_somma_maremosso_esterni()`, `usali004_2026`): clienti che pagano direttamente al ristorante,
  quindi mai in Welcome/PMS — tracciati come inserimento manuale in Corrispettivi per MMS
  (`corrispettivi_manuali.arrangiamenti_lordo`, esattamente come BON: nessun dato PMS per queste due
  strutture). `imponibile = lordo / 1.10` (IVA 10%, stessa convenzione di `_ricavi_ristorante()` e di
  Corrispettivi in generale — mai `lordo - iva`). Due righe distinte perché la sorgente dati e il
  significato economico sono diversi (ospiti hotel via redirect vs. clienti esterni via
  Corrispettivi), pur condividendo lo stesso Reparto "Ristorante Mare Mosso".

**Toggle IVA inclusa/esclusa** (`UsaliMovimentiAttivi.jsx`, `localStorage('usali_movimenti_lordo')`):
diverso sia dal pattern Corrispettivi (backend sempre lordo, toggle client-side) sia da Produzione
(backend restituisce sempre lordo+imponibile+iva già calcolati per riga). Qui il lordo si calcola in
due modi diversi a seconda del tipo riga, perché solo le righe auto hanno un IVA reale:
- **Righe auto**: `_somma_produzione_categoria()`/`_somma_penali_corrispettivi()`/`_somma_maremosso()`
  sommano sia `imponibile` sia `iva` direttamente da `prod_righe`/`corrispettivi_documenti` (dati
  reali riga per riga) — nessuna aliquota assunta, `lordo = imponibile + iva` esatto.
- **Righe manuali**: nessun IVA per-movimento esiste (viene inserito un imponibile mensile unico a
  mano), quindi `lordo = imponibile × (1 + aliquota_iva/100)` usando `usali_movimenti_righe.aliquota_iva`
  (nuovo campo, migrazione `usali003_2026`, default 10%, editabile da admin per riga in
  `UsaliMovimentiRighe` — colonna "Aliquota IVA %", disabilitata/informativa per le righe auto dove
  non si applica). Default 10% ovunque tranne `mov_shop_kmdimare` → 22%, stesse aliquote già in uso
  per la categorizzazione IVA di Corrispettivi (arrangiamenti≈10%, shop≈22%, penali≈0% — quest'ultima
  però è una riga auto, quindi usa l'IVA reale dai documenti, non questo campo).
  `GET /usali/movimenti-attivi` risponde per ogni riga `{imponibile, iva, lordo}` + `totale_imponibile`/
  `totale_lordo` (campo legacy `totale` mantenuto = `totale_imponibile`, per compatibilità).
  Frontend: l'input di modifica delle righe manuali resta **sempre in imponibile** anche col toggle su
  "IVA inclusa" (per evitare arrotondamenti nel salvataggio) — mostra il lordo equivalente accanto,
  a sola lettura.

Righe rimaste manuali perché non estraibili da nessuna fonte attuale: Camere Gruppi (a differenza di
Camere Individuali, richiederebbe raggruppare per `codice_prenotazione`, logica non ancora scritta —
scelta esplicita, non un limite tecnico), Pasticceria (probabilmente mescolata nel menu ristorante
senza un reparto Welcome dedicato), Ristorante Mare Mosso → Vino/Altro Alcolici/Altro Analcolici
(verranno scorporati da "Alimenti -> Altri Alimenti" in un secondo momento), l'intero set BON (nessun
dato Welcome/PMS, tutto manuale come già in Corrispettivi per MMS/BON).

**Ricavi -> Shop Km Di Mare** (DPH/CLB/INT) è passata da manuale ad **auto_produzione** (luglio
2026, arrivati i primi dati Welcome per questa voce): nuova categoria `prod_categorie.shop_kmdimare`
(vedi "Categorie NON hardcoded" sopra), riga `usali_movimenti_righe` aggiornata via
`PUT /usali/movimenti-righe/{id}` (`tipo='auto_produzione'`, `categoria_produzione='shop_kmdimare'`) —
azione di configurazione via endpoint già esistente, nessun codice toccato. Mostra 0€ finché
l'Articolo Welcome esatto per gli acquisti shop non viene mappato a questa categoria in Mapping
Dettagli (e, per import già caricati, dopo un "Ricalcola categorie righe esistenti").

---

## Modulo Camere (Rooms)
Tabella `rooms`: code PK, hotel_id FK, struttura_code, tipo_risorsa, nome_tipo, posti_letto, piano, attiva, note.
Endpoint: `GET|POST /rooms/`, `GET|PUT|DELETE /rooms/{code}`.

---

## Tabelle condivise
`tipi_pagamento` in `shared.py`: codice unique, descrizione, categoria, attivo, ordine.
Router: `GET|POST|PUT /lookup/tipi-pagamento`.

---

## Sistema di backup automatico notturno
**3 copie**: locale (Mac Mini) → Raspberry Pi (rsync via SSH) → repository GitHub privato `hotelos-backup`.
- Script principale: `scripts/hotelos-backup.sh` (pg_dump formato custom `-F c`, legge `DB_NAME`/`DB_USER`
  da `backend/.env` con lo stesso parsing usato dal router `backup.py` — non duplicare la logica altrove).
- Installazione (una tantum): `bash scripts/installa-backup.sh` → copia `scripts/it.hotelos.backup.plist`
  in `~/Library/LaunchAgents/`, `launchctl load`. Label `it.hotelos.backup` (coerente con
  `it.hotelos.backend`/`it.hotelos.frontend` già presenti), esecuzione ogni notte alle 03:00.
- Test manuale: `bash scripts/test-backup.sh` (esegue un backup reale con output verbose).
- Stato senza eseguire nulla: `bash scripts/verifica-backup.sh`.
- Log: `~/hotelos-backups/logs/backup_log.jsonl` (una riga JSON per esecuzione: esito
  success/partial/error, dimensione dump, esito Raspberry/GitHub, durata).
- Retention: 7 copie locale, 7 su Raspberry, 3 su GitHub (repository dedicato, push con `--force`
  ogni notte — accettato: il repo esiste solo per questo scopo, force-push sovrascrive la history
  a ogni esecuzione invece di farla crescere indefinitamente con dump binari).
- Repository GitHub: `hotelos-backup` (privato, da creare manualmente — lo script non lo crea).
  Contiene i `.dump` binari committati direttamente + un `README.md` con la data ultimo backup.
- Endpoint (prefix `/admin/backup`, tutti `richiedi_admin`, sola lettura — nessuno tocca il DB):
  `GET status|logs|files`, `POST esegui-ora` (lancia lo script in background via `subprocess.Popen`),
  `POST ripristina/{nome_file}` (restituisce solo i comandi `pg_restore`/`psql`, non esegue nulla).
- Admin: `?s=backup` in `AdminUnificato.jsx` → `frontend/src/pages/admin/AdminBackup.jsx`
  (card stato, tabella log filtrabile, lista dump con istruzioni di ripristino in modale, accordion setup).
- Test: `backend/tests/test_backup.py` — `subprocess` sempre mockato (nessun pg_dump/rsync reale nei
  test), auth verificata via override diretto di `richiedi_admin` (non tramite il bug noto del 401
  su TestClient senza login, citato sopra — evitato qui perché non serve un utente reale in DB).

⚠️ **Backup mai riuscito nemmeno una volta dall'installazione (7 luglio) fino al 14 luglio**: la
regex `DB_USER=$(... | sed 's/.*:\/\/\([^:]*\):.*/\1/')` in `hotelos-backup.sh` assume sempre un
formato `user:password@host` — con `DATABASE_URL` reale senza password (`user@host`, il caso di
questo progetto), `[^:]*` si fermava solo al primo `:` (quello della porta), catturando
`ginoscola@localhost` intero invece di `ginoscola` → `pg_dump: role "ginoscola@localhost" does not
exist` ogni notte, mascherato in log come semplice `"pg_dump fallito"` senza lo stderr. La versione
Python equivalente in `backup.py` (`_leggi_db_config()`) faceva il parsing correttamente (split su
`@` poi su `:`) — le due implementazioni "gemelle" erano divergenti, esattamente il rischio che la
nota sopra ("stesso parsing... non duplicare la logica altrove") avrebbe dovuto prevenire ma non
copriva (bash e Python restano comunque due implementazioni separate per forza, essendo lo script
invocato anche da cron/launchd fuori processo). Fix: regex bash allineata alla stessa logica
(`sed -E 's#.*://([^:@/]+).*#\1#'`, si ferma al primo tra `:`/`@`/`/`). Se in futuro emerge un altro
sintomo simile ("pg_dump fallito" senza altro dettaglio), controllare prima `~/hotelos-backups/logs/
launchd-error.log` (stderr reale del processo cron, non nel `.jsonl`) prima di sospettare rete/permessi.

⚠️ **Copia su Raspberry Pi — due cause indipendenti dal bug sopra**, entrambe risolte il 14 luglio
(prima verifica end-to-end mai fatta finora, quindi mai emerse prima): (1) chiave SSH del Mac non
autorizzata sul Raspberry (`Permission denied (publickey,password)` pur con Raspberry raggiungibile
via ping) — fix manuale, richiede la password del Raspberry: `ssh-copy-id ginoscola@192.168.100.149`
(da eseguire dall'utente, non automatizzabile via chat per non lasciare la password nella cronologia
conversazione). (2) `rsync: mkdir "/home/ginoscola/hotelos-backups/db" failed: No such file or
directory` — lo script assume che `~/hotelos-backups/db` esista già sul Raspberry, non la crea lui
(a differenza di quanto fa in locale con `mkdir -p`): creata una tantum con
`ssh ginoscola@192.168.100.149 "mkdir -p ~/hotelos-backups/db"`. Con entrambe risolte, backup
verificato `success` su tutti e tre i livelli (locale+Raspberry+GitHub).

---

## Principi di progettazione

### Riusabilità tra moduli
- Lookup condivisi → `models/shared.py`, endpoint → `routers/lookup.py`
- Costanti usate da più moduli → `app/utils/`
- Componenti riutilizzabili → `frontend/src/components/`
- Prima di creare nuova tabella, verificare se qualcosa di simile esiste già

### Righe tabella con sfondo custom (totali, evidenziate) — impostare il background su ogni `<td>`
`index.css` ha una regola globale `tr:nth-child(even) td { background: #edf1f7; }` che si applica a
**tutte** le tabelle dell'app. Uno stile inline `background` messo solo sulla `<tr>` (non sui singoli
`<td>`) NON dipinge i `<td>` figli — in CSS il background non si eredita dal genitore — quindi per le
righe dispari il `<td>` trasparente lascia vedere il colore della `<tr>` (sembra funzionare), ma per
le righe pari la regola globale vince e sovrascrive il `<td>` con `#edf1f7` (grigio chiaro), mentre un
eventuale `color` impostato sul `<td>` (es. bianco) resta invariato → testo quasi invisibile. Bug reale
(luglio 2026, Statistiche Produzione): la riga "TOTALE MESE" in `TabGiornaliera.jsx` risultava leggibile
o "spenta" a seconda del numero di giorni del mese (posizione pari/dispari cambia con 28/29/30/31
giorni — maggio 31gg=pari=rotto, giugno 30gg=dispari=ok); stesso rischio in `TabReportMensile.jsx`
("ANNO", posizione pari/dispari dipende da quante righe di dettaglio mese sono espanse). Fix: impostare
`background` esplicitamente su OGNI `<td>` della riga, non solo sulla `<tr>` — uno stile inline sul
`<td>` batte sempre qualunque regola esterna, a prescindere da specificity/ordine. Corrispettivi evita
il problema con una classe dedicata (`tr.riga-totale td { background: #1e3a5f; color: #fff; }` in
`index.css`, che vince per ordine di dichiarazione — più fragile, si romperebbe riordinando il CSS):
preferire comunque lo stile inline su ogni `<td>`, più robusto.

### Selettore mese/anno — default mese precedente
Ogni pagina/tab con selettore mese/anno deve aprirsi di default sul **mese precedente a quello
corrente**, mai sul mese in corso (ancora incompleto, dati parziali fuorvianti). Calcolo:
`new Date().getMonth()` è 0-indexed (Gen=0), quindi coincide già col mese precedente in numerazione
1-indexed; a gennaio si torna a dicembre dell'anno prima (`meseAnnoPrecedente()` in
`produzioneHelpers.js`, stessa convenzione di `UsaliContoEconomico.jsx` e `TabAnalisiRicavi.jsx`).
Non si applica alle viste "anno intero" (es. Report mensile Produzione, Riepilogo Fatturati) che
mostrano già tutti i 12 mesi in tabella: lì il default resta l'anno corrente.

### Colori configurabili
Ogni elemento visivo che usa colori per distinguere categorie/serie deve avere i colori configurabili in Admin.
- **DB**: colonna `colore VARCHAR(7)` nullable sulla tabella che definisce l'elemento
- **Admin**: colonna Colore con swatch cliccabile (color picker nativo) + campo hex `#rrggbb`
- **Frontend priorità**: colore DB → costante per categoria → palette generica ciclica
- Prevedere `colore` e UI Admin fin dall'inizio, non aggiungerla dopo
- Esempi: `cc_colori_reparti` in app_config (Dipendenti), `trattamenti_classificazione.colore` (Analisi Ricavi)

### Uniformità grafica tra pagine
Prima di costruire un elemento UI che esiste già altrove nel progetto (toggle, badge, pannello di
conferma, ecc.), cercare il pattern già in uso e riusarlo — stesso markup/stile, non solo stessa
funzione. Non introdurre una variante visiva diversa (es. una checkbox al posto della pillola a due
bottoni) solo perché è più veloce da scrivere in quel momento.
- Esempio: toggle "IVA inclusa/esclusa" — stessa pillola arancione (`background:'#fff7ed'`,
  bordo `#fdba74`, bottone attivo `#ea580c`) con due bottoni "IVA inclusa"/"IVA esclusa", identica in
  `Corrispettivi.jsx`, `StatisticheProduzione.jsx` e `UsaliMovimentiAttivi.jsx` — la prima versione di
  quest'ultima usava una semplice checkbox, corretta su richiesta esplicita (luglio 2026).
- Se un componente riutilizzabile esiste già (es. `PastReferenceArea`, `ExportMenu`), usarlo invece di
  reimplementare lo stesso markup inline in una nuova pagina.
- localStorage key per preferenze di visualizzazione (es. toggle IVA) resta per-modulo (`corrispettivi_lordo`,
  `produzione_lordo`, `usali_movimenti_lordo`, ecc.) — l'uniformità è sullo stile, non sullo stato condiviso.
