<!-- Spostato da CLAUDE.md il 07/11/2026, testo invariato: dove si legge "questa sezione" o "in CLAUDE.md" si intende questo file. Le regole generali restano in CLAUDE.md. -->

## Modulo Tesoreria (in sviluppo — progetto a più fasi e più sessioni)
Flusso di cassa di KM di Mare S.r.l.: posizione di cassa di oggi, consuntivo (dove sono andati i
soldi), previsione dei mesi futuri con il fido come soglia. Modulo `tesoreria`, route `/tesoreria`.
**Specifica completa**: `prompt_hotelos_tesoreria.md` nella root del repo (requisiti, formati file,
regole di classificazione, convenzioni). È la fonte dei requisiti: questa sezione registra solo
**stato, decisioni e collegamenti**, non ripete la specifica.
⚠️ La specifica è **solo sul server, fuori da git** (in `.gitignore`: contiene numeri di conto e
saldi), e verrà cancellata a progetto ultimato — quindi tutto ciò che deve restare (decisioni,
formati, regole effettivamente implementate) va scritto qui in CLAUDE.md, non lasciato solo lì.

### Regole di lavoro (chieste dall'utente, valgono per tutte le fasi)
- **Una fase per sessione.** Mai iniziare la fase successiva senza l'ok esplicito dell'utente: tra
  una fase e l'altra usa il modulo con dati reali e riporta correzioni.
- **Prima di scrivere codice** (anche all'interno della stessa fase, se si apre un blocco nuovo):
  presentare strategia, file coinvolti, rischi e **attendere autorizzazione**.
- **In caso di dubbi chiedere sempre**, non decidere da soli (formati file, regole, casi limite).
- A fine fase: test verdi, aggiornare questa sezione (fatto / manca / decisioni), commit e push,
  versione in `frontend/src/version.js` (Fase 1 = **MAJOR**, nuovo modulo; fasi successive = MINOR).
- **Come riprendere dopo una disconnessione**: 1) leggere "Stato delle fasi" e l'ultima voce del
  "Diario" qui sotto; 2) `git log --oneline -15` per vedere gli ultimi commit; 3) rileggere la parte
  della specifica relativa alla fase in corso; 4) riepilogare all'utente dove eravamo e chiedere
  conferma prima di proseguire.

### Stato delle fasi
| Fase | Contenuto | Stato |
|---|---|---|
| 1 | Conti, import estratti conto, classificazione, posizione attuale, consuntivo | ✅ v4.0.0 (28/10/2026) — blocchi A–D; ora uso con dati reali, poi Fase 2 (serve ok) |
| 2 | Scadenzario Passcom e abbinamento con la banca | ✅ v4.5.0 (29/10/2026) — blocchi A–D; ora uso con dati reali, poi Fase 3 (serve ok) |
| 3 | Previsione di cassa: fiscale, affitti, interventi, ricorrenti, stime, scenari | ✅ v4.14.0 (02/11/2026) — blocchi A–D; ora uso con dati reali, poi Fase 4 (dopo ~1 mese, serve ok) |
| 4 | Precisione: caparre, stipendi da Dipendenti, tempi di pagamento, verifica previsioni | ⏳ A caparre ✅ v4.21.0, B stipendi ✅ v4.22.0 (03/11/2026); C tempi e D verifica **in attesa di dati** (vedi sotto) |
| 5 | Fatture XML passive: debiti non registrati e stima IVA | ✅ v4.24.0 (05/11/2026) — blocchi A–D |
Legenda: ⬜ non iniziata · ⏳ in corso · ✅ completata (con versione).

### Decisioni prese
- **28/10/2026 — Formato import banca: solo XML CBI** (`CBIBdyBkToCstmrStmtReq`, namespace
  `urn:CBI:xsd:CBIDlyStmtReqLogMsg.00.01.02`), uguale per 095081 e 217746. Nessun parser `.xls`.
  Conto dall'IBAN, saldi da `OPBD`/`CLBD` di ogni `Stmt` (giorno), antiduplicato su `AcctSvcrRef`.
- **28/10/2026 — Visibilità: default solo admin, ma configurabile** ad altri ruoli/persone dal pannello
  permessi esistente. Quindi gli endpoint NON usano `richiedi_admin` fisso: proposta di una dipendenza
  per permesso di modulo (vedere/modificare/importare), stessa logica di `lista_moduli()` in
  `routers/modules.py` (admin sempre tutto; ruolo da `module_permissions`; override per utente solo su
  `puo_vedere`) — da estrarre in funzione condivisa, non duplicare. Seed viewer: tutto `false`.
- L'utente caricherà anche gli XML 2025 di entrambi i conti (confronto anno precedente).
- **28/10/2026 — Fido scaduto**: dopo `data scadenza fido` il fido NON entra più in "Disponibilità con
  fido" + avviso rosso "fido scaduto, aggiornare se rinnovato" (avviso arancione già 60 gg prima).
  Importo e scadenza del fido si impostano da Admin → Tesoreria → Conti (scadenza vuota = sempre
  conteggiato, nessun avviso). Seed: conto POS 217746, fido 130.000 €, **scadenza 30/09/2027**.
- **28/10/2026 — Prima del blocco A** l'utente carica uno alla volta gli altri file campione
  (scadenzario Passcom, fatture XML, altro) in `uploads/tesoreria_campioni/`, da analizzare uno per
  uno: si parte col codice solo dopo aver chiarito tutti i formati e con ok esplicito.
- **28/10/2026 — XML banca completi** in `banca_conto_principale/` (`export 2025 conto principale.xml`
  3.349 mov., `export 2026 conto principale.xml` 2.807 mov. fino al 28/10) e `banca_conto_pos/`
  (`export 2025 pos.xml` 292 mov. dal 14/04/2025 = apertura conto a saldo 0, `export 2026 POS.xml`).
  Tutti: ogni giorno quadra, nessun salto, 31/12/2025 → 02/01/2026 continuo su entrambi i conti,
  `AcctSvcrRef` univoci e mai vuoti, nessun ref ripetuto tra file. **Stabilità `AcctSvcrRef`
  verificata** anche cambiando periodo (stessi ref dei movimenti di ottobre del primo export).
  Prova delle regole di seed su 6.733 movimenti: solo **12 "Da classificare"**, tutti "Storno scritture"
  (causale ABI 68//00) → proporre una regola/categoria "Storni bancari". Giroconti: 66 movimenti, somma
  0,00 € tra i due conti (le due gambe si compensano). Mutuo 036/307528: erogazione 140.000 € il
  23/07/2026 (+ "Spese erogazione mutuo" −1.050 € finite in Banca), rate dal 20/08/2026 (~1.460–1.480 €).
- **28/10/2026 — File facoltativi** in `altro/`:
  - `piano ammortamento mutuo.xls`: **vero .xls BIFF** (non testo: serve `xlrd`, oggi non installato —
    nuova dipendenza da approvare in Fase 3, oppure conversione a mano in xlsx). Foglio
    `reportRateMutuoXls`: Nr. rata, Scadenza gg/mm/aaaa, Capitale, Interessi, Importo, Cap. residuo,
    Note ("Pagata il …"); numeri come **testo italiano** ("1.454,67"). 120 rate 20/08/2026–20/07/2036,
    tasso evidentemente **variabile** (interessi oscillano) → il piano va ricaricato quando cambia.
    "Importo" esclude le spese rata 1,50 € (banca addebita Importo + 1,50).
  - Carte: PDF con layout diversi, **nessun import previsto** (saldo manuale, come da specifica).
    Carta BCC (Numia, 2 carte nominative): chiusura il 28, addebito il 26 del mese dopo
    (271,62 € il 26/10 ✓ in banca). AMEX Oro Business: chiusura il 6, addebito ~27 dello stesso mese
    (3.042,39 € il 27/10 ✓ in banca, SDD "AMERICAN EXPRESS"). Servono per i giorni di addebito
    configurabili per carta in Fase 3.
  - Prepagata TASCA (Mastercard Prepaid Business): PDF lista movimenti, disponibilità 501,16 € al
    30/09/2026 → saldo manuale.
- **28/10/2026 — Scadenzario Passcom analizzato** (`passcom_scadenzario/011_stp000001-tutte.xml` e
  `011_stp000002-da pagare.xml`, filtro scadenze 2026): **i due file sono identici** (cambia solo
  `Created`) → il filtro "tutte" non ha avuto effetto; colonne "Data pag"/"Stato" presenti
  nell'intestazione ma sempre vuote. Formato = specifica (SpreadsheetML, windows-1252, foglio
  `-Scaddoc`, `ss:Index`, riga Totale 110.590,39 = somma righe ✓, 76 righe DESCRIZIONE TESTATA).
  Differenze dalla specifica: (1) righe **`*PAREGGIO*`** (col 5, senza tipo doc/numero/protocollo,
  74 righe): pagamenti/compensazioni registrati a una data di scadenza **diversa** dalle fatture che
  chiudono (es. Du Parc fattura 12/2025 +50.429 vs pareggio 07/2026 −53.304; MARR luglio-settembre
  fatture = pareggi) → l'aperto reale si ricava per fornitore, non riga per riga; (2) tipo doc `PG`
  (pagamenti non abbinati, negativi, tutti 2021-2022) e un `31`; (3) righe di sola col 4 con frammenti
  di testo (ragione sociale andata a capo: "ICO", " C.", "ia") da ignorare; (4) contiene partite aperte
  anche di anni vecchi (2011-2024, residui di pochi € a ~2.000 €) pur filtrando 2026; nessuna scadenza
  2027 (max 30/11/2026). 1.285 righe, 76 fornitori (MARR 999 righe), 7 fornitori con netto negativo.
  Causa: il campo "Stato rata" era rimasto vuoto (= solo rate da pagare), e Scadenza A = 31/12/2026.
- **28/10/2026 — Scadenzario rifatto** (file sostituiti): `scadenzario_da_pagare.xml` (stato vuoto,
  scadenza A 31/12/2027) = identico al precedente, nessuna scadenza 2027 (max 30/11/2026: le fatture
  fornitori scadono a breve). **Formato di riferimento per la Fase 2**: lo si scarica sempre con le
  selezioni memorizzate in Passcom. `scadenzario_pagate.xml` (stato **P**): stesso formato ma **col 3 =
  data pagamento** e **col 4 = stato `P`** (vuote nel file "da pagare"), nessuna riga `*PAREGGIO*`;
  7.638 righe, totale 6.034.905,34 ✓, scadenze 2021–27/10/2026 (il filtro "Da 01/01/2026" non è stato
  applicato: contiene tutto lo storico). La data pagamento è quella **registrata dallo studio**, non la
  data banca (es. Campanelli 830 € = 05/10 in Passcom, 07/10 in banca; solo 4 pagamenti di ottobre già
  registrati al 28/10) → utile come storico per la Fase 4, ma la verità sui pagamenti resta la banca.
  ⚠️ **Passcom lavora per anno contabile**: lo scadenzario dell'anno 2026 non mostra le scadenze di
  documenti registrati nel 2027 (gestite dal commercialista nel bilancio con ratei/risconti). In
  Fase 2–3: le scadenze oltre l'anno contabile corrente vengono solo dalle stime; a cavallo d'anno
  (inizio 2027, quando lo studio apre il nuovo anno) può servire caricare **due file per la stessa
  data** (anno vecchio + anno nuovo) — da verificare con l'utente in quel momento, prevedere nel
  modello snapshot che una fotografia possa essere composta da più file.
  Prova (`scadenzario_da_pagare_no-filtri.xml`, nessun filtro data): **identico** al file con
  scadenza A 31/12/2027 → il filtro data è irrilevante, il limite è solo l'anno contabile.
- **28/10/2026 — Fatture XML passive (Fase 5), fonte**: GoProfit non ha funzione di export; Passcom
  (PassHub) non risulta esportarle. Si prova lo **scarico massivo dal portale AdE "Fatture e
  Corrispettivi"** (richiesta per periodo, fatture ricevute, ZIP disponibile in ~24h), fatto a mano
  dall'utente. Campione richiesto: un mese (set. o ott. 2026) in `fatture_xml/`, ZIP non decompresso.
  Accesso risolto dall'utente delegando la S.r.l. al proprio codice fiscale sul portale AdE: può
  scaricare in autonomia. Percorso: Fatture e Corrispettivi → Consultazione/Richieste → "Richieste di
  Fatture Elettroniche" → Creazione richiesta guidata (Puntuale, date, **Ricevute**, tipo Tutte) →
  Genera richiesta → **Invia richiesta** (il "Download richiesta (xml)" è solo il modulo, non le
  fatture). Richiesta di prova 01/10–28/10/2026 inviata il 28/10/2026, identificativo
  `2810261047580000000000573682076`, elaborazione **entro 5 giorni** → ZIP da mettere in `fatture_xml/`.
- **29/10/2026 — ZIP AdE analizzato** (`fatture_xml/…_fileProdotto1.zip`, arrivato in ~1 giorno;
  `…_fileInput.xml` accanto è solo il modulo della richiesta, da ignorare). ZIP piatto: per ogni fattura
  il file (`.xml`/`.XML` o firmato `.xml.p7m`, 35 su 65) + `{nome}_metaDato.xml` (namespace
  `urn:xml.fatturazione.sogei.it`, coppie nome/valore: `idfile`, `dataaccoglienza`, `hashfile`,
  cedente P.IVA/denominazione, `nomefile`, `numerofatture`…). `.p7m` = CMS DER, estraibile con
  `openssl cms -verify -noverify -inform DER` (nessuna dipendenza Python nuova). Tutte FPR12, 65
  documenti, 39 fornitori, 65.620,43 €; totale = Σ riepiloghi IVA e = Σ `ImportoPagamento` su tutte.
  Tipi: TD01 32, **TD24 differite 21** (fornitori alimentari, data 30/09), **TD17 11 + TD18 1
  integrazioni reverse charge** (Booking, Google, Meta, Canva, OpenAI, Sklum — numerate 10/123…,
  generate per l'IVA, non sono debiti da pagare: vanno escluse dai debiti, contano solo per l'IVA).
  `DatiPagamento` assente su 16 (le 12 integrazioni + 4), sempre una sola rata (TP02), modalità
  MP12 Ri.Ba./MP05 bonifico/MP20 SDD/MP19/MP21/MP08 contanti/MP02 assegno; scadenze fino al 30/11.
  31 con allegato PDF incorporato, 19 con DDT. Confronto con lo scadenzario Passcom del 28/10: quasi
  tutte le TD01/TD24 già registrate dallo studio (ritardo minimo a ottobre); diverse "da pagare" per
  Passcom risultano già pagate in banca (SDD Studio Gasperoni, Nuova Ascom, TIM, TheFork; assegni
  Sogeal e Masini; Comune di Gabicce) → conferma il controllo incrociato previsto in Fase 2.
- **28/10/2026 — Consuntivo**: Entrate/Uscite/Netto operativo escludono le categorie
  `escludi_da_operativo` (giroconti, erogazione mutuo), mostrate in una riga a parte "Movimenti non
  operativi"; con "tutti i conti" giroconti sempre esclusi; saldi inizio/fine = saldi reali banca;
  rate del mutuo restano uscite operative.

- **28/10/2026 — PDF carte (BCC, AMEX, prepagata)**: niente import in Fase 1 (saldo manuale). Import
  futuro con lettori deterministici `pdfplumber` (uno per layout) + controllo di quadratura sui
  totali dell'estratto, **mai un passaggio AI/Claude** (dati riservati, risultato non deterministico,
  costo). Da collocare in Fase 3 (uscite certe con data di addebito) o come funzione a sé dopo.

- **28/10/2026 — Storni bancari**: ognuno nella categoria del movimento che annulla (regole
  "Storno scritture" + Storno comm → Banca, + EMOLUMENTI/STIPENDIO → Personale, + CAPARRA → Bonifici
  da clienti, + nome hotel/PAGOBANCOMAT/NUMIA → Incassi POS); gli altri restano da classificare.
  **Spese erogazione mutuo** → "Mutuo – rate e spese" (uscita operativa), regola prima di "Spese" →
  Banca. Aggiunto "Pagamento interessi" → Banca.
- **28/10/2026 — Regole sul nome con operatore `inizia`** sulla controparte (giroconti, affitti), non
  `contiene` come nella specifica: la banca attacca la causale libera al nome del beneficiario
  ("ERICE SNC DI FORLANI LETSaldo FT 1", troncato a 24 caratteri se lungo, altrimenti attaccato),
  e con `contiene` finivano negli affitti bonifici la cui causale nomina un hotel (quota WTG 3.300 €,
  subingresso licenza al Comune, storno conto a un ospite). Bonifici istantanei: nome dopo "BEN".

