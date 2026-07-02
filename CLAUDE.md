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
Due modalità (toggle, `localStorage('gruppo_modalita')`):
- **Settimana**: `GET /dashboard/gruppo?modalita=settimana&settimana=&snapshot=`
- **Stagione intera**: `GET /dashboard/gruppo?modalita=stagione&snapshot=`; 3 grafici trend (RevPAR/TRevPAR, Revenue, Occupazione).
- `GET /dashboard/gruppo/snapshots` → lista snapshot aggregate.
- Merge confronto per chiave `week_start` (non indice) per evitare sfasamenti tra stagioni diverse.

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
Aggiungere voce di costo: riga in `payroll_cost_types` + aggiornare `VOCI_ORDINE`.

Endpoint chiave:
- `POST /dipendenti/import`, `GET /dipendenti/report/mensile?mese=&anno=`, `GET /dipendenti/report/annuale-riepilogo?anno=`
- `GET /dipendenti/report/annuale/dettaglio-cc?anno=&cc_code=|cc_name=|cat_name=&strutture=`
- `POST /dipendenti/ricalcola-cc-anno?anno=`
- `GET /cost-centers/albero`

Frontend `Dipendenti.jsx`: 3 sezioni (report / anagrafica / import). Vista analisi CC: per struttura / categoria / reparto. `trasformaCentri(centri, vista)` con `_aggrega`. `isAdmin` → mostra/nasconde import e ricalcolo.
File test: `uploads/202604_costi  aziendali .pdf` (8 dipendenti, aprile 2026).

---

## Modulo Corrispettivi

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
- `corrispettivi_documenti`: UNIQUE(struttura_code, data_documento, numero, suffisso); audit trail (`modificato_manualmente`, `*_originale`); `camera` e `codice_prenotazione` TEXT (prenotazioni gruppo = liste lunghe).
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
  Formula totale: Σ `Ammontare` (righe con `AliquotaIVA`, solo se >0) + Σ `ImportoParziale` (righe con
  `Natura`, solo se >0). Popola anche i campi legacy `totale_10/22/ts/penali` usati dal confronto per
  categoria vs PMS (`totale_10/22` = `Ammontare` lordo, `totale_ts` = `tassa_soggiorno_nrs`,
  `totale_penali` = 0 — l'XML non ha una Natura dedicata alle penali).
  Protegge sempre `modificato_manualmente=True` anche con `on_conflict=aggiorna` (risponde `esito=saltato`).
  Logica di upsert condivisa tra i due endpoint: `_upsert_rt_chiusura_da_xml()`.
  Frontend: pulsante "Importa CORRISP.xml" in `TabControlloRT` (dentro `Corrispettivi.jsx`), due modalità:
  **Dalla cartella stampante** (default, sceglie solo RT + data) e **Carica da PC** (selezione manuale file).
  ⚠️ Nel file XML reale `<Imposta>` è annidato dentro `<IVA>` insieme a `<AliquotaIVA>` (non fratello
  diretto di `<IVA>` sotto `<Riepilogo>` come nell'esempio iniziale): il parser gestisce entrambe le forme.

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
