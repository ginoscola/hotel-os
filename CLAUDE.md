# Revenue Master Gruppo — Istruzioni per Claude Code

## Contesto del progetto
Applicazione web di revenue reporting per gruppo alberghiero.
Replica e migliora un sistema precedentemente basato su Google Sheets + Apps Script.
Linguaggio dell'applicazione: italiano.

## Hotel del gruppo
- CLB = Club Hotel, 45 camere
- DPH = Hotel Du Parc, 43 camere
- INT = Hotel International, 45 camere

## Stagioni operative
Ogni hotel ha date di apertura e chiusura che cambiano ogni anno.
Configurate nella tabella `hotel_seasons` (hotel_id, season_year, open_date, close_date, total_rooms, notes).

Stagioni 2026:
- DPH: 01/05/2026 – 19/09/2026
- CLB: 30/05/2026 – 19/09/2026
- INT: 30/05/2026 – 19/09/2026

Regole parser con filtro stagionale:
- Le date fuori dal periodo open_date–close_date vengono scartate con WARNING (non errore bloccante)
- Il contatore `righe_fuori_stagione` traccia quante righe sono state escluse
- La lista `warnings` contiene messaggi descrittivi con hotel_code, data e motivo
- Senza filtro stagionale il parser accetta tutte le date valide (comportamento di default)
- Il router POST /upload/coppia/{hotel_code} legge automaticamente la stagione dal DB

## Stack tecnologico
- Backend: Python 3.11 + FastAPI + SQLAlchemy + Alembic
- Database: PostgreSQL (locale su Mac in sviluppo)
- Frontend: React + Vite
- Export: openpyxl (Excel), reportlab (PDF)
- Test: pytest

## Struttura cartelle
- backend/app/services/    → logica business (parser, calculator, aggregator)
- backend/app/routers/     → endpoint API FastAPI
  - hotels.py              → GET /hotels/, POST /hotels/, PUT /hotels/{code}, POST /hotels/{code}/seasons, GET /hotels/{code}/seasons/{year}
  - upload.py              → POST /upload/coppia/{hotel_code}, POST /upload/bulk
  - settimane.py           → GET /settimane/{hotel_code}, GET /settimane/gruppo
  - snapshots.py           → GET /snapshots/{hotel_code}
  - export.py              → GET /export/hotel/{code}/settimanale|giornaliero?snapshot=, GET /export/gruppo
  - admin.py               → GET /admin/test-stats, DELETE /admin/test-data
  - dashboard.py           → GET /dashboard/hotel/{code}?snapshot=, GET /dashboard/gruppo
  - config.py              → GET /config/, GET /config/{key} (sola lettura)
  - budget.py              → POST /budget/{hotel_code}/{season_year}, GET /budget/{hotel_code}/{season_year}, GET /budget/{hotel_code}/{season_year}/{week_start}
- backend/app/models/      → modelli database SQLAlchemy
  - Hotel, HotelSeason, DailyRevenue, ImportSession, AppConfig, BudgetEntry
- backend/app/schemas/     → validazione Pydantic
- backend/app/utils/       → utility condivise
  - locale_it.py           → MESI_IT, GIORNI_IT, formatta_data_it() — unica sorgente di verità per la localizzazione
- frontend/src/pages/      → pagine React
- frontend/src/components/ → componenti riutilizzabili
- uploads/                 → file CSV caricati (non committare in git)
- tests/                   → test con i file CSV reali degli hotel

## Regole critiche sui file CSV
I file arrivano sempre in coppia per ogni hotel:
- File 1 (es. CLB1.csv): RICAVI TRAT comprensivi di ristorante
- File 2 (es. CLB2.csv): RICAVI TRAT solo alloggio

Formule revenue:
- revenue_rooms  = RICAVI TRAT da file 2
- revenue_fnb    = RICAVI TRAT file1 - RICAVI TRAT file2  (mai negativo)
- revenue_extra  = EXTRA TRATT (colonna presente in entrambi i file)
- revenue_total  = revenue_rooms + revenue_fnb + revenue_extra

