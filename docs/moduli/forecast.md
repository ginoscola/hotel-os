<!-- Spostato da CLAUDE.md il 07/11/2026, testo invariato: dove si legge "questa sezione" o "in CLAUDE.md" si intende questo file. Le regole generali restano in CLAUDE.md. -->

## Modulo Forecast & OTB
- **OTB**: da `daily_revenue`, identificato da `snapshot_date`
- **Maturato**: override manuale OTB, un record per (hotel_id, anno, mese)
- **Pickup rate**: % incremento su base (maturato se presente, altrimenti OTB)
- **Consuntivo**: snapshot più recente per ogni data

Tabelle (`forecast_maturato`, `forecast_budget`, `forecast_pickup_config`): UNIQUE per (hotel_id, anno, mese).
Endpoint: `GET /forecast/summary?anno=&hotel_code=` (hotel_code=all → aggregato), `GET /forecast/pace`, `PUT /forecast/maturato|budget|pickup-config`, `DELETE /forecast/maturato/{id}`.

⚠️ **Tab "Cancellazioni" (stima picco-vs-attuale) rimossa** (settembre 2026): esisteva una prima
versione che stimava le camere perse confrontando `rooms_sold` tra tutti gli snapshot di
`daily_revenue` (`_cancellazioni_hotel()`/`GET /forecast/cancellazioni`, oggi cancellati). Rimossa
dopo aver messo a confronto i due numeri sulla stagione 2026: la stima dava 446 camere/36.349€
persi, il dato reale da import Welcome (vedi sotto) 1.029 camere/671.467€ — gap enorme e non un
semplice rumore. Causa identificata: la stima è un **saldo netto per data** (picco storico meno
ultimo snapshot), quindi una camera cancellata e poi rivenduta prima dello snapshot successivo non
genera alcuna perdita netta, pur essendo una cancellazione reale — con vendite che continuano tutta
la stagione questo da solo spiega gran parte del gap sulle camere; il gap sul revenue (18x, molto
più ampio di quello sulle camere, 2,3x) suggerisce inoltre che le prenotazioni cancellate realmente
includano soggiorni/importi più alti (es. gruppi multi-camera) che il modello netto-per-notte non
cattura proporzionalmente. Limite aggiuntivo, già noto, della stima: nessuna visibilità prima del
primo snapshot Revenue (16/03/2026). Codice recuperabile dalla history git se in futuro servisse un
fallback per periodi non coperti da import reali (oggi non è il caso: si punta al mega import
dell'intera stagione — vedi sotto).

**Tab "Cancellazioni"** (4° tab, settembre 2026, rinominata da "Cancellazioni reali" dopo la
rimozione della stima sopra — nessuna ambiguità restante col nome breve): dato reale
da import manuale dell'export Welcome (una riga = una camera cancellata), non
derivato per confronto di snapshot. Nasce da un'indagine reale su un report di analisi cancellazioni
(generato da un'altra sessione Claude su richiesta dell'utente) che dichiarava un 27,9% di
cancellato/gruppo: risultato falso, causato dall'aver scambiato la colonna "7gg" (flusso settimanale
di nuove prenotazioni acquisite, volatile per natura) con lo stock di fatturato corrente per quella
settimana di arrivo — un normale calo di ritmo di vendita settimanale non è una cancellazione.
- **Modello**: `PrenotazioneCancellataImport`/`PrenotazioneCancellata` in `models/prenotazioni.py`
  (migrazione `prenot001_2026`). Una riga = una camera (una prenotazione multi-camera genera più
  righe con lo stesso `codice_ota`). ⚠️ **Nessun ID prenotazione univoco nell'export**: l'interfaccia
  Welcome mostra un "Codice Prenotazione" interno (es. 6097) e persino una colonna "Data
  cancellazione" a schermo, ma il pulsante "Esporta" di quella vista **non le include** — verificato
  chiedendo esplicitamente all'utente di provare (nessuna opzione per personalizzare le colonne
  esportate). La dedup usa quindi una chiave composita (`is_test`, hotel, codice_ota, data
  prenotazione, arrivo, partenza, tipo camera, importo, cliente) — `codice_ota` è `''` (non `NULL`)
  per le prenotazioni dirette/manuali, stesso accorgimento anti-`NULL<>NULL` già usato in
  `prod_righe`. **Nessuna data di cancellazione disponibile**: si sa solo che una prenotazione fatta
  in un dato mese è stata *poi* cancellata, non quando — quindi non è possibile costruire un
  incrocio mese-prenotazione × mese-cancellazione, solo il totale cancellato per mese di
  prenotazione (i file storici gen-lug+set 2026 usati per validare questo modulo erano filtrati per
  mese di prenotazione lato Welcome, non per mese di cancellazione — un primo tentativo di file
  "agosto" era invece filtrato per data di cancellazione, causando conteggi doppi con marzo-luglio
  finché non è stato rigenerato con lo stesso filtro degli altri mesi).
