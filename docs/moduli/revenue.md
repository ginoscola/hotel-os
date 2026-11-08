<!-- Spostato da CLAUDE.md il 07/11/2026, testo invariato: dove si legge "questa sezione" o "in CLAUDE.md" si intende questo file. Le regole generali restano in CLAUDE.md. -->

## Regole critiche Revenue CSV
File sempre in coppia: file1 = RICAVI TRAT comprensivi ristorante, file2 = solo alloggio.
- `revenue_rooms = file2.RICAVI_TRAT`
- `revenue_fnb = file1.RICAVI_TRAT - file2.RICAVI_TRAT` (mai negativo)
- `revenue_extra = EXTRA_TRATT` (in entrambi i file)
- `revenue_total = rooms + fnb + extra`

Scartare righe con "(SDLY)" o "(LY)" nel campo DATA, o senza data dd/mm/yyyy.
Numeri: virgola decimale. Date: dd/mm/yyyy (es. 30/05/2026 sab).
Convenzione nome file: `YYYYMMDD_PlanningForecast-HOTELCODE[12].xlsx/csv` — il suffisso `[12]` è
solo estetico, **ignorato dal parser**: `parse_coppia()` auto-rileva quale file è il "comprensivo
ristorante" confrontando la somma dei ricavi tra i due file (quello con somma maggiore è file1).
⚠️ **`parse_coppia()` rifiuta con `ValueError` se i due file sono identici riga per riga**
(`dati_a == dati_b`, confronto strutturale su tutti i campi, non solo sulla somma — evita falsi
positivi nel raro caso di zero F&B legittimo): bug reale (luglio 2026) in cui lo stesso file era
stato caricato due volte come file1 e file2 per CLB, producendo `revenue_fnb=0` su ogni riga
dell'import (F&B azzerato, ricavi camere gonfiati) e un calo innaturale nel grafico Ritmo
prenotazioni di gruppo. Non serve controllare i nomi file: il controllo è sul contenuto.

## Dashboard Hotel
- Snapshot: `GET /snapshots/{hotel_code}` → navigazione con frecce. Settimana di riferimento = settimana Sab–Ven contenente snapshot_date.
- **Chiamate senza snapshot** (modalità legacy `?da=&a=` di Dashboard Hotel/Gruppo, export hotel e gruppo): dal 08/11/2026
  (v4.30.11) `_carica_righe()` prende per ogni hotel e giorno la snapshot più recente. Prima sommava le righe di tutte
  le snapshot (ricavi e camere moltiplicati): bug reale nell'export gruppo (corretto v4.30.7), latente negli altri
  perché il frontend passa sempre `snapshot`. Test in `test_export_gruppo_snapshot.py`.
- `kpi_periodo` = KPI solo sulla settimana di riferimento; evidenziata in grafici (ReferenceArea) e tabella.
- Confronto snapshot precedente (mutuamente esclusivo con anno precedente, offset 364gg ±30gg tolleranza).
- Revenue giornaliero: senza confronto → BarChart impilato (Camere/F&B/Extra); con confronto → LineChart `revenue_total` corrente vs confronto.
- **ADR, retta media e valore per camera** (`GraficiValoreCamera`, v4.10.0; toggle Giornaliero/Settimanale in `localStorage('hotel_adr_vista')`, settimana sab–ven da `settimane[]`): linee Retta media (`rmc`, ricavo totale ÷ camere, anche sul prenotato; **riferimento stabile tra mesi e anni**, scelta dell'utente; confronti snapshot/anno precedente solo qui, `rmc_comp`) e ADR da Statistiche Produzione (v4.10.1: tolta dal grafico la linea dell'ADR di Revenue, che in tessere e tabelle di Dashboard Hotel e Gruppo si chiama **ADR PMS**; negli export resta "ADR"). Card "Valore per camera venduta (Statistiche)": barre Camera/F&B/Extra da `GET /produzione/report/giornaliero` (alloggio; pasti + `bar_*`; il resto, voucher esclusi) ÷ camere vendute Revenue, solo giorni prima della snapshot con dati importati. Solo lettura: ADR ufficiale, Budget, Forecast e RevPAR restano su Revenue.
  ⚠️ **L'ADR ufficiale non è il prezzo camera**: il file "solo alloggio" di Welcome toglie i pasti al **valore fisso** (scontato per i bambini, **cambia ogni anno**), diverso dalle quote di Produzione. A parità di totale, Revenue ha meno camera e più F&B (1/6–15/9/2026: Club 67,8 vs 84,5 €, International 72,4 vs 88,3 €, Du Parc 127,7 vs 128,9 €; INT 13/9 solo B&B: camere 275 vs 340, F&B 165 vs 100, totale 440). Meccanismo confermato dall'utente, importi non verificati. ADR, RevPAR e % camere/F&B non vanno confrontati tra anni; WAVE e ricavi totali non sono toccati. Tabella Admin dei valori fissi valutata e scartata dall'utente. Le quote di Produzione sono fisse nel 2026 (colazione 10 €; cena 25 € CLB/INT, 30 € DPH; pranzo 10 € CLB/INT, 20 € DPH, valori prevalenti mese per mese): se cambiano in un anno successivo, anche l'ADR da Statistiche Produzione non è confrontabile, quindi dal 2027 confrontarle prima di leggerlo tra anni.
  ⚠️ **Mr Preno mette spesso spiaggia e parcheggio sulla prima notte** (non evitabile; ~71–79% del loro valore Mr Preno 2026): picchi agli arrivi nel giornaliero, soprattutto Club.