Righe da SCARTARE sempre:
- Contengono "(SDLY)" nel campo DATA
- Contengono "(LY)" nel campo DATA
- Non hanno data nel formato dd/mm/yyyy

Numeri: usano VIRGOLA come decimale (es. 2538,6900 → 2538.69)
Date: formato italiano dd/mm/yyyy (es. 30/05/2026 sab)

## KPI da calcolare (mai fare medie semplici — usare sempre i totali)
- occupancy  = rooms_sold / rooms_available  → percentuale, NON valore euro
- adr        = revenue_rooms / rooms_sold
- revpar     = revenue_rooms / rooms_available
- trevpar    = revenue_total / rooms_available
- rmc        = revenue_total / rooms_sold
- inc_fnb    = revenue_fnb / revenue_total
- inc_rooms  = revenue_rooms / revenue_total

Divisioni per zero → restituire None, non errore.

KPISchema include anche `revenue_total: Optional[float]` (€) per le card "Tot. Revenue"
nelle dashboard hotel e gruppo.

## Settimana commerciale
Sabato → Venerdì (week_start = sabato, week_end = venerdì successivo)
KPI settimanali calcolati sui TOTALI della settimana, non media dei KPI giornalieri.

## Aggregazione gruppo
ADR gruppo = somma revenue_rooms tutti hotel / somma rooms_sold tutti hotel
Occupazione gruppo = somma rooms_sold / somma rooms_available
MAI fare media semplice dei KPI dei singoli hotel.

## File di test disponibili in uploads/
- PlanningForecast-CLB1.csv  (113 righe valide, 01/06-31/08/2026)
- PlanningForecast-CLB2.csv  (113 righe valide, 01/06-31/08/2026)
- PlanningForecast-DPH1.csv  (142 righe valide, 01/05-31/08/2026)
- PlanningForecast-DPH2.csv  (142 righe valide, 01/05-31/08/2026)
- PlanningForecast-INT1.csv  (113 righe valide, 01/06-31/08/2026)
- PlanningForecast-INT2.csv  (113 righe valide, 01/06-31/08/2026)

## Comandi di sviluppo
# Avvia backend
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000

# Avvia frontend
cd frontend && npm run dev

# Esegui test
cd backend && source venv/bin/activate && pytest tests/ -v

## Formato file supportati
- CSV (separatore ;, decimali con virgola) — formato originale
- Excel .xlsx — date come datetime Python, numeri già float

## Convenzione nome file
YYYYMMDD_PlanningForecast-HOTELCODE[12].xlsx/csv
- YYYYMMDD → snapshot_date (data del forecast)
- HOTELCODE → codice hotel (es. CLB, DPH, INT)
- [12] → indice file (ignorato, auto-detect via somma ricavi)

## Tabella imports
Registra ogni sessione di import:
- hotel_code, snapshot_date → chiave univoca (idempotenza)
- stato: success / warning / error
- Bulk import salta automaticamente le coppie già importate con successo

## Hotel dinamici
Gli hotel sono gestiti nel database, non hardcoded.
- POST /hotels/ → crea hotel
- PUT /hotels/{code} → aggiorna
- Il codice viene estratto automaticamente dal nome file
- Il frontend carica la lista hotel da GET /hotels/ (non hardcoded)

## Dashboard hotel — logica snapshot (aggiornata)
La dashboard del singolo hotel mostra l'istantanea completa di una snapshot,
con visione sull'intera stagione di apertura.

### Navigazione snapshot
- GET /snapshots/{hotel_code}: lista distinct snapshot_date, più recente prima
- Il frontend naviga tra snapshot con frecce ← Prec. / Succ. →
- Ogni snapshot corrisponde a un caricamento settimanale dati da Welcome

### Settimana di riferimento
- Per ogni snapshot, la "settimana di riferimento" = settimana commerciale (Sab–Ven)
  che contiene la snapshot_date
- Calcolata con: ref_start = snapshot_date - (weekday - 5) % 7 giorni
- Restituita dalla API come settimana_ref_start / settimana_ref_end
- kpi_periodo = KPI calcolati SOLO sui giorni della settimana di riferimento
- La settimana di riferimento è evidenziata nei grafici (ReferenceArea) e nella tabella