- **Due colonne opzionali per compilazione manuale** (`numero_prenotazione`, `data_cancellazione`
  sul modello — migrazione `prenot002_2026`), pensate per quando l'utente ha tempo di aprire la
  scheda prenotazione su Welcome e copiare a mano "Codice Prenotazione" e "Data cancellazione"
  (visibili solo a schermo, non nell'export) prima di caricare il CSV: il parser le legge se
  presenti nell'intestazione **con lo stesso nome usato a schermo in Welcome** ("Codice
  Prenotazione", "Data cancellazione" — scelta deliberata per non costringere l'utente a imparare
  un nome colonna diverso), accetta la data in formato ISO o italiano (`gg/mm/aaaa`), e non richiede
  nulla se le colonne mancano del tutto (comportamento identico a prima, verificato). Non fanno
  parte della chiave di dedup (restano popolate solo sulla prima riga inserita, non sovrascritte
  dai re-import successivi).
  ⚠️ **`pax` è nella chiave di dedup** (migrazione `prenot003_2026`) dopo un bug reale al primo
  import vero: due camere della stessa prenotazione (stesso hotel/data/tipo camera/importo/cliente,
  es. due D-Smart identiche a 432,90€) con `pax` diverso (2 e 1) collidevano sulla chiave originale
  e la seconda veniva scartata come falso duplicato — stesso tipo di problema già visto in
  `prod_righe` con ospite vuoto. Verificare sempre `n_inserite` vs righe attese nel CSV dopo un
  import con più camere per prenotazione.
  ⚠️ **`GET /report` e `GET /` filtrano per anno di `arrivo`, non di `data_prenotazione`** (bug
  reale, corretto): filtrare sull'anno della prenotazione escludeva le righe prenotate con largo
  anticipo nell'anno precedente (es. prenotato il 27/11/2025 per un soggiorno di luglio 2026) — con
  il formato "Elenco Prenotazioni" (vedi sotto) capita spesso, non un'eccezione isolata come nel
  formato precedente: su un file di test, 5 righe su 10 sparivano filtrando anno=2026. L'anno deve
  riferirsi alla stagione (= anno di arrivo), coerente con `hotel_seasons` e col resto dell'app.
