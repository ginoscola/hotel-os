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
backend/app/
  services/   → logica business (parser, calculator, aggregator)
  routers/    → endpoint FastAPI (vedi sezioni moduli)
  models/     → SQLAlchemy (revenue.py, corrispettivi.py, analisi_ricavi.py, rooms.py, shared.py)
  schemas/    → Pydantic
  utils/
    locale_it.py  → MESI_IT, GIORNI_IT, formatta_data_it() — UNICA sorgente localizzazione
frontend/src/
  pages/      → pagine React
  components/ → componenti riutilizzabili
  utils/format.js → utility formattazione (vedi sezione)
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
Convenzione nome file: `YYYYMMDD_PlanningForecast-HOTELCODE[12].xlsx/csv`

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
Moduli: `revenue` (/dashboard/gruppo), `budget` (/budget), `usali` (placeholder), `dipendenti` (/dipendenti), `corrispettivi` (/corrispettivi), `forecast` (/forecast).
Tabelle: `modules` (code PK, name, icon, route, ordine, attivo, colore), `module_permissions` (module_code, ruolo, puo_vedere, puo_modificare, puo_importare).
NavBar L1: tab moduli da `GET /modules/`; L2: sotto-nav del modulo attivo.
Permessi: al login → `localStorage['moduli_permessi']`; ProtectedRoute verifica `puo_vedere`.
**Aggiungere modulo**: riga in `modules` → righe `module_permissions` → pagina JSX → `<Route moduleCode="">` in App.jsx. Appare automaticamente in NavBar.
Placeholder: `WorkInProgress.jsx`.

## Area Admin (`/admin` → AdminUnificato.jsx, sidebar `?s=`)
**Comune**: `utenti` (CRUD), `stagioni` (stagioni operative), `moduli` (attiva/disattiva/permessi)
**Revenue**: `revenue-import` (bulk import), `revenue-test` (cancella is_test)
**Dipendenti**: `dip-cc` (AdminCentriDiCosto), `dip-colori` (colori CC), `dip-test`
**Corrispettivi**: `corr-tipi-doc`, `corr-pagamenti`, `corr-prefissi` ⚠️ tabelle droppate — da rimuovere; `corr-classificazione` (CorrClassificazioneTrattamenti)
Stagioni: `GET /hotels/{code}/seasons/{year}`, `POST /hotels/{code}/seasons` (upsert).
Dati test: flag `is_test`; `GET|DELETE /admin/test-stats|test-data`, `GET|DELETE /dipendenti/admin/test-stats|test-data`.

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
Test di integrazione che chiamano endpoint protetti falliscono con 401 (TestClient senza auth) — problema pre-esistente, i test unitari passano tutti.
⚠️ Alcuni test (`test_parser_e_bulk.py`, `test_navigazione_confronto_export.py`, `test_upload_endpoint.py`)
falliscono con traceback che punta a `/Users/ginoscola/revenue-master/` invece di `hotel-os` — sono
un'altra directory di progetto, non file di questo repo: ignorare, non nel nostro ambito.

⚠️ **`app/models/__init__.py` importa tutti i moduli modello attivi** (revenue, rooms, corrispettivi,
analisi_ricavi, usali, shared — non `fiscal.py`, dismesso) per registrare in SQLAlchemy le
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