### Confronti
- "Confronta snapshot precedente": carica la snapshot precedente nella lista;
  confronta kpi_periodo delle due snapshot
- "Confronta anno precedente": cerca snapshot a ~364 giorni fa (± 30 gg tolleranza);
  allineamento date: addDays(comp.data, 364) → data corrente
- I due toggle sono mutuamente esclusivi
- Se dati confronto non disponibili: badge grigio, nessun errore

### Grafici e tabella
- Asse X: tutti i giorni della stagione (ISO date string, tick solo sabato)
- Serie confronto: tratteggiata arancione (occupazione) / colori chiari (revenue)
- Tabella settimanale: tutte le settimane della stagione, riga ref evidenziata in blu chiaro
- SettimanaDashboard include inc_rooms, inc_fnb, inc_extra

### Grafico revenue giornaliero (DashboardHotel)
- **Senza confronto**: BarChart impilato con tre serie (Camere, F&B, Extra)
- **Con confronto attivo** (week-1 o year-1): LineChart con due linee su `revenue_total`
  — linea blu continua (snapshot corrente) e linea arancione tratteggiata (snapshot confronto)
  — il campo `revenue_total_comp` è calcolato in `mergeConfrontoGiorni` da `comp.revenue_total`
  — il titolo del grafico cambia dinamicamente in base alla modalità

## Dashboard gruppo — modalità di visualizzazione
Due modalità selezionabili con toggle, persistita in localStorage (chiave `gruppo_modalita`):

**"Settimana per settimana"** (default):
- Naviga tra settimane commerciali via `GET /settimane/gruppo`
- Chiama `GET /dashboard/gruppo?modalita=settimana&settimana=YYYY-MM-DD&snapshot=YYYY-MM-DD`
- Mostra KPI cards, grafico contributo hotel, tabella dettaglio hotel
- Confronta: settimana precedente (−7 gg, stesso snapshot) / anno precedente (−364 gg)

**"Stagione intera"**:
- Naviga tra snapshot via `GET /dashboard/gruppo/snapshots`
- Chiama `GET /dashboard/gruppo?modalita=stagione&snapshot=YYYY-MM-DD`
- Mostra KPI cards (incluso Tot. Revenue), contributo hotel, tabella aggregati settimanali
- Tre grafici trend (solo in questa modalità):
  1. "Trend settimanale gruppo RevPAR / TRevPAR" — linee blu/verde, asse Y in €
  2. "Trend settimanale Revenue" — linea arancione, asse Y in migliaia €
  3. "Trend settimanale Occupazione" — linea viola, asse Y 0–100%
- Tutti e tre i grafici supportano le linee di confronto tratteggiate
- Confronta: snapshot precedente nella lista / snapshot anno precedente (±30 gg tolleranza)

Parametri endpoint `/dashboard/gruppo`:
- `modalita=stagione&snapshot=` → intera stagione per snapshot
- `modalita=settimana&settimana=&snapshot=` → singola settimana da snapshot
- `da=&a=` → legacy (compatibile, senza filtro snapshot)

Nuovo endpoint:
- `GET /dashboard/gruppo/snapshots` → lista snapshot disponibili (aggregata su tutti gli hotel)

## Export per sezione
- Endpoint: GET /export/hotel/{code}/settimanale|giornaliero?snapshot=&da=&a=&formato=xlsx/csv/pdf
- Quando snapshot è fornito, il filtro per data_snapshot viene applicato prima di da/a
- Endpoint: GET /export/gruppo?da=&a=&formato=xlsx/csv/pdf

### Colonne export hotel settimanale (16, ordine fisso)
Settimana, Giorni, Cam. Vendute, Cam. Disponibili, Occup.%, ADR, RevPAR, TRevPAR, RMC,
Rev. Camere, Rev. F&B, Rev. Extra, Rev. Totale, Inc. Rooms%, Inc. F&B%, Inc. Extra%
- Riga "TOTALE STAGIONE" in grassetto in fondo (Excel e CSV)

