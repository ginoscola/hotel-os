# HotelOS — Istruzioni per Claude Code

> **Prima di scrivere codice**: presentare strategia, file coinvolti, rischi. Attendere conferma.
> **Prima di lavorare su un modulo leggere il suo file in `docs/moduli/`** (indice in fondo): contiene
> regole di dominio, bug già visti e decisioni prese. Qui restano solo le regole valide ovunque.
> **Aggiornare la documentazione** a ogni sessione con modifiche significative (endpoint, modelli, logica
> business): nel file `docs/moduli/<modulo>.md`; in questo file solo se cambia una regola generale.
> Questo file deve restare corto (sotto ~500 righe): storie di bug e diari vanno nei file dei moduli.
> **Dopo ogni modifica testata e funzionante**: committare i file coinvolti e fare `git push origin main` per tenere GitHub aggiornato.
> **🚧 Lavoro in corso su più sessioni — Modulo Tesoreria**: a inizio sessione leggere
> `docs/moduli/tesoreria.md` (stato fasi + diario) e la specifica completa
> `prompt_hotelos_tesoreria.md` nella root. Una fase per sessione, **autorizzazione esplicita
> dell'utente prima di scrivere codice** di ogni fase, e in caso di dubbi chiedere sempre.
> **Versionamento** (`frontend/src/version.js`): PATCH x.x.+1 = fix/tweaks; MINOR x.+1.0 = nuova funzionalità/sezione; MAJOR +1.0.0 = nuovo modulo o redesign architetturale. Aggiornare APP_VERSION e APP_VERSION_DATE a ogni commit.

## Progetto e stack
Gestione alberghiera per gruppo (CLB=Club Hotel 45cam, DPH=Du Parc 43cam, INT=International 45cam).
Replica sistema Google Sheets + Apps Script. Lingua: italiano.
Stack: FastAPI + SQLAlchemy + Alembic + PostgreSQL / React + Vite / openpyxl + reportlab / pytest.
Ristoranti: MMS (Maremosso, a Du Parc, stessa P.IVA) e BON (Buona Onda, a International): nessun dato
Welcome, incassi inseriti a mano in Corrispettivi. KMDIMARE = aggregatore virtuale del gruppo (Dipendenti).

## Stagioni operative
Tabella `hotel_seasons` (hotel_id, season_year, open_date, close_date, total_rooms, notes).
Stagioni 2026: DPH 01/05–19/09, CLB e INT 30/05–19/09.
Parser con filtro stagionale: date fuori range → WARNING (non errore), contatore `righe_fuori_stagione`.

## Struttura cartelle
```
backend/
  app/
    services/   → logica business (parser, calculator, aggregator)
    routers/    → endpoint FastAPI (vedi file dei moduli)
    models/     → SQLAlchemy (revenue.py, corrispettivi.py, analisi_ricavi.py, rooms.py, shared.py, …)
    schemas/    → Pydantic
    permessi.py → permessi per modulo (vedi docs/moduli/admin-moduli.md)
    utils/
      locale_it.py  → MESI_IT, GIORNI_IT, formatta_data_it() — UNICA sorgente localizzazione
  alembic/versions/ → migrazioni (ordine cronologico via down_revision, non per nome file)
frontend/src/
  pages/      → pagine React
    admin/    → sotto-pagine sezione Admin (es. AdminBackup.jsx)
  components/ → componenti riutilizzabili (components/ui/ = libreria UI)
  utils/format.js → utility formattazione (vedi sezione)
docs/moduli/  → documentazione per modulo (indice in fondo a questo file)
scripts/      → script operativi (es. backup automatico)
uploads/      → CSV/PDF caricati (non committare)
```

## Regole critiche Revenue CSV (dettagli in `docs/moduli/revenue.md`)
File sempre in coppia: file1 = RICAVI TRAT comprensivi ristorante, file2 = solo alloggio.
- `revenue_rooms = file2.RICAVI_TRAT`
- `revenue_fnb = file1.RICAVI_TRAT - file2.RICAVI_TRAT` (mai negativo)
- `revenue_extra = EXTRA_TRATT` (in entrambi i file)
- `revenue_total = rooms + fnb + extra`

