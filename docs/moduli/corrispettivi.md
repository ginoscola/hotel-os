<!-- Spostato da CLAUDE.md il 07/11/2026, testo invariato: dove si legge "questa sezione" o "in CLAUDE.md" si intende questo file. Le regole generali restano in CLAUDE.md. -->

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
- `PUT /incasso-storico` (upsert, admin), `DELETE /incasso-storico/{id}` → pregresso MMS/BON ripartito una-tantum (vedi sezione dedicata)
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

**Grafico "Fatturato mensile" — 3 viste** (`TabFatturati.jsx`, settembre 2026): "Per attività" (le
5 strutture/casse fiscali DPH/CLB/INT/MMS/BON separate, come da sempre — rinominata da "Per
struttura", che generava confusione con la nuova vista sotto), "Per struttura" (nuova: raggruppa
per struttura **fisica**, cioè dove le attività operano davvero — `GRUPPI_FISICI`: Du Parc =
DPH+MMS, Club Hotel = CLB, International = INT+BON, stessa logica già adottata per Maremosso nel
Conto Economico USALI — vedi sezione Usali), "Hotel vs Ristoranti" (invariata, 2 macro-gruppi da
`totale_hotel`/`totale_ristoranti` calcolati lato backend). La vista "Per struttura" è puro calcolo
client-side (somma `per_struttura[attività].totale` già presente nella risposta di
`GET /report/fatturati`, nessuna modifica al backend) — verificato che la somma dei 3 gruppi fisici
coincide esattamente, mese per mese, con `totale_hotel + totale_ristoranti` già calcolati dal
backend (nessun ricavo perso o duplicato). Buona Onda (BON) raggruppata sotto International non è
un'invenzione: confermato dall'utente che opera fisicamente lì, stesso rapporto di Maremosso con
Du Parc.

**"Forme di pagamento" (raggruppate)** — tabella in "Riepilogo Fatturati" (`TabFatturati.jsx`),
settembre 2026: 4 macro-categorie (Contante/Bonifico/Assegno/Pagamento elettronico — quest'ultima
raccoglie tutte le carte/app: Carta Credito, Bancomat, XPAY-Nexi, Satispay) per mese, stesso anno,
con export `GET /corrispettivi/export/tipo-incasso?anno=&formato=`. **C'era un tab dedicato "Tipo
Incasso"** con la stessa tabella: rimosso a fine settembre 2026 perché duplicava questa (`TabTipoIncasso.jsx`
eliminato, tab tolto da `Corrispettivi.jsx`). L'endpoint `report_tipo_incasso` e `export_tipo_incasso`
restano (consumati ora da `TabFatturati.jsx` al posto di `report_pagamenti`). `report_pagamenti`
(metodi grezzi Welcome, non raggruppati) resta ma è usato **solo da `home.py`** (`_perc_contante`).
Non duplica il parsing di `tipo_pagamento`: `_calcola_pagamenti(db, anno, is_test, key_fn,
ordine_primario)` in `corrispettivi_report.py` è condivisa — `report_pagamenti` la chiama con
`key_fn=identità`, `report_tipo_incasso` con `key_fn` che rimappa i 9 metodi noti alle 4 categorie
via `METODO_A_CATEGORIA_INCASSO` (dizionario fisso, non da Admin). Le righe Non specificato/Caparra/
Sospeso/MMS-BON restano informative fuori dalle 4 categorie. I totali dei due report coincidono
esattamente (la rimappatura raggruppa, non altera, il denaro).
⚠️ **Bug scoperto progettando questa tab, corretto nello stesso refactor**: un documento con un
solo metodo citato a importo `0,00 €` nel testo (es. `"Contante 0,00 € /"`, tipico quando `pagato`
deriva solo da un aggiustamento caparra/sospeso) produceva comunque una lista non vuota da
`_estrai_importi_per_metodo` — `if importi:` da solo bastava per entrare nel ramo "distribuisci per
metodo", che poi scartava silenziosamente l'intero `pagato` del documento (`_acc` ignora i valori a
0). Impatto: 40 documenti, 1.237,00€ persi sul 2026 in ENTRAMBI i report (bug preesistente in
`report_pagamenti`, non introdotto da "Tipo Incasso"). Fix: si entra nel ramo "per metodo" solo se
la somma degli importi estratti è ≠ 0; altrimenti si ricade sul fallback `_normalizza(raw)` che
attribuisce comunque il `pagato` reale al metodo citato nel testo.