### Colonne export hotel giornaliero (13, ordine fisso)
Data, Giorno, Cam. Vendute, PAX, Occup.%, ADR, RMC, RevPAR, TRevPAR,
Rev. Camere, Rev. F&B, Rev. Extra, Rev. Totale

### Export gruppo
- Excel: 2 fogli — "Aggregati settimanali" (16 col + totale) e "Dettaglio hotel" (12 col)
- CSV: 2 sezioni separate da riga vuota (stesse colonne Excel)
- PDF: 2 tabelle (aggregati + dettaglio hotel)
- Colonne aggregati settimanali gruppo: stesse 16 del hotel settimanale con "Hotel attivi" al posto di "Giorni"
- Colonne dettaglio hotel: Codice, Hotel, Cam. Vend., Cam. Disp., Occup.%, ADR, RevPAR,
  Rev. Camere, Rev. F&B, Rev. Extra, Rev. Totale, % Gruppo

### Formattazione Excel
- Revenue: formato `#,##0.00 "€"`
- Percentuali (0-100): formato `0.0"%"` (% letterale, senza moltiplicazione)
- Interi: formato `#,##0`
- Intestazioni: bold bianco su sfondo blu, righe alternate grigio chiaro

### PDF
- Orientamento landscape A4, font 8pt, intestazioni abbreviate
- Intestazioni bold su sfondo blu, righe alternate grigio, riga totale bold

## Dati giornalieri collassabili
- Sezione dati giornalieri parte collapsed con "Dati giornalieri (N giorni) ▼"
- Stato salvato in localStorage per hotel: chiave `giornalieri_{hotel_code}`