Scartare righe con "(SDLY)" o "(LY)" nel campo DATA, o senza data dd/mm/yyyy.
Numeri: virgola decimale. Date: dd/mm/yyyy (es. 30/05/2026 sab).
`parse_coppia()` riconosce da solo quale file è il "comprensivo ristorante" (somma maggiore) e rifiuta
due file identici riga per riga.

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
⚠️ L'ADR ufficiale (Revenue) **non è il prezzo camera** e non è confrontabile tra anni: vedi `revenue.md`.

## Funzioni centrali — non duplicare
- `aggrega_totali_righe(righe)` in `kpi_calculator.py` → unica funzione per sommare RigaRevenue
- `_carica_righe(db, hotel_code, snapshot_date, da, a)` in `dashboard.py` → unica funzione per leggere daily_revenue; `_raggruppa_per_hotel(righe)` per dict hotel→righe
- `kpi_stagione` è il campo canonico in DashboardHotelResponse (non `kpi_periodo`)
- Merge confronto settimanale in DashboardGruppo.jsx: per chiave `week_start`, non per indice
- Tra moduli si leggono i dati **chiamando le funzioni esistenti** (molti endpoint sono funzioni Python
  chiamabili passando `db`), mai riscrivendo la stessa query: vedi i "Collegamenti" nei file dei moduli.

## Schema database — vincoli chiave
- `daily_revenue.snapshot_date` NOT NULL; UNIQUE `uq_hotel_data_snapshot` su (hotel_code, data, snapshot_date)
- `imports`: UNIQUE `uq_import_hotel_snapshot` su (hotel_code, snapshot_date)
- `daily_revenue.hotel_id` FK→hotels nullable; hotel_code rimane per compatibilità (filtrare su `hotel_code`)
- `budget_entries`: UNIQUE su (hotel_id, season_year, week_start, version)
- `app/models/__init__.py` importa tutti i moduli modello (serve alle `relationship()` per stringa):
  aggiungere lì ogni nuovo file di modelli.

## Configurazione app (app_config)
Chiavi attive: `week_start_weekday`='5', `anno_confronto_giorni_offset`='364', `anno_confronto_tolleranza_giorni`='30', `cors_origins`, `app_name`, `cc_colori_reparti` (JSON hex per grafici Dipendenti). Altre chiavi JSON per modulo (soglie, parametri) sono descritte nei file dei moduli.
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
- Permessi per modulo lato backend: `richiedi_permesso(code, 'vedere'|'modificare'|'importare')` di
  `app/permessi.py` (oggi solo Tesoreria) — dettagli in `admin-moduli.md`.

## Architettura modulare (dettagli in `docs/moduli/admin-moduli.md`)
Moduli: `revenue` (/dashboard/gruppo), `produzione` (/statistiche-produzione), `budget` (/budget), `usali` (/usali), `dipendenti` (/dipendenti), `corrispettivi` (/corrispettivi), `forecast` (/forecast), `tesoreria` (/tesoreria). Home (`/home`) e Attività (`/attivita`) non sono moduli.
Tabelle: `modules` (code PK, name, icon, route, ordine, attivo, colore), `module_permissions` (module_code, ruolo, puo_vedere, puo_modificare, puo_importare).
**Aggiungere modulo**: riga in `modules` → righe `module_permissions` → pagina JSX → `<Route moduleCode="">` in App.jsx
→ **prefisso della route in `rilevaModuloAttivo()`** e caso in `getSubnav()` di `NavBar.jsx` (passi manuali,
altrimenti tab non evidenziato / banner "in sviluppo").
Area Admin: `/admin` → `AdminUnificato.jsx`, sezioni con `?s=` (elenco in `admin-moduli.md`); un nuovo gruppo in `SEZIONI` eredita sidebar collassabile e persistenza.

