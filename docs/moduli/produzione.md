<!-- Spostato da CLAUDE.md il 07/11/2026, testo invariato: dove si legge "questa sezione" o "in CLAUDE.md" si intende questo file. Le regole generali restano in CLAUDE.md. -->

## Modulo Statistiche Produzione
Modulo separato (non più dentro USALI — spostato su richiesta esplicita dopo la prima versione),
route `/statistiche-produzione`, code modulo `produzione`, in NavBar tra Statistiche (revenue) e
Budget. `StatisticheProduzione.jsx` è il tab router (Import, Produzione giornaliera, Analisi canali,
Analisi trattamenti, Analisi tipo ospite, Report mensile, Conteggio pasti, Ricavi camere, Occupazione
e Consumo, Dati di test — 10 tab), toggle IVA globale `localStorage('produzione_lordo')` su tutte tranne
Import/Conteggio pasti/Occupazione e Consumo/Dati di test. `Usali.jsx` ha 2 tab proprie:
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

**Somme nel database, non in Python (v4.30.8, 08/11/2026)**: i report (giornaliero, settimanale,
mensile, canali/trattamenti/tipo ospite, conteggio pasti, pasti di Occupazione) e la Home non caricano
più le righe con `query_report().all()` per sommarle una a una: con ~70.000 righe la Home impiegava
3,6 s, il report mensile 1,4 s. Si usa `somme_per(query_report(...), *chiavi)` di `produzione_shared.py`
(GROUP BY → `{chiave: (lordo, imponibile, iva, n_righe)}` in Decimal esatti) e `aggrega_somme()` per il
formato `{lordo, imponibile, iva, n_righe}`; mese come chiave = `MESE` di `produzione_report.py`;
pasti = `conta_pasti_per()`. Le settimane commerciali si ricompongono in Python dai giorni
(`settimana_di`). Nelle espressioni di raggruppamento le costanti vanno come `literal_column`, non come
parametri (PostgreSQL vedrebbe SELECT e GROUP BY diversi). Verificato su 118 risposte reali
(2025–2026, gruppo e strutture, con filtri): valori e ordine identici. Solo `/righe` (drawer di
dettaglio) legge ancora riga per riga. Un nuovo report su `prod_righe` deve seguire lo stesso schema.

**Export del Report mensile** (`GET /produzione/export/mensile`): fino alla v4.30.10 andava sempre in errore, in
ogni formato, perché usava `MESI_IT` (una lista) come dizionario; nessun test lo chiamava. Corretto il 08/11/2026,
test `TestExportMensile` (xlsx/csv/pdf).

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

### Tab "Conteggio pasti" (`produzione/TabConteggioPasti.jsx`, settembre 2026)
Numero di colazioni/colazioni extra/pranzi/cene (non il ricavo) per mese, struttura (DPH/CLB/INT —
BON escluso, coerente col resto del modulo) e complessivo gruppo. `GET
/produzione/report/conteggio-pasti?anno=&struttura_code=` in `produzione_report.py`, stesso pattern
di `/report/mensile` (`query_report()`, una sola query raggruppata per mese) ma `conta_pasti_per()`
al posto di `somme_per()`: **`COUNT(*)` per categoria, non `SUM(quantita)`** — ogni riga di `prod_righe` è già un
singolo pasto/persona (un Oid Welcome = un addebito, mai una riga aggregata con quantità multipla,
vedi `UniqueConstraint` sul modello), quindi contare le righe è l'unico conteggio coerente col resto
del modulo; il campo `quantita` sul modello resta comunque non utilizzato da nessun report. Colazioni
extra (`colazione_extra`) è una voce a sé, non sommata dentro "Colazioni" (supplemento acquistato a
parte, non il pasto del trattamento standard) — scelta esplicita dell'utente.
Frontend: header a due righe con colonne raggruppate per struttura (stesso pattern grafico di
`TabGiornalieri.jsx` in Corrispettivi — riga 1 struttura con `colSpan`, riga 2 sotto-colonne con
bordoGruppo/bordoSotto per marcare i confini), 3 sotto-colonne per struttura: **Colazione | Pranzo |
Cena**. "Colazione" è trattamento+extra sommati (il numero di colazioni davvero servite); click sulla
cella (sottolineatura tratteggiata) espande una riga con la scomposizione Colazione
trattamento/Colazione extra per quella struttura/mese — Pranzo/Cena non hanno sotto-voci da espandere.
Nessun cambiamento lato backend: `_conta_pasti()` restituiva già tutti e 4 i conteggi separati,
sufficiente per questa vista. Niente toggle IVA (è un conteggio, non un importo — tab aggiunta a
`TAB_SENZA_TOGGLE_IVA` in `StatisticheProduzione.jsx`) e nessun export (non richiesto in questa v1).