### Blocco A — fatto (28/10/2026)
- `app/models/tesoreria.py` (registrato in `app/models/__init__.py`): `TesoreriaConto` (IBAN univoco,
  fido + `fido_scadenza`, `ha_import`), `TesoreriaImport`, `TesoreriaSaldo` (UNIQUE conto+data, saldo
  a fine giornata per data contabile, `origine` import|manuale), `TesoreriaCategoria`, `TesoreriaRegola`
  (campo descrizione|controparte, operatore inizia|contiene, `valori` OR + `valori_anche` facoltativo
  in AND, segno, priorità), `TesoreriaMovimento` (UNIQUE conto+`impronta`, `import_id` CASCADE =
  import che l'ha inserito per primo, `categoria_manuale`, `straordinario`).
- Migrazione `tes001_2026`: tabelle + seed (5 conti, 23 categorie, 29 regole) + modulo `tesoreria`
  **attivo=false** (da attivare nel blocco D, quando esiste la pagina) + permessi (viewer tutto false).
  Le costanti `CONTI`/`CATEGORIE`/`REGOLE` della migrazione sono lette dai test: restano costanti.
  Applicata al DB reale il 28/10/2026 (verificati anche downgrade e nuovo upgrade).
- `services/tesoreria_parser.py` → `parse_estratto_cbi(bytes)`: blocchi bloccanti (`ErroreImportTesoreria`)
  su IBAN multiplo, stato ≠ BOOK, data contabile ≠ giorno, giorno che non quadra, saldo non continuo,
  riferimenti ripetuti. Saldi = chiusura di ogni giorno + apertura del primo giorno come saldo del
  giorno prima. Impronta `R:{AcctSvcrRef}` o `H:{sha256}` (dati + occorrenza). `estrai_controparte()`.
  ⚠️ ElementTree: `iter()` non accetta il namespace jolly `{*}`, usare `findall('.//{*}…')`.
- `services/tesoreria_classificatore.py` → `classifica(descrizione, controparte, importo, regole)`.
- `services/tesoreria_saldi.py` → `saldo_a_data()`, `verifica_saldi()` (`Discrepanza.differenza`).
- Test: `test_tesoreria_parser.py`, `test_tesoreria_classificatore.py` (usa le regole della migrazione),
  `test_tesoreria_saldi.py`; fixture finte `tests/fixtures/tesoreria/estratto_principale.xml` e
  `estratto_pos.xml`. Suite completa: 644 verdi.
- Prova sui file reali (senza DB): 4 XML, 6.733 movimenti, 0 discrepanze di saldo, **1 solo "Da
  classificare"** (storno F23 11,05 €), giroconti 66 movimenti a somma 0, affitti 23 (tutti veri).
- Versione: nessun bump finché il modulo non è visibile; la Fase 1 chiuderà con **4.0.0**.

### Blocco B — fatto (28/10/2026)
Router `routers/tesoreria.py` (aggregatore, prefix `/tesoreria`) + `tesoreria_shared.py` (permessi
`puo_vedere`/`puo_modificare`/`puo_importare` = `richiedi_permesso('tesoreria', …)`, `storage_dir()`
da env `TESORERIA_DIR`, `regole_attive()`, `categoria_automatica()`, `ricalcola_categorie()`,
`movimento_json()`), `tesoreria_import.py`, `tesoreria_movimenti.py`, `tesoreria_config.py`.
- **Import** (`puo_importare`): `POST /import/anteprima` (multipart `file`; conto dall'IBAN, 400 se
  IBAN sconosciuto o conto senza `ha_import`; nuovi/già presenti per impronta, `saldi_cambiati`,
  `discrepanze` = `verifica_saldi()` sul conto **intero** come sarà dopo l'import, `per_categoria`
  dei nuovi, `gia_importato` per sha256; file in `{dir}/_anteprima/{token}/` 24h), `POST
  /import/conferma` (`{token, note?}`; 409 stesso file sullo stesso conto; inserisce solo i nuovi,
  scrive i saldi del file — **la banca prevale anche su un saldo manuale** della stessa data —;
  file in `{dir}/banca/{anno}/{id}_{nome}`), `GET /import` (`n_collegati` = movimenti che
  sparirebbero), `GET /import/{id}/file`, `DELETE /import/{id}?conferma=true` (movimenti con
  quell'`import_id` = inseriti per primi da lui, saldi con quell'`import_id`, file).
  ⚠️ Eliminando un import si perdono anche i movimenti che un import successivo conteneva ma aveva
  trovato già presenti (non vengono "riassegnati"): ricaricare il file successivo per riaverli.
- **Movimenti**: `GET /movimenti` (conto, date, categoria — `da_classificare` include i NULL —,
  segno, `q` su descrizione/controparte/note/importo, solo_manuali, straordinario, ordinamento in
  whitelist, paginazione, totali entrate/uscite/netto), `PUT /movimenti/{id}` (`categoria_id` →
  manuale; `automatica: true` → torna alle regole; `straordinario`; `note`), `GET
  /movimenti/{id}/proposta-regola` (controparte "inizia" se c'è, altrimenti prime 3 parole della
  descrizione; segno del movimento; priorità = regola che oggi lo classifica − 1). `filtra_movimenti()`
  riusabile dal Drawer del consuntivo.
- **Config** (`puo_modificare` in scrittura): conti (`GET` con `ultimo_saldo`, `POST`, `PUT`; IBAN
  obbligatorio se `ha_import`, codice/IBAN univoci; nessuna cancellazione, solo `attivo`), saldi
  (`GET`, `POST` upsert manuale — 409 se per quella data c'è il saldo da estratto —, `DELETE` solo
  manuali), categorie (CRUD; `da_classificare` protetta; elimina solo se non usata, altrimenti
  disattivare; categoria disattivata = sue regole ignorate), regole (CRUD con `ricalcola: true`
  facoltativo, `POST /regole/prova` = effetto senza salvare: corrispondenti, quanti cambierebbero e da
  quali categorie, esempi), `POST /ricalcola`. Le categorie manuali non cambiano mai.
- `corrisponde()` del classificatore ora pubblica (usata da proposta e prova regola).
- `verifica_saldi()` riscritta in un solo passaggio sui movimenti (prima O(saldi × movimenti)).
- Test `test_tesoreria_api.py` (24): import/antiduplicato/sovrapposizione/discrepanze/eliminazione,
  movimenti, config, permessi (viewer 403, abilitato in sola lettura, override per utente, modulo
  disattivato). Suite completa: 668 verdi.
- Prova sui 4 XML reali via endpoint (DB di test, svuotato dopo): 6.733 movimenti, 641 saldi,
  0 discrepanze, reimport rifiutato, ricalcolo 0 cambi, 1 da classificare; anteprima+conferma del
  file più grande (3.349 mov.) < 2,5 s ciascuna.
- ⚠️ Cartella `uploads/tesoreria` con ACL per `hotelos` (comandi dati all'utente il 28/10/2026, come
  `uploads/usali_contabile`): senza, la conferma import fallisce con PermissionError.

### Blocco C — fatto (28/10/2026)
`routers/tesoreria_report.py` + calcoli puri in `services/tesoreria_report.py` (`stato_fido()`,
`anno_prima()` — 29/02 → 28/02 —, `mesi_tra()`, `aggrega()`, `valida_soglie()`).
- **Soglie avvisi** in `app_config['tesoreria_soglie_avvisi']` (JSON, creato al primo salvataggio;
  default `giorni_estratto` 7, `giorni_saldo_carta` 35, `giorni_preavviso_fido` 60, interi 1–365):
  `GET|PUT /tesoreria/soglie` (PUT parziale).
- **`GET /tesoreria/posizione?giorno=`** (default oggi, solo conti attivi): conti bancari =
  `saldo_a_data()`; carte/prepagata = ultimo saldo manuale ≤ giorno (nessun movimento); tipo `cassa`
  sommato ai contanti. Voci: saldo banche, contanti (= Cassa reale + conti cassa, con data e mese di
  riferimento), prepagate, carte da addebitare (negativo), liquidità netta, fidi conteggiati,
  disponibilità con fido. Fido conteggiato **fino al giorno di scadenza compreso**. Avvisi ordinati
  rosso → arancione → info: estratto (età dell'**ultimo caricamento**, `created_at` dell'import, non
  la data dell'ultimo movimento — il conto POS fuori stagione resta settimane senza movimenti e
  l'XML non ha giorni senza movimenti), discrepanze `verifica_saldi()` (rosso), saldo manuale
  carte/prepagate vecchio o mancante, fido in scadenza/scaduto, contanti non disponibili, movimenti
  da classificare (info).
- **Contanti**: `_contanti()` chiama `riepilogo_cassa(anno, is_test=False, db, _=None)` di
  `corrispettivi_cassa.py` (anno corrente; se non ha né mesi né saldo iniziale dell'anno, l'anno
  prima); data di riferimento = fine dell'ultimo mese con dati (o oggi se è il mese in corso).
  Sul DB reale al 28/10/2026: 24.471,89 € a settembre 2026.
- **`GET /tesoreria/consuntivo?data_da&data_a&conto_id`** (solo conti `tipo='conto'`; senza
  `conto_id` tutti gli attivi): KPI entrate/uscite/netto operativo/non operativi/saldo inizio (fine
  del giorno prima)/saldo fine, ognuno con anno precedente e Δ/Δ%; tabella per categoria (operative
  prima, poi non operative); mensile del netto operativo con anno precedente; `giroconti_esclusi`
  (solo con tutti i conti, categoria codice `giroconti`); `quadratura` (variazione saldi = netto
  operativo + non operativi + giroconti esclusi); `ap_completo` (primo saldo noto ≤ inizio del
  periodo dell'anno prima: il primo saldo è la chiusura del giorno prima del primo movimento).
- Test: `test_tesoreria_report.py` (puri, 10) + 10 in `test_tesoreria_api.py`. Suite: 688 verdi.
- Prova sui 4 XML reali (DB di test, svuotato): 01/01–28/10/2026 tutti i conti → entrate
  1.927.246 €, uscite −1.821.524 €, netto operativo +105.722 € (2025: +119.313 €), non operativi
  +140.000 € (mutuo), giroconti 32 movimenti a somma 0, **quadratura ok**; conto principale da solo
  quadra anche lui (giroconti +969.000 € tra i non operativi). Saldo banche al 28/10: 354.715,59 €.
  Da verificare con l'utente: tassa di soggiorno 2025 solo 7.490 € (2026: 39.944 €) e compensi
  marchio 2026 a zero (2025: 44.247 €) — regole o tempi di pagamento?

### Blocco D — fatto (28/10/2026, v4.0.0)
- `pages/Tesoreria.jsx` (tab in `localStorage('tesoreria_tab')`): **Posizione** (`TabPosizione`:
  avvisi come `Messaggio` rosso/arancione/info, KPI, dettaglio per conto, selettore "situazione al";
  link "vedi" dai movimenti da classificare → tab Movimenti filtrata), **Consuntivo**
  (`TabConsuntivo`: periodo con scorciatoie Mese precedente / **Da inizio anno = default** / Anno
  precedente, conto in `localStorage('tesoreria_consuntivo_conto')`, KPI con confronto anno prima,
  grafico mensile barre + anno precedente `STILE_CONFRONTO` stesso colore, tabella operative →
  subtotale → non operative, clic categoria → `Drawer` movimenti; avvisi se quadratura non torna o
  anno precedente parziale), **Movimenti** (`TabMovimenti`: ricerca con debounce 400ms, filtri,
  `ThOrdinabile`, categoria modificabile in riga → manuale con `ui-riga-modificata` (dalla v4.4.3 con
  conferma `useConferma` prima del salvataggio, contro i cambi accidentali dalla tendina), modale
  Dettagli con note/straordinario/"Torna alla categoria automatica"/"Crea regola"), **Import e
  saldi** (`TabImport`: `DropZone` .xml → modale anteprima → conferma, storico con Scarica/Elimina,
  saldi manuali di carte/prepagate).
- Nessun `pastReferenceArea` nel grafico del consuntivo: è tutto passato (servirà alla previsione).
- `pages/tesoreria/helpers.jsx`: `permessiTesoreria()` (admin = tutto, altrimenti
  `moduli_permessi` del login), `isoLocale()`/`oggiISO()` (mai `toISOString`), `Importo`,
  `BadgeCategoria`, `useAnagrafiche()`, `SelectCategoria`, **`ModaleRegola`** (condiviso con Admin:
  prova sui movimenti reali + salva con ricalcolo).
- Admin gruppo "Tesoreria" (`pages/admin/AdminTesoreria.jsx`): conti (righe con bozza + Salva,
  ambra se non salvate), categorie (colore swatch + hex), regole (cerca, attiva/disattiva con
  ricalcolo, modifica, elimina, "Ricalcola tutti i movimenti"), soglie.
- NavBar: prefisso `/tesoreria` in `rilevaModuloAttivo()`, `tesoreria` tra i moduli senza subnav.
- Migrazione `tes002_2026`: `modules.attivo = true` (permessi invariati: viewer niente).
- Nessun componente nuovo in `components/ui` (Libreria UI invariata).
- ⚠️ Dopo il deploy serve il riavvio del backend (endpoint nuovi) e `npm run build` (fatto).

### Scheda KPI (28/10/2026, v4.4.0)
Indici scelti dall'utente tra quelli proposti: 1, 2, 3, 6, 8, 10 (tutti calcolabili in Fase 1).
`GET /tesoreria/kpi?anno=` (`routers/tesoreria_kpi.py`, tab "KPI" → `TabKpi.jsx`, `NavAnno`, default anno
corrente); calcoli puri in `services/tesoreria_report.py` (`serie_saldi`, `minimo_serie`,
`inverno_di_riferimento`, `mesi_di_autonomia`).
1. **Andamento del saldo**: somma dei conti correnti a fine giornata dal 1/1 a oggi (o 31/12), anno vs anno
   prima (stesso giorno; 29/02 saltato). Saldo tenuto fino al saldo noto successivo; prima del primo
   saldo un conto vale 0 se è nato a zero (POS aperto il 14/04/2025), altrimenti il giorno è mancante.
   Eccezione voluta a `STILE_CONFRONTO` (richiesta dell'utente, v4.4.1): l'anno precedente ha un **colore
   diverso** (`coloreSerie(1)`), sempre tratteggiato, invece dello stesso colore semitrasparente.
2. **Punto più basso** (anno, anno prima stesso periodo, anno prima intero) e **uso del fido** per conto con
   fido: saldo minimo, giorni sotto zero, utilizzo massimo in € e % del fido.
3. **Mesi di autonomia** = liquidità netta di oggi (`posizione()`) / consumo medio mensile = −media del
   netto operativo mensile dell'ultimo inverno completo (1/10–30/4, `consuntivo()`); data di esaurimento
   stimata. Stima dallo storico: in Fase 3 la sostituisce il saldo previsto mese per mese.
6. **Costo degli incassi**: commissioni POS (codici ABI `16//60` PagoBancomat, `16//63` circuiti
   internazionali) / incassi POS netti (categoria `incassi_pos`); costi bancari (categoria `banca`) /
   entrate operative. Anno vs stesso periodo anno prima.
8. **Peso delle uscite sugli incassi**: uscite di ogni categoria operativa di tipo uscita/neutra (non le
   categorie di entrata, che hanno solo storni) / entrate operative, anno vs anno prima, Δ in punti.
10. **Tassa di soggiorno, per trimestre** (v4.4.2, `tassa_per_trimestre()`): incassata per mese da
   `report_fatturati()` di Corrispettivi (tassa_soggiorno per struttura, **documenti annullati esclusi**);
   versata = categoria `tassa_soggiorno`, ogni versamento vale per il **trimestre precedente** a quello del
   bonifico (gen–mar dell'anno dopo → 4° trimestre). Stato: aperto / versato / da versare / nessuna.
   **Da versare** = incassato dei trimestri aperti o finiti senza versamento; **scarto** = incassato −
   versato dei trimestri versati: NON è un debito (l'utente conferma di aver versato tutto). Cause:
   documenti alla data di check-out vs presenze dichiarate al Comune, esenzioni, rettifiche. Prima
   versione (v4.4.0) con `report_totali()` contava anche gli annullati (~219 €) e mostrava lo scarto come
   "da versare". Al 28/10/2026: da versare 0, scarto 614,60 € (2° trim. 29 €, 3° trim. 585,60 €; per
   hotel il più alto è International). ⚠️ Correzione a una lettura precedente: il versamento del
   15/10/2026 (30.030,50 €, causali troncate dalla banca a "IMPOSTA DI SOGGIORNO LUGL") copre
   **luglio–settembre** (incassati 30.673,50 €): il Comune si paga a trimestre (aprile–giugno a luglio,
   luglio–settembre a ottobre). Al 28/10/2026 restano ~834 € di differenza, non agosto e settembre.
   Corrispettivi solo dall'aprile 2026: per il 2025 la sezione è vuota. In Fase 3 il calendario fiscale
   userà la stessa regola trimestrale per le scadenze della tassa di soggiorno.
Dati reali 2026 al 28/10: minimo −26.105 € il 30/04/2026 (2025: +17.313 € il 22/04); fido POS usato fino
al 30% (39.574 €, 53 giorni sotto zero; 2025: 0,6%); autonomia 5,2 mesi (consumo inverno 25/26
72.651 €/mese); commissioni POS 0,98% (2025: 0,94%); affitti 25,4% delle entrate (2025: 19,7%).
**KPI rimandati alle loro fasi** (proposti, non ancora scelti): debito verso i fornitori e tempi medi di
pagamento → Fase 2; cassa libera (saldo − impegni a 90 giorni) e debito residuo del mutuo → Fase 3;
caparre già incassate per la stagione successiva e precisione delle previsioni → Fase 4. Non scelti per
ora: uso del fido come indice a sé, incassi per canale, incassato vs fatturato, primi 10 fornitori.

### Controparte e causale separate (28/10/2026, v4.3.0)
Richiesta dell'utente: in Movimenti "Controparte" = solo il titolare dell'altro conto, "Descrizione" =
solo la causale. Prima la controparte veniva dalla prima riga del testo, dove la banca incolla il nome
(troncato a 24 caratteri) alla causale ("BAGNI PEPPO SNC DI DELLAsaldo FT 10").
- `controparte_e_causale(descrizione, nome_banca, causale_abi, importo)` in `tesoreria_parser.py`:
  voci con etichetta del testo (`campi_etichettati()`: "Nominativo beneficiario"/"Causale" per i
  bonifici in uscita, "Ragione sociale ordinante"/"Descrizione aggiuntiva del movimento" per le
  entrate) e campo nome della banca `RltdPties/*/Nm` **con gli spazi originali**, a colonne fisse:
  bonifici in uscita/giroconti/stipendi (`26//11 26//10 39//11 34//00`) nome nei primi 24 caratteri;
  SDD (`31//22 31//21`) [documento 36][creditore 31][riferimento] o, senza documento,
  [creditore 31][riferimento]; Ri.Ba. (`31//48`) [riferimento 22][scadenza 9][creditore 24][indirizzo];
  esteri "ORD.:/BEN.: nome  causale"; istantanei "BEN nome+causale" attaccati (resta tutto in
  controparte). Carte, ricariche, storni della banca e ogni codice non di bonifico: nessuna controparte,
  causale = testo prima di "Info aggiuntive". Sul 2025–2026: 4.456 con nome, 2.277 senza, 3 imprecisi
  (ITALCAMEL, senza ragione sociale nel file).
- Colonna `tesoreria_movimenti.causale` (`tes004_2026`). `descrizione` resta il testo completo: regole,
  ricerca (cerca anche nella causale), "Testo completo della banca" in Dettagli e nell'export xlsx/csv.
- `riprocessa_movimenti()` + `POST /tesoreria/import/riprocessa` (pulsante "Rileggi i file originali"
  in Import e saldi): rilegge i file XML conservati, aggiorna controparte/causale per conto + impronta,
  poi `ricalcola_categorie()`. Usarlo quando si migliora la lettura dei testi: niente reimport.
  Eseguito sul DB reale il 28/10/2026: 6.693 aggiornati, **0 categorie cambiate** (verificato anche
  prima, confrontando le categorie dell'import con il nuovo parser con quelle del DB reale).
- Frontend: `causaleDi(m)` in `helpers.jsx` (causale, se manca il testo completo).

### Export Movimenti e Consuntivo (28/10/2026, v4.2.0)
`GET /tesoreria/movimenti/export` (stessi filtri e ordinamento dell'elenco, tutte le righe, max 50.000;
nel pdf descrizioni troncate a 90 caratteri) e `GET /tesoreria/consuntivo/export` (chiama
`consuntivo()`: categorie operative → TOTALE OPERATIVO → non operative, RIEPILOGO dei KPI con anno
precedente e Δ, netto operativo per mese), `formato=xlsx|csv|pdf`, con `ExportMenu` nelle due schede.
Celle con `cella_importo()`/`cella_data()` di `tesoreria_shared.py`: numeri veri nell'xlsx, "1234,56"
nel csv (Excel italiano lo legge come numero), "1.234,56" nel pdf; date gg/mm/aaaa.
PDF (v4.2.1): il primo export usciva tagliato a destra (A4 verticale, colonne larghe quanto il testo).
`_pdf_tabella()`/`_risposta_tabella()` di Corrispettivi hanno ora i parametri facoltativi
`larghezze_pdf` (pesi relativi → A4 **orizzontale**, colonne in proporzione, testo che va a capo nella
cella) e `numeriche_pdf` (indici allineati a destra); senza, comportamento storico invariato (export
Corrispettivi penali/tipo incasso/totali non toccati). Pesi in `LARGHEZZE_PDF` di
`tesoreria_movimenti.py` e nell'export del consuntivo; descrizione troncata a 200 caratteri.

### Carte di credito: azzeramento automatico (28/10/2026, v4.1.0)
Scelta dell'utente: ogni mese si inserisce **solo il totale dell'estratto** di ogni carta (AMEX
«Importo dovuto», data di chiusura il 6; BCC «Saldo attuale», chiusura il 28) come saldo manuale.
Nella Posizione (`stato_carta()` in `services/tesoreria_report.py`, candidati da
`_addebiti_candidati()`) la carta conta quell'importo finché in un conto bancario non compare
un'uscita **di pari importo**, **dopo** la chiusura ed entro `FINESTRA_ADDEBITO_CARTA` = 45 giorni,
con `tesoreria_conti.testo_addebito` nella descrizione (migrazione `tes003_2026`: AMEX "AMERICAN
EXPRESS", CARTA_BCC "Carta del Credito Cooperativo"; vuoto = solo importo); poi vale zero. Risposta per
conto: `carta_stato` (`da_addebitare`/`addebitato`/`nessun_debito`), `carta_importo_estratto`,
`carta_data_addebito`. Avviso dopo `giorni_saldo_carta`: "non risulta ancora addebitato" o "inserire
l'estratto successivo". Verificato sul 2026: tutti i 20 addebiti AMEX/BCC riconosciuti dal testo
(giorno di addebito variabile: 25–30); le ricariche TASCA ("Ricarica carta prepagata TASCA") no.
Limite accettato: le spese dopo la chiusura entrano solo con l'estratto successivo.
**Prepagata TASCA: resta manuale** (decisione dell'utente, 28/10/2026): saldo = disponibilità letta
dall'app o dalla lista movimenti, aggiornata ogni tanto (promemoria dopo `giorni_saldo_carta`). Le
ricariche dal conto principale ("Ricarica carta prepagata TASCA", 500–1.000 €) **non** vengono sommate
in automatico alla disponibilità: le spese con la carta non sono note, il valore sarebbe gonfiato.
Effetto accettato: per qualche giorno dopo una ricarica la liquidità risulta più bassa del vero.

### Fase 2 — decisioni (29/10/2026)
Roadmap: A tabelle + lettore scadenzario Passcom → B import a fotografie (anteprima/conferma, confronto con la
precedente) → C abbinamento con la banca (salvato, incerti da confermare, alias codice fornitore Passcom ↔ nome
in banca imparato dalle conferme) → D scheda Scadenzario (per settimana, stati, per fornitore, "da segnalare allo
studio"), KPI debito fornitori e tempi medi di pagamento, v4.5.0. Scelte dell'utente:
1. **Pareggi**: aperto calcolato **per fornitore al netto dei `*PAREGGIO*`**; saldo fornitore ≤ 0 → nulla da pagare.
2. **Residui vecchi** (partite 2011–2024): riquadro a parte "da verificare con lo studio", fuori dalla vista settimanale.
3. Solo il file **"da pagare"**; quello delle pagate (stato P) in Fase 4.
4. **Segna come pagata a mano**, anche con **selezione multipla** (contanti, carta, altro non visibile in banca);
   persistente tra una fotografia e l'altra (legata alla chiave della scadenza, non alla riga importata).
5. Tempi medi di pagamento dagli abbinamenti con la banca (data fattura → pagamento effettivo).
6. **La modalità di pagamento di Passcom è solo indicativa**: l'abbinamento cerca prima con la regola della
   modalità indicata, poi anche con gli altri canali (bonifico/SDD/Ri.Ba.) — es. fattura "CONTANTI" pagata con
   bonifico → proposta come abbinamento incerto da confermare, con nota "modalità diversa da quella in Passcom".
Formato verificato sul file reale: dettaglio = colonne 5–15 (`ss:Index`), importi con **punto** decimale
("-150.00"), NR già negative nel file, gruppo `1='Data Scadenza'`/`2=gg/mm/aaaa`, intestazione con
"Data di Stampa" (default della data fotografia), righe di sola colonna 4 (frammenti di ragione sociale) da
ignorare, `DESCRIZIONE TESTATA` anche con colonna 4. Chiave conto+protocollo+scadenza+importo: 0 duplicati su
1.285 righe (i pareggi non hanno protocollo).

### Fase 2 — Blocco A fatto (29/10/2026)
- Modelli `TesoreriaScadImport` (`tesoreria_scad_import`: data_fotografia, data_stampa, file, sha256, totale,
  scadenza_da/a, avvisi) e `TesoreriaScadenza` (`tesoreria_scadenze`, `import_id` CASCADE, UNIQUE
  import+`chiave`, indici su chiave e codice fornitore; `registro` = colonna 7, registro IVA 1 Italia/8 estero).
  Migrazione `tes005_2026` (solo tabelle), applicata al DB reale (verificati downgrade e nuovo upgrade).
- `services/tesoreria_passcom_parser.py` → `parse_scadenzario(bytes)`: errori bloccanti
  (`ErroreImportTesoreria`, stesso tipo del parser banca) su non-XML, foglio `-Scaddoc` assente, riga
  `Totale` assente, totale ≠ somma (±0,01), riga di dettaglio prima di una "Data Scadenza", file delle rate
  pagate (colonna 3/4 valorizzata). Ignorate le righe di sola colonna 4, la colonna 4 delle descrizioni,
  "Fine Stampa" e le intestazioni; altre righe sconosciute → avviso. `chiave` con suffisso `#n` per
  righe identiche nello stesso file (pareggi senza protocollo).
- Test `test_tesoreria_passcom_parser.py` (10) con fixture finta `tests/fixtures/tesoreria/scadenzario_da_pagare.xml`
  (windows-1252, nota di credito, registro 8, pareggi doppi, descrizione con a capo). Suite: 729 verdi.
- Prova sul file reale del 28/10 (senza DB): 1.285 scadenze, totale 110.590,39 ✓, nessun avviso, chiavi
  univoche, file "pagate" rifiutato. 76 fornitori, 22 con saldo ≤ 0 (pareggi); aperto netto dei fornitori a
  saldo positivo 121.597,46 €.

### Fase 2 — Blocco B fatto (29/10/2026)
- `routers/tesoreria_scadenzario.py` (incluso da `tesoreria.py`, permessi del modulo): `POST
  /scadenzario/anteprima` (multipart `file` + `data_fotografia` facoltativa, default = Data di Stampa del
  file; riepilogo, confronto, `sostituisce`, `gia_importato`; nessuna scrittura), `POST /scadenzario/conferma`
  (`{token, data_fotografia?, sostituisci?, note?}`; 409 stesso file già importato; 409 se esiste già un
  import con stessa data **e** stesso anno contabile e manca `sostituisci: true` — scelta dell'utente: il
  file riscaricato lo stesso giorno sostituisce il precedente, previa conferma; i sostituiti si cancellano
  con scadenze e file), `GET /scadenzario/import`, `GET /scadenzario/import/{id}/file`,
  `DELETE /scadenzario/import/{id}?conferma=true`. Token nella stessa area `_anteprima` degli estratti
  conto (helper riusati da `tesoreria_import.py`), `meta.tipo = 'scadenzario'`. File in
  `{TESORERIA_DIR}/scadenzario/{anno fotografia}/{id}_{nome}`.
- **Anno contabile** = anno dell'ultima data di registrazione del file (`anno_contabile()`), colonna
  `tesoreria_scad_import.anno_contabile` (migrazione `tes006_2026`, applicata al DB reale). Il confronto
  avviene con l'ultimo import **dello stesso anno contabile** con data anteriore: nuove / chiuse in
  contabilità (per `chiave`), max 200 righe di dettaglio per lista.
- Calcoli puri `services/tesoreria_scadenzario.py`: `per_fornitore()` (fatture, pareggi, netto, aperto =
  max(netto, 0), residui), `riepilogo()`, `confronta()`, `unisci_fotografia()` (più file della stessa data
  senza doppioni di chiave — per il blocco D), `limite_residui()` = 1° gennaio dell'anno precedente.
- Test `test_tesoreria_scadenzario_api.py` (13). Suite: 742 verdi.
- Prova sul file reale (DB di test, svuotato): anteprima 0,5 s, conferma 0,3 s; 1.285 scadenze, aperto
  121.597,46 €, 22 fornitori saldati, **80 residui** (scadenze prima del 2025) per 4.525,34 €; primi per aperto
  MARR 29.861 €, CIL 23.321 €, SGR 12.085 €. Reimport dello stesso file riconosciuto.
- ⚠️ Endpoint nuovi: serve il riavvio del backend prima di usarli (frontend nel blocco D).

### Fase 2 — Blocco C fatto (29/10/2026)
- Motore puro `services/tesoreria_abbinamento.py::abbina(scadenze, movimenti, alias, scartati)` → `Proposta`
  (chiavi, movimenti, stato `automatico`|`proposto`, regola, nota). Canali per codice ABI: Ri.Ba. `31//48`
  (gruppo fornitore+data scadenza ±3 gg: somma di tutti gli addebiti = somma del gruppo, poi 1:1, poi un
  sottoinsieme ≤ 6 addebiti → proposto), SDD `31//22`/`31//21` (±7), bonifico `26//11`/`26//10`/`26//31` (±15,
  e "bonifico_somma" per più fatture con il numero citato nella causale), assegno `13//00` (nessun nome:
  sempre proposto, solo se l'importo è univoco). Altra modalità rispetto a Passcom: finestra −30/+45 gg,
  sempre proposto con nota. **Importi 1:1 al centesimo esatto** (un caso reale 200,02 vs 200,03 era un
  falso abbinamento); ±0,01 solo sulle somme. Nome: `parole()` (maiuscolo, senza accenti, sigle puntate
  unite 'C.I.L'→'CIL', senza forme societarie), `forza_nome()` 2/1/0 (alias imparato, tutte o ≥ 2 parole in
  comune, troncamenti ≥ 4 lettere). Nome diverso (TheFork / La Fourchette) con la modalità indicata e un
  solo pagamento compatibile → proposto. Automatico solo con modalità indicata + nome forte (o numero
  fattura citato) + un solo candidato.
- Tabelle (`tes007_2026`, applicata al DB reale): `tesoreria_abbinamenti` (stato, regola, nota, fornitore),
  `tesoreria_abbinamento_scadenze` (chiave + dati copiati: restano quando la scadenza sparisce dalle
  fotografie, servono ai tempi di pagamento), `tesoreria_abbinamento_movimenti` (FK movimento CASCADE),
  `tesoreria_pagate_manuali` (chiave UNIQUE, data pagamento, nota, dati copiati), `tesoreria_fornitori_banca`
  (codice fornitore ↔ nome in banca normalizzato, imparato alla conferma se il nome non era già riconosciuto).
- `routers/tesoreria_abbinamenti.py`: `fotografia_corrente()` (per anno contabile l'import più recente,
  uniti), `ricalcola_abbinamenti(db)` (cancella automatici/proposti e quelli rimasti senza movimenti, esclude
  confermati, pagate a mano, coppie scartate, pareggi, fornitori saldati, residui; note di credito incluse
  nelle somme Ri.Ba.) chiamata da conferma/eliminazione di scadenzario **ed estratti conto**. Endpoint:
  `GET /scadenzario/abbinamenti?stato=&codice_fornitore=` (con conteggi), `POST …/ricalcola`, `POST
  …/conferma` e `…/scarta` (`{ids}`), `DELETE …/abbinamenti/{id}` (annulla una scelta + ricalcolo), `POST
  …/abbinamenti/manuale` (`{chiavi, movimenti, nota}` → confermato, regola 'manuale'), `GET
  /scadenzario/movimenti-candidati?chiave=` (±90 gg, per nome/importo/data), `GET|POST /scadenzario/pagate-manuali`
  (`{chiavi, data_pagamento?, nota?}`, selezione multipla), `POST /scadenzario/pagate-manuali/rimuovi`.
  Scrittura con `puo_modificare`.
- Test: `test_tesoreria_abbinamento.py` (12, puri) + 7 in `test_tesoreria_scadenzario_api.py`. Suite: 761 verdi.
- **Prova sui dati reali** (4 XML banca + scadenzario 28/10, DB di test, svuotato; ricalcolo 0,7 s): 721
  scadenze abbinate in automatico per 92.610 € (MARR luglio/agosto/settembre: 717 fatture, 87.360 €, con le
  Ri.Ba. di fine mese; IGEA Ri.Ba. 30/09/2025, Nuova Ascom, Comune di Gabicce, Castellana), 3 da confermare
  (TheFork, assegni Sogeal 1.350 € e Masini 1.000 €).
  ⚠️ **Lettura corretta nel blocco D**: quei pagamenti MARR lo studio li ha **già registrati come pareggi**
  (non collegati alle fatture, per questo le fatture restano aperte nello scadenzario): non sono da
  segnalare. Vedi `compensa_pareggi()` sotto: al netto dei pareggi restano da segnalare solo ~2.839 €.

### Fase 2 — Blocco D fatto (29/10/2026, v4.5.0) — Fase 2 chiusa
- **Pareggi distribuiti per fornitore** (`services/tesoreria_scadenzario.compensa_pareggi`): il credito dei
  `*PAREGGIO*` (+ note di credito aperte) copre **prima le scadenze già pagate** (in banca o a mano: lo studio
  ha registrato il pagamento come pareggio → non vanno segnalate), poi le aperte dalla più vecchia. Ogni riga
  riceve `compensato`, `aperto` (da pagare), `da_segnalare` (pagata ma non registrata); coperta per intero →
  stato `compensata` (`stato_originale` conservato). Le note di credito dentro una Ri.Ba. pagata hanno
  `da_segnalare` negativo (il totale torna con l'addebito). Sostituisce il vecchio stato "saldata".
  Scoperto sui dati reali: senza questa regola risultavano 87.360 € MARR "da segnalare" già registrati.
- `routers/tesoreria_scadenzario_report.py`: `stato_scadenze(db, oggi)` (stato per riga: pareggio,
  pagata_banca, pagata_manuale, da_confermare, residuo, scaduta, aperta → poi compensata; totali da_pagare /
  scaduto / in_scadenza 30 gg / da_segnalare / da_confermare / residui / compensate, sempre sulle quote
  `aperto`/`da_segnalare`; riepilogo per fornitore), `tempi_pagamento(db, da, a)` (giorni fattura → pagamento
  in banca e rispetto alla scadenza, medie pesate sull'importo, dagli abbinamenti automatici/confermati).
  Endpoint `GET /scadenzario/stato`, `GET /scadenzario/fornitore/{codice}` (scadenze, pagamenti in banca con
  nome simile o imparato negli ultimi 18 mesi, totali mensili, abbinamenti), `GET
  /scadenzario/da-segnalare/export?formato=xlsx|csv|pdf` (solo fornitori con quota da segnalare > 0).
- KPI (`tesoreria_kpi.py`, blocco `fornitori`): debito verso i fornitori (= da pagare), scaduto, da
  segnalare, tempo medio di pagamento dell'anno vs anno precedente, primi 10 fornitori per importo.
- Frontend: scheda **Scadenzario** (`pages/tesoreria/TabScadenzario.jsx`, tra Movimenti e Import; vista in
  `localStorage('tesoreria_scadenzario_vista')`): KPI in alto, viste Per settimana (lun–dom, scadute in un
  blocco a parte, filtro Da pagare/Tutte, selezione multipla → "Segna pagate"), Da confermare (proposti,
  automatici, confermati, scartati; conferma/scarta anche multipli, "Annulla la scelta"), Da segnalare allo
  studio (`ExportMenu`), Per fornitore (→ `Drawer` dettaglio: scadenze selezionabili, "Abbina a un
  pagamento" con candidati, "Segna pagate", "Togli pagata a mano", pagamenti in banca, abbinamenti), Residui.
  Pulsante "Ricalcola abbinamenti". In **Import e saldi** la card "Scadenzario fornitori (Passcom)": DropZone,
  anteprima con data della fotografia modificabile (rifà l'anteprima), confronto con la precedente, conferma
  della sostituzione dello stesso giorno con `useConferma`, storico con Scarica/Elimina. KPI: card Fornitori.
- Test: 5 nuovi in `test_tesoreria_scadenzario_api.py` (stato, dettaglio, export, tempi, pareggi). Suite: 766 verdi.
- **Dati reali** (DB di test, svuotato): stato 0,17 s; da pagare 111.677 € (299 scadenze, 81.310 € entro 30
  giorni), **scaduto 16.774 €** (41: Google Ireland 2.751 €, Bagni Peppo 4.270 €, Vesti il lavoro, Ortofrutta,
  Sky, CHS, Zucchetti…), da segnalare 2.839 € (Nuova Ascom, Comune di Gabicce, Castellana), 3 da confermare,
  residui 4.998 €, 890 scadenze chiuse da pareggi. Tempo medio di pagamento 2026: 61,5 giorni dalla fattura,
  0,1 giorni dopo la scadenza (MARR 63 giorni: Ri.Ba. a fine mese successivo).
- ⚠️ Dopo il deploy: riavvio del backend (endpoint e tabelle nuove) e `npm run build` (fatto).
- **Note di credito** (v4.5.2, segnalato dall'utente sulla Ri.Ba. MARR del 31/10): prima le note di credito
  aperte finivano nel credito comune con i pareggi, che copre per primo le scadenze già pagate → la Ri.Ba.
  aperta restava al lordo (27.204,63 € invece di 26.892,95 €). E le note già pagate (dentro le Ri.Ba. di
  luglio–settembre, pareggi dello studio già al netto) non chiudevano le loro fatture: i pareggi restavano
  "corti" e la differenza (699,31 €) risultava aperta su giugno. Ora in `compensa_pareggi()` ogni nota di
  credito riduce le fatture **dello stesso stato** (aperta → aperte, pagata → pagate), prima quelle con la
  **stessa data di scadenza**, poi le altre dalla più vecchia; dopo, i pareggi come prima. Una nota pagata
  risulta "chiusa"; il "da segnalare" non ha più quote negative di note già dentro un pagamento.
- **Filtri** (v4.5.1, richiesta dell'utente): in cima alla scheda Scadenzario data di scadenza dal/al,
  modalità di pagamento (dalle modalità presenti nel file) e fornitore (parte del nome, con suggerimenti).
  Lato client (`riassumi()` ricalcola KPI e riepilogo per fornitore sulle sole righe filtrate, stesse quote
  `aperto`/`da_segnalare` del backend); valgono per tutte le viste, "Da confermare" compresa (abbinamenti
  con almeno una scadenza che rientra). L'export "da segnalare" riceve gli stessi filtri
  (`scadenza_da`, `scadenza_a`, `modalita`, `fornitore`). La card "Aperto per Passcom" resta non filtrata.

### Fase 2 — indicazioni già raccolte (28/10/2026)
- **GoProfit resta lo strumento operativo per i pagamenti ai fornitori** (decisione dell'utente):
  scarica le fatture dallo SDI in automatico, quindi è più aggiornato di qualunque fonte di HotelOS
  (Passcom = ritardo dello studio; ZIP AdE = richiesta manuale con fino a 5 giorni di attesa,
  accettabile solo una volta al mese). Flusso attuale dell'utente in GoProfit: lista scadenze →
  filtro non pagate per data → paga dall'home banking → spunta a mano "pagata".
- **Ruolo di HotelOS: controllo incrociato con la banca.** Obiettivo da proporre nella strategia:
  elenchi "segnate non pagate ma con pagamento in banca" e "segnate pagate ma senza pagamento in
  banca", abbinando per fornitore + importo + data. **GoProfit non esporta nulla** (verificato
  dall'utente il 28/10/2026): fonte delle scadenze = **Passcom** (già analizzato, sopra) → il controllo
  confronta le scadenze dello studio con la banca (aperte per lo studio ma pagate in banca = da
  segnalare allo studio; scadute senza pagamento = arretrati veri), non le spunte di GoProfit. Per
  quelle: vista per fornitore con pagamenti e totali mensili (oggi: Movimenti → ricerca per nome).
  Con la Fase 5 (ZIP AdE mensile) anche "fatture ricevute vs pagamenti" per le non ancora registrate.
- Collegamento automatico allo SDI tramite intermediario: escluso per ora (credenziali fiscali).

### Fase 3 — indicazioni già raccolte per il calendario fiscale (28/10/2026)
- **IVA trimestrale** (confermato dall'utente). Scadenze attese: 16/5 (1° trim.), 20/8 (2° trim.),
  16/11 (3° trim.), 4° trimestre con la dichiarazione annuale (16/3), acconto 27/12 — da verificare
  con lo studio nella strategia (anche la maggiorazione dell'1% sui trimestrali).
- L'utente vuole stime migliori di "stesso mese dell'anno prima" prima dei valori dello studio.
  Fonti proposte per tipo di imposta (da presentare nella strategia della Fase 3):
  ritenute e contributi dipendenti → cedolini del modulo Dipendenti del mese prima (anticipa la 4b);
  IVA → vendite da Corrispettivi meno acquisti dalla contabilità (Conto Economico contabile), poi
  dalle fatture XML in Fase 5; IRES/IRAP → utile dell'anno dalla contabilità × aliquote, saldo di
  giugno e acconti giugno/novembre (stima grezza: imponibile ≠ utile); tassa di soggiorno →
  incassata in Corrispettivi; IMU/TARI → anno prima. Valore dello studio = "confermato" (vince).
- Limite: in banca ogni F24 è una cifra unica ("Delega Unificata"), senza ripartizione per tributo.
- Da chiedere allo studio: metodo acconti (40/60 o 50/50 ISA), aliquota IRAP regionale, IRES/IRAP
  2025 dovute e acconti 2026 versati, eventuale IMU.

### Fase 5 — regole per scaricare gli ZIP fatture dall'AdE (30/10/2026)
Decise con l'utente: **mostrarle come istruzioni nella futura sezione di upload** degli ZIP (testo fisso
accanto alla DropZone), così ogni richiesta resta coerente con le precedenti.
- Portale Fatture e Corrispettivi → Consultazione/Richieste → "Richieste di Fatture Elettroniche" →
  Creazione richiesta guidata: **Puntuale**, fatture **Ricevute**, tipo **Tutte**, **tipo data = data di
  ricezione** (mai emissione) → Genera richiesta → **Invia richiesta** ("Download richiesta (xml)" è solo
  il modulo). ZIP pronto in ~1–5 giorni.
- Perché la ricezione: un periodo chiuso non riceve più fatture (con l'emissione le TD24 differite datate
  a fine mese arrivano fino al 15 del mese dopo e sfuggirebbero); è la data che conta per la detrazione
  IVA e quella in cui il debito diventa noto.
- **Una richiesta per trimestre** (il portale limita il periodo, probabilmente a 3 mesi); da qui in poi
  una al mese, il mese **intero**, richiesta dopo la sua fine.
- Storico da scaricare: 01/01/2025 → 30/09/2026 (7 trimestri, come gli estratti conto) + ottobre 2026
  intero a inizio novembre (la prova 01–28/10 resta: i doppioni si scartano per `idfile` SDI, quindi
  l'import deve deduplicare su quello, mai rifiutare un file sovrapposto).
- ZIP caricati così come arrivano, non decompressi (nome suggerito `AAAA-Tn.zip` / `AAAA-MM.zip`);
  il `…_fileInput.xml` accanto è il modulo della richiesta, da ignorare.
- La conservazione sul portale non è illimitata (fonte non ufficiale: fino al 31/12 del secondo anno
  dopo la ricezione): scaricare per tempo.
- **Il portale limita le richieste giornaliere**: lo storico va chiesto in più giorni.
- **Controlli da fare in import** (errori reali del 04/11/2026): un ZIP di fatture **emesse** (cedente
  = Km di Mare, P.IVA 04569190400, nei `_metaDato.xml`) va rifiutato; il nome del file non dice il
  periodo (un "gennaio-marzo-25" conteneva il 2026): mostrare in anteprima il periodo di ricezione
  vero (`dataaccoglienza`). 39 `.p7m` hanno firma non valida ma contenuto leggibile: estrarre con
  `openssl cms -verify -noverify -nosigs -inform DER` (2 sono DER in base64).
- Stato al 05/11/2026 in `uploads/tesoreria_campioni/fatture_xml/`: **storico completo** 01/01/2025 → 29/10/2026,
  8 ZIP (`2025-T1…T4`, `2026-T1…T3`, `2026-10-ott`), **4.707 file**, verificati: nessun `idfile` ripetuto tra ZIP,
  nessuna fattura emessa da Km di Mare, cessionario sempre 04569190400, nessun buco ≥ 7 giorni, tutti i 2.355 `.p7m`
  estratti con openssl e tutti gli XML leggibili. Il confine tra due richieste non è un taglio netto sulla
  `dataaccoglienza` (fatture del 30/06 e 30/09 sera finiscono nel trimestre dopo, a volte alternate tra due ZIP):
  dedup per `idfile`, mai filtrare per data. In 14 casi il file nello ZIP ha il prefisso dell'`idfile`
  (`{idfile}_{nomefile}`, omonimi dello stesso intermediario) mentre il `_metaDato` riporta `nomefile` senza:
  cercare il file come nome del metaDato senza `_metaDato.xml`. Ultima ricezione 29/10 alle 9:28 (30–31/10 vuoti).

### Fase 5 — strategia approvata (05/11/2026)
Blocchi: **A** tabelle (fattura unica per `idfile`, righe IVA per aliquota, scadenze) + lettore ZIP (p7m anche
base64, ZIP annidati, file con prefisso `idfile`, errori per file senza bloccare, rifiuto emesse/cessionario diverso,
XML conservato senza allegati + ZIP originale) → **B** import anteprima/conferma + abbinamento Passcom (numero
normalizzato + data + importo + nome; impara P.IVA ↔ codice fornitore Passcom) e banca (motore Fase 2) → debiti da
registrare in previsione (scadenza XML, altrimenti tempi abituali del fornitore dalle sue fatture); TD16–19 e
fornitori pagati con carta esclusi dai debiti → **C** stima IVA mensile (acquisti XML con la regola del 15 del mese
dopo, vendite da Corrispettivi, credito riportato, collaudo 2025 su VF71 258.352 € e agosto 2026 su 5.281,61 €;
verificare l'effetto delle caparre CP con IVA, escluse dai Corrispettivi) → **D** scheda Fatture, previsione/impegni,
interventi, attività "ZIP fatture AdE" automatica, v4.24.0. Permessi = resto della Tesoreria.
Decisioni dell'utente:
- **"Da registrare"** = assente dallo scadenzario Passcom "da pagare", non pagata in banca e **ricevuta dopo l'ultima
  data di registrazione dello studio − 15 giorni**; le più vecchie senza riscontro in un elenco "da verificare" (una
  tantum). Il file Passcom delle rate pagate non si usa (eventuale aggiunta solo se l'elenco risulta lungo).
- **Fatture emesse fuori da Welcome: rare** (circa 1 nel 2026): IVA vendite solo dai Corrispettivi, niente import
  delle fatture emesse.

### Fase 5 — Blocco A fatto (05/11/2026)
Solo backend, nessuna schermata né cambio di versione.
- Tabelle (`tes017_2026`, dopo `att001_2026`; applicata al DB reale, vuote): `tesoreria_fatture_import` (log, sha256,
  file, conteggi nuove/già presenti/errori, periodo di ricezione, errori e avvisi JSON), `tesoreria_fatture`
  (`impronta` UNIQUE = `SDI:{idfile}` o `H:{sha256}` senza metaDato; `import_id` CASCADE = import che l'ha inserita
  per primo; cedente, tipo, numero, data, data ricezione con fuso, totale come nel file — note di credito positive —,
  imponibile/imposta sommati dai riepiloghi, **`ritenuta`** d'acconto, causale, fatture collegate, n. DDT, XML
  **senza Allegati**), `tesoreria_fatture_iva` (per aliquota/natura, esigibilità), `tesoreria_fatture_scadenze`
  (rate: condizioni, modalità, scadenza, importo, IBAN).
- Lettore puro `services/tesoreria_fatture_parser.py::parse_zip_fatture(bytes, piva_azienda)`: file firmati con
  `openssl cms -verify -noverify -nosigs` (anche in base64), ZIP annidati (max 3 livelli), BOM, file con prefisso
  `idfile`, fatture senza metaDato; un file illeggibile o un lotto con più fatture → `errori`, non blocca; bloccanti:
  non ZIP, nessuna fattura, fatture emesse dall'azienda o intestate ad altri. `PIVA_AZIENDA` = 04569190400.
  `TIPI_AUTOFATTURA` (TD16–23, 26–28) e `TIPI_NOTA_CREDITO` (TD04, TD08) per il blocco B.
- Test `test_tesoreria_fatture_parser.py` (16) con fatture inventate in `tests/fixtures/tesoreria/fatture/`
  (`firmata.xml.p7m` firmata con un certificato di prova). Suite: 949 verdi.
- **Prova sui dati veri** (senza DB): 8 ZIP, 4.707 fatture, 0 errori, nessun doppione tra ZIP, ~36 s in tutto (il
  ZIP più grande 15 s, quasi tutto openssl), 36 MB di XML senza allegati. Tipi: TD24 2.719, TD01 1.480, TD17 356,
  TD04 83, TD18 38, TD06 11, TD16 9, TD19 8, TD02 3. Da sapere per il blocco B:
  - **Da pagare = Σ rate (`ImportoPagamento`)**, non il totale (Σ rate = totale − ritenuta in 3.959 fatture su 3.970
    con rate complete; 11 fatture con ritenuta): nelle parcelle TD06 le rate sono al netto della
    ritenuta (es. 1.268,80 € con rata 1.068,80 €); alcuni fornitori (Sky, Adriagelo) mettono importi diversi dal
    totale (acconti, cauzioni, rate di più documenti).
  - 737 fatture senza dati di pagamento (in gran parte autofatture), 344 rate senza data di scadenza.
  - Amazon Business arrotonda: totale ≠ Σ riepiloghi di qualche centesimo (usare il totale).
  - Nessuna IVA a esigibilità differita o in scissione nei dati reali.

### Fase 5 — Blocco B fatto (05/11/2026)
Solo backend (+ etichetta della colonna nuova in Previsione), nessun cambio di versione. **Serve il riavvio del backend.**
- **Numero in Passcom = ultime 6 cifre del numero della fattura, senza zeri iniziali** (`numero_passcom()`: 'BA046401'
  → '46401', '991/2026' → '912026', '351697231' → '697231'; verificato su 1.107 coppie reali). Fattura nello
  scadenzario = scadenza con stesso numero Passcom + stessa data documento + nome compatibile (`forza_nome` ≥ 1) o
  codice fornitore già noto per quella P.IVA. Trova 1.122 delle 1.143 scadenze Passcom 2025–2026 (le altre: fatture
  estere Meta/Google, nello SDI solo come autofattura); nessun numero ambiguo tra fornitori.
- Tabella `tesoreria_fornitori_piva` (`tes018_2026`, applicata al DB reale): P.IVA ↔ codice Passcom, imparata a ogni
  ricalcolo degli abbinamenti (`aggiorna_fornitori_piva()`), resta anche quando la scadenza esce dalle fotografie.
- Regole pure in `services/tesoreria_fatture.py`; stato in `routers/tesoreria_fatture_stato.py::stato_fatture()`.
  Stati in ordine: `autofattura` (TD16–19…) · `in_scadenzario` · `pagata_banca` · `pagata_manuale` · `pagata_carta`
  (codice in `tesoreria_fornitori_carta`) · `da_confermare` · `da_registrare` (ricevuta ≥ ultima data di registrazione
  dello studio nella fotografia − 15 gg) · `chiusa` (ricevuta prima: non più aperta in Passcom). Senza fotografia:
  tutte chiuse. **Nessuno stato "da verificare"** (scelta dell'utente 05/11/2026, opzione b): la prima versione aveva
  anche le assenti da Passcom senza pagamento ricevute nei 60 gg prima del limite (82 fatture, ~111.000 € sui dati veri),
  quasi tutte già chiuse dallo studio e pagate con carta, contanti o bonifici cumulativi. Rischio accettato: una fattura
  dimenticata dallo studio resta visibile solo finché è "da registrare" (~15 gg), poi diventa "chiusa".
- **Abbinamento con la banca**: le rate delle fatture non in Passcom e ricevute da non più di 60 gg prima del limite
  entrano in `ricalcola_abbinamenti()` insieme alle scadenze Passcom (stesso motore `abbina()`, stesse tabelle, chiave
  `XML:{impronta}#{rata}`, codice fornitore Passcom se noto altrimenti `PIVA:…`). Da pagare = Σ rate del file, altrimenti
  totale − ritenuta; note di credito negative. Senza data di scadenza: data documento + giorni abituali del fornitore
  (mediana dalle sue fatture) o 30, `data_stimata`; senza modalità nel file `tipo_pagamento='NON INDICATA'` → nessun
  canale principale, finestra larga −30/+45 e sempre da confermare (caso reale Campanelli: scadenza stimata 04/11,
  bonifico il 07/10). `_scadenze_correnti()` accetta le chiavi `XML:` → **pagare a mano, abbinare a mano e candidati
  usano gli endpoint dello scadenzario** (`/scadenzario/pagate-manuali`, `/abbinamenti/manuale`, `/movimenti-candidati`).
- **Previsione**: solo `da_registrare` (le "da confermare" hanno già un pagamento probabile in banca), note di credito
  compensate per fornitore (`compensa_note()`, credito avanzato ignorato) → gruppo **`fatture`** "Fatture da registrare",
  categoria per modalità (Ri.Ba. → fornitori_riba, SDD → fornitori_sdd, assegno → assegni, altro → fornitori_bonifici),
  tolta dalla stima dei fornitori.
- Router `routers/tesoreria_fatture.py`: `POST /fatture/anteprima` (multipart `file`; nuove / già presenti per `idfile` /
  doppie per P.IVA + numero + data; ZIP e lettura in pickle nell'area `_anteprima`, la conferma non rilegge lo ZIP),
  `POST /fatture/conferma` (`{token, note}`, 409 stesso sha256; ZIP in `{TESORERIA_DIR}/fatture/{anno}/`; ricalcola gli
  abbinamenti), `GET /fatture/import`, `GET /fatture/import/{id}/file`, `DELETE /fatture/import/{id}?conferma=true`
  (fatture inserite per prime, CASCADE), `GET /fatture` (`stato` anche più valori separati da virgola, `tipo`, `q`,
  `ricevuta_da/a`, ordinamento, paginazione; `conteggi` per stato, `limite_da_registrare`), `GET /fatture/{id}` (righe
  IVA, rate del file, rate da pagare, scadenze Passcom collegate, abbinamenti; `?xml=true`),
  `GET /fatture/da-registrare/export` (solo le da registrare, per lo studio).
- Test `test_tesoreria_fatture_api.py` (13). Suite: 962 verdi.
- **Prova sui dati veri** (DB di test con conti, movimenti, scadenzario 28/10 e abbinamenti copiati dal reale, poi
  svuotato): 8 ZIP importati, anteprima ≤ 15 s, conferma ≤ 2 s, reimport riconosciuto. Con fotografia 28/10 (ultima
  registrazione 24/10, limite 09/10): in scadenzario 1.123, chiuse 2.994, autofatture 411, pagate in banca 65,
  pagate con carta 20, da confermare 11, **da registrare 1** (Comune di Gabicce 366 €, ricevuta il 29/10), le altre
  chiuse. Gli abbinamenti automatici salgono da 6 a 62 (dati utili anche per la Fase 4C).

### Fase 5 — Blocco C fatto (05/11/2026): stima dell'IVA mensile
Solo backend, nessun cambio di versione. **Serve il riavvio del backend** (endpoint `/tesoreria/iva`).
- Calcoli puri `services/tesoreria_iva.py`, dati `routers/tesoreria_iva.py`. Liquidazione = IVA vendite − IVA acquisti
  + credito riportato; versamento il 16 del mese dopo solo se > 25,82 € (sotto: rinviato al mese dopo); a gennaio si
  riparte da zero (il credito annuale è la tranche del calendario, inserita a mano dalla dichiarazione).
  **Vendite** = `report_fatturati()` IVA inclusa − IVA esclusa (scontrini, fatture Welcome, Mare Mosso e Buona Onda;
  caparre CP ed estratti conto ES di Welcome fuori: non sono documenti fiscali — IVA scontrini agosto 2026 61.073 € =
  IVA delle chiusure RT 61.054 €). **Acquisti** = imposta delle fatture SDI per **mese di ricezione**, note di credito
  in meno, autofatture escluse; la regola "entro il 15 del mese dopo → mese prima" torna peggio col versato.
- Mese **completo**: concluso; acquisti con l'ultima fattura ricevuta da 3 giorni prima della fine del mese in poi;
  vendite con incassi se il mese è in stagione (`hotel_seasons`). Anno senza stagioni in Admin (2025) → nessun mese
  completo. La catena del credito si ferma al primo mese incompleto.
- **Calendario (scelta dell'utente, opzione 1)**: `DatiFiscali.iva_dati` = mesi conclusi con dati completi
  (`iva_mesi_conclusi()`), impegno `iva:{anno}-{mm}` solo se a debito, base con vendite/acquisti/credito; **mesi futuri
  come prima** (agosto = ultimo agosto versato, gli altri a credito). Acconto di dicembre non generato (dicembre sempre
  a credito). Le conferme a mano vincono come sempre. `genera_impegni()` chiamato anche dopo import/eliminazione delle
  fatture. Il credito di fine anno stimato è solo informativo (tranche invariate).
- `GET /tesoreria/iva?anno=` → per mese vendite, acquisti, credito precedente, saldo, versamento stimato, scadenza,
  versato (agosto da `iva_agosto`, altri dagli impegni pagati o confermati) e scarto; `credito_fine_anno`.
- **Collaudo**: 2026 gennaio–luglio a credito ✓, agosto 7.811 € contro 5.281,61 € versati (+2.530), settembre e
  ottobre a credito ✓. Metodo "ultimo versato" su agosto 2026 = 18.466 €. Sul 2025 IVA delle fatture SDI 209.650 € +
  autofatture 25.899 € = 235.549 € contro VF71 258.352 € → ~23.000 € (9%) di acquisti con IVA fuori dallo SDI: la stima
  tende a sopravvalutare il dovuto. Oggi nessun impegno IVA cambia sul DB reale (mesi conclusi già scaduti o a credito).
- Test `test_tesoreria_iva.py` (4) + 1 in `test_tesoreria_fatture_api.py`. Suite: 967 verdi.

### Nomi fornitore ↔ banca: una parola sola non basta più (05/11/2026, v4.24.1)
Segnalato dall'utente: nel dettaglio fornitore dello Scadenzario i pagamenti a Castellana Gianni comparivano sotto
Gianni Gianmarco e viceversa. `forza_nome()` dava 1 con una qualunque parola di ≥ 4 lettere in comune: sul DB reale 40
fornitori su 76 ricevevano pagamenti altrui (ITALIA, SERVICE, SERVIZI, MARCO…). Ora la forza 1 richiede anche che
**tutte le parole del nome in banca** siano nel nome del fornitore ('GLAM', 'corif', 'Sogefer Srl' restano). Verificato:
i 74 abbinamenti proposti/automatici sui dati reali sono identici prima e dopo.

### Fase 5 — Blocco D fatto (05/11/2026, v4.24.0) — Fase 5 chiusa
- Scheda **Fatture** (`pages/tesoreria/TabFatture.jsx`, dopo Scadenzario): KPI per stato, riga che spiega il limite
  "da registrare" (fotografia Passcom e ultima registrazione), filtri (cerca, stato, tipo, ricevute dal/al),
  `ThOrdinabile`, paginazione, `ExportMenu` delle da registrare; clic → `Drawer` con dati, riepilogo IVA, rate (scadenza
  "stimata" se assente nel file), scadenze Passcom collegate, pagamenti in banca (Conferma/Scarta) e, per le da
  registrare/da confermare, "Abbina a un pagamento in banca" e "Segna pagata a mano" (riusano `ModaleManuale` e
  `ModalePagate` di `TabScadenzario.jsx`, ora esportati) o "Togli pagata a mano".
- **Import ZIP** in "Import e saldi" (`ImportFatture.jsx`): istruzioni fisse per la richiesta all'AdE (sezione apribile,
  stato in `localStorage('tesoreria_istruzioni_ade')`), `DropZone .zip`, anteprima (periodo di ricezione vero, nuove,
  già presenti, file illeggibili, per tipo), timeout 300 s, storico con Scarica/Elimina.
- **IVA mese per mese** (`CardIva.jsx`, sezione apribile in fondo a Impegni, `localStorage('tesoreria_iva_aperta')`,
  `NavAnno`): vendite, acquisti, credito riportato, saldo, da versare, scadenza, versato e scarto; mesi incompleti
  attenuati; credito stimato a fine anno solo come confronto.
- Previsione: colonna/Drawer "Fatture da registrare (SDI)".
- **Attività ricorrenti**: `fatture_ade` ora automatica — fatta se un import arriva fino a fine mese (−3 giorni)
  (`_evidenze()` in `routers/attivita.py`, `TesoreriaFattureImport.ricezione_a`, come dato del mese dopo).
- Nessun componente nuovo nella Libreria UI. Schermate non aperte a video da Claude (build + controllo identificatori).

### Fase 3 — calendario fiscale indipendente dallo studio (30/10/2026)
Scelta dell'utente: **non dipendere dal commercialista** per il calendario fiscale.
- Date per legge (calcolate da HotelOS, slittamento al primo giorno lavorativo); importi da: **cassetto
  fiscale AdE** (l'utente ha accesso per la S.r.l.: versamenti F24 con dettaglio per codice tributo —
  in banca ogni F24 è una "Delega Unificata" unica —, dichiarazioni Redditi SC/IRAP/IVA → acconti esatti
  dall'imposta dell'anno prima, ripartizione 40/60 o 50/50 dedotta dagli F24 di giugno/novembre 2025,
  LIPE trimestrali), **Passcom (Passepartout)** per liquidazioni IVA, dati HotelOS (cedolini → F24
  dipendenti, Corrispettivi → IVA vendite, fatture XML Fase 5 → IVA acquisti). Saldo IRES/IRAP = stima.
- **F24 dipendenti: il 16 del mese successivo** alle paghe a cui si riferiscono (confermato).
- **IMU: no** (la S.r.l. non possiede immobili). **TARI: sì, la paga la S.r.l.** → tabella "tributi
  locali" (avviso inserito a mano: importo + rate con date; prima dell'avviso, stima da quanto pagato
  l'anno prima in banca — pagoPA al Comune di Gabicce, oggi in categoria Utenze).
- Tassa di soggiorno 2025 versata per intero (terzo trimestre il 14/11/2025, 29.854 €: fuori dal confronto
  1/1–28/10 della Fase 1); nel 2026 versamenti trimestrali (luglio, ottobre) → schema usato in previsione.
- Compensi del marchio: ancora a zero nel 2026, fuori dalla previsione finché non c'è una data.
- **Analisi quietanze F24/F23 2026** (30/10/2026, file in `uploads/tesoreria_campioni/fisco/`): PDF
  "Quietanza di versamento" AdE leggibili con `pdfplumber` (righe `SEZIONE codice … debito credito`,
  "Saldo delega", "DATA DEL VERSAMENTO"). Tutte le deleghe con saldo > 0 trovate in banca ("Imposte e
  tasse:Delega Unificata", 1–3 giorni dopo; più deleghe dello stesso giorno = un solo addebito); F24 a
  zero non in banca. F23 = "Imposte e tasse : ex SAC" in banca. Scoperte:
  - ⚠️ **IVA MENSILE, non trimestrale** (codice 6008 = IVA agosto, 5.281,61 € il 16/9/2026; volume
    d'affari oltre la soglia): gli altri mesi 2026 senza IVA a debito in F24. Da chiarire con le
    liquidazioni Passcom (mensili).
  - **Credito IVA 2025 (6099) usato in compensazione**: 44.886,87 € nel 2026, soprattutto contributi e
    ritenute dei dipendenti di giugno–agosto → in banca gli F24 estivi 2026 sono quasi a zero. Quando il
    credito finisce si pagano per intero: la previsione 2027 non deve copiare il 2026. Residuo dalla
    dichiarazione IVA.
  - IRES/IRAP: saldo 2025 a credito (2003 −370, 3800 −294), 1° acconto 2026 il **20/7** (proroga ISA):
    IRES 2001 1.886,50, IRAP 3812 2.382,50; 2° acconto il 30/11.
  - Fisse: 7085 libri sociali 309,87 € il 16/3; 3850 diritto camerale 354 € (FC 221 + AN 133) a luglio;
    INAIL 18320 in 4 rate ~580 € (16/2, 16/5, 16/8, 16/11); **TARI** 3944 + TEFA Gabicce (D836)
    17.709 € rata unica con F24 il 1/7/2026; **registro contratto d'affitto ERICE** (1550) 1.300 € il
    21/1/2026 (il "conto terzi" del 4/7/2022 è lo stesso tributo, contribuente ERICE, KM coobbligato; caricato per errore: nessun versamento per conto terzi nel 2026).
  - Dipendenti: 1001 ritenute + DM10 INPS + addizionali 3802/3847/3848 + EBTU/FAST, il 16 del mese dopo.
  - F23 2026: 5 versamenti (sanzioni, 5.397,47 €) e ravvedimenti del 18/2 (codici 8947–8952): occasionali,
    fuori dalla previsione. Codici da verificare: 1075, 4071, 4731.
- **Confronto con le quietanze 2025** (43 deleghe + 2 F24 TARI, tutte trovate in banca tranne una da
  109,71 € del 20/8/2025):
  - **Il credito IVA annuale è strutturale, non un caso del 2026**: 2025 compensati 54.435 € (credito
    2024), 2026 44.887 € (credito 2025) — vendite al 10%, acquisti al 22%, inverni a credito. La
    previsione deve usare il credito disponibile dalla dichiarazione IVA di ogni anno, non azzerarlo.
  - **IVA a debito solo per agosto** (6008, versata il 16/9): 2025 18.466,35 €, 2026 5.281,61 €.
    Nessun acconto IVA di dicembre (6013) in entrambi gli anni.
  - **Acconti IRES/IRAP 50/50 confermati** (soggetto ISA): 2025 IRES 2001 2.071,50 il 23/7 e 2002
    2.071,50 il 1/12; IRAP 3812/3813 2.359,50 + 2.359,50. Quindi **2° acconto 2026 = 1.886,50 + 2.382,50
    = 4.269 € entro il 30/11/2026**.
  - **TARI in due versamenti**: 2025 11.996 € il 1/7 e 21.656 € il 1/12 (totale 33.652 €). 2026: avviso
    di **acconto** (tariffe dell'anno prima, 2 rate 30/6 e 30/9, pagate insieme con un solo F24 il 1/7:
    17.709 € con TEFA) + avviso di **conguaglio** n. 4553 del 23/10/2026 (tariffe definitive + "conguaglio
    presenze" sulla quota variabile, quindi non prevedibile con precisione) **19.044 € in rata unica entro
    il 1/12/2026**, F24 precompilato (3944 + TEFA, ente D836). Totale TARI 2026 = 36.753 €. 4 utenze a
    Gabicce (V. Veneto 165, Panoramica 48 sub 3 e 4, Panoramica 33). **Regola scritta nell'avviso di
    acconto** (n. 2152 del 14/05/2026): acconto = **75% del dovuto annuo a tariffe dell'anno prima**, 2 rate
    30/6 e 30/9 o rata unica entro il 30/6; il resto con avviso a **scadenza 1° dicembre**. Previsione:
    prima degli avvisi, acconto = 75% del totale dell'anno prima a fine giugno, conguaglio = totale anno
    prima × (1 + variazione) − acconto al 1/12; arrivato l'avviso, importi veri. Gli avvisi arrivano per
    **PEC come PDF con testo** (il conguaglio lo è; l'acconto caricato era una scansione fatta a mano):
    proposta per la Fase 3 = caricare il PDF della PEC e leggere la tabella "Riepilogo e scadenze dei
    versamenti" (rata, scadenza, importo) con `pdfplumber`, con anteprima e conferma; scansione o PDF non
    leggibile → inserimento manuale degli importi.
    File: `uploads/tesoreria_campioni/fisco/TARI 2026 (Acconto).pdf` e `… conguaglio.pdf`.
  - Ritenute lavoro autonomo (1040): 2025 16.980 € (4.000 € a febbraio e a dicembre), 2026 solo 804 €.
  - Contributi INPS (DM10) lordi: 2025 75.223 €, 2026 69.224 € a settembre.
- **Redditi SC 2025 (anno d'imposta 2024)** dal cassetto (quadri CP, RF, RN, RO, RS, RX; la Redditi 2026
  non è ancora nel cassetto, ma è stata presentata: saldo e acconti 2026 già versati a luglio):
  - **Concordato preventivo biennale (CPB) 2024–2025** (quadro CP): reddito concordato 18.590 €, imposta
    sostitutiva 12% sulla parte eccedente → **codice 4071 = imposta sostitutiva CPB** (159 € nel 2025,
    330 € nel 2026). Reddito effettivo 2024 30.215 €, utile civilistico 26.251 €, componenti positivi
    1.113.840 €. **Nessuna adesione al CPB 2026–2027** (risposta dell'utente, 30/10/2026): dal 2026
    IRES/IRAP sul reddito effettivo → saldo 2026 (a giugno/luglio 2027) = imposta effettiva 2026 −
    acconti 2026 (3.773 € IRES) da **stimare** (utile dalla contabilità × aliquota, con avviso che
    imponibile ≠ utile); acconti 2027 = imposta 2026 (storico) — fino alla dichiarazione, stima.
  - IRES 2024 = 17.263 € × 24% = 4.143 €; acconti versati 3.976 € → saldo 167 € (2003, luglio 2025).
  - **Metodo acconti IRES = storico al 100% dell'imposta dell'anno prima, 50/50**: acconti 2025 =
    2.071,50 × 2 = 4.143 €; IRES 2025 = acconti 2025 − credito 370 € = 3.773 € → acconti 2026 = 1.886,50 × 2
    ✓. Regola: 1° acconto entro 30/6 (proroga ISA al 20–23/7), 2° entro 30/11, saldo con il 1° acconto.
- **Dichiarazioni IVA** (4 PDF dal cassetto: IVA 2025 del 17/4/2025 + integrativa 1/7/2025, anno 2024;
  IVA 2026 del 18/2/2026 + integrativa 21/4/2026, anno 2025; VH in colonna 1 = credito, colonna 2 = debito):
  - Anno 2024: IVA vendite (VE26) 110.650 €, detraibile (VF71) 159.855 €, **credito annuo VL33 54.435 €**
    (= compensato nel 2025 ✓). Liquidazioni mensili 2024 tutte a credito tranne agosto (debito 5.636 €);
    credito che cresce in autunno/inverno (dicembre 54.436 €).
  - Anno 2025: IVA vendite 169.488 €, detraibile 258.352 €, VL4 38.800 € + IVA periodica versata 18.466 €
    (agosto) = **credito annuo VL33 57.266 €**, utilizzabile nel 2026. Compensati in F24 nel 2026 fino al
    16/10: 44.886,87 € → **residuo ≈ 12.379 €** a fine ottobre 2026 (copre il 2° acconto IRES/IRAP e parte
    degli F24 di novembre–dicembre; il non usato passa nella dichiarazione successiva).
  - Regola per la previsione: credito annuo dalla dichiarazione IVA (presentata a febbraio–aprile),
    consumato dagli F24 in ordine di scadenza (come fa lo studio: in estate soprattutto contributi e
    ritenute); prima della dichiarazione, stima dall'anno prima. ⚠️ Oltre 5.000 € il credito annuo si
    compensa solo dopo la presentazione della dichiarazione (nel 2026 usato da aprile).
- **IRAP 2025 (anno 2024)**, quadri IC/IR: valore della produzione netta 121.005 € × **3,90%** (regione
  codice 06 in F24) = **4.719 €**; acconti 2025 = 2.359,50 × 2 = 4.719 ✓ (storico 100%, 50/50); saldo 2024
  364 € (3800, luglio 2025). Acconti 2026 = 2.382,50 × 2 = 4.765 € (IRAP 2025 da confermare con la
  dichiarazione 2026, non ancora nel cassetto). Dal quadro IC 2024: ricavi 1.113.840 €, godimento beni di
  terzi (affitti) 346.721 €, servizi 314.605 €, materie prime 135.846 €.
- Raccolta dati fiscali per la Fase 3 **completa** (30/10/2026): F24/F23 2025–2026, TARI acconto e
  conguaglio, Redditi SC e IRAP anno 2024, IVA anni 2024–2025. Da aggiungere quando disponibili:
  Redditi SC/IRAP 2026 (anno 2025). Liquidazioni Passcom non necessarie per lo storico.

### Fase 3 — affitti (30/10/2026)
- **Du Parc** (Hotel Du Parc S.n.c. di Eli…, parte correlata): **nessun contratto vincolante, documento
  interno** — importo e scadenze li decide la società in base alla convenienza contabile. Canone **130.000 €
  + IVA = 158.600 €**, uguale per il 2026 salvo decisione diversa. Dalla banca: il canone dell'anno N è
  fatturato a fine anno (FT 4/1) e pagato a rate **da dicembre N a luglio N+1** (canone 2025: 30.000 l'11/12/2025,
  30.000 il 10/3/2026, 3 × 20.000 a giugno, 38.600 il 6/7/2026). In più "riaddebito costi di competenza"
  53.304,36 € il 13/7/2026 (fattura Du Parc 12/2025 in Passcom): **una tantum, non ricorrente** — rimborso
  di una rata di un altro affitto pagata per errore dal conto della S.n.c. invece che dalla S.r.l.
- Previsione: per ora lo schema del canone 2025 (30.000 € dicembre, 30.000 € marzo, 60.000 € giugno,
  38.600 € luglio). L'utente **sposterà le date dei pagamenti Du Parc in base alla liquidità della S.r.l.**:
  è l'uscita più flessibile → idea per la strategia della Fase 3: rate Du Parc modificabili al volo dalla
  previsione (anche "cosa succede se sposto la rata"), eventualmente un suggerimento su quando pagarle.
- **Club Hotel** (contratto in `uploads/tesoreria_campioni/affitti/`): concedente **ERICE S.N.C. di Forlani
  Letizia & C.**, affitto d'azienda dal **1/1/2026, 2 anni**, poi rinnovo tacito annuale (disdetta entro il
  30/9). Canone **145.000 € + IVA = 176.900 €**, nessun ISTAT, 3 rate: **43.500 + IVA (53.070 €) entro il 30/11
  dell'anno precedente**, 43.500 + IVA (53.070 €) entro il 30/4, **58.000 + IVA (70.760 €) entro il 31/8**.
  Fideiussione 58.000 €. Registro annuale a cura del concedente, metà a carico nostro (in F24: 1550, 1.300 €
  a gennaio). Banca 2026: 53.070 il 24/4, 70.760 il 12/8 ✓; la rata del 30/11/2025 è quella pagata per errore
  dal conto della S.n.c. Du Parc (rimborsata col riaddebito del 13/7/2026). Prima del 2026 contratto diverso
  (2025: 43.920 + 58.560 + 600 €).
- **International**: concedente **Hotel International S.n.c. di Giunta e C.** (atto registrato il 31/1/2025),
  durata 5 anni solari fino al **31/12/2029**, rinnovo tacito di altri 5. Canone **150.000 € + IVA = 183.000 €**
  (130.000 immobile + 20.000 altri beni), **nessuna rivalutazione**, 3 rate uguali (**61.000 €**) il **1/1, 1/7 e
  1/8**; modificabili per accordo scritto. Fideiussione 100.000 €. Banca 2026: 61.000 il 26–27/1, 23/7, 17/8 ✓.
  Il PDF ha testo non estraibile (font): letto come immagine.
- **Totale affitti per anno di canone: 518.500 € IVA inclusa** (Du Parc 158.600 + Club 176.900 + International
  183.000). Prossime uscite: Club 53.070 € entro il 30/11/2026, Du Parc 30.000 € a dicembre, International
  61.000 € il 1/1/2027.
- Configurazione prevista nella Fase 3 (da approvare con la strategia): sezione Admin con contratti/piani di
  pagamento modificabili (Du Parc = piano libero di rate decise dall'utente).

### Fase 3 — altre risposte dell'utente (30/10/2026)
- **Interventi inverno 2026/27**: non ancora definiti — in programma lavori a **piscina** e **parcheggio**,
  forse una **nuova cella frigorifera**. Servono come voci inseribili/modificabili (importo stimato, mese,
  stato ipotesi/confermato), non dati fissi.
- **Ricorrenti fuori scadenzario** (dalla banca): assicurazioni **Unipol/Mancini** a fine dicembre–gennaio e
  fine giugno–luglio (polizze globali alberghi DPH ~2.970–3.010 € e INT ~1.815–1.840 €, incendio ~451 €,
  BCC Assicurazioni SDD ~494 € a giugno); **canone RAI** speciale fine giugno (2 × ~1.024 € CLB e DPH);
  **SIAE** a luglio (2025: 1.117 + 984 + 857 €; 2026 non trovata in banca: da verificare). Pagate in
  stagione. Proposta: ricorrenti ricavati dallo storico banca, modificabili.
- **Scenari**: 3 — pessimista / realista / ottimista (realista = previsione base).
- **Incassi futuri dal Budget** (modulo Budget), ma **nel budget mancano i ristoranti** (MMS/BON): vanno
  aggiunti (o stimati a parte) prima di usarlo. Da verificare nella strategia: IVA inclusa/esclusa del
  budget e tempi di incasso (caparre, POS, OTA) rispetto alla competenza.
- **Piano del mutuo**: aggiungere la libreria `xlrd` per leggere il `.xls` originale (nuova dipendenza
  approvata dall'utente, da installare nella Fase 3).

### Fase 3 — strategia presentata (30/10/2026), NON ancora autorizzata
Proposta: tabella unica `tesoreria_impegni` (data, importo, tipo, stato stimato/confermato/pagato/coperto
da credito, movimento abbinato) generata da fonti gestite in Admin (calendario fiscale, affitti, mutuo,
carte, ricorrenti, interventi) + scadenzario + stime storiche per categoria + incassi; scheda Previsione
(saldo con forchetta pessimista–ottimista, soglia fido, tabella mensile certo/stimato, cassa libera a 90 gg,
salva previsione) e scheda Impegni. Blocchi: A tabelle + calendario fiscale → B affitti/mutuo (xlrd)/
ricorrenti/interventi/carte → C motore previsione (incassi, scenari, collaudo sul 2026) → D frontend, v4.6.0.
Risposte dell'utente:
1. **Orizzonte fino al 31/12/2027** (poi sempre 12–15 mesi avanti).
2. **Credito IVA simulato su tutti gli F24 in ordine di scadenza, TARI esclusa** (pagata sempre in cassa).
3. **Incassi dei ristoranti dal Budget**: prima del blocco C va sviluppato il modulo Budget per includere
   Mare Mosso e Buona Onda (lavoro nel modulo Budget, fuori dalla Tesoreria, con strategia propria).
4. **Avvio del blocco A: in attesa** — l'utente ha chiesto di aspettare.

### Fase 3 — Blocco A fatto (02/11/2026)
Solo backend, nessuna schermata né cambio di versione (schede nel blocco D).
- Tabella `tesoreria_impegni` (`tes008_2026`, applicata al DB reale): unica per fisco e, dai blocchi successivi,
  affitti/mutuo/interventi (la specifica ne prevedeva una solo fiscale). `codice` stabile: generando di nuovo si
  aggiornano solo stima e base, mai `importo_confermato`, date spostate (`data_manuale`), pagati, avvisi, manuali.
- `services/tesoreria_calendario.py` (puro): `scadenza_legale()` (festivi con Pasquetta, proroga dal 1° al 20 agosto →
  20/8), `genera_scadenze()`, `simula_credito()` (ordine di scadenza; prima della dichiarazione al massimo 5.000 €),
  `abbina_gruppo()` (un addebito chiude più F24 della stessa scadenza; automatico solo con importo esatto).
- `routers/tesoreria_impegni.py`: `GET|POST /impegni`, `PUT|DELETE /impegni/{id}` (il calendario non si elimina),
  `GET|PUT /impegni/parametri`, `POST /impegni/genera`, `POST /impegni/abbina`, `POST /impegni/{id}/abbinamento`
  (conferma|scarta|annulla, su tutto il gruppo), `POST /impegni/tari/anteprima|conferma`
  (`services/tesoreria_tari_parser.py`: rata unica se presente; scansione → errore, importi a mano).
- **Dati reali in `app_config['tesoreria_fiscale_parametri']`**, non in git: imposte da dichiarazione, IVA di agosto
  versata, totali TARI, F24 storici 2025 dalle quietanze, tributi fissi, tranche del credito IVA (12.379,13 € di
  residuo + 57.266 € 2026 **stimati** come l'anno prima, dal 16/04/2027). Caricati il 02/11/2026 con 35 scadenze e
  l'avviso TARI n. 4553.
- Decisioni accolte dall'utente: tassa di soggiorno il 15 del mese dopo il trimestre; IVA solo agosto; 1040 a mano;
  1075/4731 fuori; acconti il 20/7 modificabili; registro ERICE nel calendario.
- **Collaudo sul 2026** (quietanze e banca): date degli F24 tutte corrette; cedolini vs dovuto gen–set 89.322 € contro
  92.781 € (−3,7%; luglio −4.061 €, gennaio −1.929 €, gli altri entro ±1.309 €); 6099 usato 44.886,87 € ✓;
  tassa T3 30.616 € contro 30.030,50 € versati.
- ⚠️ **Stima IVA da vendite e acquisti scartata dopo il collaudo**: agosto 2026 dava 23.140 € contro 5.281,61 € versati
  (non vede il credito del mese prima né l'IVA degli affitti di agosto). Si usa l'ultimo importo versato.
- ⚠️ **Gli F24 oltre al credito IVA hanno altri crediti non stimati** (1701, 1704, 1631, 1627: 26.090 € nel 2026, 28.554 €
  nel 2025, fino a 9.157 € al mese d'estate): la previsione degli F24 è il dovuto lordo, quindi prudente di circa 26.000 €
  l'anno. **Decisione dell'utente (02/11/2026): nel blocco C stimarli, con base i mesi dell'anno prima.**
- ⚠️ **IRES 2026 stimata 18.179 €** (reddito ~75.700 €: gen–set contabili + ott–dic alla media gen–mar) contro 3.773 € del
  2025: senza concordato, ma stima grezza che pesa su saldo e acconti 2027 finché non c'è la dichiarazione.
- Mancano: chiamata automatica di `abbina_impegni()` dopo l'import degli estratti conto (ora da endpoint);
  aggiornamento di `crediti_iva` quando arriva la dichiarazione IVA.

### Fase 3 — Blocco B fatto (02/11/2026, v4.11.0)
- Migrazione `tes009_2026`; `routers/tesoreria_piani.py` (`/piani/affitti`, `/piani/mutuo`, `/piani/ricorrenti`,
  `/piani/interventi`), `services/tesoreria_piani.py`, `routers/tesoreria_impegni_abbina.py` (`abbina_impegni()`, chiamata
  anche da conferma ed eliminazione degli estratti conto). I piani generano impegni di fonte `piano` con
  `sincronizza_piani()`: correzioni sull'impegno e pagati restano, il resto segue il piano.
- **Ultima rata automatica** (v4.14.2, richiesta dell'utente): con almeno 2 rate nello stesso anno di canone l'ultima per data chiude il 100% (`percentuali_effettive()`); la % salvata resta in tabella e torna valida se se ne aggiunge una dopo. Una rata sola o un'ultima già pagata restano come sono.
- **Affitti: ogni rata = data + % del canone dell'anno di competenza** (Admin `?s=tes-affitti`; scelta dell'utente per
  Du Parc, dove le date si decidono in base alla liquidità). Somma per anno ≤ 100%, sotto il 100% la differenza è «da
  pianificare» e non entra in previsione; a 100% l'ultima rata assorbe l'arrotondamento. Date Club/International
  contrattuali (scelta dell'utente). **Du Parc: prima rata il 31/01/2027, confermata dall'utente.** Riaddebito del 13/7/2026 escluso, una tantum.
- Abbinamento affitti su `nomi_banca` (Du Parc: **S.N.C., già S.A.S.**, cambio di ragione sociale), importo esatto →
  automatico, solo nome → proposto; un nome diverso non abbina mai.
- Mutuo: `parse_piano_mutuo()` con `xlrd`, importo + 1,50 € di spese (verificato sulle prime 3 rate). Ricaricando il
  piano le rate pagate restano. Impegni fino all'orizzonte, debito residuo su tutto il piano (137.231,22 €). Upload solo
  da endpoint per ora (schermata nel blocco D).
- Ricorrenti caricati (categoria per il blocco C: **RAI è in `utenze`, BCC in `fornitori_sdd`, da sottrarre dalla stima
  storica di quelle categorie**). Assicurazioni = **Unipol di Andrea Mancini** ("MANCINI ASSICURAZIONI DI MANCINI ANDREA");
  **Arturo Mancini Srl è un fornitore di merce (DDT), non un'assicurazione**: tolto dalla regola 21 sul DB reale (il seme
  di `tes001_2026` lo contiene ancora: su un'installazione nuova va tolto). **SIAE non è un ricorrente**: nel 2026
  pagata probabilmente con carta (non risulta in banca), quindi è già nella stima delle carte del blocco C.
  Schermata Admin nel blocco D.
- Interventi: piscina, parcheggio, cella frigorifera inseriti senza importo e fuori previsione (Admin `?s=tes-interventi`).
  Collegamento con lo scadenzario nel blocco D.
- **Interventi a rate** (v4.15.0, `tes012_2026`, tolto `mese_previsto`): `tesoreria_rate_intervento` (data + %), `POST /piani/interventi/{id}/rate`, `PUT|DELETE /piani/interventi/rate/{id}`; ogni rata è un impegno `intervento:{id}:{rata}`. L'ultima per data chiude il 100% (`_chiudi_al_100()`, salvata in tabella), una sola = pagamento unico; una nuova rata dimezza la quota dell'ultima. Più fatture per lavoro: coprono prima le rate più vicine (`importi_rate_intervento()`).
- **Straordinari marcati (7 movimenti, −51.275,88 €)**: Palazzi, Design Color, CHS, SG Informatica/Gianni Gianmarco
  dell'avvio del gestionale (acconto 2.500 € del 17/09/2025, saldo 3.600 € del 19/11/2025, FT 6.734,40 € del 15/06/2026).
  **Non straordinari**: Castellana (ordinario) e il **canone annuo del gestionale** (5.496,10 € il 07/10/2026, "licenze
  stagione 2027"): resta nello storico di `fornitori_bonifici`, così il blocco C lo ritrova a ottobre 2027.

### Compensi soci (02/11/2026, v4.16.0)
Admin `?s=tes-compensi`, `tes013_2026`: `tesoreria_compensi` (voce marchio|amministratori, anno, importo **netto**, UNIQUE voce+anno) + `tesoreria_rate_compenso` (data + %, l'ultima chiude il 100% salvo se pagata), impegni `compenso:{voce}:{anno}:{rata}`, gruppo "Compensi soci" in previsione. Decisi ogni anno: nessuna stima automatica (`GRUPPI_STIMA` non li contiene). Amministratori: bonifico fuori dagli stipendi (scelta dell'utente), categoria `soci_amministratori` separata da `personale`, regola sulla descrizione; nel 2025–2026 nessun bonifico trovato. Abbinamento su somma dei bonifici dello stesso giorno nella categoria (Gino + Elisa), `movimento_id` = primo del giorno. Ritenute a parte, voci a mano in Impegni.

### Advertising pagato con carta (03/11/2026, v4.18.0)
Google e Meta (~50.000 €/anno, **sempre AMEX**) non passano dalla banca: prima erano solo dentro la stima «Carte», e le loro
fatture aperte nello scadenzario Passcom (registro 8) entravano in previsione come uscita certa → doppio conteggio.
- **Piano per anno alberghiero** (Admin `?s=tes-advertising`, `tes014_2026`; da `tes015_2026` `anno` = anno di fine stagione,
  2026 = ottobre 2025 – settembre 2026, `anno_calendario()` per l'anno solare del mese): `tesoreria_advertising` (anno UNIQUE, carta, totale, nota) +
  `tesoreria_advertising_mesi` (mese, importo **in €**, scelta dell'utente); l'ultimo mese compilato chiude il totale
  (`chiudi_totale()`, ordine della stagione `MESI_STAGIONE`, salvato in tabella). Impegno `advertising:{anno solare}:{mese}`, gruppo «Advertising (carta)», alla data di
  addebito della carta del **mese dopo** (`data_addebito_advertising()`: giorno di addebito del conto, primo giorno lavorativo).
  Non generato se l'addebito è già passato o se l'estratto della carta che si addebita quel mese è già inserito (lo contiene).
  Mai abbinato alla banca (`TIPI_SENZA_BANCA`).
- **Stima «Carte»** = addebiti carta dell'anno di riferimento − advertising addebitato in quel mese (`advertising_per_addebito()`,
  `DatiPrevisione.advertising`), mai negativa. Per questo servono anche gli anni passati come riferimento.
- Dati caricati (dai pannelli Google/Meta): stagione 2025/26 reale (50.655,29 €); 2026/27 ott–dic come 2025 (indicazione
  dell'utente) + gen–set copiati dal 2026; 2027/28 solo ott–dic copiati — **da decidere dall'utente**.
- ⚠️ La sessione dell'app ha `autoflush=False`: `_salva_mesi()` fa `db.flush()` prima di `sincronizza_piani()` (i test usano
  autoflush e non lo vedevano: il primo piano caricato sul DB reale era rimasto senza impegni).
- **Fornitori pagati con carta** (`app_config['tesoreria_fornitori_carta']`, `GET|PUT /tesoreria/scadenzario/fornitori-carta`,
  stessa pagina Admin): le loro scadenze hanno stato `pagata_carta` (dopo pagata in banca/a mano), coperte per prime dai pareggi
  come le altre pagate, ma **fuori da "da segnalare"** (lo studio le registra con l'estratto), da pagare, scadute, abbinamenti e
  previsione. Oggi: Google Ireland (601.00640), Meta Platforms (601.03326). Google Cloud Italy non incluso.

### Anno solare / anno alberghiero (03/11/2026, v4.19.0)
Toggle in cima alla pagina Tesoreria (`SegmentedControl`, `localStorage('tesoreria_tipo_anno')`, default **solare**). Anno
alberghiero = 1/10–30/9, identificato dall'**anno di fine** (2026 = "2025/26"). Funzioni uniche: `intervallo_anno()`,
`anno_di()`, `etichetta_anno()` in `services/tesoreria_report.py`; nel frontend `intervalloAnno`/`annoDi`/`etichettaAnno`/
`periodoAnno` in `pages/tesoreria/helpers.jsx`. Nome scelto: "anno alberghiero" (il Forecast resta su "anno commerciale").
- **KPI**: `GET /tesoreria/kpi?anno=&tipo_anno=solare|alberghiero` → `etichetta`, `etichetta_ap`, `dal`, `ap_dal`,
  `ap_completo` (avviso se mancano estratti dell'anno prima: il 2024/25 è parziale, banca dal 1/1/2025). Tassa di soggiorno
  sempre per trimestri dell'anno solare `anno`; mesi di autonomia invariati (inverno ott–apr). `NavAnno` ha la prop
  facoltativa `etichetta` (funzione anno → testo).
- **Consuntivo e Movimenti**: scorciatoie "Da inizio anno (alberghiero)" / "Anno (alberghiero) precedente".
- **Previsione**: `totali_anno[tipo][scenario]` nella risposta (`totali_per_anno()`: saldo iniziale del primo mese, somme,
  saldo finale dell'ultimo, `completo` = 12 mesi) → riga "Totale …" dopo l'ultimo mese di ogni anno; export con
  `tipo_anno` e righe TOTALE sommate colonna per colonna.
  Nel grafico (v4.19.3) una linea verticale marcata e un punto sull'**ultimo mese** di ogni anno (dicembre o settembre)
  con "Fine X" e "saldo previsto|reale al gg/mm/aaaa: importo" (rosso se negativo) — il saldo di quel punto. ⚠️ Nella
  v4.19.1–4.19.2 la linea stava sul primo mese dell'anno: ogni punto è il saldo di fine mese, quindi sul punto di gennaio
  si leggeva un saldo diverso da quello scritto (31/12/2026 +22.989 €, fine gennaio 2027 −60.210 €).
- **Advertising**: piano per stagione (vedi sopra). Posizione, Impegni e Scadenzario non cambiano.

### Fase 3 — Blocco C fatto (02/11/2026, v4.12.0)
Motore in `services/tesoreria_previsione.py`, dati in `routers/tesoreria_previsione.py`: `GET /tesoreria/previsione`,
`GET|PUT /tesoreria/previsione/parametri` (Admin `?s=tes-previsione`). Calcolato alla richiesta: Budget e impegni modificati
valgono subito. Grafico e schede nel blocco D.
- **Entrate** = entrate in banca del mese di riferimento × Budget dell'anno ÷ ricavi dell'anno prima (hotel + ristoranti, IVA
  inclusa): il Budget dice quanto, la banca quando. Oggi il ritmo è solo 2026 (nov–dic dal 2025); con più anni si potrà mediare.
- **Anno di riferimento unico per tutte le categorie**: una categoria senza spese nel mese vale zero. ⚠️ Bug trovato sui dati:
  cercandolo per categoria, gli assegni di gennaio ripescavano il 2025 (fornitori gennaio 2027 78.664 € invece di 7.782 €).
- **Uscite stimate** = stesso mese di riferimento senza straordinari, × crescita del gruppo solo negli anni futuri. Crescita in
  Admin per gruppo (scelta dell'utente): vuoto = come il Budget (default fornitori, marketing, carte), personale/utenze/altre 0%.
  Escluse perché coperte: affitti, f24, tassa di soggiorno, mutuo, assicurazioni; compensi del marchio esclusi (nessuna data).
  Si sottraggono scadenzario, ricorrenti, estratti carta e, nel mese in corso, quanto già avvenuto.
- **Altri crediti F24**: `app_config` `altri_crediti_f24` (dalle quietanze), stesso mese dell'anno prima, colonna
  `tesoreria_impegni.coperto_altri` (`tes010_2026`), scalati prima del credito IVA.
- Scenari (Admin): pessimista −10% incassi +5% uscite stimate, ottimista +5% incassi. Fido solo fino a scadenza (30/09/2027).
- **Collaudo sul 2026** (dati 2025, impegni = movimenti reali, ricavi non scalati): scarto saldo gen–ott da −99.020 € a
  +25.917 €, a ottobre −85.946 €: **prudente in inverno e autunno** (gennaio 2025 aveva 57.000 € di assegni, ottobre 2025 uscite
  più alte). Non misura la bontà del Budget. Da rivedere in Fase 4.
- Previsione reale al 02/11/2026: realista minimo −70.766 € ad aprile 2027, negativo gennaio–maggio; pessimista −97.318 € ad
  aprile; a dicembre 2027 pessimista −134.547 € **sotto soglia perché il fido scade il 30/09/2027**.

### Fase 3 — Blocco D fatto (02/11/2026, v4.13.0–4.14.0) — Fase 3 chiusa
- Schede **Previsione** (`pages/tesoreria/TabPrevisione.jsx`: grafico per mese con saldo reale, linea dello scenario scelto nella tabella, fascia pessimista–ottimista,
  soglia del fido, un solo asse; tabella per scenario in `localStorage('tesoreria_previsione_scenario')`; clic sul mese → Drawer;
  export) e **Impegni** (`TabImpegni.jsx`: conferme, voci a mano, abbinamenti proposti, avviso TARI).
- **Prove**: `POST /tesoreria/previsione/prova` (`sposta`, `interventi_on`, `interventi_off`), `applica_prova()`: ricalcola senza scrivere.
  Rate Du Parc e interventi. Valgono solo sugli impegni, non rifanno credito e altri crediti (affitti e interventi non sono compensabili).
- **Salva previsione**: `POST /previsione/salva`, `GET /previsione/salvate[/{id}]`, `DELETE`, tabella `tesoreria_previsioni_salvate`
  (`tes011_2026`, risposta intera in JSON) per il confronto della Fase 4.
- **Fatture e interventi**: `tesoreria_intervento_scadenze` (per chiave, dati copiati), `GET|POST /piani/interventi/{id}/fatture`,
  `DELETE /piani/interventi/fatture/{id}`. La stima si riduce delle fatture collegate; intervento «pagato» quando coprono tutta la
  stima e sono pagate o uscite dallo scadenzario (`_aggiorna_interventi_pagati()`).
- **KPI**: `previsione` in `GET /tesoreria/kpi` solo per l'anno corrente: mesi di autonomia = mesi pieni prima che il saldo
  realista vada sotto zero (senza fido né contanti), cassa libera a 90 giorni, debito del mutuo. La vecchia stima resta nella nota.
- Admin: `tes-ricorrenti`, `tes-mutuo`, `tes-fiscale` (dati in `app_config`, al salvataggio rigenera il calendario).
- ⚠️ Schermate non aperte a video da Claude (nessun browser sul server): solo build, controllo identificatori e test API.
- Non fatti: "slittamento apertura stagione" e scenari manuali salvati della specifica (la prova copre il caso Du Parc).

### Fase 4 — decisioni (03/11/2026)
- **Fase 3 chiusa senza** "slittamento apertura stagione" e scenari manuali salvati (decisione dell'utente: le date
  di apertura stanno in Stagioni/Budget, la "prova" della Previsione copre le varianti).
- **Caparre: fonte = banca** (causale dei bonifici da clienti), non l'export Welcome "Elenco Prenotazioni" (che ha
  "Totale acconti/caparre" per prenotazione, 184.580 € nel 2026, ma non la data di pagamento: niente confronto alla
  stessa data). Welcome eventualmente in futuro come controllo, o per i codici "BK/2026/…" ed "ERIC-…" in coda.
- Ordine: A caparre (subito, inizia l'inverno delle caparre) → B stipendi netti dai cedolini → C tempi di
  pagamento per fornitore → D verifica delle previsioni salvate (per ultima: servono previsioni salvate, una al mese).

### Fase 4 — Blocco A caparre fatto (03/11/2026, v4.20.0)
- Colonne su `tesoreria_movimenti` (`tes016_2026`): `arrivo`, `arrivo_struttura` (DPH/CLB/INT o NULL),
  `arrivo_regola` (nome della regola, `manuale`, `escluso` = non è una caparra, NULL = non letto), `arrivo_manuale`.
- Lettore puro `services/tesoreria_caparre.py`: `leggi_arrivo(descrizione, data_pagamento)` (regole in ordine su
  testo pulito: senza "Info aggiuntive" e senza l'intestazione dei bonifici istantanei; anno mancante o scritto male
  → anno del pagamento o successivo; arrivo plausibile = mesi aprile–ottobre, da 60 gg prima a 550 gg dopo il
  pagamento; giorno/mese invertiti se fuori stagione), `leggi_struttura()`, `per_mese_arrivo()`, `future_al()`.
  Caparra = incasso **prima** del giorno di arrivo (caparre, acconti e saldi anticipati insieme).
- `aggiorna_caparre(db)` in `tesoreria_shared.py`: rilegge tutti i bonifici da clienti in entrata non corretti a mano
  e toglie l'arrivo a chi non lo è più; chiamata da `ricalcola_categorie()` (quindi ricalcolo, regole, "Rileggi i file
  originali"), conferma import estratti e cambio categoria di un movimento.
- Sui dati reali 2025–2026: 1.770 bonifici letti su 2.459 (~663.000 € su 1,06 milioni), struttura per ~1.480.
  Non letti: saldi senza date, codici di prenotazione, causali tagliate dalla banca. ~0,1 s per rileggere tutto.
- Router `routers/tesoreria_caparre.py`: `GET /tesoreria/caparre?anno=` (stagione = anno alberghiero, = anno
  dell'estate): per mese di arrivo e struttura incassate finora, anno prima alla stessa data (`anno_prima()`), anno
  prima a fine stagione; coda = bonifici della stagione senza arrivo e non esclusi (**solo la stagione richiesta**:
  lo storico non si completa a mano, i non letti succedono in modo simile in entrambi gli anni).
  `PUT /tesoreria/caparre/{id}` `{arrivo, struttura}` | `{escluso: true}` | `{automatico: true}` (`puo_modificare`).
- Posizione: `caparre_future` (già nel saldo banche, per mese di arrivo e struttura) + avviso info "N bonifici da
  clienti senza periodo di soggiorno" con link alla scheda.
- **Previsione**: `DatiPrevisione.caparre = {(y, m) arrivo: (in banca oggi, per (y-1, m) un anno fa)}`;
  `rettifica_caparre()` = oggi − anno prima × `fattore_budget(y)`, tolta dalle entrate del mese di arrivo (dopo il
  moltiplicatore dello scenario, mai sotto zero; negativa = si aggiunge). Il totale della stagione resta quello del
  Budget. Confronto valido solo se gli estratti partono da gennaio di due anni prima dell'arrivo. Riga
  `rettifica_caparre`, elenco `caparre` nella risposta, spiegazione nel Drawer del mese.
  Al 03/11/2026: stagione 2027 680 € contro 3.165 € un anno prima → giugno +2.818 €, luglio +537 €, agosto −500 €.
- Frontend: scheda **Caparre** (`pages/tesoreria/TabCaparre.jsx`, dopo Impegni; `NavAnno` per stagione, tabella
  mesi × strutture con confronto, coda con data di arrivo + struttura → Salva o "Non è una caparra"), riquadro in
  Posizione. `STRUTTURE` in `helpers.jsx`.
- Limite: caparre con carta/POS invisibili.
- **v4.21.0 — incrocio con Welcome e "senza periodo"** (richiesta dell'utente: troppo lungo cercare a mano):
  - se la causale non ha date, `abbina_prenotazione()` cerca l'ordinante (o un nome nella causale, `parole_nome()`
    senza le parole tipiche delle causali) tra gli ospiti delle prenotazioni Welcome **non disdette** importate nel
    Forecast (`indice_welcome()` in `tesoreria_shared.py`): due parole del nome in comune (una sola di ≥ 5 lettere
    se il nome ne ha una), prenotazione fatta prima del pagamento, arrivo plausibile; vale solo se tutte le
    prenotazioni compatibili cadono nello **stesso mese e struttura** (arrivo = la prima). Regola `welcome:<codice>`.
    `aggiorna_caparre()` gira anche dopo import ed eliminazione di un import Welcome (`routers/prenotazioni.py`).
    ⚠️ "Totale acconti/caparre" di Welcome non è affidabile (a zero anche con caparra pagata): l'incrocio è sul nome.
  - stato **"caparra senza periodo"** (`arrivo_regola='senza_periodo'`, a mano, anche più bonifici insieme con
    `POST /tesoreria/caparre/segna {ids, stato: senza_periodo|escluso}`): conta nella stagione del pagamento, riga
    "Periodo non indicato" nel riepilogo, in Previsione e Posizione distribuita sui mesi di arrivo in proporzione alle
    caparre note (`caparre_per_mese()`; senza caparre note, come la stagione prima).
  - Scheda: coda per qualunque stagione con selezione multipla, sezione apribile "Abbinati a Welcome o sistemati a
    mano" con "Torna automatico" / "Non è una caparra".
  - Stagione 2025/26 sul DB reale: 1.162 bonifici, 1.050 con arrivo (184 tramite Welcome), 58 "non è una caparra"
    segnati dall'utente (saldi a fine soggiorno, riaddebiti), 54 da completare. Stagione 2024/25 senza Welcome
    (nessuna prenotazione 2025 importata): conta solo come anno prima della 2026.

### Fase 4 — Blocco B stipendi netti fatto (03/11/2026, v4.22.0)
- Dati 2026: il netto dei cedolini di un mese esce in banca il mese dopo intorno al 10 (distinta "BONIFICI DEL …
  QTA n" + bonifici singoli; a fine stagione il 2/10), quasi uguale (luglio 66.353 € = agosto in banca; differenze di
  pochi % per anticipi e Fideuram). Scelte dell'utente: **sempre il 10** (costante `GIORNO_STIPENDI`, nessuna
  impostazione in Admin); **fondo pensione Fideuram resta nella stima** del personale (importi variabili).
- `netti_per_mese(db)` in `routers/dipendenti.py` (gemella di `costi_f24_per_mese`, voce `ret_netta`, non test).
- `certe_stipendi(netti, pagati, oggi)` in `services/tesoreria_previsione.py`: uscita certa gruppo `stipendi`,
  categoria `personale` (quindi tolta dalla stima del personale), al 10 del mese dopo; mese di pagamento passato →
  non conta; mese in corso → pagato se le uscite in banca della categoria personale del mese arrivano al 90% del netto
  (`QUOTA_STIPENDI_PAGATI`), altrimenti resta la differenza. Calcolata a ogni richiesta, nessuna tabella né impegno
  in DB (non compare nella scheda Impegni, sì in Previsione: colonna/Drawer "Stipendi netti (cedolini)").
- `cedolini_mancanti(netti, oggi)`: dopo il 5 del mese, se mancano i cedolini del mese prima (e ne esistono di
  precedenti) → avviso in Previsione (`avvisi` nella risposta) e in Posizione (arancione, tipo `cedolini`).
- Effetto: solo sul mese dopo l'ultimo cedolino importato (in inverno pochi €, in estate 50–67.000 € al mese).

### Fase 4 — Blocchi C e D rimandati per mancanza di dati (03/11/2026, decisione dell'utente)
Verificato sui dati reali prima di scrivere codice:
- **C (tempi di pagamento per fornitore)**: solo **17 abbinamenti** scadenza↔banca (MARR, SGR, Radio Bakery, IGEA,
  Sogeal, Castellana…), quasi tutti pagati alla scadenza (0–5 gg): lo studio registra quasi tutti i pagamenti come
  pareggi, quindi le scadenze escono da Passcom prima di poterle abbinare. Il file Passcom delle **rate pagate**
  (stato P, 7.630 righe) **non è utilizzabile**: la "data pagamento" è la data di chiusura contabile della partita,
  non del pagamento (MARR in media 187 gg *prima* della scadenza, Google Commerce 943 gg prima).
  Lo "scaduto" del 03/11 (74.347 €) era quasi tutto Ri.Ba. del 31/10 con l'estratto conto non ancora caricato: è
  freschezza dei dati, non un ritardo. La base esiste già (abbinamenti + `tempi_pagamento()` della Fase 2).
- **D (verifica delle previsioni)**: nessuna previsione salvata al 03/11/2026. Consigliato all'utente: "Salva
  previsione" ora e poi una volta al mese.
- **Quando riprendere** (l'utente ha chiesto di ricordarglielo): C quando ci sono **almeno ~60 abbinamenti
  automatici/confermati su almeno 10 fornitori** (`SELECT count(*), count(DISTINCT codice_fornitore) FROM
  tesoreria_abbinamenti WHERE stato IN ('automatico','confermato')`); D quando ci sono **almeno 3 previsioni salvate
  distanti almeno un mese** e con mesi già chiusi da confrontare (`tesoreria_previsioni_salvate`).

### Previsione salvata in automatico (05/11/2026, v4.25.0)
Per il blocco 4D servono previsioni salvate una al mese: `salva_automatica()` in `routers/tesoreria_previsione.py`,
chiamata da `conferma_import` degli estratti conto **dopo il commit** (un errore non annulla l'import: rollback e log).
Salva se nel mese non c'è ancora una previsione salvata e l'estratto arriva a fine mese prima (`arriva_a_fine_mese()`:
ultima data ≥ ultimo giorno del mese prima − `TOLLERANZA_FINE_MESE` = 4, perché l'XML non ha i giorni senza movimenti).
Basta **un** conto (in inverno l'utente carica solo il principale). Nota "Automatica (estratto conto …)", risposta
dell'import con `previsione_salvata` (id o null). Dal giorno 8 (`GIORNO_AVVISO_SALVATE`) avviso in Previsione se il
mese non ne ha una. L'attività "Salva previsione" dello scadenziario risulta fatta da sola (già esistente).
Scelta dell'utente: al caricamento dell'estratto, non a data fissa (il 1° del mese i dati di fine mese spesso mancano).
Suggerimenti di attendibilità della previsione presentati all'utente lo stesso giorno, da scegliere: uscite stimate su
più anni (picchi tipo assegni gennaio 2025), incassi della stagione dalla proiezione del Budget invece del budget fisso,
credito IVA 2026 calcolato dai dati (Fase 5C) invece di copiato, IVA dei mesi futuri da vendite/acquisti previsti,
blocco 4C (criterio raggiunto).

### Uscite stimate su anni solari interi (05/11/2026, v4.26.0)
Prima ogni mese stimava dall'ultimo anno con quel mese concluso: il 2027 mescolava gen–ott 2026 e nov–dic 2025, e
le Ri.Ba. che nel 2026 sono slittate da settembre–ottobre a novembre non finivano in nessun mese (fine 2027 a +143.000 €
contro +23.000 € del 2026, ~140.000 € di fornitori persi). Ora (`services/tesoreria_previsione.py`):
- **Uscite stimate**: `anni_riferimento_uscite()` = ultimi anni solari **interi** (tutti i 12 mesi coperti dagli estratti,
  dicembre concluso), al massimo 2, **gli stessi per tutti i mesi dell'anno**; media pesata `PESI_ANNI` = (2, 1), il più
  recente pesa il doppio (dal 2027: 2026 ×2 + 2025; dal 2028: 2027 ×2 + 2026). Senza un anno intero: vecchia regola per
  mese (`anno_riferimento()`).
- **Entrate invariate** (ritmo dell'ultimo mese concluso: per l'utente il 2025 non è affidabile per gli incassi).
- **Fattore di crescita sull'anno di riferimento vero**: `fattore_budget(y, budget, ricavi, rif)` = Budget di `y` ÷ ricavi
  di `rif` (prima sempre ÷ ricavi di y−1, anche partendo dal 2025). Vale per uscite ed entrate.
- **Ricavi degli anni prima di HotelOS** (2025) da `lordo_storico_anno()` di `services/wave_dati.py` = Σ netto dello
  storico WAVE (hotel + ristoranti, apr–set) × 1,10, scelta dell'utente. 2025 = 1.841.704 €, 2026 = 1.830.727 €.
  `_ricavi_e_budget()` ora da `oggi.year − 3`.
- **Anno in corso completato con la previsione** (v4.26.1, scelta dell'utente): se mancano al massimo
  `MESI_PREVISTI_MAX` = 2 mesi a fine anno (novembre–dicembre), l'anno in corso conta già come anno intero; i mesi non
  conclusi si prendono dalla previsione realista stessa (`completa_anno_corrente()` → `DatiPrevisione.completamento`:
  per gruppo, già avvenuto nel mese + impegni certi della categoria + stima; carte al netto dell'advertising, come lo
  storico). Durante quel calcolo l'anno in corso non fa da riferimento a sé stesso. Quindi a novembre 2026 il 2027 usa
  già 2026 ×2 + 2025 (novembre 2026 = Ri.Ba. già pagate + scadenzario); a gennaio il completamento non serve più.
- Righe della risposta con `riferimento_entrate` (anno), `riferimento_uscite` (lista) e `riferimento_previsti` (mesi
  dell'anno di riferimento presi dalla previsione), mostrati nel dettaglio del mese.
- **Dati corretti**: l'assegno da 61.000 € del 31/01/2025 (categoria "Assegni", finiva nei fornitori stimati di ogni
  gennaio e doppio con l'impegno d'affitto) è la rata di gennaio dell'affitto International → categoria Affitti a mano.
Effetto al 05/11/2026 (realista): fine 2027 da 143.000 € a −7.500 € (2026: +23.000 €; fido scaduto dal 30/09/2027),
picco agosto 562.000 €, minimo aprile 2027 da −75.000 € a −88.000 € (solo 2025: −114.000 €).

### Spese ordinarie e straordinarie separate (06/11/2026, v4.27.0)
Richiesta dell'utente: una linea del grafico solo con le spese ordinarie e le straordinarie a parte (importi e date),
gestite anno per anno.
- **Passato**: le spese una tantum pagate in banca si segnano `straordinario` sul movimento (escono dalle stime degli anni
  dopo, restano nel consuntivo). Admin → Tesoreria → Spese straordinarie → card "Uscite passate da controllare" (anno, soglia
  default 3.000 €, solo categorie che alimentano le stime tranne personale e carte; spunta = `PUT /movimenti/{id}`).
  Segnati il 06/11/2026 su indicazione dell'utente anche Boghi Marco (2 × 8.000 €, 30–31/07/2026), FIDER (7.642 €, commissioni
  pratica finanziamento), BSD (6.813 €) e Dorelan (5.545 €) di aprile 2025. **Non** straordinari: Albergatore PRO, Palazzi 2026,
  parcheggi Campoquadro. Le spese con carta non si separano (restano nella stima Carte).
- **Futuro**: la tabella degli interventi è ora chiamata in UI **"Spese straordinarie"** (Admin `?s=tes-interventi`, Previsione,
  prova): voci dell'anno con importo e rate, nessuna copia da un anno all'altro. Al 06/11/2026 per il 2027 solo piscina,
  parcheggio e cella frigorifera senza importo (l'utente: "per il 2027 non dovrebbe esserci altro").
- **Motore**: `calcola_scenario()` dà per riga `straordinarie` (= certe del gruppo `GRUPPO_STRAORDINARIE` = "interventi") e
  `saldo_ordinario` (stesso saldo senza quelle uscite); `totali_per_anno()` somma `straordinarie`. Export con colonna
  "Saldo solo spese ordinarie".
- **Grafico**: toggle "Una linea / Ordinarie e straordinarie" (`localStorage('tesoreria_previsione_linee')`, default una):
  seconda linea verde tratteggiata dello scenario scelto, tooltip con le straordinarie del mese; colonna "di cui straordinarie"
  in tabella.
Effetto al 06/11/2026 (realista, solo per i 5 movimenti segnati): fine 2027 da −7.500 € a +14.700 €, aprile 2027 −83.500 €.

**v4.28.0 — fatture SDI e pagamenti in banca collegati alle spese straordinarie** (richiesta dell'utente). Pulsante
"Fatture e pagamenti" sulla spesa (`GET /piani/interventi/{id}/fatture` → `collegate`, `candidate` con `origine`
passcom|sdi, `pagamenti`, `pagamenti_candidati`, `coperto`, `residuo`):
- **Fatture SDI da registrare** collegabili (chiave `XML:{impronta}#{rata}`, dalle `debiti` di `stato_fatture()`); quando lo
  studio le registra, `_migra_fatture_sdi()` (dentro `_aggiorna_interventi_pagati()`, quindi a ogni `sincronizza_piani`)
  sposta il collegamento sulle scadenze Passcom.
- **Pagamenti in banca** (tabella `tesoreria_intervento_movimenti`, `tes019_2026`, applicata al DB reale): `POST
  /piani/interventi/{id}/pagamenti {movimento_id}`, `DELETE /piani/interventi/pagamenti/{id}`. Il movimento viene segnato
  `straordinario` (al distacco torna com'era, `era_straordinario`). Candidati: uscite dei conti correnti degli ultimi 18 mesi
  non escluse dall'operativo, ★ se `forza_nome(fornitore della spesa, controparte) ≥ 1`.
- **Mai contato due volte**: `coperto_intervento()` = Σ fatture collegate + Σ pagamenti collegati **che non pagano** una fattura
  collegata (abbinamento automatico/confermato); collegare un pagamento di una fattura già collegata → 409.
  `_segna_pagamenti_straordinari()` segna straordinari i movimenti abbinati a fatture collegate, solo se l'abbinamento contiene
  esclusivamente fatture collegate (una Ri.Ba. con fatture ordinarie resta ordinaria).
- **Previsione**: le scadenze Passcom e le fatture SDI collegate a una spesa entrano nel gruppo `interventi` (linea delle
  straordinarie) e non riducono la stima dei fornitori ordinari.
- Pagata: fatture e pagamenti coprono la stima e le fatture collegate sono pagate (SDI: pagata o chiusa).

**v4.29.0 — spese straordinarie per anno, lavori già fatti e fatture pagate tolte dallo storico** (06/11/2026, richiesta
dell'utente: rifacimento sala da pranzo Du Parc 2025, spese grosse e tante piccole; prima si collegava una fattura alla volta da
una tendina di sole fatture aperte). Migrazione `tes020_2026` (applicata al DB reale):
- `tesoreria_interventi.anno` = **anno alberghiero** (1/10–30/9, anno di fine: la piscina fatta a novembre 2026 è un lavoro
  2027), default all'inserimento = anno alberghiero di oggi; le 3 spese esistenti → 2027. Admin: selettore anno ("fatti / in
  corso / in programma", `localStorage('tesoreria_spese_anno')`), colonna Anno, "Costo finora" (= `coperto`, tooltip per
  modalità `per_modalita`), badge "N da completare" (`n_senza_pagamento`).
- `tesoreria_intervento_scadenze.modalita_pagamento` (bonifico|riba|sdd|assegno|carta|contanti) e `data_pagamento` (giorno
  dell'addebito in banca), proposti al collegamento da `predefiniti()`: pagamento trovato in banca (abbinamento automatico o
  confermato: categoria del movimento + data) > fornitore pagato con carta > modalità della fattura (Passcom/MP) + scadenza.
  `PUT /piani/interventi/fatture/{id}`. `_migra_fatture_sdi()` li porta sulle scadenze Passcom.
- **Assegnare fatture anche chiuse**: `POST /piani/interventi/{id}/fatture-sdi {fattura_ids}` (fattura nello scadenzario attuale →
  sue scadenze Passcom, altrimenti rate del file `XML:{impronta}#{n}`; già in un'altra spesa → spostata; autofatture saltate).
  `POST /piani/interventi/{id}/fatture` accetta `chiavi` (più fatture aperte). Scheda **Fatture**: caselle di selezione, "Assegna a
  spesa straordinaria" (esistente o nuova, `ModaleAssegna`), badge della spesa, filtro `spesa=si|no|<id>` (`spese_per_fattura()`),
  spesa nel dettaglio. Finestra "Fatture e pagamenti" in Admin rifatta: modalità e data in riga (salvate subito), aggiunta da
  "Tutte le fatture ricevute" (ricerca su `/tesoreria/fatture`) o "Aperte" (ricerca, selezione multipla, ★ del fornitore), pagamenti
  in banca con ricerca.
- **Previsione** (`services/tesoreria_spese_straordinarie.py`, `_fatture_straordinarie()` in `tesoreria_previsione.py`):
  `da_togliere()` → per categoria della modalità (`CATEGORIA_MODALITA`: fornitori_bonifici/riba/sdd, assegni, carte) e mese della
  data di pagamento; niente per contanti, data mancante o futura, fattura ancora aperta (è tra le uscite certe, gruppo interventi)
  o pagata da un movimento già `straordinario`. `applica_allo_storico()` toglie da `uscite` di `_storico_banca` mai sotto zero
  (eccesso → avviso in Previsione: data o modalità sbagliate). Risposta `straordinarie_tolte`, mostrate nel dettaglio del mese.
  Limite noto: un bonifico singolo collegato come "pagamento senza fattura" **e** la sua fattura con modalità bonifico verrebbero
  tolti due volte (la finestra avvisa di non farlo).

**v4.30.2 — linea "senza le spese straordinarie" anche sul passato** (06/11/2026, scelta (a) dell'utente): ogni punto di
`storico` ha `straordinarie` del mese (`_straordinarie_pagate()` in `tesoreria_previsione.py`: uscite dei conti banca segnate
straordinarie + fatture collegate con pagamento non già straordinario, `_fatture_straordinarie()`, una volta sola) e la risposta
`straordinarie_mese_in_corso`. Nel grafico (`datiGrafico()`) la linea verde sul passato = saldo reale + straordinarie pagate
dall'inizio del grafico (cumulate); sul futuro **continua da lì** = saldo solo ordinario previsto + tutte le straordinarie già
pagate, senza salto. Solo disegno: la previsione non cambia. Al 06/11/2026: 43.818 € pagati da novembre 2025.
**v4.30.3**: la distanza **riparte da zero a ogni anno** (solare o alberghiero, dal toggle in cima): linea verde = saldo (reale
sul passato, previsto sul futuro) + straordinarie dell'anno fino a quel mese (pagate o previste), così il 2027 non porta con sé
quelle del 2026. Calcolo tutto nel frontend (`datiGrafico(d, scenario, tipoAnno)`), `saldo_ordinario` del backend non più usato
dal grafico.
**v4.30.4**: a fine anno uno **scalino** (richiesta dell'utente: con la diagonale dicembre→gennaio sembrava che i lavori non
pesassero a fine anno): la linea verde arriva al 31/12 (o 30/9) con tutte le straordinarie dell'anno, scende in verticale al saldo
(`ReferenceLine segment`) e da lì riparte l'anno dopo; due serie alternate `ordA`/`ordB` per non unire gli anni con una diagonale.

**v4.30.1 — pagamento delle fatture straordinarie cercato anche per importo** (06/11/2026, avviso reale "a apr 2025 le fatture
pagate con Fornitori – bonifici (12.358 €) superano le uscite"): BSD e B & T erano collegate con modalità bonifico ma non
abbinate in banca (troppo vecchie per l'abbinamento automatico), mentre i loro bonifici erano già segnati straordinari → tolte una
seconda volta dallo storico (7.871 € di bonifici ordinari di aprile 2025 spariti dalla stima). `pagamenti_fatture()` in
`tesoreria_piani.py` (usata da previsione, finestra della spesa e collegamento): dopo gli abbinamenti, `abbina_per_importo()`
cerca un'uscita dei conti correnti con lo **stesso importo**, nome compatibile (`nome_compatibile()`: anche una sola parola o
sigla in comune) ed entro **90 giorni** dalla scadenza (Boghi pagato 64 giorni dopo); trovata → data e categoria di quel
movimento, già straordinario = niente da togliere. Non segna nulla come straordinario: togliere la fattura di pari importo
dallo storico ha lo stesso effetto ed è reversibile. Corretta anche `parole()` di `tesoreria_abbinamento.py`: le lettere
singole incollavano la forma societaria ('B & T S.r.l.' → 'BTSRL', 'E C. S.N.C.' → 'ECSNC'); ora `_chiudi_sigla()` la toglie
(14 nomi su 2.844 cambiano, 84 abbinamenti identici prima e dopo). Allineati data e modalità dei 7 collegamenti esistenti.

**v4.30.0 — vedere la fattura** (06/11/2026, richiesta dell'utente). `pages/tesoreria/VistaFattura.jsx` (popup), aperto da
Fatture → dettaglio ("Vedi fattura") e da Admin → Spese straordinarie → "Fatture e pagamenti" (numero della fattura collegata,
"Vedi" nelle ricerche; `fattura_id` dato da `_fatture_sdi_per_chiave()` in `tesoreria_piani.py`: rate XML dall'impronta, scadenze
Passcom dalle fatture trovate nello scadenzario attuale). Due viste:
- **Dati della fattura (XML)**: `GET /tesoreria/fatture/{id}/documento` → `documento_leggibile()` di
  `services/tesoreria_fatture_vista.py` sull'XML salvato: anagrafiche, **righe `DettaglioLinee`** (non estratte in tabella), riepilogo
  IVA, pagamenti, DDT/ordini/contratti, ritenute, cassa, bollo.
- **PDF del fornitore** (3.128 fatture su 4.707 hanno `Allegati`): il DB ha l'XML senza allegati, quindi `_xml_originale()` lo
  ritrova nello ZIP AdE conservato (`trova_nel_zip()` per `nome_file`, ZIP annidati, `.p7m` estratto; prima l'import che l'ha
  inserita, poi gli altri), ~0,02–0,07 s. `GET /tesoreria/fatture/{id}/allegati/{indice}`: **in linea solo PDF e immagini**
  (`FORMATI_IN_LINEA`), il resto (testi, ZIP, XML, HTML) come `attachment` `application/octet-stream` + `nosniff`, perché l'HTML
  di un fornitore aperto in linea verrebbe eseguito. ZIP originale cancellato → `allegati_non_disponibili`.

### Da fare più avanti (idee approvate dall'utente, non ancora pianificate)
- **Ritmo di incasso da più anni** (03/11/2026): oggi entrate e caparre della previsione usano un solo anno di
  riferimento (`anno_riferimento()`, il più recente). ⚠️ Per l'utente i dati affidabili partono dalla **stagione 2026**
  (caparre incassate da ottobre 2025): la stagione 2025 non va usata come riferimento. Quindi con almeno due stagioni
  (dalla previsione della stagione 2028: stagioni 2026 e 2027) calcolare per ogni anno la quota della stagione incassata mese per mese, fare la
  media pesata (più recente 2:1, come il pickup del Budget) e applicarla al totale atteso dal Budget. Possibile
  anche correggere il ritmo dei mesi futuri quando a metà inverno si è molto avanti o indietro (oggi la rettifica
  caparre sposta solo sul mese di arrivo).

### Punti aperti da chiarire con l'utente
- Fase 3e: se usare il modulo Forecast per gli incassi futuri (verificare prima IVA inclusa/esclusa
  e confronto con gli incassi in banca 2026).

### Collegamenti con altri moduli
Elenco obbligatorio (se cambia l'altro modulo, controllare qui). Lettura **solo** tramite funzioni
esistenti, mai query duplicate sulle loro tabelle.
- **Corrispettivi → Cassa**: `riepilogo_cassa()` (`routers/corrispettivi_cassa.py`) chiamata da
  `_contanti()` in `routers/tesoreria_report.py` (posizione attuale). Usa `saldo_corrente`,
  `mesi[-1].mese`, `saldo_iniziale.data`: se cambiano nome o significato, aggiornare `_contanti()`.
- **Moduli/permessi**: `app/permessi.py` (condiviso con `lista_moduli()`).
- **Corrispettivi → tassa di soggiorno incassata**: `report_fatturati()` di `routers/corrispettivi_report.py`
  (`mesi[].per_struttura[].tassa_soggiorno`, annullati esclusi) in `_tassa_incassata_per_mese()` di
  `routers/tesoreria_kpi.py`.
- **Dipendenti → stipendi netti**: `netti_per_mese()` di `routers/dipendenti.py` in `dati_previsione()` e
  `posizione()` (avviso cedolini mancanti).
- **Dipendenti → F24**: `costi_f24_per_mese()` di `routers/dipendenti.py` (voci `VOCI_F24`) in `dati_fiscali()` di
  `routers/tesoreria_impegni.py`. **Contabilità USALI → IRES**: `risultato_per_mese()` di `services/usali_contabile_kpi.py`.
  **Corrispettivi → tassa di soggiorno futura**: `_tassa_incassata_per_mese()` di `tesoreria_kpi.py`.
- **Tesoreria interna**: `tesoreria_import.conferma_import`/`elimina_import` chiamano
  `ricalcola_abbinamenti()` di `tesoreria_abbinamenti.py` (gli estratti conto cambiano gli abbinamenti).
- **Tesoreria interna (caparre)**: `caparre_db()`/`senza_periodo_db()`/`caparre_per_mese()` di `tesoreria_caparre.py`
  usate da `tesoreria_previsione.py` (rettifica) e `caparre_posizione()` da `tesoreria_report.posizione()`.
- **Forecast → prenotazioni Welcome**: `indice_welcome()` (tesoreria_shared) legge `prenotazioni_cancellate`
  (non disdette, non test); `routers/prenotazioni.py` chiama `aggiorna_caparre()` dopo import ed eliminazione.
- **Corrispettivi → IVA vendite**: `report_fatturati()` (lordo e netto) in `vendite_iva_per_mese()` di
  `routers/tesoreria_iva.py`; **stagioni**: `hotel_seasons` per dire se un mese doveva avere incassi.
- **Attività ricorrenti**: `routers/attivita.py::_evidenze()` legge `tesoreria_fatture_import.ricezione_a`.
- **Indice WAVE → ricavi 2025**: `lordo_storico_anno()` di `services/wave_dati.py` in `_ricavi_e_budget()` della previsione.
- **Corrispettivi → export**: `_risposta_tabella()` di `routers/corrispettivi_documenti.py` (xlsx/csv/pdf
  da intestazioni + righe) usata dagli export di Movimenti e Consuntivo.

### Diario sessioni
- **27/10/2026** — aggiunta la specifica `prompt_hotelos_tesoreria.md` e questa sezione. Nessun
  codice scritto. Prossimo passo: strategia della Fase 1 da presentare e far approvare.
- **27/10/2026 (2)** — **Strategia Fase 1 presentata, NON ancora approvata** (utente uscito prima di
  rispondere). Nessun codice scritto. Riassunto della proposta:
  - Backend: `models/tesoreria.py` (6 tabelle), migrazione `tes001_2026` (tabelle + seed conti/saldi/
    categorie/regole + modulo + permessi viewer=false), `services/tesoreria_parser.py` (TSV latin-1,
    impronta, controparte), `services/tesoreria_classificatore.py` (puro), `services/tesoreria_saldi.py`
    (saldo a data avanti/indietro + verifica tra saldi noti), router aggregatore `tesoreria.py` +
    `tesoreria_import|movimenti|config|report.py`, test con fixture anonimizzate.
  - Regole (estensione del modello `usali_categoria_kpi`): campo descrizione|controparte, operatore
    inizia|contiene, valori (OR), condizione aggiuntiva facoltativa (AND con secondo elenco OR), segno
    entrata|uscita|entrambi, priorità; "Da classificare" = ripiego, non una regola.
  - Impronta: conto + data contabile + data valuta + importo + descrizione + indice di occorrenza;
    proposto di NON includere il campo Note (la banca potrebbe aggiungerlo dopo). UNIQUE(conto, impronta).
  - Eliminazione import: cancella i movimenti che quell'import ha inserito per primo (avviso esplicito).
  - Contanti: `riepilogo_cassa()` di `corrispettivi_cassa.py` chiamata come funzione (`saldo_corrente`
    dell'anno corrente, data = fine dell'ultimo mese con dati).
  - Frontend: `Tesoreria.jsx` con tab Posizione / Consuntivo / Movimenti / Import; Admin gruppo
    "Tesoreria" (Conti, Categorie, Regole + ricalcolo, Soglie avvisi); NavBar prefisso + subnav `[]`;
    versione 4.0.0.
  - Ordine blocchi (verifica utente tra uno e l'altro): A modelli/migrazione/parser/classificatore/saldi
    + test → B endpoint import/movimenti/config → C posizione/consuntivo → D frontend + CLAUDE.md + commit.
  - Rischi segnalati: nessun estratto conto reale ancora disponibile; override per-utente di
    `puo_vedere` darebbe 403 dal backend a un viewer abilitato; ACL `uploads/tesoreria`.
  **Domande in attesa di risposta (riprendere da qui):**
  1. Visibilità solo admin confermata?
  2. Il saldo noto al 27/10 è a fine giornata (include i movimenti del 27) e per data contabile?
  3. Da che data verranno importati gli estratti conto (serve il 2025 per il confronto anno precedente)?
  4. Fido scaduto: escluderlo dalla disponibilità con avviso, o conteggiarlo finché non lo si toglie?
  5. KPI entrate/uscite del Consuntivo senza le categorie `escludi_da_operativo` (mostrate a parte)?
  6. Un estratto conto reale per conto in `uploads/tesoreria_campioni/` (fuori git) per verificare il parser.
- **28/10/2026** — l'utente ha caricato in `uploads/tesoreria_campioni/banca_conto_principale/` tre
  export del conto 095081 (xls "semplificato" = formato della specifica, xls "gestionale" con colonne
  Dare/Avere/Causale separate, `export.xml` CBI). Analizzati: stessi 93 movimenti (solo 01–28/10/2026,
  non tutto il 2026). **Proposto l'XML CBI** come formato principale (IBAN → conto automatico, saldo
  apertura/chiusura giornaliero `OPBD`/`CLBD` → verifica saldi automatica, riferimento univoco
  `AcctSvcrRef` per l'antiduplicato, codice causale ABI `BkTxCd`, importi/date ISO). Unico dato in
  meno: numero assegno ("Vs assegno n." vuoto). Domanda 2 risolta dai dati: 347.086,84 = saldo di
  chiusura del 27/10 (= apertura del 28/10). In attesa della scelta dell'utente sul formato.
- **28/10/2026 (2)** — il periodo ott. lo aveva scelto l'utente (la banca esporta anche l'anno intero).
  Riesportato l'XML di ottobre (`export ottobre.xml`, 40 min dopo): identico a parte `CreDtTm` →
  `AcctSvcrRef` stabile tra esportazioni (da riverificare con un periodo sovrapposto diverso).
  Conto POS (`banca_conto_pos/export 2026 POS.xml`): stesso formato CBI, IBAN …217746, 285 movimenti
  02/01–02/10/2026, 105 giorni tutti quadrati e continui, saldo finale 3.325,31 (= seed), minimo
  −39.574,23 (fido in uso). Il fido **non** è nel file (`CLAV` = `CLBD`): resta un dato del conto.
  Causali POS: Incassi Internazionali Numia (09//15), Incassi PagoBancomat (09//02), giroconti
  "Bonifico a favore di *KM DI MARE SRL GC POS" (26//10, −830.000 € nel 2026), interessi trimestrali.
  ⚠️ **Regola giroconti: confrontare solo la controparte estratta, mai il testo intero**: ogni
  bonifico in uscita del conto principale contiene "Intestazione ordinante: KM DI MARE SRL" nelle info
  aggiuntive — una regola "contiene KM DI MARE" sulla descrizione li classificherebbe tutti giroconti.

- **28/10/2026 (3)** — blocco B fatto (endpoint import/movimenti/config + permessi per modulo in
  `app/permessi.py`), prova sui 4 XML reali via endpoint ok. Prossimo: blocco C (posizione attuale,
  consuntivo, avvisi di freschezza con soglie in `app_config`) — serve l'ok dell'utente.
- **28/10/2026 (4)** — blocco C fatto (posizione, consuntivo, soglie), prova sui dati reali con
  quadratura ok. Prossimo: blocco D (frontend `Tesoreria.jsx`, Admin, attivazione modulo, 4.0.0) —
  serve l'ok dell'utente.
- **28/10/2026 (7, fine giornata)** — dopo la Fase 1, su richiesta dell'utente: v4.1.1 link "vedi" dei
  movimenti da classificare; v4.1.2 anno precedente affiancato nel grafico del consuntivo; v4.2.0–4.2.2
  export xlsx/csv/pdf di Movimenti e Consuntivo (pdf orizzontale) e colonne Controparte/Descrizione
  separate; v4.3.0 controparte e causale dai dati strutturati della banca (6.693 movimenti rielaborati,
  0 categorie cambiate); v4.4.0–4.4.2 scheda KPI (indici 1, 2, 3, 6, 8, 10) con tassa di soggiorno per
  trimestre. Annotate le indicazioni per Fase 2 (GoProfit resta operativo, HotelOS controlla con la banca,
  fonte Passcom) e Fase 3 (IVA trimestrale, fonti di stima per imposta). Dati reali caricati: XML
  2025–2026 dei due conti; saldi carte/prepagata da inserire dall'utente. **Prossimo passo**: uso del
  modulo da parte dell'utente; la Fase 2 parte solo con il suo ok (presentare prima la strategia).
- **28/10/2026 (6)** — v4.1.0: carte di credito azzerate in automatico all'addebito in banca (l'utente
  inserisce solo il totale di ogni estratto). XML 2025–2026 dei conti già caricati dall'utente.
- **29/10/2026** — analizzato lo ZIP fatture AdE (Fase 5); v4.4.3 conferma cambio categoria in Movimenti.
  **Fase 2 avviata**: roadmap e decisioni sopra; blocco A fatto (tabelle + lettore scadenzario).
  Blocco B fatto (import a fotografie, sostituzione stesso giorno con conferma).
  Blocco C fatto (abbinamento con la banca). Blocco D fatto: scheda Scadenzario, pareggi distribuiti per
  fornitore (i pagamenti MARR erano già registrati come pareggi), KPI fornitori. **Fase 2 chiusa con v4.5.0.**
  Prossimo: l'utente carica lo scadenzario reale e usa la scheda; Fase 3 solo con il suo ok (strategia prima).
- **30/10/2026 — PUNTO DI RIPRESA.** Fase 2 chiusa (v4.5.0–4.5.2). Raccolti tutti i dati per la Fase 3
  (quietanze F24/F23 2025–2026, TARI acconto + conguaglio, Redditi SC/IRAP anno 2024, IVA anni 2024–2025,
  contratti d'affitto Club e International, schema Du Parc, ricorrenti dalla banca): vedi le sezioni
  "Fase 3 — …" sopra. **Strategia della Fase 3 presentata** con risposte dell'utente (orizzonte 31/12/2027,
  credito IVA su tutti gli F24 tranne TARI, incassi ristoranti dal Budget). L'utente lavora al **Budget dei
  ristoranti (MMS/BON) in un'altra sessione**. **Prossimo passo (31/10/2026)**: partire con la **Fase 3,
  blocco A** (tabelle `tesoreria_impegni` + calendario fiscale + lettore avviso TARI + collaudo sul 2026) —
  l'utente ha detto "domani partiremo"; confermare comunque con lui prima di scrivere codice, e prima del
  blocco C verificare che il Budget includa i ristoranti.
- **02/11/2026** — Fase 3, blocco A fatto (solo backend, vedi sezione). Collaudo sul 2026 con quietanze e banca; dati
  fiscali reali e avviso TARI caricati. **Serve il riavvio del backend** per gli endpoint. **Prossimo passo**: blocco B
  (affitti, mutuo con `xlrd`, ricorrenti, interventi, carte), con strategia e ok dell'utente.
- **02/11/2026 (2)** — Fase 3, blocco B fatto (v4.11.0). **Prossimo passo**: blocco C (motore di previsione, incassi da
  Budget, scenari, altri crediti F24 dalla base dell'anno prima, sottrazione dei ricorrenti dalla stima), con ok dell'utente.
- **02/11/2026 (3)** — Fase 3, blocco C fatto (v4.12.0). **Prossimo passo**: blocco D (schede Previsione e Impegni, ricorrenti e
  mutuo in Admin, salva previsione, collegamento interventi–scadenzario), con strategia e ok dell'utente.
- **02/11/2026 (4).** Fase 3 chiusa (v4.14.0). Da verificare a video le schede nuove. Rate modificate
  dall'utente: Du Parc canone 2026 al 50% (79.300 € da pianificare, fuori previsione), International 33,3% × 3 (99,9%).
  **Prossimo passo**: uso reale, poi Fase 4 solo con ok dell'utente (strategia prima).
- **03/11/2026 — PUNTO DI RIPRESA.** Fase 3 chiusa (lasciate fuori due voci, vedi decisioni Fase 4). Fase 4
  avviata: **blocco A caparre fatto (v4.20.0–4.21.0)**, **blocco B stipendi netti fatto (v4.22.0)**. Serve il riavvio
  del backend. Blocchi C e D **rimandati finché non ci sono dati** (criteri nella sezione "Blocchi C e D rimandati"):
  a ogni sessione sulla Tesoreria controllarli e, se soddisfatti, ricordarlo all'utente. **Fase 5 (fatture XML): in
  attesa** che l'utente scarichi dall'AdE tutti gli ZIP delle fatture ricevute 2025 e 2026 (regole nella sezione
  "Fase 5 — regole per scaricare gli ZIP"), poi strategia e ok.
- **05/11/2026** — Fase 5 avviata: blocco A (lettore ZIP) e blocco B (import, stato rispetto a Passcom e banca,
  debiti da registrare in previsione) fatti; scelta b (nessuno stato "da verificare"). Backend riavviato e **storico
  fatture caricato nel DB reale** (8 ZIP, 4.707 fatture, import #1–#8): 1 da registrare, 11 da confermare.
  Abbinamenti automatici/confermati: **72 su 38 fornitori → criterio del blocco 4C raggiunto** (segnalato). Blocco C
  (stima IVA mensile, opzione 1) e blocco D (schermate) fatti: **Fase 5 chiusa con v4.24.0**. Prossimo: uso reale;
  Fase 4C (tempi di pagamento) pronta a partire con l'ok dell'utente.
- **28/10/2026 (5)** — blocco D fatto, **Fase 1 chiusa con v4.0.0**. Modulo attivo (solo admin).
  Prossimo: l'utente importa gli XML reali e usa il modulo; correzioni; poi strategia Fase 2
  (scadenzario Passcom) — serve l'ok dell'utente.
