<!-- Spostato da CLAUDE.md il 07/11/2026, testo invariato: dove si legge "questa sezione" o "in CLAUDE.md" si intende questo file. Le regole generali restano in CLAUDE.md. -->

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
  semaforo per hotel, striscia di freschezza dati. I blocchi Produzione (mix, commissioni) usano le
  somme nel database (`somme_per()`, vedi `produzione.md`): cruscotto da 3,6 s a ~0,4 s (v4.30.8).
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
- **Occupancy e ADR anche per mese** (`kpi_operativi.occupancy_per_mese`/`adr_per_mese`, blocco
  pubblico): un tachimetro per ogni mese solare con almeno una camera venduta (mesi senza vendite,
  tipicamente inizio/fine stagione, esclusi) — `_kpi_per_mese()` in `home.py`, un solo giro sulle
  righe `daily_revenue` già caricate. **Soglie anche per mese**, non più solo "piatte" per stagione
  (migrazione `home003_2026`, colonna `dashboard_kpi_soglie.mese`, NULL = piatta/fallback, 1-12 =
  override per quel mese): maggio e agosto hanno aspettative molto diverse, una soglia unica
  appiattiva il confronto. `_gauge(kpi_code, valore, soglie, mese=...)` cerca prima
  `(kpi_code, mese)`, poi ricade su `(kpi_code, NULL)` se quel mese non ha un override — i gauge di
  stagione (es. "Occupancy stagione") continuano a passare `mese=None`, invariati. Seminate solo
  maggio-settembre (`SOGLIE_MENSILI` in `home003_2026`, unici mesi realmente operativi — vedi
  `hotel_seasons`), valori di partenza stimati sui dati reali stagione 2026, da affinare in Admin.
  ⚠️ **`UNIQUE(kpi_code, hotel_code, mese)` non impedisce righe piatte duplicate**: Postgres tratta
  ogni NULL come distinto in un vincolo UNIQUE, quindi in teoria più righe con `hotel_code`/`mese`
  entrambi NULL per lo stesso `kpi_code` passerebbero il vincolo — rischio accettato (stesso limite
  già presente su `hotel_code` da solo in `home001_2026`), i semi sono scritti a mano nelle
  migrazioni, non da input utente diretto.

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

## Attività ricorrenti — scadenziario operativo (novembre 2026, v4.23.0)
Pagina `/attivita` (`pages/Attivita.jsx`, **solo admin**, come la Home non è un modulo: nessun tab evidenziato,
`rilevaModuloAttivo()` → `'home'`): cosa caricare o aggiornare, per settimana del mese (`NavMese`, apre sul mese
**in corso** — eccezione voluta alla regola "mese precedente": è una lista di cose da fare), riquadro "In ritardo"
(mese scorso + mese in corso, con "Segna tutti come fatti" per ripulire), casella "Nascondi le fatte"
(`localStorage('attivita_nascondi_fatte')`, solo a schermo: il PDF le mostra sempre con la spunta), impegni di Tesoreria del mese solo come
conteggio (il calendario fiscale resta in Tesoreria → Impegni), **PDF** del mese con caselle da spuntare. In Home,
per gli admin, `pages/home/RiquadroAttivita.jsx` ("N attività in ritardo · M entro 7 giorni").
- **Stato ricavato dagli import**, nessuna spunta per la maggior parte delle voci: catalogo `CATALOGO` in
  `services/attivita.py` (puro: occorrenze, finestre, stato), evidenze in `_evidenze()` di `routers/attivita.py`
  (date degli import/dati: corrispettivi per `data_documento`, `rt_chiusure`, incassi MMS/BON, snapshot Revenue per
  hotel, `created_at` degli import di banca/Produzione/Passbi/Passcom/CE contabile/Welcome/previsioni salvate,
  versamenti in Cassa, saldi manuali AMEX/BCC/TASCA; dati per (anno, mese) — cedolini, coperti, utenze — contano
  dal 1° del mese dopo; budget e stagioni dell'anno dopo contano a dicembre dell'anno prima).
- Finestre: giornaliera = giorno del dato (scadenza il giorno dopo, solo nei giorni di `hotel_seasons` degli hotel
  indicati), settimanale = settimana lun–dom della scadenza, mensile = il mese, annuale = l'anno. `parti` = evidenze
  richieste tutte (Revenue DPH/CLB/INT, coperti MMS/BON, Welcome disdette/non disdette).
- Titoli e note accettano `{anno}`/`{prima}` (anno della scadenza e anno prima, `testo()`): le voci fiscali dicono
  dove cercare nel cassetto fiscale e con quali anni (v4.23.1); nel PDF la nota è stampata sotto le voci a mano.
- Attività `automatica=False` (ZIP fatture AdE, coda caparre, TARI, dichiarazioni, advertising, interventi,
  compensi): solo spunta a mano. La spunta (`attivita_fatte`, migrazione `att001_2026`, UNIQUE codice+scadenza) vale
  anche sulle automatiche, per una scadenza senza file.
- Endpoint (prefix `/attivita`, tutti `richiedi_admin`): `GET ?anno=&mese=`, `GET /riepilogo`, `GET /export` (pdf),
  `POST /fatto {codice, scadenze, fatto}`, `GET /catalogo`, `PUT /parametri/{codice}` (`giorno`/`mese`/`mesi`/
  `attiva`, `{ripristina: true}`). Modifiche salvate in `app_config['attivita_parametri']` (solo gli override).
  Admin `?s=attivita` → `pages/admin/AdminAttivita.jsx`.
- ⚠️ **Nuovo import o dato ricorrente in un modulo → aggiungerlo a `CATALOGO` e, se verificabile, a `_evidenze()`**,
  altrimenti lo scadenziario non lo conosce. Al primo avvio (04/11/2026) ottobre risultava pieno di ritardi perché
  la Tesoreria è partita il 28/10: normale, si ripuliscono con "Segna tutti come fatti".