- **`data_rilevata`** (obbligatoria, = data dell'import): fallback pratico quando manca
  `data_cancellazione` — con import ripetuti nel tempo dello stesso mese di prenotazione, una riga
  mai vista prima negli import precedenti (quindi non scartata dalla dedup) prende come
  `data_rilevata` la data dell'import corrente, dando una finestra indicativa sul periodo di
  cancellazione invece di nessuna informazione temporale. Mostrata in tabella con un trattino "~" a
  distinguerla da una data cancellazione certa.
- Endpoint (prefix `/prenotazioni-cancellate`): `POST /import?mese=&anno=&is_test=` (admin,
  multipart CSV o XLSX — avvisa, non scarta, se `dataPren` di alcune righe cade fuori dal mese/anno
  dichiarati), `GET /import/storico`, `DELETE /import/{id}?conferma=true`, `GET /report?anno=&
  hotel_code=&canale=&arrivo_da=&arrivo_a=` (aggregati per mese prenotazione/hotel/canale),
  `GET /?...&pagina=&per_pagina=` (righe grezze paginate), `GET|DELETE /admin/test-stats|test-data`.
  ⚠️ **`mese` è opzionale** (`prenot004_2026`, colonna nullable): pensato per "PrenotazioniWeb"
  (dove valida `data_prenotazione` riga per riga — vedi sopra), ma non ha senso per un mega import
  "Elenco Prenotazioni" di tutta la stagione in un colpo solo, dove serviva solo come etichetta
  inerte (il parser di quel formato non lo usa mai per validare). Omesso → `mese=NULL`,
  `mese_label="Intera stagione"` in `_fmt_import()`; passato comunque a `parse_csv()` come `0`
  (mai un mese reale, innocuo perché "Elenco Prenotazioni" lo ignora e "PrenotazioniWeb" lo userebbe
  solo per il warning "fuori mese", mai per rifiutare righe).

**Secondo formato supportato: "Elenco Prenotazioni"** (settembre 2026, sostituisce "PrenotazioniWeb"
come fonte principale — molto più semplice e veloce da esportare per l'utente): CSV **punto e
virgola** (non virgola) rilevato dall'intestazione "Codice prenotazione", oppure **XLSX** diretto
(rilevato dai byte iniziali `PK`, firma zip) — stesso schema, stesse colonne. Date italiane
`gg/mm/aaaa`, importi con virgola decimale. A differenza di "PrenotazioniWeb": ha un **ID
prenotazione nativo** (`Codice prenotazione`, va in `numero_prenotazione`) e una **vera data di
cancellazione nativa** (`Data cancellazione`) — le due colonne opzionali sopra non servono più per
questo formato. Filtrato lato Welcome per mese/periodo di **arrivo** (anche l'intera stagione in
un colpo solo, tutti gli hotel insieme — `Ubicazione` distingue la struttura riga per riga): per
questo formato `mese`/`anno` in fase di upload sono solo un'etichetta per l'import, **nessun
controllo di coerenza sulle date** (un "mega import" di più mesi non deve generare falsi avvisi
"fuori mese" — a differenza di "PrenotazioniWeb", dove mese/anno validano `data_prenotazione`).
⚠️ **Contiene versioni storiche della stessa prenotazione**: una modifica (importo cambiato,
conferma, ecc.) genera una nuova riga con lo stesso `Codice prenotazione` — se cambia anche la
camera (`Risorsa`) sono camere realmente distinte della stessa prenotazione multi-camera (tenute
entrambe), se la camera è la stessa sono versioni nel tempo della stessa riga (`parse_elenco_prenotazioni`
raggruppa per (codice, camera) e tiene solo quella con `Data cancellazione` più recente). Caso reale
verificato: codice 905, 3 righe, stessa camera I426, importi/stato diversi (1739€ Prenotata→1764€
Prenotata→1759€ Confermata) — tenuta solo l'ultima. ⚠️ Questa deduplica funziona solo **dentro lo
stesso file caricato in una volta**: se in futuro (stagione 2027) si passa a import settimanali
invece che un mega import unico a fine stagione, una prenotazione modificata tra un import e il
successivo genererebbe righe separate nel database (la dedup a livello DB usa la chiave composita
di `PrenotazioneCancellata`, che include `importo` — versioni con importo diverso non collidono) —
da risolvere prima di adottare import ricorrenti, non ancora fatto.
⚠️ **`trattamento` era `varchar(20)`, troppo corto per un valore reale del file** (bug reale,
settembre 2026): a differenza di "PrenotazioniWeb" (dove `trattamento.nome` è tipicamente un codice
breve, BB/HB/FB), "Elenco Prenotazioni" riporta la descrizione estesa del trattamento così com'è in
Welcome (es. "Pensione Completa con bevande incluse...") — un mega import reale falliva con
`StringDataRightTruncation` sulla prima riga con un trattamento lungo, l'intero import annullato
(nessuna riga inserita). Fix (`prenot005_2026`): colonna allargata a `varchar(100)` (stessa misura
di `canale_vendita`/`tipo_camera`, altri campi testo libero dello stesso file).
Parser: `services/prenotazioni_parser.py` — `parse_csv()` è il dispatcher che rileva il formato e
smista a `_parse_csv_prenotazioniweb()` o `parse_elenco_prenotazioni()`; quest'ultimo prende le
righe già lette (da CSV con `csv.DictReader(delimiter=";")` o da XLSX con `openpyxl`, entrambe
convertite nello stesso formato dict-per-riga prima di entrare nella logica comune). `_num_it()`/
`_parse_data_it()` gestiscono sia stringhe (CSV) sia tipi nativi Excel (float/datetime già tipizzati
in celle xlsx formattate) — verificato con entrambi i casi reali.
- Frontend: **5° tab separato "Importa Welcome"** (rinominata da "Importa Cancellazioni Welcome"
  dopo l'aggiunta dell'import "Prenotazioni non disdette" — non è più solo cancellazioni; solo
  admin — non un pannello fisso in cima alla tab di consultazione come nella primissima versione,
  spostato su richiesta esplicita per non sporcare la pagina quando si va solo a guardare i dati):
  pannello upload + storico import
  con eliminazione. La tab "Cancellazioni" resta solo consultazione (filtri, **due grafici a
  barre mensili** — per mese di prenotazione e, subito sotto, per mese di **arrivo** [`per_mese_arrivo`
  nella response di `/report`, stesso calcolo ma su `r.arrivo.month`] — utile perché le due viste
  raccontano cose diverse: la prima quando è stata *fatta* la prenotazione poi cancellata, la seconda
  per quale periodo di *soggiorno*, tabelle), colonne dettaglio "Codice Prenotazione"/"Data
  cancellazione" (quest'ultima mostra `~data_rilevata` in grigio se il valore certo manca).
  ⚠️ **`prenotazione_da`/`prenotazione_a` esistevano in UI ma non arrivavano a `/report`** (bug reale,
  corretto lo stesso giorno): la funzione `_applica_filtri()` li supportava già, ma l'endpoint
  `report()` non li dichiarava tra i query param e passava `None, None` al loro posto — quindi i due
  grafici, i KPI e le tabelle per struttura/canale ignoravano il filtro periodo di prenotazione
  (applicato solo alla tabella dettaglio). Utile per capire, es., "delle prenotazioni fatte a
  febbraio, per che mese di arrivo erano" — che è esattamente il pattern osservato sui dati reali:
  quasi tutte le cancellazioni prenotate fino ad aprile sono per soggiorni di agosto.
- **Filtro "Struttura" indipendente dal selettore hotel in cima alla pagina** (stesso pattern già
  usato in `TabPace`): stato locale `hotelFiltro` inizializzato dall'header ma poi controllato solo
  dalla propria select nella riga filtri — l'utente può guardare "Riepilogo Stagione" per un hotel e
  "Cancellazioni" per tutti (o un altro) senza che cambino insieme.
  ⚠️ Il backend serializza `created_at` degli import con `.isoformat()` completo (con ora e fuso);
  `formatDataIt()` del frontend si aspetta invece una data pura `YYYY-MM-DD` e fallisce silenziosamente
  su un datetime completo (`NaN` al posto del giorno) — bug reale trovato nella tabella storico import,
  corretto troncando a `.date().isoformat()` lato backend. Attenzione a questo stesso pattern se si
  espone `created_at`/altri `DateTime` in un nuovo endpoint pensato per `formatDataIt()`.

**Modifica/cancellazione riga + reimport intelligente** (settembre 2026): nato da un problema reale
— l'utente aveva visto prenotazioni cancellate manualmente e poi reinserite a mano su Welcome,
creando dati fuorvianti che andavano corretti o eliminati direttamente in HotelOS, senza che un
reimport li sovrascrivesse silenziosamente.
- **`modificato_manualmente`** (`prenot006_2026`, Boolean default false) su `PrenotazioneCancellata`
  — stesso pattern di `corrispettivi_documenti.modificato_manualmente`. Impostato a `true` solo da
  `PUT /prenotazioni-cancellate/{id}` (admin, `ModaleModificaCancellazione` in `Forecast.jsx`):
  form con tutti i campi principali, `notti` sempre ricalcolato server-side da arrivo/partenza (mai
  inviato dal client). `DELETE /prenotazioni-cancellate/{id}?conferma=true` (admin) rimuove la riga
  — stesso pattern `?conferma=true` già in uso per l'eliminazione import, con `window.confirm()`
  lato frontend prima della chiamata.
- **Ricerca libera** (`q` su `GET /prenotazioni-cancellate/`, debounce 400ms lato frontend): ILIKE
  su tutti i campi testuali (hotel, canale, codice prenotazione, cliente, camera, trattamento,
  mercato) + campi numerici/data castati a testo (`cast(col, String)`) così anche un importo
  ("540") o una data ("2026-07") sono cercabili. Stessi filtri di struttura/canale/periodo della
  tabella, non un filtro separato.
- **Ordinamento cliccabile** (`ordina_per`/`direzione=asc|desc` su `GET /prenotazioni-cancellate/`,
  settembre 2026): whitelist `_COLONNE_ORDINABILI` in `prenotazioni.py` (hotel, canale, codice
  prenotazione, date, cliente, camera, importo) — mai una colonna arbitraria da query string diretta
  in `order_by()`. Frontend: componente `ThOrd` (intestazione cliccabile, freccia ▲/▼ sulla colonna
  attiva, secondo click sulla stessa colonna inverte la direzione), stato `ordinaPer`/`direzione` in
  `TabCancellazioni`, reset pagina a 1 al cambio come per gli altri filtri.
- **`dati_grezzi`** (JSON nullable, `prenot007_2026`): l'intera riga del file "Elenco
  Prenotazioni" così com'è — tutte le colonne, comprese quelle non mappate a un campo proprio
  (es. Segmento, Fonte, Nazione) — non solo i pochi campi già modellati. Nato da una richiesta
  esplicita dell'utente: "dati che magari non uso ora ma potrebbero essere utili in futuro", per
  non dover aggiungere una colonna dedicata (e una migrazione) ogni volta che serve un nuovo campo
  del file. `_serializza_grezzo()` in `prenotazioni_parser.py` converte date/datetime delle celle
  xlsx native in stringa ISO prima di salvarle (altrimenti non serializzabili in JSON). **Non
  modificabile da `PUT /prenotazioni-cancellate/{id}`** (resta lo snapshot dell'import originale
  anche dopo una correzione manuale dei campi "veri" — coerente con lo scopo di audit/riferimento).
  Incluso nella ricerca libera (`cast(dati_grezzi, String).ilike(...)`): cerca anche dentro ai campi
  non ancora promossi a colonna propria. Frontend: sezione `<details>` collassata "Dati grezzi dal
  file" in fondo al modale di modifica, tabella chiave/valore di sola lettura, nascosta del tutto se
  `dati_grezzi` è `NULL` (righe importate prima di questa modifica, o formato legacy
  "PrenotazioniWeb" — anche lì popolato dal parser ma con molti meno campi disponibili in origine).
  ⚠️ Non richiede alcun reimport dei dati esistenti: è additivo, le righe già in DB (comprese quelle
  già modificate/cancellate a mano) restano invariate con `dati_grezzi=NULL` finché non vengono
  reimportate (rispettando comunque la stessa protezione `modificato_manualmente` di sempre).
- **Vista mensile in ordine di anno commerciale (ott→set), non anno solare (gen→dic)**:
  `_MESI_ORDINE_COMMERCIALE = [10,11,12,1,...,9]` in `prenotazioni.py` — la stagione operativa è
  maggio-settembre (`hotel_seasons`), quindi le prenotazioni fatte a ottobre/novembre/dicembre sono
  quasi sempre per la stagione SUCCESSIVA (chi prenota con largo anticipo), non un residuo di quella
  appena chiusa. `per_mese`/`per_mese_arrivo` in `GET /report` restano dict chiave=mese-numero
  (1-12, invariato per l'accumulo), solo l'ORDINE della lista in output cambia — il frontend non ha
  bisogno di modifiche, mappa l'array così com'è sull'asse X del grafico.
- **Toggle Mensile/Giornaliero sui due grafici** (`SegmentedControl`,
  `localStorage('cancellazioni_vista_periodo')`): a mensile
  restano i `BarChart` di sempre; a giornaliero diventano `LineChart` (barre illeggibili su fino a
  365 punti, una linea rende sia i picchi isolati sia i periodi piatti). `GET /report` calcola
  `per_giorno`/`per_giorno_arrivo` nello stesso giro sui dati già usato per `per_mese`/
  `per_mese_arrivo` (nessuna query aggiuntiva). ⚠️ **Il range giornaliero è il min/max effettivo
  tra le righe filtrate, non l'anno solare intero**: restringere i filtri data esistenti
  (`arrivo_da/a`, `prenotazione_da/a`) restringe automaticamente anche la vista Giornaliero, senza
  bisogno di un filtro dedicato al grafico — utile per analizzare periodi più brevi (es. un singolo
  mese) restando sugli stessi controlli già in pagina. Verificato: filtrando `arrivo_da/a` su 15
  giorni di agosto, `per_giorno_arrivo` si riduce esattamente a 15 punti mentre `per_giorno`
  (prenotazione) resta ampio (le prenotazioni per quel periodo di arrivo sono fatte su mesi diversi)
  — i due assi si restringono indipendentemente, coerente con cosa filtra ciascuno.
- **Secondo toggle Prenotazioni/Fatturato**, stesso stile pillola, sotto quello Mensile/Giornaliero
  (`localStorage('cancellazioni_vista_metrica')`): sceglie se i due grafici mostrano `n` (camere
  cancellate) o `importo` — dato già presente in ogni punto di `per_mese`/`per_giorno` e affini,
  quindi puro cambio di `dataKey`/formatter lato frontend, nessuna modifica al backend. I due gruppi
  di pulsanti stanno in una colonna (`flexDirection:'column', justifyContent:'space-between'`)
  affiancata alle card KPI (`KpiTile`), non sotto di esse: l'`alignItems:'stretch'` di default del
  container flex padre allunga la colonna alla stessa altezza delle card, così il pulsante in alto
  e quello in basso restano allineati ai bordi superiore/inferiore delle card — messo inizialmente
  come due righe separate ("accanto" poi "sotto" il primo toggle), corretto su richiesta esplicita
  perché spezzava il layout.
- **Colori della tab (dal settembre 2026, migrazione alla Libreria UI)**: la tab usava un tema
  azzurro `#0ea5e9` proprio, chiesto dall'utente solo per togliere il viola `#8B5CF6` del resto di
  Forecast. Con il colore unico dell'app il viola è sparito ovunque, quindi anche l'eccezione azzurra
  è stata tolta (decisione delegata dall'utente): tab blu notte come le altre, toggle
  Mensile/Giornaliero e Prenotazioni/Fatturato come `SegmentedControl` standard, serie dei grafici,
  card KPI e colonna "% Disdette" in `colors.info` (blu). Resta invece un viola con significato,
  `colors.accent`, solo per i valori derivati dal **Maturato manuale** (colonna Maturato, Forecast
  calcolato su maturato, linea Maturato nel Pace Chart).
  ⚠️ **Testo della legenda dei grafici sempre nero, mai del colore della serie**: Recharts colora
  di default `.recharts-legend-item-text` come la serie (`fill`/`stroke`), non solo il quadratino —
  comportamento non voluto qui. Fix: prop `formatter` su `<Legend>` che avvolge il testo in uno
  `<span style={{color: colors.text}}>` (`legendaNeutra` in `Forecast.jsx`); funziona perché lo stile
  inline sul figlio vince comunque sull'ereditarietà del colore dal genitore colorato, non serve
  sovrascrivere lo span esterno di Recharts.
- **Filtro canale — select singola** (`canale`/`Tutti`, invariata nell'aspetto): provata una
  variante a checkbox multi-selezione (una per canale, su una riga sotto i filtri data) per
  poter filtrare su più canali insieme — **scartata subito dopo, giudicata dall'utente troppo
  confusionaria**: per questo filtro l'utente preferisce la scelta singola "uno o tutti" alla
  possibilità di combinarne più di uno. Tenuto però il miglioramento di backend portato da quel
  tentativo: `GET /prenotazioni-cancellate/canali` (nuovo, whitelist implicita via
  `_applica_filtri(..., canali=None, ...)`) restituisce l'elenco canali distinti rispettando
  hotel/periodo ma **senza applicare il filtro canale stesso**, quindi non si restringe da solo
  quando lo si usa per popolare le opzioni della select — a differenza della vecchia fonte
  (`dati.per_canale`, già ristretta dal filtro corrente). `canali` su `GET /report`/`GET /` resta
  una stringa comma-separated lato backend (`_parse_canali()`, accetta anche un solo valore) —
  scelta deliberata per non dipendere da come axios serializza un array (nessun
  `paramsSerializer` custom in `api/client.js`); il frontend la usa oggi con un solo elemento
  (`canaliSelezionati` resta un array internamente, ma la UI ne mostra sempre al più uno).
- ⚠️ **Reimport: l'identità di una prenotazione non può più essere la UNIQUE di dedup esistente**
  (`uq_prenotazione_cancellata_dedup`, che include `importo` fra le colonne) — se Welcome ricalcola
  l'importo su una modifica reale, la vecchia chiave non troverebbe più la riga come "già presente"
  e la inserirebbe come riga duplicata invece di riconoscerla. Per le righe del formato "Elenco
  Prenotazioni" (le uniche con `numero_prenotazione` sempre valorizzato — vedi sopra), l'identità
  per il reimport diventa `(hotel_code, numero_prenotazione, tipo_camera)`, indipendente
  dall'importo. `POST /prenotazioni-cancellate/import` accetta ora `on_conflict=salta|aggiorna`
  (default `salta`, stesso nome parametro già in uso in Corrispettivi/Produzione) e per ogni riga
  con questa identità:
  - non esiste ancora → inserita normalmente (via la UNIQUE esistente, invariata, come rete di
    sicurezza contro duplicati letterali);
  - esiste ed è `modificato_manualmente=true` → **mai toccata**, aggiunta a `messaggi_bloccate`
    nella risposta (es. "La prenotazione 6097 (D101, DPH) non è stata inserita perché è già
    presente ed è stata modificata manualmente.") — per rientrare una prenotazione modificata va
    prima cancellata a mano (azione sopra), poi reimportata;
  - esiste, non modificata, `on_conflict=salta` (default, checkbox "Sovrascrivi" non spuntata in
    `TabImportaCancellazioni`) → comportamento storico, salta senza messaggio;
  - esiste, non modificata, `on_conflict=aggiorna` → aggiornata con i valori del file (tutti i
    campi tranne l'identità e `data_rilevata`, che resta la data della prima osservazione).
  Le righe del vecchio formato "PrenotazioniWeb" (senza `numero_prenotazione`) restano sul
  comportamento storico invariato (nessuna identità affidabile per distinguerle tra import diversi).
  Risposta arricchita con `n_aggiornate`/`n_bloccate_modificate`/`messaggi_bloccate`.
  Verificato con un file in due versioni (stessa identità, importo diverso): la riga modificata a
  mano resta bloccata in entrambe le modalità, quella non modificata viene aggiornata solo con
  `on_conflict=aggiorna`.

**Tasso di cancellazione per mese di prenotazione** (`prenot008_2026`, settembre 2026): richiesto
dall'utente per sapere, es., "che % delle prenotazioni fatte a gennaio è stata poi cancellata" — non
calcolabile prima perché la tabella conteneva solo il numeratore (le cancellazioni), mai il
denominatore (il totale prenotato quel mese, cancellato o no).
- **`PrenotazioneCancellata.cancellata`** (Boolean, default `true` per compatibilità con tutte le
  righe già in DB, che erano — e restano — solo cancellazioni). ⚠️ **Nonostante il nome, la tabella
  `prenotazioni_cancellate` può ora contenere anche prenotazioni mai cancellate**: Welcome non
  permette di esportare in un unico file "tutte le prenotazioni" con lo stato incluso, va generato
  un file separato (stessa struttura "Elenco Prenotazioni") per le prenotazioni ancora valide. Non
  rinominata la tabella/il modello per non toccare tutti i punti del codice che già la referenziano
  — la sua semantica reale oggi è "prenotazioni importate da Welcome", `cancellata` distingue le due
  categorie. Preferita una tabella unica a due tabelle separate proprio pensando a import settimanali
  futuri: la stessa prenotazione può passare da valida a cancellata da una settimana all'altra, e la
  logica di identità/reimport già esistente (hotel+codice+camera) aggiorna il flag sulla riga
  esistente invece di dover riconciliare due tabelle indipendenti nel tempo.
- **`POST /import` accetta `tipo=disdetta|non_disdetta`** (default `disdetta`, compatibile con
  l'uso storico): scrive `cancellata` su ogni riga in base al **tipo di import scelto**, non
  deducendolo dal contenuto del file (più affidabile: nel file "non disdette" `Data cancellazione`
  è sempre vuota per costruzione, ma dedurlo dalla sola presenza/assenza di quel campo sarebbe
  fragile). `PrenotazioneCancellataImport.tipo` aggiunto alla UNIQUE dell'import
  (`mese`+`anno`+`nome_file`+`tipo`) — così lo stesso nome file può essere usato per entrambi i tipi
  senza falsi conflitti "import già presente". `cancellata` è tra i `_CAMPI_AGGIORNABILI`: una
  prenotazione importata come "non_disdetta" e poi ritrovata nel file "disdette" di un import
  successivo (`on_conflict=aggiorna`) aggiorna da sola il flag, verificato end-to-end.
  ⚠️ **Bug corretto nello stesso lavoro**: `parse_elenco_prenotazioni()` richiedeva sempre una `Data
  cancellazione` valida, scartando con "data non valida" ogni riga del file "non disdette" (dove
  quel campo è sempre vuoto per definizione) — l'intero import falliva con "nessuna riga valida
  trovata". Fix: quel campo è l'unico tra le date della riga per cui l'assenza è un dato legittimo,
  non un errore di formato — vuoto/None → `None`, nessuna eccezione.
- **`_applica_filtri(..., cancellata=True)`**: default `True` preserva **esattamente** il
  comportamento storico di `GET /report`/`GET /`/`GET /canali` (mostrano solo le cancellate, come
  sempre) senza dover toccare i loro call site — verificato che i 947 record reali del 2026 restano
  invariati dopo la migrazione. Il nuovo `GET /tasso-cancellazione` è l'unico endpoint che passa
  `cancellata=None` (nessun filtro, prende tutte le righe) per calcolare sia numeratore sia
  denominatore dalla stessa tabella.
- Frontend: terzo grafico "Tasso di cancellazione per mese/giorno di prenotazione" in
  `TabCancellazioni`, tooltip custom (`TooltipTasso`) che mostra anche `cancellate su totale`
  (formattato in € quando la metrica è Fatturato), non solo la percentuale. `TabImportaCancellazioni`:
  `SegmentedControl` per scegliere `tipo=disdetta|non_disdetta` prima di caricare; storico import
  mostra una colonna "Tipo" (badge rosso/verde). Terza card KPI "% Cancellazioni" accanto alle due
  esistenti.
- ⚠️ **Il terzo grafico segue gli stessi due toggle degli altri due** (Mensile/Giornaliero,
  Prenotazioni/Fatturato) — non è rimasto "sempre mensile" come nella primissima versione, corretto
  su richiesta esplicita subito dopo. `GET /tasso-cancellazione` calcola quindi, nello stesso giro
  sui dati, sia `per_mese` sia `per_giorno` (stesso range-sui-dati-effettivi di `/report`) sia,
  per ciascuno, sia il tasso su conteggio sia su importo (`_tasso_dict()`, un unico helper per non
  ripetere quattro volte la stessa formula `round(cancellate/totale*100, 1)`). Il frontend sceglie
  l'array (`per_mese`/`per_giorno`) e i campi (`tasso_pct`/`tasso_importo_pct`, ecc.) in base ai due
  toggle già esistenti — nessun terzo stato locale per questo grafico.
  Sotto la descrizione, una riga "Tasso di cancellazione (media periodo X%)" usa il tasso aggregato
  a livello di **intero periodo filtrato** (`tasso_pct`/`tasso_importo_pct` in cima alla risposta,
  stessa formula cancellate/totale ma senza raggruppare per mese) — coerente con la regola del
  progetto "mai medie semplici, sempre totali aggregati": non è la media dei tassi mensili, è il
  tasso vero sul totale del periodo.
- **`per_canale`** aggiunto anche a `GET /tasso-cancellazione` (stesso giro sui dati di
  `per_mese`/`per_giorno`, chiave = nome canale invece del mese): alimenta la nuova colonna
  "% Disdette" nella tabella "Per canale" sotto i tre grafici, tra "N." e "Importo" — lookup lato
  frontend (`tassoPerCanale`, mappa canale→`tasso_pct`) perché quella tabella viene da
  `dati.per_canale` (solo cancellate, endpoint `/report`), mentre il tasso serve dall'endpoint con
  tutte le righe. Sempre il tasso su conteggio (`tasso_pct`), non toggled da Prenotazioni/Fatturato
  come i tre grafici sopra: le altre due colonne della stessa tabella (N./Importo) non rispondono
  già a quel toggle, quindi introdurlo solo per questa colonna sarebbe stato incoerente con la
  tabella stessa.
- **Pulsante "Anno com. {anno}"** ("com." = commerciale, abbreviato per stare sulla stessa riga
  delle 4 date) dopo Arrivo da/a e Prenotazione da/a: imposta tutte e quattro a **1° ottobre
  dell'anno precedente – 30 settembre dell'anno selezionato in cima alla pagina** (non l'anno
  solare gen–dic, coerente con l'anno commerciale ott→set già usato nell'ordine dei grafici mensili
  di questa stessa tab — non l'anno solare di oggi: scelta esplicita dell'utente, così funziona
  anche navigando dati di stagioni passate). Un solo pulsante per entrambe le coppie di date (non
  uno per coppia). `whiteSpace: 'nowrap'` sul pulsante per non spezzare l'etichetta su due righe.