## Sviluppo, test e deploy (dettagli in `docs/moduli/deploy-sviluppo.md`)
Sviluppo sul server Linux `kmdimare-server`, cartella `/srv/progetti/hotel-os` (non più il Mac Mini).
```bash
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev
cd backend && source venv/bin/activate && pytest tests/ -v
cd backend && source venv/bin/activate && ruff check app tests   # controllo statico (ruff.toml, requirements-dev.txt)
cd frontend && npm run lint                                       # eslint (eslint.config.js): trova identificatori non definiti che vite build non vede
```
- **Produzione**: nginx serve `frontend/dist/` (file statici) + reverse proxy verso uvicorn (systemd
  `hotelos-backend`, utente `hotelos`), su origini/porte separate. Dopo modifiche frontend serve
  `npm run build`; dopo endpoint/modelli nuovi serve il riavvio del backend.
- **Riavvio**: `hotelos-restart` (`--build` per ricompilare anche il frontend) = `restart_server.sh`.
  Claude può usare `sudo -n systemctl restart hotelos-backend` **solo su richiesta esplicita dell'utente**.
  Mai uccidere/rilanciare uvicorn a mano sulla porta 8000.
- `VITE_API_URL` in `.env`; **mai URL hardcoded**: per costruire URL API importare `API_URL` da `api/client.js`.
- `cors_origins` in DB letto solo all'avvio (serve il riavvio).
- **Test**: DB dedicato `hotel_os_test` (`TEST_DATABASE_URL` in `backend/.env`, letto solo da
  `tests/_db.py` — mai un URL nel test, mai `SessionLocal` nei test). Schema da `create_all()`, non dalle
  migrazioni (i test non vedono il drift modello↔migrazioni↔DB: in caso di dubbio `alembic current` e `\d tabella`).
- La fixture `client` deve sovrascrivere anche `richiedi_admin`/`richiedi_utente_attivo` (non solo
  `get_db`): `app.dependency_overrides[richiedi_admin] = lambda: SimpleNamespace(id=None)`. Senza, i 401
  a cascata nascondono bug reali.
- **Mai usare dati reali nei test che cancellano** (incidente Dipendenti: CF reali azzerati): valori sintetici.
- Cartelle in `uploads/` scritte dal backend (utente `hotelos`) richiedono ACL: vedi i moduli USALI e Tesoreria.

## Localizzazione
`MESI_IT`, `GIORNI_IT`, `formatta_data_it()`, `formatta_euro_it()` ("-1.234,56 €", per testi generati dal backend) definiti SOLO in `locale_it.py`. Non ridefinire nei router.
UI: date in italiano, euro con €, percentuali con %.  occupancy sempre come % (mai €).

## Utility frontend (format.js)
- `formatEuro(v)`, `formatEuroK(v)` (≥1000 → "Xk €"), `formatEuroIntero(v)`, `formatPerc(v)`, `formatN(v)`, `formatData(iso)`, `addDays(isoDate, n)`, `calcolaDelta(val, ref)`
- `percentualiA100(valori, decimali=1)` — percentuali di ripartizione che, arrotondate, sommano sempre esattamente 100 (metodo del resto maggiore). Usarla per ogni legenda/colonna "% sul totale" che l'utente usa per ripartire costi.
- `mostraErrore(e)` — **OBBLIGATORIO in ogni catch block**. Se `localStorage('debug_errori')==='true'` → stack trace completo; altrimenti prima riga. **Mai** usare inline `e.response?.data?.detail || e.message`.
- **Mai `toISOString()` per ricavare una data da un `Date` locale** (in Italia mezzanotte → giorno prima in UTC):
  formattare in ora locale (es. `isoLocale()` in `pages/tesoreria/helpers.jsx`). Bug reale in Budget.
- Mai leggere stato React dentro un `setTimeout` di debounce: usare un ref o passare il valore (bug reale in Budget).
- `key` React nelle liste: sul Fragment restituito dal `.map()` (`<Fragment key=…>`), non sui figli.