- Dati giornalieri: collassabili, stato solo in-memory (`useState`), **sempre compresso all'apertura
  della pagina**, come i blocchi "Dati mensili" (non più persistito in localStorage).
- **Sezione "Dati mensili"** (`SezioneDatiMensili` + helper `aggregaGiorniPerMese` in `DashboardHotel.jsx`,
  tra "Aggregati settimanali" e "Dati giornalieri"): un blocco collassabile per ogni mese solare della
  stagione (Mag/Giu/Lug/Ago/Set), ciascuno con tutte le righe giornaliere del mese (stesse colonne di
  "Dati giornalieri") + riga "TOTALE {mese}" con KPI ricalcolati sui totali del mese (mai media dei
  giornalieri). Stato apertura solo in-memory (`useState`), tutti i mesi compressi all'apertura pagina.
  Ogni blocco mese ha il proprio tasto **Esporta** (xlsx/csv/pdf): riusa `/export/hotel/{code}/giornaliero`
  con `da`/`a` = prima/ultima data effettiva del mese (`m.giorni[0].data`..`m.giorni.at(-1).data`),
  filename `{hotel}_giornaliero_{YYYY-MM}`. Nessun endpoint dedicato.
- SettimanaDashboard include: rooms_sold, rooms_available, occupancy, adr, rmc, revpar, trevpar, revenue_*, inc_rooms, inc_fnb, inc_extra.

## Dashboard Gruppo
Tre modalità (toggle, `localStorage('gruppo_modalita')`):
- **Settimana**: `GET /dashboard/gruppo?modalita=settimana&settimana=&snapshot=`
- **Stagione intera**: `GET /dashboard/gruppo?modalita=stagione&snapshot=`; 3 grafici trend (RevPAR/TRevPAR, Revenue, Occupazione).
- **Ritmo prenotazioni** (`SezionePace` in `DashboardGruppo.jsx`): crescita OTB di un mese target
  (frecce ◀▶ mese/anno) attraverso tutti gli snapshot, un `LineChart` con una linea per hotel
  (`COLORI_HOTEL`). Dati da `GET /forecast/pace-gruppo?anno=&mese=` — stessa logica di
  `/forecast/pace` (singolo hotel) ma per tutti gli hotel in un'unica risposta, fattorizzata in
  `_pace_punti()` in `routers/forecast.py`. Il merge dei punti per `snapshot_date` avviene client-side
  (`chartData` in `SezionePace`), assumendo che gli snapshot siano allineati tra hotel (verificato:
  lo sono, stesso `snapshot_date` per import contemporanei).
  Toggle **Valore assoluto / Crescita indicizzata** (`localStorage('pace_vista')`): la vista assoluta
  mostra il revenue OTB cumulativo (utile per il volume totale) ma penalizza visivamente un hotel con
  fatturato complessivo inferiore anche quando sta accelerando di più — la sua curva resta comunque
  sotto le altre. La vista indicizzata (`chartDataIndicizzato`) porta ogni hotel a base 100 sulla prima
  snapshot disponibile, con `ReferenceLine` a y=100: mostra la FORMA della crescita (pickup relativo)
  a prescindere dal volume assoluto, per confrontare correttamente chi sta accelerando di più.
- `GET /dashboard/gruppo/snapshots` → lista snapshot aggregate.
- Merge confronto per chiave `week_start` (non indice) per evitare sfasamenti tra stagioni diverse.
- `Hotel` (model) non ha un campo `attivo`: `_hotels_per_codice("all", ...)` in `forecast.py` restituisce
  tutti gli hotel in anagrafica (bug preesistente corretto — filtrava su un campo inesistente,
  mai eseguito finché non è servito da `/forecast/pace-gruppo`).

## Export
- Hotel: `GET /export/hotel/{code}/settimanale|mensile|giornaliero?snapshot=&da=&a=&formato=xlsx|csv|pdf`
  (tutti e tre chiudono con una riga "TOTALE" — KPI sui totali del periodo, mai medie — anche il
  giornaliero, usato sia per la stagione intera sia per il singolo mese via `da`/`a`)
- Gruppo: `GET /export/gruppo?da=&a=&formato=`
- `/hotel/{code}/mensile`: aggregati per **mese solare** (non mese contabile Budget), stesse 16 colonne
  del settimanale con prima colonna "Mese", replica di `aggregaMensile()`/`TabellaAggregatiMensili` in
  `DashboardHotel.jsx` (KPI sui totali mensili, `giorni`=giorni con camere vendute, mesi senza vendite
  esclusi). Helper `_aggrega_mesi`/`_riga_mens`/`_totale_mens`/`_xlsx|_csv|_pdf_hotel_mens` in
  `export.py`, riusa `_scrivi_riga_sett`. Pulsante Esporta in `TabellaAggregatiMensili` via `SezioneHeader`.
- Excel: revenue `#,##0.00 "€"`, percentuali `0.0"%"`, interi `#,##0`. Intestazioni bold bianco su blu, righe alternate grigio.
- PDF: landscape A4, 8pt.
- Gruppo Excel: 2 fogli (aggregati settimanali + dettaglio hotel).