⚠️ **Bug reale scoperto lo stesso giorno (segnalato dall'utente: "le cene del Du Parc mi sembrano
troppe")**: la prima versione contava tutte le righe della categoria `pranzo`/`cena`, ma per Du Parc
quella categoria (usata anche da `_somma_maremosso()` in `usali.py` per il ricavo di Movimenti Attivi)
contiene **sia** la riga quota (`Quota Cena`, una a persona/notte) **sia ogni singolo piatto/bevanda/
coperto ordinato al ristorante Maremosso**, mappati lì apposta per finalità di ricavo — una cena reale
genera 4-6 righe, gonfiando il conteggio di ~3x (verificato: agosto 2026 DPH mostrava 1.575 "cene",
di cui solo 476 erano `Quota Cena` vera). Colazione DPH era pulita (100% `Quota Colazione`) e CLB/INT
erano quasi puliti (`cena`/`pranzo` = quasi solo `Quota Cena`/`Quota Pranzo`, 1-2 righe estranee), il
bug era specifico di DPH ma avrebbe potuto ripresentarsi silenziosamente su qualunque nuova voce di
menu mappata in futuro. Fix: nuova colonna `prod_dettaglio_categoria.conta_come_pasto` (migrazione
`prod006_2026`, come `categoria_da_prezzo`, editabile da admin in `?s=prod-mapping` →
`ProdMappingDettagli`, checkbox "Conta come pasto") — solo le righe marcate true (backfillate su
`quota colazione`/`quota pranzo`/`quota cena`/`colazione extra`) entrano nel conteggio; le singole
voci di menu restano `false` di default e continuano a contribuire al ricavo (categoria `pranzo`/
`cena` invariata) senza contribuire al conteggio pasti. `_conta_pasti()` filtra su questo flag oltre
che sulla categoria — vedi `_carica_conta_come_pasto()` in `produzione_report.py`.

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

### Tab "Occupazione e Consumo" (`produzione/TabOccupazioneConsumi.jsx`, ottobre 2026, v3.23.0)
Dati mensili di occupazione/consumo per struttura, stesso schema della maschera "Dati di Occupazione
o Consumo" del gestionale contabile (Reparto | Dato | valore), qui come voci × 12 mesi + totale.
Strutture DPH (= **Du Parc + Mare Mosso, struttura unica**), CLB, INT (reparto "Ristorante" per
tutte, anche DPH — scelta dell'utente), BON (solo Ristorante presenze + utenze, tutto manuale).
Elenco voci **fisso nel codice** (`voci_struttura()` in `routers/produzione_occupazione.py`), non in tabella.
- **Automatiche** (calcolate a query-time, mai salvate): Camere Vendibili = `hotel_seasons.total_rooms`
  × giorni di apertura nel mese (scelta dell'utente: 43 per DPH → 1.333 a maggio, il gestionale ne
  conta 44 → 1.364: correggere a mano o cambiare la stagione); Camere Occupate / Clienti Presenze =
  `daily_revenue` via `produzione_mensile()` di `usali_contabile_kpi` (snapshot più recente);
  Arrivi Camere / Arrivi Clienti = righe / Σ`pax` di `prenotazioni_cancellate` con `cancellata=false`
  per mese di `arrivo` (import Welcome "Prenotazioni non disdette": aggiornati quanto l'ultimo
  import); Colazione = quota colazione + colazione extra, Ristorante = pranzi + cene (`_conta_pasti()`
  di Conteggio pasti, solo righe `conta_come_pasto`) — **solo ospiti hotel**, i clienti esterni del
  Mare Mosso non hanno conteggio persone. Dato mancante → `None` ("—"), mai zero inventato.
- **Manuali**: Utenze (kWh, m³ acqua, Smc gas), tutto BON. Pasticceria e Altri Reparti Operativi tolte
  su richiesta dell'utente.
- Tabella `prod_occupazione_consumi` (`prod007_2026`, UNIQUE struttura/anno/mese/voce_code): solo valori
  inseriti a mano. Su una voce automatica è una **correzione** che sostituisce il calcolo (viola
  `colors.accent` a schermo); `PUT` con `valore=null` la cancella e ripristina l'automatico.
- `GET /produzione/occupazione-consumi?struttura=&anno=` → `voci[{voce_code, reparto, dato, tipo
  auto|manuale, mesi[{mese, automatico, manuale, valore}], totale}]`; `PUT /produzione/occupazione-consumi`
  (admin) `{struttura_code, anno, mese, voce_code, valore|null}`. Admin: ogni cella è un input (valore
  automatico come placeholder grigio, salvataggio all'uscita dal campo/Invio); viewer: sola lettura.
