<!-- Spostato da CLAUDE.md il 07/11/2026, testo invariato: dove si legge "questa sezione" o "in CLAUDE.md" si intende questo file. Le regole generali restano in CLAUDE.md. -->

## Libreria UI (`components/ui/` + `styles/tokens.js` + `styles/ui.css`) — settembre 2026
Nata per uniformare grafica e testi dell'intera app (prima: 135 colori esadecimali diversi, ~25
dimensioni di testo, barre tab riscritte in ogni modulo con 4 stili, `alert()`/`confirm()` nativi).
Il vecchio `styles/common.js` (mai importato da nessun file, e con pulsante primario ambra in
contrasto con l'app reale) è stato eliminato.
- **`styles/tokens.js`**: UNICA sorgente di colori/testi/spazi in JS (per Recharts, SVG, stili
  calcolati). **`styles/ui.css`**: stessi valori come variabili CSS (`--color-*`, `--fs-*`) + classi
  `ui-*`, importato in `main.jsx` DOPO `index.css`. Cambiando un valore, allinearlo in entrambi.
- **Colore principale unico** `#1e3a5f` (blu notte): tab, pulsanti principali, intestazioni tabelle,
  in TUTTI i moduli — scelta esplicita dell'utente. Il colore del modulo (`modules.colore`) resta
  **solo** nella NavBar in alto. Eccezione voluta: la pillola arancione IVA (`ToggleIva`). Grigi: solo
  la famiglia slate (`#64748b`, `#94a3b8`, `#1e293b`…), non più anche gray (`#6b7280`, `#374151`…).
- **Colori strutture** `COLORI_STRUTTURA`/`coloreStruttura()`: DPH verde `#10b981`, CLB blu
  `#3b82f6`, INT ambra `#f59e0b` (scelti dall'utente), MMS teal / BON ambra scuro (tonalità "sorelle"
  della struttura fisica). Uguali ovunque: le ridefinizioni locali (`COLORI_HOTEL` in
  `produzioneHelpers.js`/`DashboardGruppo.jsx`, `TabFatturati.jsx`, `Dipendenti.jsx`) vanno sostituite
  migrando le pagine.
- **Componenti** (`import { ... } from '../components/ui'`): `Button` (primary/secondary/danger/
  danger-soft/ghost, sm), `PageHeader`, `SectionTitle`, `Card`, `Tabs`, `SegmentedControl`,
  `ToggleIva`, `NavMese`, `Input`/`Select`/`Field`, `Table`/`Th`/`Td` (`num` = destra + cifre
  allineate, `tot` = colonna totale), `Badge`, `Dot`, `HotelTag`, `Messaggio`, `Loading`,
  `StatoVuoto`, `Modal`, `KpiTile` (etichetta + valore + sub, in fila dentro `<div
  className="ui-kpi-row">`), `FileButton` (pulsante che apre la scelta file), `ThOrdinabile`
  (intestazione cliccabile ▲▼), `Paginazione`, `Textarea`, `Checkbox`, `NavAnno`, `DropZone`
  (area trascina-file), `Drawer` (pannello laterale di dettaglio). `Table maxHeight="70vh"` =
  scroll verticale con intestazione fissa. Intestazioni a due livelli: seconda riga
  `<tr className="sub">`, `Th`/`Td` con `gruppo` per il bordo di inizio gruppo colonne.
- **`PALETTE_CATEGORICA`/`coloreSerie(idx)`** (in `tokens.js`, prima in `produzioneHelpers.js` che
  ora la riesporta): palette validata per serie/categorie nei grafici — usare questa, non colori a caso.
- **`ExportMenu`** (componente condiviso) ha lo stile della libreria in tutta l'app; un errore di
  export compare come avviso temporaneo invece che come testo rosso accanto al pulsante.
- `Paginazione estremi` (con « »), `SegmentedControl label="…"` (etichetta davanti alla pillola),
  righe `ui-riga-annullata`/`ui-riga-modificata` (barra ambra = corretto a mano), classe
  `ui-console` per log tipo terminale (righe `riga-info`/`riga-ok`/`riga-err`).
- `SezioneApribile` (titolo ▸/▾ che apre/chiude), `NavMese selettore` (click sull'etichetta apre il
  selettore di mese del browser), `DropZone multiple`, `Badge colore="#…"` (colore libero da DB,
  sfondo tenue — usato anche da `HotelTag`), riga `ui-riga-errore` (differenza da verificare).
- `KpiTile` accetta anche `confronto`/`confrontoLabel`/`delta` (ha sostituito il vecchio `KPICard`,
  eliminato); `<div className="ui-kpi-grid">` = griglia regolare di KPI.
- **Tooltip con totale** (`components/TooltipConTotale.jsx`, ottobre 2026, regola chiesta
  dall'utente): ogni grafico le cui serie **si sommano** (barre impilate, o affiancate che compongono
  un totale) usa `<Tooltip content={<TooltipConTotale />} />` — voci nel colore della serie + riga
  **Totale** in grassetto (`formatter` default euro, `labelFormatter`, `etichettaTotale`). Oggi in:
  Dashboard Hotel (ricavi giornalieri), Dashboard Gruppo (contributo per hotel), Statistiche
  Produzione (trend mensile), Riepilogo Fatturati (3 viste a più serie), USALI F&B Costo pasto.
  **Non** dove la somma non ha senso (Budget vs Actual, Ricavi vs GOP, percentuali, serie di confronto).
- **Colori grafici revenue**: `COLORI_REVENUE` (camere/fnb/extra) in `tokens.js`, uguali ovunque.
  **Materia prima**: `COLORI_MATERIA_PRIMA` (cibo blu scuro `#1e40af`, bevande azzurro `#38bdf8`),
  scelti dall'utente per distinguerle dal verde del personale (`coloreSerie(1)`) nei grafici di costo F&B.
  **Serie di confronto** (periodo/anno precedente) nei grafici a linee: stesso colore della serie
  principale + `{...STILE_CONFRONTO}` (tratteggiata, semitrasparente) — non un colore diverso.
- `components/NavigazioneSnapshot.jsx`: barra ← Prec. / Succ. → + i due confronti mutuamente
  esclusivi, condivisa da Dashboard Hotel e Gruppo. `SezioneHeader` (in `ExportMenu.jsx`) eliminato:
  si usa `<Card title=… actions={<ExportMenu …/>}>`.
- **`colors.accent`** (viola `#7c3aed`): unico colore extra ammesso oltre ai colori di significato,
  **solo** per "valore manuale che sostituisce il dato automatico" (oggi: Maturato in Forecast). Catalogo visivo: Admin → Sistema → Libreria UI (`?s=ui-kit`,
  `pages/admin/AdminUiKit.jsx`) — aggiornarlo quando si aggiunge un componente.
- **Conferme e avvisi**: `useConferma()` al posto di `window.confirm()` (`await conferma({titolo,
  messaggio, pericolo, ritardoMs})` → boolean; `ritardoMs` per azioni irreversibili tipo Chiusura Z),
  `useAvvisi()` al posto di `alert()` (`successo`/`info` spariscono da soli dopo 4s,
  `errore`/`attenzione` restano finché chiusi). `<UiProvider>` montato una volta in `App.jsx`.
- **Tabelle**: righe speciali con classe sulla `<tr>` (`ui-riga-attenuata` dati assenti,
  `ui-riga-avviso` da compilare, `ui-riga-ok` completata, `ui-riga-subtotale`, `ui-riga-sezione`,
  `ui-riga-risultato`, `ui-riga-totale`) — il CSS colora le `<td>`, quindi il bug riga pari/dispari
  (vedi "Righe tabella con sfondo custom") non si presenta. I selettori `.ui-table > tbody > tr > td`
  sono espliciti (`index.css` non ha più regole globali su tabelle dal v3.16.0).
- **Migrazione a fasi, un modulo alla volta** (verifica visiva dell'utente dopo ciascuno):
  ✅ USALI (pilota, v3.15.0), ✅ Budget (v3.15.1 — ora ha un titolo pagina con hotel come
  `SegmentedControl`, anno/versione in `PageHeader`; colori grafici Budget/Actual = `textSubtle`/`info`).
  ✅ Forecast (v3.15.2 — tolto il viola "di marca" e l'azzurro di Cancellazioni, tenuto
  `colors.accent` per il Maturato; titolo senza emoji), ✅ Statistiche Produzione (v3.15.3 —
  filtro struttura come `SegmentedControl` "Tutte/hotel" via `OPZIONI_STRUTTURA` in
  `produzioneHelpers.js`; tolto il titolo interno duplicato delle tab Analisi), ✅ Corrispettivi
  (tranche A v3.15.4: contenitore, Import, Scontrini/Fatture, Penali, Cassa, Stampante RT, Dati di
  test — la pillola "Se già presente: Salta/Aggiorna" dell'Import non è più arancione, l'arancione
  resta solo per IVA; vista "Per hotel" di Scontrini/Fatture ora apre sul mese precedente come da
  convenzione. Tranche B v3.15.5: Corrispettivi giornalieri, Riepilogo Fatturati, Controllo RT,
  Analisi Ricavi — intestazioni per struttura e box "Per sede fisica" ora nei colori ufficiali degli
  hotel invece dei vecchi DPH blu notte/CLB azzurro/INT indaco; in Analisi Ricavi il conflitto 409
  "dati già presenti" usa `useConferma` invece di un pannello inline, e Dettaglio/Macrocategorie è
  un `SegmentedControl` invece di una checkbox), ✅ Dashboard Hotel e Gruppo (v3.15.6 — hotel e
  modalità come `SegmentedControl` nel titolo pagina; nel Ritmo prenotazioni e nell'occupazione per
  hotel i colori ufficiali delle strutture), ✅ Home/Cruscotto + Import Revenue + Import massivo
  (v3.15.7 — tachimetri, mappa di calore e semaforo sui colori di significato; il blocco admin in
  fondo alla Home si intitola "Dati riservati" con badge "solo admin"; eliminato `BulletChart.jsx`,
  importato ma mai usato), ✅ Login (v3.15.9 — solo aspetto, logica di accesso invariata; pulsante
  blu notte invece dell'azzurro), ✅ Dipendenti tranche A (v3.15.10: titolo, tab, Report mensile,
  Anagrafica con editor ripartizione CC, Import PDF, Storico — tab da ambra a blu notte, esiti di
  ricalcolo come avvisi temporanei, conferme dell'app; i colori dei badge CC restano quelli per reparto
  configurabili in Admin → Colori CC, con la palette di ripiego `_CC_PALETTE` invariata apposta per non
  cambiare i colori dei reparti non configurati), ✅ Dipendenti tranche B (v3.15.11: Analisi CC —
  controlli su due righe, confronto anno come casella "Confronta con {anno-1}", tabella con colonna
  fissa a sinistra e intestazione a due livelli, torta "Per struttura" nei colori ufficiali degli hotel
  invece dei vecchi DPH blu/CLB verde; eliminati tutti gli stili locali in fondo a `Dipendenti.jsx`),
  ✅ Admin tranche A (v3.15.12: sidebar — classi `ui-admin-sidebar`/`ui-admin-gruppo`/`ui-admin-voce`,
  voce attiva blu notte invece dell'azzurro —, Utenti con modali della libreria, Stagioni, Moduli (bordo
  sinistro nel colore del modulo, come in NavBar), Soglie tachimetri (riga modificata e non salvata
  evidenziata in ambra), Revenue Import massivo e Dati di test), ✅ Admin tranche B (v3.15.13: Centri
  di costo — un solo titolo, prima doppio —, Colori CC con avviso "modifiche non salvate", Dati di test
  Dipendenti, Classificazione trattamenti — **corretto un difetto**: i messaggi di esito comparivano
  come riquadro rosso vuoto, perché `fb(testo, tipo)` passava due argomenti a `useFeedback`, che ne
  gestiva uno solo e poi leggeva `msg.tipo`/`msg.testo` su una stringa; ora usa `useAvvisi` —, Stampanti
  RT, Debug, Backup), ✅ Admin tranche C (v3.15.14: USALI Mappatura costi lavoro — scelte Camere/F&B/
  Altri come `SegmentedControl` per riga —, Range KPI, Righe Movimenti Attivi; Produzione Categorie e
  Mapping dettagli. Stesso difetto dei messaggi vuoti corretto anche qui (Categorie, Mapping, Movimenti
  usavano `fb(testo, tipo)`). Eliminati `useFeedback`/`inputSm`/`btnSm`. Con questa tranche **non
  restano `window.confirm`/`alert` in tutta l'app**), ✅ Pulizia finale (v3.16.0 — **migrazione
  completata**, tutte le pagine sulla libreria): `index.css` ridotto a reset di base (body con variabili,
  titoli, `button` nativo per i pochi pulsanti con stile inline — interruttori, accordion); **eliminate
  le regole globali su `th`/`td`/`tr`/`select`/`input[type=date]`** e le classi vecchie `.card`,
  `.grid-kpi`, `.sezione`, `.badge*`, `.text-muted`, `.text-right`, `tr.riga-totale` (verificato: nessun
  uso residuo; tutte le tabelle passano da `<Table>`, tutti i campi da `ui-input`). NavBar.css su
  variabili (blu notte, font), pagina 403 di `ProtectedRoute` e `PastReferenceArea` sui token, colore
  colonne totale delle righe risultato del Conto Economico come token `successBgStrong`. Eliminati
  `thSt`/`tdSt`/`inpSt` dagli helper e `WorkInProgress.jsx` (non più importato da nessuna parte).
  Export xlsx/pdf (colori nel backend) fuori ambito. **Pagine nuove**: usare solo la libreria — senza
  `<Table>` una `<table>` nuda oggi non ha alcuno stile (nessuna regola globale di ripiego).
- Nelle pagine migrate: nessun colore esadecimale scritto a mano, nessun `fontSize` fuori scala
  (11/12/13/14/16/18/22), nessun `alert()`/`confirm()`.

## Componenti grafici condivisi
**`PastReferenceArea`** (`frontend/src/components/PastReferenceArea.jsx`): sfondo scuro sui periodi già trascorsi in un grafico Recharts, per distinguere visivamente "maturato" (passato) da "OTB" (futuro).
- Props: `data` (array punti), `dateKey` (chiave ISO YYYY-MM-DD per confronto con oggi), `displayKey` (chiave usata su XAxis se diversa da `dateKey`)
- Usato in: DashboardHotel (3 grafici), DashboardGruppo (4 grafici), Budget (2 grafici), Forecast (1 grafico)
- **⚠️ Usare come funzione inline, non come componente JSX** — Recharts riconosce i figli per tipo e ignora componenti wrapper custom. Usare `{pastReferenceArea(data, 'week_start', 'label')}` dentro il chart.
- Aggiungere a ogni nuovo grafico con asse temporale: `{pastReferenceArea(data, 'week_start', 'label')}`
- Se il grafico usa date ISO direttamente sull'XAxis: `{pastReferenceArea(data, 'data')}`
- Nota: se `grafici[]` usa `label=week_start.slice(5)`, includere `week_start` nell'oggetto per poter usare `dateKey="week_start"`

## Principi grafici (da "Principi di progettazione")

### Righe tabella con sfondo custom (totali, evidenziate) — impostare il background su ogni `<td>`
Oggi la regola è in `styles/ui.css` (`.ui-table > tbody > tr:nth-child(even) > td`, righe alterne di
ogni `<Table>`) e il modo corretto è una classe `ui-riga-*` sulla `<tr>` (vedi Libreria UI). Storia: fino
al v3.16.0 `index.css` aveva una regola globale `tr:nth-child(even) td { background: #edf1f7; }` su
**tutte** le tabelle dell'app. Uno stile inline `background` messo solo sulla `<tr>` (non sui singoli
`<td>`) NON dipinge i `<td>` figli — in CSS il background non si eredita dal genitore — quindi per le
righe dispari il `<td>` trasparente lascia vedere il colore della `<tr>` (sembra funzionare), ma per
le righe pari la regola globale vince e sovrascrive il `<td>` con `#edf1f7` (grigio chiaro), mentre un
eventuale `color` impostato sul `<td>` (es. bianco) resta invariato → testo quasi invisibile. Bug reale
(luglio 2026, Statistiche Produzione): la riga "TOTALE MESE" in `TabGiornaliera.jsx` risultava leggibile
o "spenta" a seconda del numero di giorni del mese (posizione pari/dispari cambia con 28/29/30/31
giorni — maggio 31gg=pari=rotto, giugno 30gg=dispari=ok); stesso rischio in `TabReportMensile.jsx`
("ANNO", posizione pari/dispari dipende da quante righe di dettaglio mese sono espanse). Fix: impostare
`background` esplicitamente su OGNI `<td>` della riga, non solo sulla `<tr>` — uno stile inline sul
`<td>` batte sempre qualunque regola esterna, a prescindere da specificity/ordine. Corrispettivi evita
il problema con una classe dedicata (`tr.riga-totale td { background: #1e3a5f; color: #fff; }` in
`index.css`, che vince per ordine di dichiarazione — più fragile, si romperebbe riordinando il CSS):
preferire comunque lo stile inline su ogni `<td>`, più robusto.

