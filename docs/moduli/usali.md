<!-- Spostato da CLAUDE.md il 07/11/2026, testo invariato: dove si legge "questa sezione" o "in CLAUDE.md" si intende questo file. Le regole generali restano in CLAUDE.md. -->

## Modulo USALI — Conto Economico

**Dal 15/10/2026 alimentato dalla contabilità importata** (scheda "Conto Economico contabile",
vedi sezione successiva) per ogni (struttura, mese) con un import contabile — scelta dell'utente:
"pagina tutta automatica", override delle voci inserite a mano. `get_report()` in `usali.py`:
- mesi con contabilità → `voci_da_contabile()` (`services/usali_contabile_ce.py`): ricavi Camere/F&B/
  Altri reparti/Ricavi vari dai conti contabili; costi con corrispondenza fissa reparto/conto → voce
  (`voce_interna()`: Camere → Servizi con Contratto=appalto, Biancheria/Lavanderia=lavanderia,
  Prestazioni professionali=consulenze, resto=altri costi camere; F&B → categoria food/beverage=costo
  del venduto, attrezzature/porcellana/posate…=attrezzature, resto=**Altri costi F&B** (voce nuova
  `altri_costi_fnb`); Altri reparti → costo del venduto altri reparti; Costi Generali → Amministrativo
  (Prestazioni professionali=consulenze), Funzionamento=manutenzioni, Informatica, Utenze, Vendite e
  Marketing). Non Operativi in F (sotto l'EBITDAR), Deprezzamenti esclusi.
- **Costo del lavoro per reparto resta dai cedolini** (ripartizione CC di Dipendenti — scelta esplicita
  dell'utente, "più coerente con HotelOS"); i conti contabili di categoria personale vanno in un totale
  e **la differenza personale contabile − cedolini finisce in "Costo del lavoro non suddiviso"** (può
  essere negativa: INT 2026 −1.242 €). Così **EBITDAR = GOP contabile** al centesimo (`contabile.
  differenza_gop`, avviso in pagina se ≠ 0). Verificato DPH/CLB/INT/BON gen–set e giugno 2026.
- **F — Costi non operativi e G — EBITDA** (v3.22.0): come da USALI gli affitti stanno tra GOP/EBITDAR
  ed EBITDA (non sotto, con interessi/imposte/ammortamenti). Sezione contabile "Non Operativi" →
  `affitti` (conto con "affitt" nel nome) o `altri_non_operativi` (tutto il resto, compreso il conto
  di transito "Acquisto Voucher per dipendenti" — scelta dell'utente, così EBITDA = EBITDA contabile,
  `contabile.differenza_ebitda`). Nei mesi senza contabilità sono voci manuali. KPI `ebitda_pct`
  con range proprio (default hotel 15–20%, ristoranti 20–30%, stime da affinare in Admin):
  `_leggi_kpi_config()` completa una config salvata con i default dei KPI aggiunti dopo. Affitti
  2026 gen–set: CLB 108.452 €, INT 112.192 € (rateo mensile, anche fuori stagione).
  Deprezzamenti restano esclusi (sotto l'EBITDA).
- Mesi senza contabilità → fonti di sempre (`_dati_fonti_interne()`: PMS/corrispettivi + cedolini +
  voci manuali); periodi misti sommati per intervalli contigui (`_intervalli()`). Le voci manuali dei
  mesi contabili restano in `usali_voci_manuali` ma sono ignorate (reversibile); `PUT /usali/voce` su
  un mese contabile → 409. Risposta: `voci_auto` (celle non modificabili) e `contabile` (mesi, GOP,
  personale contabile/cedolini). Nei mesi contabili "Ricavi ristorante e bar — clienti esterni" (DPH)
  è vuota: la contabilità non separa ospiti/esterni del Mare Mosso, tutto è in ricavi F&B.
- ⚠️ Corretto un difetto storico di `_voci_manuali()`: una voce non salvata per il mese finale dava
  delta = −cumulato precedente (es. DPH ottobre: EBITDAR +351.055 € con ricavi 0). Ora vale 0.
- Conti alimentari non classificati in Admin → Categorie KPI finiscono in "Altri costi F&B" invece
  che nel costo del venduto: classificarli sposta la cifra.

**Maremosso (MMS) è accorpato su Du Parc, nessuna colonna propria** (settembre 2026, assetto
finale dopo due iterazioni — vedi sotto). Confermato dall'utente: stessa azienda e partita IVA di
Du Parc, licenza e registratore fiscale propri ma nessun obbligo di separazione contabile —
tenerlo distinto era una scelta di reporting gestionale, non un requisito. `STRUTTURE_RISTORANTI`
in `usali.py` = `['BON']` (MMS rimosso); `TUTTE_STRUTTURE` non lo itera più come riga a sé.
- **Ricavi**: `ricavi_fnb` di DPH torna a essere il dato di pacchetto grezzo da `daily_revenue`
  (comprensivo di colazione E pranzo/cena consumati al Maremosso, invariato rispetto a
  Dashboard/Budget/Revenue). Nuova riga **"Ricavi ristorante e bar — clienti esterni"**
  (`ricavi_fnb_esterni`, sezione A, entra nel totale ricavi) = `_ricavi_ristorante(db, 'MMS', ...)`
  — chi paga direttamente al ristorante Maremosso (stampante fiscale propria, corrispettivi), mai
  negli ospiti Du Parc in pacchetto: nessuna sovrapposizione. Visibile solo su DPH (`soloStruttura:
  'DPH'` lato frontend), "n/a" altrove.
- **Costo del lavoro**: `_lavoro_fnb_dph_con_maremosso()` somma il `lavoro_fnb` di DPH (Colazioni +
  Pasticceria) e quello di MMS (Cucina/Sala/Bar, via `_lavoro_da_dipendenti(db, 'MMS', ...)`) in
  un'unica cifra su DPH — nessuna riga "clienti esterni" lato costo, non esiste un costo del lavoro
  da isolare come per i ricavi.
- **Il nodo CC `MMS` → `MMS_FNB` → `MMS_CUCINA`/`MMS_SALA`/`MMS_BAR` (`usali005_2026`) resta
  intatto in anagrafica**, solo per poter tornare indietro senza perdere dati: alimenta ancora la
  somma sopra, e **Dipendenti → Analisi CC e Movimenti Attivi (tab "Ristorante Mare Mosso")
  continuano a mostrare Maremosso distinto, invariati** — solo il Conto Economico lo accorpa.
- Frontend `UsaliContoEconomico.jsx`: `KPI_BLOCCHI` non ha più il blocco "KPI Ristoranti" (con solo
  Buona Onda rimasto sarebbe ridondante con la sua colonna nella tabella principale) — resta "KPI
  Hotel" e "KPI Gruppo". `COL_ORDER` non ha più `MMS`/`RISTR` (il totale ristoranti con un solo
  membro duplicherebbe la colonna BON).

⚠️ **Prima iterazione (scartata): ripartizione proporzionale invece di accorpamento.** Prima di
sapere che Maremosso è la stessa partita IVA di Du Parc, si era tentato di dargli una colonna
propria nel Conto Economico, usando `usali005_2026` (sotto) per il costo del lavoro e una funzione
(`_ripartisci_ricavi_fnb_dph_mms`, poi rimossa) che spaccava proporzionalmente il ricavo di
pacchetto DPH tra DPH e MMS in base al mix Produzione (Colazione+Bar+Pasticceria vs Ristorante
Maremosso) — perché nessun dato sorgente spezza il pacchetto mezza/pensione per pasto (verificato:
Colazione+Ristorante Maremosso da Produzione coprivano solo ~80-85% del pacchetto mensile DPH).
Scartata perché, saputo che è la stessa azienda, non c'era motivo di accettare una stima quando un
accorpamento è preciso al centesimo — tenuta a mente questa storia perché se in futuro si volesse
di nuovo una colonna Maremosso a sé, la strada della ripartizione proporzionale è già stata
esplorata e la funzione (rimossa) è recuperabile dalla history git.

**Il nodo CC `MMS` nell'albero centri di costo** (`usali005_2026`, settembre 2026): prima non
esisteva alcun nodo struttura `MMS` — Cucina/Sala/Bar erano figli di `DPH_FNB`, quindi
`_lavoro_da_dipendenti()` (risale la gerarchia fino al primo nodo `tipo='struttura'`) attribuiva
tutto il costo del personale F&B a Du Parc. Confermato dall'utente: Cucina/Sala/Bar lavorano
esclusivamente per pranzo/cena al Maremosso (nessuna quota colazione), quindi spostamento pieno dei
3 reparti, non uno split %. Migrazione: nuovo `MMS` (struttura) → `MMS_FNB` (categoria, mirror di
`BON_FNB`) → `MMS_CUCINA`/`MMS_SALA`/`MMS_BAR` (stessi `id` di `DPH_CUCINA`/`DPH_SALA`/`DPH_BAR`,
solo `code`/`name`/`parent_id` cambiati — zero impatto sui collegamenti dipendenti già esistenti in
`employee_cc_default`/`EmployeeCostCenterMonthly`). Colazioni e Pasticceria restano su DPH.
Aggiornata anche `usali_cc_voce_mapping` in `app_config` (chiavi per `code`: le 3 chiavi `DPH_*`
rinominate sarebbero altrimenti cadute sul fallback `'altri'`).
⚠️ **Effetto retroattivo**: essendo tutto calcolato live (nessuno snapshot mensile), lo spostamento
riclassifica anche i mesi già chiusi in Dipendenti → Analisi CC (Cucina/Sala/Bar risultano sotto
"Maremosso" invece che "Hotel Du Parc" anche per i mesi passati) — coerente con l'obiettivo, da
tenere a mente confrontando report per-struttura esportati prima di questa migrazione.

## Modulo USALI — Conto Economico contabile (import dal gestionale, ottobre 2026)
Terza scheda del modulo USALI (non un modulo NavBar a sé): conto economico **dalla contabilità
vera**, export Flexmonster del gestionale già riclassificato USALI — distinto dal "Conto Economico"
interno sopra (calcolato da daily_revenue/Dipendenti/voci manuali). Fasi: ✅ 1 modelli+parser+test,
✅ 2 import anteprima/conferma + report, ✅ 3 KPI + categorie, ✅ 4 frontend (v3.20.3).
- **Modelli** `models/usali_contabile.py`, migrazione `usali006_2026`: `usali_struttura_gestionale`
  (id gestionale→`struttura_code`, seed 128→DPH), `usali_import` (log, sha256 xlsx, file originali),
  `usali_riga` (conto×mese, dato grezzo mai modificato; `percorso` JSON + `percorso_testo`),
  `usali_segmento`/`usali_regola_segmento` (seed: un segmento "Du Parc + Maremosso" + regola catch-all),
  `usali_categoria_kpi` (conto→personale/food/beverage/commissioni/utenze/altro). Strutture come
  `struttura_code` (String), non id: BON/MMS non esistono in `hotels`.
- ⚠️ **`usali_riga.importo` è `Numeric(14,4)`, non (12,2)**: il gestionale ripartisce costi condivisi
  (utenze, informatica, commissioni bancarie…) con frazioni di centesimo; arrotondando ogni conto al
  centesimo i totali mensili sbagliavano di 2-4 cent (gennaio −6.831,59 invece di −6.831,55). Con 4
  decimali tutti i valori attesi tornano al centesimo. Arrotondare solo in presentazione.
- **Parser** `services/usali_contabile_parser.py::parse_export(xlsx, csv=None)`: gerarchia dal
  rientro cella (`alignment.indent`), **foglia = riga la cui successiva ha rientro ≤** (non "ha
  importi": esistono foglie tutte a zero, es. Colazione > Servizi con Contratto); intestazione con
  importi → errore. Sezione = primo nodo del percorso dalla radice tra Ricavi Operativi/Costi
  Operativi/Costi Generali/Non Operativi/Deprezzamenti (Deprezzamenti contiene a sua volta "Costi
  Generali"). Reparto = nodo dopo la sezione; sottoreparto = nodi intermedi senza le ripetizioni del
  reparto ("Altri Reparti Operativi" annidato 3 volte). Quadratura vs "Gran Totale" su valori pieni
  (±0,01) → `ErroreImportUsali` se non quadra. Mesi via `MESI_IT`. CSV: solo arricchimento
  (`Azione`, `id_conti`, `id_reparti_N`, `Ammortamento=1`, struttura da `id_strutture_concat_work`),
  abbinato per indice riga con verifica nome; un nome diverso → arricchimento scartato per tutto il
  file con avviso. Solo CSV → rifiutato.
  ⚠️ **Alcuni export hanno i subtotali anche sulle intestazioni** (CLB sì, DPH no — dipende da come è
  impostata la vista Flexmonster): non sono conti, vengono ignorati ma verificati — ogni subtotale deve
  valere la somma delle foglie sotto di lui (±0,01), altrimenti errore "riesportare con tutte le righe
  espanse" (`_verifica_subtotali`). Prima venivano rifiutati con "intestazione con importi".
- Id struttura gestionale: **128 = DPH** (seed migrazione), **129 = CLB**, **248 = INT** (inseriti a mano
  15/10/2026 in `usali_struttura_gestionale`, letti dai CSV). BON da aggiungere al primo CSV.
- **Segmenti** `services/usali_segmenti.py::assegna_segmenti(righe, regole)`, **in lettura**, mai
  salvati sulle righe: vincono le regole con priorità più alta, devono sommare a 100% (ripartizioni
  tipo utenze 70/30, arrotondamento sull'ultima quota); riga non coperta → errore, mai scartata.
  `percorso_prefisso` = sotto-percorso contiguo case-insensitive (`'Food & Beverage > Ristorante'`
  prende ricavi e costi), `''` = tutto. `valida_dal/al` = 'YYYY-MM'.
- **Router** `routers/usali_contabile.py` (prefix `/usali/contabile`): `POST /anteprima` (admin,
  multipart `xlsx` + `csv` facoltativo + `struttura_code`; parsing, nessuna scrittura DB, file in
  `{storage}/_anteprima/{token}/` per 24h, confronto netto/ricavi vecchio→nuovo per i mesi già
  presenti, `gia_importato` se stesso sha256 xlsx), `POST /conferma` (`{token, struttura_code?,
  note?}`; 409 se sha già importato; in UNA transazione cancella le righe dei (struttura, anno, mese)
  del file e inserisce le nuove → l'ultimo import vince, i precedenti restano nel log),
  `GET /import` (storico con `periodi_in_vigore`), `GET /import/{id}/file/xlsx|csv`,
  `DELETE /import/{id}?conferma=true` (admin: righe ancora in vigore + voce di storico + file originali;
  i mesi tolti tornano "non importati", un import precedente già sostituito NON viene ripristinato —
  le sue righe non esistono più, va reimportato; pulsante "Elimina" nello storico), `GET /strutture`,
  `GET /segmenti`, `GET /periodi`, `GET /report?struttura&anno&mese_da&mese_a&segmento_id`,
  `GET /report/export` (xlsx). Struttura: dal CSV via `usali_struttura_gestionale`, altrimenti scelta
  dall'utente; scelta in conflitto col CSV → 400.
- **File originali**: `uploads/usali_contabile/{struttura}/{anno}/{import_id}_{nome}` (env
  `USALI_CONTABILE_DIR` per sovrascrivere, usato dai test). `uploads/` è di `gino`, il backend gira
  come `hotelos`: scrittura concessa via ACL (`setfacl -m u:hotelos:rx uploads`,
  `setfacl -m u:hotelos:rwx` + default ACL su `uploads/usali_contabile`). Se si ricrea la cartella,
  rifare le ACL o l'import fallisce con PermissionError.
- **Report** `services/usali_contabile_report.py::costruisci_report()` (pura): righe piatte con
  `id`/`parent`/`livello`/`tipo` (sezione/reparto/sottoreparto/conto/subtotale/profitto_reparto/
  totale), ordine: Ricavi Op., Costi Op., Profitto dei Reparti Operativi (+ per reparto, abbinati per
  nome; solo-ricavi = ricavi), Costi Generali, GOP, Non Operativi, EBITDA, Deprezzamenti, (Non
  classificato), Reddito Netto — tutti dalle foglie. Colonne: mesi (`None` = mese non importato, non
  zero), totale, % ricavi, progressivo da gennaio, stesso periodo anno precedente + Δ (solo se esiste).
  Con `segmento_id` le righe passano da `assegna_segmenti()`; righe non coperte → `errori_segmento`.
- **KPI** `services/usali_contabile_kpi.py` + `GET /usali/contabile/kpi?struttura&anno&mese_da&mese_a&segmento_id`:
  importi dalla contabilità, camere disponibili/vendute/presenze da `daily_revenue` (snapshot più
  recente per data, una query per anno — `produzione_mensile()`). Stato mese: `ok` / `chiuso` (fuori
  `hotel_seasons`: solo costi) / `mancante` (in stagione senza dati Revenue: KPI per camera `None`, mai
  0) / `non_applicabile` (BON). KPI per camera (occupazione, ADR, RevPAR, TRevPAR, GOPPAR, CPOR, utenze
  per camera venduta) di periodo = Σ numeratori / Σ denominatori dei **soli mesi `ok`**; rapporti sugli
  importi (GOP %, personale %, food/beverage cost % su ricavi reparto F&B, commissioni Camere % su
  ricavi camere, margine Camere %) su tutti i mesi importati. ADR/RevPAR usano i **ricavi camere della
  contabilità**, non `daily_revenue.revenue_rooms`. `gop_cumulato` sempre da gennaio. Con un segmento
  gli importi sono del segmento ma le camere restano quelle della struttura.
- **Categorie KPI** (`usali_categoria_kpi`): match case-insensitive su nome conto, regola con `reparto`
  specifico vince su quella generica (`reparto=''`); solo righe di costo. Food/beverage contano solo in
  Costi Operativi > Food & Beverage, commissioni solo in Costi Operativi > Camere. Endpoint:
  `GET|POST /categorie-kpi`, `PUT|DELETE /categorie-kpi/{id}`, `GET /categorie-kpi/non-categorizzati`
  (conti di costo importati senza categoria: assegnare `altro` per toglierli). Con il seed, sul file DPH
  2026 restano 63 conti senza categoria (manutenzioni, informatica, marketing…).
- **Frontend** `pages/usaliContabile/` (terza scheda di `Usali.jsx`, `UsaliContabile.jsx`): filtri
  struttura (`SegmentedControl`, sempre tutte: DPH/CLB/INT/BON, anche senza dati) / segmento /
  anno / mese da–a (default: anno più recente importato, gennaio → ultimo mese importato), sotto-schede
  `TabellaCE.jsx` (righe espandibili via `id`/`parent`, classi `ui-riga-sezione|subtotale|totale`,
  negativi in rosso — `colors.dangerBg` sulle righe totale blu notte —, export xlsx con pulsante
  dedicato, non `ExportMenu`: solo xlsx), `KpiCE.jsx` (card, grafico `ComposedChart` Ricavi/GOP a barre
  + GOP cumulato a linea su un solo asse €, tabella KPI per mese con badge chiuso/no camere),
  `ImportCE.jsx` (storico + download originali per tutti; modale import con anteprima solo admin).
  Euro senza decimali via `formatEuroIntero()` (`utils/format.js`, formato it-IT "1.234 €" come il
  resto dell'app). Admin: `?s=usali-categorie-kpi` → `pages/admin/AdminUsaliCategorieKpi.jsx`
  (conti da classificare + mappature).
- ⚠️ **"Acquisto Voucher per dipendenti"** (Non Operativi) è un conto di transito: deve azzerarsi con
  l'uso dei voucher in busta paga (righe "Voucher" dei reparti, già categoria personale). Non va
  messo in personale. Nel file DPH 2026 vale +2.981 € (non ancora a zero).
- **Budget non collegato**: `budget_entries` è settimanale (mese contabile), solo ricavi camere/F&B/
  extra, nessun costo → nessun confronto GOP/EBITDA possibile. Servirebbe un budget mensile per
  sezione/reparto USALI (anno, mese, struttura, voce) con le stesse chiavi del report.
- Fixture `tests/fixtures/usali/export-1.xlsx` + `pivot-1.csv` (DPH gen–set 2026, 223 conti).
  ⚠️ **Non lasciarli in `uploads/`**: `test_bulk_scan_cartella_uploads` (import massivo Revenue)
  scansiona tutta la cartella e li conta come coppie in errore. Gli export USALI caricati a mano stanno in
  `uploads/usali_export_originali/` (spostati lì il 20/10/2026: la scansione non legge le sottocartelle).

## Modulo USALI — Food & Beverage (ottobre 2026, v3.28.0)
Quarta scheda di `Usali.jsx` (`pages/usaliFnb/`): analisi per **punto vendita** — DPH: Colazione,
Ristorante Mare Mosso (sotto-righe Ospiti Du Parc / Clienti esterni), Bar; CLB/INT: Colazione,
Ristorante (riga unica), Bar; BON: punto unico (la contabilità BON divide Bar/Ristorante in modo
incoerente); Gruppo = totale per struttura. Sotto-schede Riepilogo (+ export xlsx), Andamento
mensile, Coperti, Materia prima, **Costo pasto** (v3.29.0, `CostoPastoFnb.jsx` + `GET /usali/fnb/
costo-pasto?anno=&mese_da=&mese_a=`: sempre DPH/CLB/INT insieme, colazione delle tre strutture +
pasto del ristorante CLB e INT (con pranzi/cene e pranzi/cene su presenze solo informativi) + Mare
Mosso solo con i coperti Menu; per pasto materia prima,
cibo e bevande (`food_coperto`/`beverage_coperto`, v3.29.5), personale, altri, costo pieno, ricavo medio e margine — `ricavo_coperto_cc`/`margine_coperto` sugli
stessi mesi del costo, non sull'intero periodo come `ricavo_coperto`; righe da `costo_pasto()` in
`usali_fnb.py`, che riusa le righe del riepilogo). Logica in `services/usali_fnb.py`, router `routers/usali_fnb.py`
(prefix `/usali/fnb`: `GET /report`, `GET /report/export`, `GET /materia-prima`, `GET /costo-pasto`, `GET|PUT /coperti`,
`GET|PUT /parametri`). Sola lettura sugli altri moduli: CE e CE contabile non toccati.
**Fonti (scelte con l'utente)**:
- costi materia prima/altri → contabilità (`usali_riga`, Costi Operativi > Food & Beverage, punto
  dal sottoreparto: `punto_contabile()`), food/beverage dalle categorie KPI (`categoria_di()`); conti
  F&B senza categoria vanno in "Altri costi" e sono elencati in Materia prima (sottostimano il food cost)
- personale → **cedolini** (`_carica_cedolini()`: reparti figli di `*_FNB`, MMS = DPH), come il CE;
  il personale contabile è solo confronto. Reparto → punto: default dal suffisso del codice
  (`punto_default_cc()`: COLAZIONI/PASTICCERIA → colazione, BAR → bar, resto e tutti gli `MMS_*` →
  ristorante), modificabile in Admin
- ricavi → Produzione (`_carica_produzione()`, imponibile; per DPH anche righe reparto 'Maremosso' di
  ogni struttura, stessa regola di Movimenti Attivi), clienti esterni MMS e BON da corrispettivi
  manuali (lordo/1,10); ricavi F&B contabili solo come confronto
- coperti → pasti `conta_come_pasto` di Produzione (colazione = trattamento + extra); MMS = coperti
  **totali** dal gestionale Menu (ospiti DPH compresi, ~tutte cene) inseriti per mese, esterni =
  Menu − pranzi/cene ospiti (negativo → avviso, nessuna stima); BON = **scontrini** del mese.
  Tabella `usali_fnb_coperti` (`usalifnb001_2026`, struttura MMS|BON, anno, mese, valore)
**Pranzo e cena NON separati** (v3.29.1, dopo una prima versione con sotto-righe e "peso cena"
configurabile, tolti): per il gruppo un pasto costa uguale a pranzo e a cena, e il prezzo diverso
(quota pranzo ~8 €, cena ~21 € in Welcome) serve solo a rendere conveniente la pensione completa —
un margine "del pranzo" non avrebbe significato. Il ristorante hotel è una riga unica; `pranzi`/
`cene`/`pranzi_perc`/`cene_perc` in `_somma()` solo informativi. **Ospiti/esterni Mare Mosso**:
ricavi e coperti veri, costi **stimati** (badge "stima") ripartiti per numero di coperti (stesso
costo per pasto). `app_config['usali_fnb_parametri']` contiene solo `cc_punto` (Admin `?s=usali-fnb`
→ `AdminUsaliFnb.jsx`, salvati solo gli abbinamenti CC diversi dal default).
**Regola dei rapporti** (`_somma()`): numeratore e denominatore sommati sui soli mesi in cui esistono
entrambi — costi solo nei mesi con contabilità importata. Per-coperto: mesi con costi E (coperti
oppure **nessuna vendita**) — i costi di avvio/chiusura stagione (acquisti, attrezzature, personale
di marzo-aprile) entrano nel costo per pasto (v3.29.4, prima esclusi per errore: DPH colazione
10,04 → 10,93 €, Mare Mosso 25,96 → 29,29 €); esclusi solo i mesi con vendite ma senza pasti (dato
mancante). Per le sotto-righe ospiti/esterni i costi dei mesi senza vendite sono ripartiti con le
quote di coperti dell'intero periodo (`costruisci_report`), così la somma torna col ristorante.
Mare Mosso in Costo pasto: riquadri coperti / **scontrino medio** (ricavi IVA esclusa / coperti) /
costo / margine; lo scontrino ospiti/esterni è indicativo (ospiti = sole quote pranzo/cena Welcome,
ma i loro ricavi comprendono anche l'alla carta addebitato in camera). Coperti non sommati nel totale struttura (colazioni + cene non si sommano).
**Avvisi** in pagina: mese con ricavi F&B contabili < 50% dei gestionali (trovati: BON luglio e
settembre a 0, CLB e INT **giugno a 0 con tutto il pacchetto pensione su Camere**), coperti MMS o
scontrini BON mancanti. I costi sono acquisti, non consumi (nessuna rimanenza in contabilità).

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
