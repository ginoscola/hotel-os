<!-- Spostato da CLAUDE.md il 07/11/2026, testo invariato: dove si legge "questa sezione" o "in CLAUDE.md" si intende questo file. Le regole generali restano in CLAUDE.md. -->

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
Tab Analisi CC (agosto 2026): filtro checkbox "Categorie" (macrocategorie ricavate dinamicamente dai
dati, es. Camere/Food & Beverage/Struttura/Amministrazione), tutte selezionate di default. Applicato
a monte (`filtraCategorie()`, su `parent_name` dei centri grezzi) così tabella, torta e grafico a
barre restano coerenti tra loro quando si deseleziona una categoria — stesso pattern del filtro
strutture già esistente (`barStruttureSel`).
`GET /dipendenti/` (lista anagrafica) restituisce anche `centri_di_costo` (lista completa, non solo
il primo CC come `centro_di_costo`/`centro_di_costo_id` — mantenuti per compatibilità): bug corretto
in cui la riga riassuntiva di `AnagraficaCard` mostrava un solo CC per dipendenti con ripartizione su
più centri (es. Balducci Annie su 3 reparti Pasticceria CLB/DPH/INT), visibili tutti solo dopo aver
espanso la card (che li carica separatamente da `GET /dipendenti/{id}/centri-di-costo`).
File test: `uploads/202604_costi  aziendali .pdf` (8 dipendenti, aprile 2026).

⚠️ **`key` React su tre `<>...</>` dentro `.map()` era messa sui `<td>`/`<tr>` interni invece che
sul Fragment**, che è l'elemento davvero restituito a ogni iterazione (righe dipendenti in "Report
mensile" + due punti di "Analisi CC" con confronto anno attivo, colonne mese corrente/precedente
affiancate). React se ne lamentava in console ("Each child in a list should have a unique key
prop") ma soprattutto non riconciliava correttamente la lista a ogni cambio di dati, rischiando
scambi di stato tra righe (es. riga espansa "sbagliata" dopo un refresh). Fix: `<>` → `<Fragment
key={...}>` (import da `react`), key spostata dal figlio al Fragment stesso; i `<td>`/`<tr>` interni
non ne hanno più bisogno (non sono loro l'elemento nell'array). Verificato: nessun warning residuo
in console, tabelle invariate a schermo.

⚠️ **`payroll_parser.py` non usa più indici di riga fissi per indirizzo/qualifica/mansione/sommario**:
per alcuni tirocinanti/stagisti il PDF non stampa affatto la riga "indirizzo dipendente" (campo vuoto),
il che scalava di una posizione tutte le righe successive e faceva leggere uno dei 13 valori numerici
finali come "incidenza%" — bug reale (luglio 2026, import giugno 2026) che produceva l'errore
"attese 13 voci numeriche, trovate 12" su più pagine (tutti i tirocinanti/stagisti del cedolino).
Fix: la riga "sommario" (le uniche due righe con due numeri decimali separati da spazio, dopo la
riga cognome/CF) viene localizzata dinamicamente via regex; qualifica/mansione sono le due righe
immediatamente precedenti, indirizzo è tutto ciò che sta prima (0+ righe, non più esattamente 1).
⚠️ **Numeri negativi con segno meno in coda** (es. `396,53-` per un IRPEF a credito, non `-396,53`):
`_parse_numero()` li scartava come non-numerici (`float("396,53-")` fallisce), causando lo stesso
identico errore "attese 13 voci numeriche, trovate 12" per un motivo diverso dal precedente — riga
sommario/qualifica/mansione lette correttamente, ma una delle 13 voci saltata perché il segno meno
è in fondo alla stringa. Fix: `_parse_numero()` riconosce il `-` finale e lo applica come segno.