### Uniformità grafica tra pagine
Prima di costruire un elemento UI che esiste già altrove nel progetto (toggle, badge, pannello di
conferma, ecc.), cercare il pattern già in uso e riusarlo — stesso markup/stile, non solo stessa
funzione. Non introdurre una variante visiva diversa (es. una checkbox al posto della pillola a due
bottoni) solo perché è più veloce da scrivere in quel momento.
- Esempio: toggle "IVA inclusa/esclusa" — stessa pillola arancione (`background:'#fff7ed'`,
  bordo `#fdba74`, bottone attivo `#ea580c`) con due bottoni "IVA inclusa"/"IVA esclusa", identica in
  `Corrispettivi.jsx`, `StatisticheProduzione.jsx` e `UsaliMovimentiAttivi.jsx` — la prima versione di
  quest'ultima usava una semplice checkbox, corretta su richiesta esplicita (luglio 2026).
- Dal settembre 2026 la pillola è il componente `ToggleIva` della libreria UI (vedi sezione "Libreria
  UI"): nelle pagine migrate usare quello, non il markup inline.
- Se un componente riutilizzabile esiste già (es. `PastReferenceArea`, `ExportMenu`, tutto
  `components/ui/`), usarlo invece di
  reimplementare lo stesso markup inline in una nuova pagina.
- localStorage key per preferenze di visualizzazione (es. toggle IVA) resta per-modulo (`corrispettivi_lordo`,
  `produzione_lordo`, `usali_movimenti_lordo`, ecc.) — l'uniformità è sullo stile, non sullo stato condiviso.

## Nota da "Utility frontend" (testo originale)

- `percentualiA100(valori, decimali=1)` — percentuali di ripartizione che, arrotondate, sommano sempre esattamente 100 (metodo del resto maggiore). Usarla per ogni legenda/colonna "% sul totale" che l'utente usa per ripartire costi: con `toFixed(1)` per voce la somma poteva dare 100,1/99,9 (bug segnalato ottobre 2026, torta "Ripartizione" e dettaglio dipendenti in Dipendenti → Analisi CC).