## Libreria UI (dettagli e catalogo in `docs/moduli/libreria-ui.md`)
Tutte le pagine usano `components/ui/` (`Button`, `PageHeader`, `Card`, `Tabs`, `SegmentedControl`,
`ToggleIva`, `NavMese`, `NavAnno`, `Table`/`Th`/`Td`, `Badge`, `HotelTag`, `Messaggio`, `Modal`, `Drawer`,
`KpiTile`, `DropZone`, `ThOrdinabile`, `Paginazione`, …) + `ExportMenu`, `TooltipConTotale`,
`NavigazioneSnapshot`, `pastReferenceArea()`. Catalogo visivo: Admin → Sistema → Libreria UI (`?s=ui-kit`),
da aggiornare quando si aggiunge un componente.
- Colori/testi solo da `styles/tokens.js` (JS) e `styles/ui.css` (variabili CSS), allineati tra loro.
  Nessun esadecimale scritto a mano, `fontSize` solo 11/12/13/14/16/18/22.
- Colore principale unico `#1e3a5f` (blu notte); colore del modulo solo in NavBar; arancione solo per `ToggleIva`;
  viola `colors.accent` solo per "valore manuale che sostituisce il dato automatico".
- Colori strutture `coloreStruttura()`: DPH verde, CLB blu, INT ambra. Serie dei grafici da `coloreSerie(idx)`;
  serie di confronto = stesso colore + `STILE_CONFRONTO`. Serie che si sommano → `<Tooltip content={<TooltipConTotale />} />`.
- `useConferma()` al posto di `confirm()`, `useAvvisi()` al posto di `alert()`.
- Una `<table>` nuda non ha stile: usare sempre `<Table>`; righe speciali con classi `ui-riga-*` sulla `<tr>`.
- `pastReferenceArea(data, 'week_start', 'label')` su ogni grafico con asse temporale, come **funzione
  inline**, non componente JSX.
- Prima di costruire un elemento UI, cercare il pattern già in uso e riusarlo (stesso markup e stile).

## Modulo Camere (Rooms)
Tabella `rooms`: code PK, hotel_id FK, struttura_code, tipo_risorsa, nome_tipo, posti_letto, piano, attiva, note.
Endpoint: `GET|POST /rooms/`, `GET|PUT|DELETE /rooms/{code}`.

## Tabelle condivise
`tipi_pagamento` in `shared.py`: codice unique, descrizione, categoria, attivo, ordine.
Router: `GET|POST|PUT /lookup/tipi-pagamento`.

## Principi di progettazione

### Riusabilità tra moduli
- Lookup condivisi → `models/shared.py`, endpoint → `routers/lookup.py`
- Costanti usate da più moduli → `app/utils/`
- Componenti riutilizzabili → `frontend/src/components/`
- Prima di creare nuova tabella, verificare se qualcosa di simile esiste già
- Router grandi divisi per dominio sotto lo stesso prefix (aggregatore sottile + `*_shared.py`), come
  Corrispettivi, Produzione, Tesoreria: le costanti condivise si importano dal file `_shared`, non si ridefiniscono.

### Selettore mese/anno — default mese precedente
Ogni pagina/tab con selettore mese/anno deve aprirsi di default sul **mese precedente a quello
corrente**, mai sul mese in corso (ancora incompleto, dati parziali fuorvianti). Calcolo:
`new Date().getMonth()` è 0-indexed (Gen=0), quindi coincide già col mese precedente in numerazione
1-indexed; a gennaio si torna a dicembre dell'anno prima (`meseAnnoPrecedente()` in
`produzioneHelpers.js`, stessa convenzione di `UsaliContoEconomico.jsx` e `TabAnalisiRicavi.jsx`).
Non si applica alle viste "anno intero" (es. Report mensile Produzione, Riepilogo Fatturati) che
mostrano già tutti i 12 mesi in tabella: lì il default resta l'anno corrente. Eccezione voluta:
Attività ricorrenti apre sul mese in corso (è una lista di cose da fare).