## Dashboard Hotel
- Snapshot: `GET /snapshots/{hotel_code}` → navigazione con frecce. Settimana di riferimento = settimana Sab–Ven contenente snapshot_date.
- `kpi_periodo` = KPI solo sulla settimana di riferimento; evidenziata in grafici (ReferenceArea) e tabella.
- Confronto snapshot precedente (mutuamente esclusivo con anno precedente, offset 364gg ±30gg tolleranza).
- Revenue giornaliero: senza confronto → BarChart impilato (Camere/F&B/Extra); con confronto → LineChart `revenue_total` corrente vs confronto.
- Dati giornalieri: collassabili, stato in `localStorage('giornalieri_{hotel_code}')`.
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
- Hotel: `GET /export/hotel/{code}/settimanale|giornaliero?snapshot=&da=&a=&formato=xlsx|csv|pdf`
- Gruppo: `GET /export/gruppo?da=&a=&formato=`
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
`GET /dipendenti/` (lista anagrafica) restituisce anche `centri_di_costo` (lista completa, non solo
il primo CC come `centro_di_costo`/`centro_di_costo_id` — mantenuti per compatibilità): bug corretto
in cui la riga riassuntiva di `AnagraficaCard` mostrava un solo CC per dipendenti con ripartizione su
più centri (es. Balducci Annie su 3 reparti Pasticceria CLB/DPH/INT), visibili tutti solo dopo aver
espanso la card (che li carica separatamente da `GET /dipendenti/{id}/centri-di-costo`).
File test: `uploads/202604_costi  aziendali .pdf` (8 dipendenti, aprile 2026).

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
  ⚠️ Welcome PMS assegna `numero=0` a **tutte** le righe di storno/annullo non numerate emesse
  in un giorno per una struttura (non è un identificativo). Con ≥2 annullamenti nello stesso
  giorno/struttura, la vecchia chiave (senza camera/codice_prenotazione) li considerava lo
  stesso documento: solo il primo veniva inserito, il secondo scartato in silenzio da
  `ON CONFLICT DO NOTHING` nello stesso import — causa di un delta RT-PMS reale (27/06/2026,
  CLB, -1.274€: storno perso della prenotazione 4406, coesisteva con lo storno della
  prenotazione 338 stesso giorno/numero=0/suffisso). Migrazione `corrfix001_2026`.
  Stesso pattern già incontrato ed erroneamente "risolto" rimuovendo del tutto il vincolo
  sulla vecchia tabella `fiscal_documents` (precursore, ora dismessa) — qui invece si è
  preferito estendere la chiave (camera+codice_prenotazione distinguono storni diversi)
  per mantenere l'idempotenza per-documento su cui si basa `on_conflict=salta|aggiorna`.
  Non basta però quando la **stessa** prenotazione/camera ha più scontrini annullati nello
  stesso giorno (es. 20/06/2026 INT, camera I418/prenotazione 4858: due storni -476 e -28
  per due scontrini diversi, stesso numero=0/camera/prenotazione) — collidevano ancora tra
  loro. Aggiunta `numero_scontrino` (numero fiscale di stampa, es. "177-18") alla chiave:
  distingue eventi di storno diversi anche a parità di camera/prenotazione. Migrazione
  `corrfix002_2026`. Assente nel formato Excel base (18 colonne): lì resta solo la
  protezione camera+codice_prenotazione, teoricamente ancora vulnerabile allo stesso
  scenario (mai riscontrato finora in quel formato).
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
  **Dalla cartella stampante** (default, sceglie solo RT + data) e **Carica da PC** (selezione manuale file).
  ⚠️ Nel file XML reale `<Imposta>` è annidato dentro `<IVA>` insieme a `<AliquotaIVA>` (non fratello
  diretto di `<IVA>` sotto `<Riepilogo>` come nell'esempio iniziale): il parser gestisce entrambe le forme.

**Alert tassa di soggiorno**: `esente_n1` (Natura N1) di un giorno deve essere multiplo esatto della
tariffa per persona/notte (`TARIFFA_TS_PER_PERSONA`), altrimenti c'è quasi certamente un errore di
conteggio. RT2 = 2,00€ (solo International, tariffa unica). **RT1 = 0,50€** (non 2,50€!): condivide
la cassa fiscale tra Du Parc (2,50€/persona) e Club Hotel (2,00€/persona), quindi qualunque
combinazione di persone-notte tra i due hotel è un totale legittimo (es. 70,50€ = 1 notte Du Parc +
34 notti Club) — verificabile solo sul MCD tra le due tariffe (0,50€), non su 2,50€ da sola (avrebbe
dato falsi allarmi su quasi ogni giorno). Flag `n1_non_quadra` calcolato in `_n1_non_quadra()`,
incluso nella risposta `GET /rt-chiusure` per ogni rt1/rt2. Frontend: icona ⚠️ accanto al totale RT
in `TabControlloRT` con tooltip che mostra l'importo esente N1.
⚠️ `esente_n1` va tenuto sincronizzato con `totale_ts` anche sul salvataggio manuale
(`POST /rt-chiusure`, non solo sull'import XML): altrimenti dopo una correzione manuale della tassa
di soggiorno (`totale_ts`) l'alert continua a basarsi sul vecchio `esente_n1` importato da XML, non
più aggiornato — bug reale scoperto e corretto (luglio 2026), con backfill una tantum sulle righe
`modificato_manualmente=True` già in DB (`esente_n1 = totale_ts`, quest'ultimo come fonte di verità
essendo l'ultimo valore confermato dall'utente).

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
artificiale (bug reale scoperto confrontando la somma stagionale con la somma dei delta mese per
mese — un solo giorno "orfano" da 5.382€ falsava l'intera stagione). Stessa semantica del confronto
giornaliero, dove un giorno senza RT ha `delta=None` ed è escluso dalla somma.

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
Verificato in campo (luglio 2026): dopo aver inserito gli importi noti su una decina di giorni di
maggio, la stagione RT1 è tornata a somma_differenza=0,00€ esatta (prima +252,50€ "inspiegati").

⚠️ **Chiusura fatta "il giorno dopo" disallinea i sotto-campi XML**: se la chiusura RT di un
giorno viene fatta la mattina successiva, i campi dettaglio (`imponibile_10/22`, `imposta_10/22`,
`tassa_soggiorno_nrs` — non `totale_10/22/ts/penali` né `esente_n1`, quelli restano sul giorno
giusto) possono finire salvati sotto la data sbagliata (quella della chiusura, non quella
dell'incasso). Sintomo: `imponibile_10+imposta_10` del giorno D coincide con `totale_10` di
**D-1**, non con quello proprio di D. Bug reale scoperto e corretto (luglio 2026) su un blocco
di giorni RT1 di maggio 2026 (06-08, 11-13, 17-28) inseriti "shiftati" — corretto ricopiando i
sotto-campi sul giorno giusto; l'ultimo giorno di ogni blocco (08, 13, 28) è rimasto senza dato
sorgente per il giorno successivo ed è stato azzerato. Diagnosi: confrontare
`imponibile_10+imposta_10` di ogni giorno con `totale_10` del giorno precedente, non con il
proprio — se combacia sistematicamente su più giorni consecutivi è questo bug, non un errore
puntuale.

Toggle IVA: backend restituisce SEMPRE lordi; `applyToggle()` client-side; `localStorage('corrispettivi_lordo')`.
Correzione manuale: `PUT /documenti/{id}` → `modificato_manualmente=true`, salva valori originali in `*_originale`.

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

Frontend `TabAnalisiRicavi.jsx`: bottoni hotel [DPH][CLB][INT][Gruppo]; frecce ◀▶ mese/anno; toggle Range (mese_fine); toggle dettaglio/macrocategorie; toggle Δ Revenue (solo hotel singolo). Default: mese precedente a quello corrente. Colori: priorità DB → `CATEGORIA_COLORI` → palette.
Admin `corr-classificazione`: `CorrClassificazioneTrattamenti` con colonna Colore (swatch + hex).

### Frontend Corrispettivi.jsx (9 tab)
Import | Corrispettivi giornalieri (drawer cella→documenti) | Scontrini | Fatture | Riepilogo Fatturati | Controllo RT | Stampante RT | Analisi Ricavi | Dati di test.
`PerHotelView`: generico per scontrini/fatture, `localStorage('scontrini_vista'|'fatture_vista')`.
Tab attiva: `localStorage('corrispettivi_tab')`.

**Diviso per file** (stesso pattern dello split backend — `Corrispettivi.jsx` è solo tab bar + routing,
~130 righe invece di ~3000): `frontend/src/utils/corrispettiviHelpers.js` (costanti/helper condivisi:
`STRUTTURE_HOTEL`, `NOMI`, `NOME_CAT`, `thSt`/`tdSt`/`inpSt`, `isAdmin`, `fmtD`, `meseNome`,
`primoGiorno`/`ultimoGiorno`, `giornoSettimana`, `applyToggle`/`fmtToggle` — import da qui, non
ridefinire), `TabImport.jsx`, `TabDocumenti.jsx` (+ `ModalModifica`, `PerHotelView`, `CameraCell` —
componenti privati usati solo da scontrini/fatture), `TabGiornalieri.jsx` (+ `DrawerDocumenti`),
`TabTest.jsx`, `TabFatturati.jsx`, `TabControlloRT.jsx` (+ `FormRT`). `TabAnalisiRicavi.jsx` e
`TabStampanteRT.jsx` erano già file separati da prima. Prima di aggiungere codice a un tab: verificare
se l'helper serve anche altrove — se sì va in `corrispettiviHelpers.js`, non duplicato nel file del tab.

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
- `STATUS` riusa il payload di `X` (`printXReport`): l'Epson non espone un comando di stato dedicato.
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

---

## Principi di progettazione

### Riusabilità tra moduli
- Lookup condivisi → `models/shared.py`, endpoint → `routers/lookup.py`
- Costanti usate da più moduli → `app/utils/`
- Componenti riutilizzabili → `frontend/src/components/`
- Prima di creare nuova tabella, verificare se qualcosa di simile esiste già

### Colori configurabili
Ogni elemento visivo che usa colori per distinguere categorie/serie deve avere i colori configurabili in Admin.
- **DB**: colonna `colore VARCHAR(7)` nullable sulla tabella che definisce l'elemento
- **Admin**: colonna Colore con swatch cliccabile (color picker nativo) + campo hex `#rrggbb`
- **Frontend priorità**: colore DB → costante per categoria → palette generica ciclica
- Prevedere `colore` e UI Admin fin dall'inizio, non aggiungerla dopo
- Esempi: `cc_colori_reparti` in app_config (Dipendenti), `trattamenti_classificazione.colore` (Analisi Ricavi)