⚠️ **Bug ben più grande, stessa scoperta (231.198,14€ sul 2026)**: anche quando il testo riporta
importi > 0, la loro somma non sempre coincide con `pagato`, sempre per difetto, pur con
`Deposito`/`Sospeso` entrambi a zero sul documento — 722 documenti su 4.282 nel 2026, 207 dei quali
con un gap multiplo esatto di 100€. Esempio reale: scontrino I-SC 852, Totale 2.014€, testo
"Bancomat 1.514,00 € /" → mancano 500€ non spiegati da nessuna colonna. **Confermato dall'utente**
(proprietario, conosce Welcome): quando il testo dichiara meno del dovuto, il residuo è quasi
certamente una caparra incassata in precedenza e applicata a saldo — stessa semantica della riga
'Caparra', solo non riflessa in `Deposito` per questi documenti specifici (causa non nota, probabile
limite dell'export Welcome). Fix: il residuo (`pagato - somma_importi`) confluisce nella riga
'Caparra' invece di sparire, in ENTRAMBI i report (`_calcola_pagamenti`) — il totale generale ora
coincide sempre esattamente con SUM(totale_lordo) reale (verificato: 1.806.417,66€ su entrambi,
= documenti DPH/CLB/INT + manuali MMS/BON 2026), invariante che prima valeva solo quando il testo
copriva per caso l'intero pagato.

**Ripartizione manuale MMS/BON per tipo di incasso** (`corrfix003_2026`, 4 colonne nullable
`incasso_contante/bonifico/assegno/elettronico` su `corrispettivi_manuali`, NULL su tutte e 4 =
nessuna ripartizione inserita, comportamento storico invariato): a differenza di DPH/CLB/INT
(sempre estratti da `corrispettivi_documenti`, mai inseriti a mano), MMS e BON non hanno dati
Welcome. Il modale `ModaleIncassoManuale` in `TabGiornalieri.jsx` (sostituisce il vecchio input+Salva
singolo): **MMS e BON incassano solo in contante e pagamento elettronico** (confermato dall'utente —
`bonifico`/`assegno` restano nello schema ma sono sempre azzerati per queste due strutture). Si parte
dal **totale lordo del giorno**, si inserisce la **quota elettronica**, il **contante è la differenza**
(campo calcolato, sola lettura). `arrangiamenti_lordo` resta il campo autoritativo per gli altri
consumatori (`report_giornaliero`, `report_fatturati`, USALI `_ricavi_ristorante`/
`_somma_maremosso_esterni`) — **ricalcolato dal backend come somma dei 4** quando la ripartizione è
presente (= contante + elettronico, mai il contrario, `POST/PUT /corrispettivi/manuali`; il body
manda anche `arrangiamenti_lordo` esplicito ma il backend lo ignora e usa la somma). `_calcola_pagamenti` disaggrega sempre (nessun parametro, comportamento unico): le righe con
ripartizione confluiscono nelle 4 categorie vere in ENTRAMBI i report — anche in
`report_pagamenti` (vocabolario di metodi grezzi Welcome), perché 'Contante'/'Bonifico'/'Assegno'
coincidono già con nomi di metodi grezzi noti (`TIPI_PAGAMENTO_NOTI`) e si sommano semplicemente
alle righe esistenti; solo 'Pagamento elettronico' compare come riga propria (nessuna granularità
per-carta disponibile per un incasso inserito a mano). I giorni MMS/BON storici senza ripartizione
restano nella riga unica informativa 'MMS / BON (manuale)' in entrambi i report.
⚠️ **Incidente sfiorato nello stesso lavoro**: `UNIQUE(data_giorno, struttura_code)` su
`corrispettivi_manuali` **non include `is_test`** — una chiamata `POST /manuali` con `is_test=true`
su un giorno che ha già un record reale lo trova come "esistente" (la query di lookup non filtra su
is_test) e lo sovrascrive silenziosamente. Successo quasi per un pelo testando manualmente questo
stesso endpoint: dati reali del 15/07/2026 (MMS, 792,50€) sovrascritti con valori di test, recuperati
nella stessa sessione perché lo scostamento del totale era stato notato subito. Fix: `crea_manuale`
ora rifiuta con 409 se il record esistente ha un `is_test` diverso da quello della richiesta,
invece di sovrascriverlo — un record reale e uno di test per lo stesso giorno/struttura non possono
comunque coesistere nello schema attuale (il vincolo UNIQUE non li distingue), ma almeno non si
sostituiscono più a vicenda senza errore. Da tenere a mente testando questo endpoint in futuro: usare
sempre una data fuori stagione (es. gennaio) per i test, mai una data con dati reali già presenti.

**Pregresso MMS/BON ripartito una-tantum** (`corrfix004_2026`, tabella `corrispettivi_incasso_storico`
— una riga per `(struttura_code, anno, is_test)`: `data_a` "ad oggi" + `incasso_contante/bonifico/
assegno/elettronico`): rifare giorno per giorno la ripartizione dei ~100 giorni MMS/BON già inseriti
come totale unico è impraticabile. Qui si inserisce **una volta** la ripartizione complessiva fino a
`data_a`; da lì in poi si usa il modale giornaliero (`corrispettivi_manuali.incasso_*`). Consumata
**solo** da `_calcola_pagamenti` (tab "Tipo Incasso" + "Forme di pagamento"): `report_giornaliero`,
`report_fatturati` e USALI continuano a leggere `arrangiamenti_lordo` invariato. Comportamento in
`_calcola_pagamenti` quando la riga esiste per una struttura: i giorni MMS/BON senza ripartizione
propria e con `data_giorno <= data_a` non alimentano più la riga mensile `'MMS / BON (manuale)'` ma
vengono sommati in `atteso` (+ `base_mese`, stessa somma spezzata per mese); i 4 importi `incasso_*`
confluiscono **direttamente nelle 4 righe categoria** (via `key_fn`, come già la ripartizione
giornaliera — l'utente vuole il vero totale per metodo, non righe separate), **distribuiti sui mesi in
proporzione** a `base_mese` (`_distribuisci()`, ultimo mese assorbe l'arrotondamento): non esiste un
dettaglio giornaliero della ripartizione, si usa il ritmo reale degli incassi MMS/BON come proxy —
così la riga TOTALE in fondo resta coerente (Σ mesi = Σ categorie = TOTALE generale). Il residuo
`atteso - somma4` (0 con dati corretti) va a `'MMS / BON (manuale)'` con lo stesso criterio, così il
TOTALE resta = `SUM(totale_lordo)` reale (verificato: 1.806.417,66€ prima e dopo). Endpoint
`PUT /corrispettivi/incasso-storico` (upsert, admin) e `DELETE /corrispettivi/incasso-storico/{id}`;
la risposta di `/report/tipo-incasso` espone comunque `pregresso_mmsbon`
(`{MMS,BON} → atteso/data_a/salvato/incasso_*/residuo/id`). **Nessun pannello UI**: l'inserimento è
una-tantum, fatto una volta a settembre 2026 (dati salvati e verificati) — c'era un pannello in
`TabTipoIncasso.jsx`, rimosso su richiesta dell'utente subito dopo l'inserimento. Correzioni future:
via `PUT/DELETE /corrispettivi/incasso-storico` diretto (o riesumare il pannello dallo storico git,
commit di questo lavoro). `home.py::_perc_contante` legge `totale_anno['Contante']`, che già include
il pregresso confluito.

### Tab "Totali" (`TabTotali.jsx`, ottobre 2026, v3.19.0)
Prospetto annuale per mese × struttura in **due tabelle**: "Scontrini (Stampanti RT)" e "Fatture"
(righe DPH, MMS, CLB, INT, BON — Maremosso accanto a Du Parc, come nel foglio esterno da cui nasce;
MMS/BON = incassi manuali negli scontrini, fatture sempre "—"), riga TOTALE per sezione + totale
generale. Toggle IVA = quello globale di Corrispettivi; toggle **Tassa di soggiorno inclusa/esclusa**
proprio (`localStorage('corrispettivi_totali_con_ts')`).
- `GET /corrispettivi/report/totali?anno=&lordo=&con_ts=` (`report_totali()` in
  `corrispettivi_report.py`): **riusa `report_giornaliero()`** sull'anno intero e somma per mese —
  stessa fonte della tab "Corrispettivi giornalieri" (scelta dell'utente), quindi **annullati
  inclusi** come lì, a differenza di `report_fatturati` che li esclude: i totali possono differire
  leggermente dal Riepilogo Fatturati. Verificato: con IVA e TS incluse `totale_generale` =
  Σ `totale_giorno` della giornaliera al centesimo (1.896.693,98€, 2026). IVA scorporata e TS tolta
  **lato server** (eccezione al pattern "backend sempre lordo", come `/check`), perché l'export deve
  dare gli stessi numeri a schermo.
- `GET /corrispettivi/export/totali?anno=&lordo=&con_ts=&formato=xlsx|csv|pdf` → una sola tabella
  con le due sezioni una sotto l'altra (riusa `_risposta_tabella` di `corrispettivi_documenti`) +
  riga finale che dichiara IVA/TS. Frontend con `ExportMenu`.
- Il foglio di riferimento mostrato dall'utente era del **2025**: nessun dato 2025 nel DB
  (corrispettivi da aprile 2026), quindi nessun confronto numerico possibile.

### Tab "Cassa" — cassa contante reale di gruppo (`TabCassa.jsx`, settembre 2026)
Il **vero scopo** per cui è nata la tab Tipo Incasso: sapere quanto contante fisico ha in mano il
gruppo. **Cassa reale = saldo iniziale + Σ contante incassato − Σ versamenti in banca + Σ rettifiche**
(con segno), come saldo progressivo per mese. Gestione **a livello di gruppo** (un unico saldo,
nessuno scorporo per struttura — scelta esplicita dell'utente).
- Tabella `cassa_movimenti` (`corrfix005_2026`): `tipo` ∈ {`saldo_iniziale` (contante al 1° del mese
  di `data` — l'endpoint forza `day=1`; baseline positiva), `versamento` (importo versato in banca,
  positivo, **sottratto**), `rettifica` (± con segno: spese/prelievi/ammanchi in contanti = negativo,
  contante immesso = positivo)} + `data`, `importo`, `note`, `is_test`, audit. Nessun vincolo UNIQUE:
  il `saldo_iniziale` usato è **il più recente con `data.year <= anno`** (agisce da punto di re-basing).
- **Sotto-router `corrispettivi_cassa.py`** (incluso da `corrispettivi.py`): `GET|POST /cassa/movimenti`,
  `PUT|DELETE /cassa/movimenti/{id}` (scrittura admin), `GET /cassa/riepilogo?anno=` →
  `{saldo_iniziale, mesi:[{mese, contante_incassato, versamenti, rettifiche, saldo_fine_mese}],
  totali, saldo_corrente}`.
- **`contante_incassato` per mese NON è riaggregato**: `riepilogo_cassa()` chiama `report_tipo_incasso()`
  e legge `per_tipo['Contante']` — resta identico alla riga Contante della tab Tipo Incasso (DPH/CLB/INT
  + MMS/BON + pregresso una-tantum distribuito). Se cambia la logica del contante lì, la cassa segue
  senza modifiche.
- ⚠️ Il contante include la **tassa di soggiorno pagata in contanti** (denaro fisicamente in cassa ma
  da girare al Comune) — coerente con `_calcola_pagamenti` che non la sottrae. La tab lo dichiara in
  nota; un'eventuale riga "di cui tassa soggiorno" è un affinamento futuro, non fatto in v1.
- Frontend: card grande "Cassa contante disponibile" (`saldo_corrente`) + tabella mensile + (solo
  admin) form aggiungi/modifica movimento con elenco. Tab `id='cassa'`, dopo "Tipo Incasso".
  ⚠️ Solo `rettifica` accetta importo con segno; `versamento`/`saldo_iniziale` negativi → 400
  (`_parse_body()`). Un'uscita di contante (es. pagamento fornitore dalla cassa) è una **rettifica
  negativa**, non un versamento (il versamento è il contante portato fisicamente in banca). Il form
  (`TabCassa.jsx`) normalizza con `Math.abs()` l'importo rimasto in campo quando si cambia Tipo da
  `rettifica` a un tipo che non ammette il segno, e blocca il salvataggio lato client con messaggio
  esplicito — bug UX reale (settembre 2026: `-73,20` digitato come bozza di rettifica, poi Tipo
  cambiato in "Versamento in banca" senza che il segno sparisse → 400 dal backend).
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
  + **ristoranti MMS/BON** (ottobre 2026): `ristoranti_codes=['MMS','BON']` = colonne aggiuntive dopo
  gli hotel nella vista Gruppo. Nessun dato Passbi per loro: solo `SUM(corrispettivi_manuali.
  arrangiamenti_lordo)` (is_test=false, stesso anno/range mesi) in una riga reparto dedicata
  `'Ristorante (corrispettivi manuali)'` (`RIGA_RISTORANTI_MANUALI`), distinta dalla riga
  'Maremosso' di Passbi (= addebiti in camera degli ospiti DPH). Entra in `totale_reparti` e nelle %;
  nei Trattamenti le colonne MMS/BON sono sempre '—' (un ristorante non ha BB/HB/…) e
  `totale_trattamenti` resta solo hotel — quindi i due totali del Gruppo differiscono di questa riga.
  Solo vista Gruppo (+ export Gruppo), non selezionabili come hotel singolo.
  **Terza tabella "Reparti — Gruppo ripartiti sui Corrispettivi"** (`reparti_corrispettivi`,
  `corrispettivi_per_struttura`, `totale_reparti_corrispettivi`; foglio export "Reparti su
  Corrispettivi"): per ogni hotel il totale di `report_fatturati()` nei mesi della vista (riusato,
  non riaggregato: IVA inclusa, annullati e tassa di soggiorno esclusi) è ripartito tra i reparti in
  proporzione ai valori Passbi **di quell'hotel** (non alle % di gruppo), centesimo di arrotondamento
  sul reparto più grande → ogni colonna = Corrispettivi esatti (verificato apr–set 2026 =
  1.841.975,63€ = Riepilogo Fatturati). MMS/BON invariati. Hotel con Corrispettivi ma senza reparti nel
  periodo → riga `'Non ripartibile (nessun dato reparti)'`. `_reparti_su_corrispettivi()`.
  **Toggle IVA su questa tabella = netto REALE, non il 10% presunto**: `get_gruppo` calcola la
  ripartizione due volte (`report_fatturati(lordo=True|False)`, IVA per categoria: penali 0%, shop
  22%…) e manda la versione netta in `netto_corrispettivi`; frontend (`vistaIva`) ed export
  (`_scorpora_iva_presunta`) la sostituiscono invece di dividere per 1,10 (titolo foglio "IVA
  esclusa", senza "presunta"). Le due tabelle PassBI restano sulla stima al 10%. Titoli a schermo
  ed export: "Trattamenti/Reparti — Gruppo (fonte PassBI)".
  Perché serve: Passbi (maturato, sembra includere la tassa di soggiorno) supera i Corrispettivi di
  ~65k€ sulla stagione 2026 (~25k€ al netto della TS: residuo simile anche Produzione vs Corrispettivi).
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
  quando disponibile. Il "valore" è preso così com'è dal CSV Passbi (Dashboard Analisi Ricavi),
  sempre IVA inclusa e **senza aliquota** (confermato dall'utente).
  **Toggle IVA (ottobre 2026)**: il toggle globale di Corrispettivi ora vale anche qui, con **IVA
  presunta al 10% su tutto** (scelta esplicita dell'utente, è una stima: un reparto con voci al 22%
  risulta sovrastimato). Con "IVA esclusa" tutti gli importi sono divisi per 1,10 (`vistaIva()` in
  `TabAnalisiRicavi.jsx`, `_scorpora_iva_presunta()` in `analisi_ricavi.py` per l'export, param
  `lordo`; titolo foglio "IVA esclusa (presunta al 10%)"); % invariate; `revenue_module` (Δ
  Revenue) non toccato. Sotto la pillola compare l'avviso "Valori presunti: IVA complessiva stimata
  al 10%" (solo tab Analisi Ricavi + IVA esclusa). DB sempre IVA inclusa: una modifica inline fatta
  in vista netta viene rimoltiplicata ×1,10 prima del `PUT` (`aLordo()`).

Frontend `TabAnalisiRicavi.jsx`: bottoni hotel [DPH][CLB][INT][Gruppo]; frecce ◀▶ mese/anno; toggle Range (mese_fine); toggle dettaglio/macrocategorie; toggle Δ Revenue (solo hotel singolo). Default: mese precedente a quello corrente. Colori: priorità DB → `CATEGORIA_COLORI` → palette.
Admin `corr-classificazione`: `CorrClassificazioneTrattamenti` con colonna Colore (swatch + hex).

### Frontend Corrispettivi.jsx (12 tab)
Import | Corrispettivi giornalieri (drawer cella→documenti) | Scontrini | Fatture | Penali | Riepilogo Fatturati | Totali | Cassa | Controllo RT | Stampante RT | Analisi Ricavi | Dati di test.
`PerHotelView`: generico per scontrini/fatture, `localStorage('scontrini_vista'|'fatture_vista')`.
Tab attiva: `localStorage('corrispettivi_tab')`.

**Diviso per file** (stesso pattern dello split backend — `Corrispettivi.jsx` è solo tab bar + routing,
~130 righe invece di ~3000): `frontend/src/utils/corrispettiviHelpers.js` (costanti/helper condivisi:
`STRUTTURE_HOTEL`, `NOMI`, `NOME_CAT`, `isAdmin`, `fmtD`, `meseNome`,
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