## Colonne KPI nelle tabelle settimanali
SettimanaDashboard include (nell'ordine): rooms_sold, rooms_available, occupancy, adr, rmc,
revpar, trevpar, revenue_rooms, revenue_fnb, revenue_extra, revenue_total, inc_rooms, inc_fnb, inc_extra.
Tutte visibili nella tabella aggregati settimanali hotel; gruppo mostra le stesse tranne inc_*.

## Area Admin
Tre sezioni a larghezza piena:

### Stagioni operative
- Selettore anno (2024–2027); carica/salva stagioni per tutti gli hotel
- API: GET /hotels/{code}/seasons/{year} (lettura), POST /hotels/{code}/seasons (upsert)
- Campi: apertura, chiusura, camere, note — pulsante "Salva" per hotel con feedback inline
- Se stagione non configurata mostra badge "non configurata"

### Import Massivo
- Link a /import/bulk

### Gestione dati di test
- Flag is_test su daily_revenue e imports
- GET /admin/test-stats → conteggio record di test
- DELETE /admin/test-data → cancella tutti i record is_test=true
- Checkbox "Dati di test" nelle maschere Import e Import Massivo

## Configurazione applicazione (app_config)
Tabella `app_config` (key PK, value, description, updated_at) creata dalla migrazione e4f5a6b7c8d9.
Chiavi attive:
- `week_start_weekday` = '5' → giorno inizio settimana commerciale (0=lun, 5=sab)
- `anno_confronto_giorni_offset` = '364' → offset giorni per confronto anno precedente
- `anno_confronto_tolleranza_giorni` = '30' → tolleranza in giorni per trovare snapshot anno prec.
- `cors_origins` = 'http://localhost:5173' → origini CORS autorizzate (virgola-separato)
- `app_name` = 'KM Di Mare Revenue' → nome applicazione mostrato nella navbar (modificabile da DB)

Lettura config nel codice:
- `main.py` legge `cors_origins` da DB al startup; fallback a localhost:5173 se DB non raggiungibile
- `weekly_aggregator._leggi_week_start()` legge `week_start_weekday` con cache in-process;
  resettabile con `_reset_week_start_cache()` nei test
- Endpoint sola lettura: GET /config/, GET /config/{key}

## Budget settimanale
Tabella `budget_entries` (migrazione f5a6b7c8d9e0): hotel_id FK, season_year, week_start, version (default 'v1'), valori budget per camere/fnb/extra/total, notes.
Constraint univoco: `uq_budget_hotel_settimana` su (hotel_id, season_year, week_start, version).
POST /budget/{hotel_code}/{season_year} fa upsert su ON CONFLICT constraint.
La tabella parte vuota — nessun dato di budget caricato al momento.

## Schema database — vincoli chiave
- `daily_revenue.snapshot_date` è NOT NULL (migrazione d3e4f5a6b7c8)
- Constraint univoco `uq_hotel_data_snapshot` su (hotel_code, data, snapshot_date)
  → ogni snapshot conserva il proprio set di righe indipendente
- `imports` ha constraint `uq_import_hotel_snapshot` su (hotel_code, snapshot_date)
- `daily_revenue.hotel_id` FK → hotels(id), nullable, popolata dalla migrazione a9b0c1d2e3f4
  hotel_code rimane per compatibilità; hotel_id viene valorizzato anche dagli import futuri

## Localizzazione italiana
- MESI_IT, GIORNI_IT e formatta_data_it() sono definiti SOLO in backend/app/utils/locale_it.py
- Non ridefinire questi array nei singoli router — importarli sempre da locale_it
- Il frontend usa le proprie funzioni JS di formattazione (non condivise col backend)

## Autenticazione e autorizzazione

### Credenziali admin di default
- username: `admin`
- password: `admin2024`
- ruolo: `admin`
Per cambiare la password: Admin → Gestione Utenti → Reset pwd, oppure via API:
`POST /admin/utenti/{id}/reset-password` con body `{"password": "nuova_password"}`

### Ruoli
- `admin`: accesso completo (import, upload, admin, gestione utenti)
- `viewer`: sola lettura (dashboard hotel, dashboard gruppo, export)

### Token JWT
- Firmato con `SECRET_KEY` da `.env` (cambiare in produzione)
- Scadenza: 8 ore
- Algoritmo: HS256
- Salvato in `localStorage` chiave `auth_token`; dati utente in `auth_user`

### Dipendenze FastAPI
- `richiedi_utente_attivo` → qualsiasi utente loggato e attivo
- `richiedi_admin` → solo ruolo admin, altrimenti 403

### Endpoint protetti
| Endpoint | Protezione |
|----------|-----------|
| GET /hotels/, /dashboard/*, /settimane/*, /snapshots/*, /export/*, /config/ | richiedi_utente_attivo |
| POST/PUT /hotels/, /upload/*, /budget/* | richiedi_admin |
| Tutti /admin/* | richiedi_admin |
| POST /auth/login | nessuna (rate limit: 5 tentativi/15 min per IP) |
| GET /auth/me, POST /auth/logout | richiedi_utente_attivo |

### Endpoint gestione utenti
- `GET /admin/utenti` → lista utenti (no password_hash)
- `POST /admin/utenti` → crea utente (admin only)
- `PUT /admin/utenti/{id}` → modifica ruolo/stato (admin only)
- `POST /admin/utenti/{id}/reset-password` → reimposta password (admin only)
Constraint: non è possibile disattivare l'ultimo admin attivo.

### Frontend
- `Login.jsx` → form login, salva token in localStorage
- `ProtectedRoute.jsx` → reindirizza a /login se non loggato; 403 se ruolo insufficiente
- `NavBar.jsx` → mostra username, badge ruolo, bottone Esci; nasconde Import e Admin ai viewer
- `AdminUtenti.jsx` → pagina CRUD utenti (solo admin, su /admin/utenti)
- `api/client.js` → interceptors axios: allega Bearer token, gestisce 401 → redirect /login?sessione_scaduta=1

## Aggregazione KPI — unica sorgente di verità

`aggrega_totali_righe(righe)` in `backend/app/services/kpi_calculator.py` è l'unica
funzione che somma i campi di una lista di `RigaRevenue`.
- Usata da `dashboard.py._kpi_schema()` e da `upload.py._calcola_kpi_periodo()`
- **Non ridefinire le somme inline** in altri moduli — importare sempre questa funzione
- Restituisce `TotaliRighe` (dataclass) con tutti i campi aggregati pronti per `calcola_kpi()`

## Caricamento righe DB — unica funzione

`_carica_righe(db, hotel_code=None, snapshot_date=None, da=None, a=None)` in
`backend/app/routers/dashboard.py` è l'unica funzione per leggere `daily_revenue`.
- Tutti i parametri sono opzionali e combinabili
- `hotel_code=None` → restituisce tutti gli hotel
- Per ottenere un dict `hotel_code → righe` usare `_raggruppa_per_hotel(righe)`
- **Non aggiungere nuove funzioni `_carica_righe_*`** — estendere questa

## Nomenclatura KPI dashboard hotel

Il campo canonico è `kpi_stagione` in `DashboardHotelResponse`.
- `kpi_periodo` esiste solo in `RisultatoUpload` (upload response) con semantica diversa
- Nel frontend usare sempre `dati.kpi_stagione` — il fallback `kpi_periodo` è stato rimosso

## Merge confronto settimanale (frontend)

In `DashboardGruppo.jsx`, il merge tra le settimane correnti e quelle di confronto
avviene per chiave `week_start` (non per indice array).
- Confronto "anno precedente": chiave = `addDays(s.week_start, -364)`
- Confronto "snapshot precedente": chiave = `s.week_start` (stesso anno, snapshot diversa)
- Questo evita confronti sfasati quando le due snapshot hanno stagioni di lunghezza diversa.

## Test di integrazione — nota auth

I test in `test_navigazione_confronto_export.py` e `test_parser_e_bulk.py` che chiamano
endpoint protetti (upload, dashboard) falliscono con 401 perché il `TestClient` non
include l'header di autenticazione. È un problema pre-esistente del test suite,
non dei test unitari (che passano tutti).

## Architettura modulare

Il sistema è organizzato in moduli indipendenti e interconnessi.

### Moduli esistenti
| code | Nome | Route | Stato |
|------|------|-------|-------|
| revenue | Revenue & Statistiche | /dashboard/gruppo | Implementato |
| budget | Budget | /budget | Placeholder |
| usali | USALI | /usali | Placeholder |
| dipendenti | Spese Dipendenti | /dipendenti | Placeholder |
| corrispettivi | Corrispettivi | /corrispettivi | Placeholder |

### Tabelle database moduli
- `modules` — definizione moduli (code PK, name, icon, route, ordine, attivo, colore)
- `module_permissions` — permessi per ruolo (module_code FK, ruolo, puo_vedere, puo_modificare, puo_importare); constraint unique su (module_code, ruolo)
- `data_connections` — mappa interconnessioni future (source_module FK, target_module FK, description, attivo)

### Aggiungere un nuovo modulo
1. Inserire riga in `modules` (via migrazione Alembic o direttamente in Admin > Gestione Moduli)
2. Inserire righe in `module_permissions` per ogni ruolo
3. Creare `frontend/src/pages/NuovoModulo.jsx` (usare `WorkInProgress.jsx` finché non implementato)
4. Aggiungere `<Route path="/nuova-route">` in `App.jsx` con `moduleCode="nuovo_code"`
5. La NavBar L1 legge i moduli da `GET /modules/` — appare automaticamente

### Endpoint moduli
- `GET /modules/` → lista moduli attivi con permessi dell'utente corrente (richiede auth)
- `GET /modules/{code}` → dettaglio con tutti i permessi per ruolo
- `PUT /modules/admin/{code}` → modifica nome/icona/route/ordine/attivo/colore (solo admin)
- `PUT /modules/admin/{code}/permissions/{ruolo}` → aggiorna permessi (solo admin)
- `PUT /modules/admin/ordine` → riordina moduli con lista di code (solo admin)

### NavBar a due livelli
- **L1 (60px)**: logo + tab moduli dinamici da `GET /modules/` + utente/logout
- **L2 (40px)**: sotto-navigazione del modulo attivo, determinato dall'URL corrente
  - Revenue: Importazione (admin) | hotel da `GET /hotels/` | Gruppo | Admin (admin)
  - Altri moduli: badge "in sviluppo" finché non implementati
- Il colore accent del tab attivo viene dal campo `colore` del modulo nel DB
- CSS in `NavBar.css` (`.navbar-l1`, `.navbar-l2`, `.navbar-modulo`, `.subnav-link`)

### Permessi modulo (ProtectedRoute)
- Al login, `GET /modules/` viene chiamato e i permessi salvati in `localStorage['moduli_permessi']`
- `ProtectedRoute` accetta prop `moduleCode` per verificare `puo_vedere` prima di renderizzare
- Se `puo_vedere=false` → pagina 403 "Accesso al modulo non autorizzato"
- Utility: `getPermessiModuli()`, `puoVedereModulo(code)` in `ProtectedRoute.jsx`

### Admin — Gestione Moduli
Sezione in `Admin.jsx` (`GestioneModuli`) che permette di:
- Attivare/disattivare moduli (scompaiono dalla NavBar per tutti gli utenti)
- Riordinare moduli con frecce ↑↓
- Gestire permessi per ruolo con tabella checkbox + pulsante Salva per ruolo

### WorkInProgress.jsx
Componente placeholder (`frontend/src/components/WorkInProgress.jsx`) per moduli non ancora
implementati. Props: `nome`, `icona`, `colore`. Mostra barra animata decorativa e bottone
per tornare a Revenue.

## Variabili d'ambiente frontend

Il frontend usa Vite con la variabile `VITE_API_URL` per l'URL del backend.

| File | Scopo |
|------|-------|
| `frontend/.env` | Sviluppo locale (non committare) |
| `frontend/.env.production` | Build di produzione (aggiornare prima del deploy) |

- Sviluppo: `VITE_API_URL=http://localhost:8000`
- Produzione Linux: `VITE_API_URL=https://tuodominio.it` (o IP del server)

Regole:
- **Non usare mai URL hardcoded** nel frontend. Usare sempre `import.meta.env.VITE_API_URL`
- `api/client.js` usa `import.meta.env.VITE_API_URL || 'http://localhost:8000'` come fallback
- `Login.jsx` usa la stessa variabile (usa `axios` diretto, non il client condiviso, perché
  il login avviene prima che il token sia disponibile)

## Compatibilità macOS / Linux

Il progetto viene sviluppato su macOS ma deve essere deployato su un server Linux headless (produzione).

### Regole di sviluppo cross-platform
- **Nessun path hardcoded** specifico per macOS (es. `/Users/...`, `/Library/...`)
- **Nessun URL hardcoded**: usare sempre `VITE_API_URL` nel frontend, `cors_origins` da DB nel backend
- Evitare comandi shell specifici per BSD/macOS (es. `sed -i ''` → usare `sed -i` su Linux)
- Python e Node.js sono cross-platform: il codice applicativo non richiede modifiche

### Deploy su Linux (produzione)
Stack consigliato:
- **Reverse proxy**: nginx → ascolta su porta 80/443, fa proxy a uvicorn su 127.0.0.1:8000
- **Backend**: uvicorn gestito da systemd (`uvicorn app.main:app --host 127.0.0.1 --port 8000`)
- **Frontend**: `npm run build` → cartella `dist/` servita da nginx come file statici
- **SSL**: Let's Encrypt via certbot (`certbot --nginx -d tuodominio.it`)
- **CORS**: aggiornare `cors_origins` in `app_config` nel DB con il dominio reale

### Procedura deploy (sintesi)
1. Sul server: `git clone`, `pip install -r requirements.txt`, `alembic upgrade head`
2. `cd frontend && npm install && VITE_API_URL=https://tuodominio.it npm run build`
3. Configurare nginx per servire `dist/` e fare proxy a `:8000`
4. Creare service systemd per uvicorn con `WorkingDirectory` e `ExecStart`
5. Aggiornare `app_config.cors_origins` nel DB PostgreSQL del server

## Note importanti
- Sempre commentare il codice in italiano
- Gestire tutti gli errori con messaggi chiari in italiano
- La UI deve mostrare date in formato italiano, euro con simbolo €, percentuali con %
- occupancy va sempre formattato come percentuale (es. 60.0%) mai come valore monetario