### Colori configurabili
Ogni elemento visivo che usa colori per distinguere categorie/serie deve avere i colori configurabili in Admin.
- **DB**: colonna `colore VARCHAR(7)` nullable sulla tabella che definisce l'elemento
- **Admin**: colonna Colore con swatch cliccabile (color picker nativo) + campo hex `#rrggbb`
- **Frontend priorità**: colore DB → costante per categoria → palette generica ciclica
- Prevedere `colore` e UI Admin fin dall'inizio, non aggiungerla dopo
- Esempi: `cc_colori_reparti` in app_config (Dipendenti), `trattamenti_classificazione.colore` (Analisi Ricavi)

### Import e correzioni manuali
Schema ricorrente in tutti i moduli: import idempotente (`on_conflict=salta|aggiorna`), righe corrette a
mano marcate `modificato_manualmente` e **mai sovrascritte** da un reimport, anteprima + conferma per i
file importanti, eliminazione di un import con `?conferma=true`. Un nuovo import o dato ricorrente va
aggiunto anche allo scadenziario delle Attività ricorrenti (`CATALOGO` + `_evidenze()`).

---

## Indice dei moduli (`docs/moduli/`)
Leggere il file del modulo **prima** di lavorarci. Accanto, le trappole più pericolose.

| File | Contenuto | Da sapere subito |
|---|---|---|
| `revenue.md` | Revenue CSV, Dashboard Hotel e Gruppo, Export | ADR PMS ≠ prezzo camera (valori fissi pasti di Welcome); Mr Preno mette spiaggia/parcheggio sulla prima notte; export con riga TOTALE sui totali |
| `admin-moduli.md` | Moduli, permessi, NavBar, sezioni Admin | `rilevaModuloAttivo()`/`getSubnav()` vanno aggiornati a mano; `corr-tipi-doc` è sola consultazione (regola fiscale fissa) |
| `deploy-sviluppo.md` | Deploy Linux, nginx, cache, upload grandi, test, npm | dopo modifiche frontend `npm run build`; upload grandi dalla LAN via `API_URL`; DB di test |
| `libreria-ui.md` | Componenti UI, token, storia della migrazione, principi grafici | sfondo righe speciali su ogni `<td>` (o classi `ui-riga-*`) |
| `home-attivita.md` | Home/Cruscotto, soglie tachimetri, Attività ricorrenti | costo del lavoro solo nell'endpoint admin; nuovi import → `CATALOGO` dello scadenziario |
| `dipendenti.md` | Cedolini PDF, centri di costo, report | cancellare più import dello stesso dipendente svuota `employee_cc_default`; test solo con CF sintetici |
| `corrispettivi.md` | Registro fiscale, RT, Cassa, Analisi Ricavi, Stampante RT | imponibile = lordo/(1+aliquota), mai lordo−iva; caparre escluse; `UNIQUE` manuali senza `is_test`; categorie mai ricalcolate dopo l'import |
| `forecast.md` | OTB, Maturato, Pace, Cancellazioni Welcome | tabella `prenotazioni_cancellate` contiene anche le non disdette (`cancellata`); filtri per anno di arrivo |
| `budget.md` | Budget hotel e ristoranti, proiezione/pickup | camere vendute con mezzo per eccesso (mai `round()`); mai `toISOString()` |
| `produzione.md` | Statistiche Produzione (prod_righe), pasti, ricavi camere, occupazione | dedup su `oid_welcome`; cambio mapping → "Ricalcola categorie"; pasti solo `conta_come_pasto` |
| `usali.md` | Conto Economico, CE contabile, Food & Beverage, Movimenti Attivi | MMS accorpato su DPH nel CE; importi contabili `Numeric(14,4)`; costo lavoro dai cedolini |
| `backup.md` | Backup notturno (systemd, Raspberry, GitHub) | backup gira come `gino`, backend come `hotelos` (ACL, `HOTELOS_BACKUP_DIR`) |
| `tesoreria.md` | Modulo Tesoreria a fasi: stato, decisioni, diario | una fase per sessione con ok esplicito; specifica fuori da git |
| `wave.md` | Indice WAVE a fasi | sempre su dati Revenue ÷ 1,10; riferimento = migliore degli anni precedenti |
