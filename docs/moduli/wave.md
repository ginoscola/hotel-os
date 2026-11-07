<!-- Spostato da CLAUDE.md il 07/11/2026, testo invariato: dove si legge "questa sezione" o "in CLAUDE.md" si intende questo file. Le regole generali restano in CLAUDE.md. -->

## Indice WAVE (in sviluppo — progetto a fasi)
WAVE = Weekly Achieved Value vs Excellence: fatturato del periodo ÷ miglior fatturato mai ottenuto nello stesso
periodo (netto IVA, senza tassa di soggiorno), KPI sempre sui totali. Specifica completa: `prompt_hotelos_wave.md`
nella root (**fuori da git**, verrà cancellata a lavoro finito: le decisioni vanno scritte qui). Storico 2022–2025:
`uploads/wave/Storico_fatturato_WAVE_2022-2025.xlsx` (foglio Storico, colonna H). Stesse regole di lavoro della
Tesoreria: una fase per volta, ok esplicito prima del codice, chiedere nei dubbi.
Fasi: 1 storico + riferimento · 2 Dashboard Hotel · 3 Gruppo + Home · 4 ritmo di stagione.
**Stato**: ✅ Fase 1 (v4.8.0), ✅ Fase 2 (v4.9.0), 31/10/2026. Fase 3 (Gruppo + Home) solo con ok dell'utente.

**Fase 2 — fatto** (Dashboard Hotel):
- `services/wave_hotel.py::wave_hotel(db, hotel_code, righe, oggi)` — UNICA implementazione, usata da
  `GET /dashboard/hotel/{code}` e dagli export settimanale/mensile. Anno = anno prevalente delle righe di
  aprile–settembre; numeratore `revenue_total ÷ 1,10`; per settimana solo i giorni di giugno–settembre (settimane di
  aprile/maggio → None); stagione = Σ incassi dei soli periodi con riferimento ÷ Σ riferimenti. Restituisce
  `{anno, stagione, periodi[], settimane{week_start: {valore, riferimento, wave}}}`.
- Risposta dashboard: `DashboardHotelResponse.wave` (`WaveHotel`: anno, stagione, periodi con `anno_record`) e su
  ogni `SettimanaDashboard` `wave`/`wave_valore`/`wave_riferimento` (campi nuovi opzionali, nessun campo cambiato).
- Export hotel settimanale e mensile: **17 colonne** (ultima "WAVE (%)", riga TOTALE = WAVE di stagione); nel
  mensile xlsx le celle WAVE di aprile e maggio sono unite (csv/pdf: stesso valore del blocco su entrambe le righe).
- Frontend `DashboardHotel.jsx`: tessere "WAVE stagione" (con confronto) e "WAVE sett. rif." (in apr/mag mostra
  l'Inizio stagione), grafico "WAVE settimanale e occupazione" (`ComposedChart`: barre WAVE `coloreSerie(4)`, linea
  occupazione `colors.info`, linea WAVE del confronto con `STILE_CONFRONTO`, linea a 100%, `pastReferenceArea`),
  colonna WAVE nelle tabelle mensile (aprile+maggio in una cella `rowSpan`) e settimanale, **riga TOTALE STAGIONE
  aggiunta alla tabella settimanale** (KPI sui totali, `totaliAggregati()` condivisa con la mensile).
  `components/SpiegazioneWave.jsx` = pulsante "ⓘ" + finestra con il testo della specifica (`TOOLTIP_WAVE`): se cambia
  il calcolo, aggiornare anche quel testo.
- **v4.9.1 — il grafico ingannava** (segnalato dall'utente: "dal grafico la stagione sembra buona, ma il totale è
  molto sotto il 100%"): le barre settimanali pesano tutte uguale a vista mentre agosto vale molti più euro di
  settembre (CLB: 5/9 al 205% = +15k €, agosto 65–96% = −52k €), e il riferimento spalmato per giorni fa picchi agli
  estremi dei mesi. Correzione: linea principale **WAVE stagione progressivo** (Σ incassi ÷ Σ riferimenti fino alla
  settimana, Inizio stagione compreso; l'ultimo punto = WAVE di stagione), barre settimanali chiare come dettaglio,
  confronto sul progressivo, tabella **Incassato / 100% WAVE / Scarto €** per periodo sotto il grafico
  (`TabellaScartoWave`), tessera "X € su Y € (netto IVA)". Per far tornare il progressivo, `wave_hotel()` restituisce
  le settimane di **tutto giugno–settembre** anche senza dati (incasso zero dopo la chiusura) e `wave.settimane`
  (lista `WaveSettimana` con `progressivo`) nella risposta dashboard. Scarto 2026: CLB −82.336 € (agosto −51.845),
  INT −62.224 € (agosto −36.736), DPH −6.291 €.
- **v4.9.2 — distanza in euro** (richiesta dell'utente: "si misura la redditività", la % non rendeva la distanza):
  card "Distanza dal 100% WAVE, in euro" (`GraficoScartoWave` in `DashboardHotel.jsx`, solo frontend sui dati di
  `wave`): barre = incassato − 100% della settimana (verde/rosso, prima barra = blocco aprile+maggio), linea = scarto
  accumulato da inizio stagione (ultimo punto = scarto di stagione), confronto tratteggiato. 2026: CLB scende a
  −82k, INT a −62k (il buco si apre ad agosto), DPH oscilla tra −6k e +20k.
- **v4.9.3 — consuntivo e prenotato distinti nei grafici** (`separaPrenotato()` in `DashboardHotel.jsx`): il riferimento è
  sempre il risultato finale, quindi le settimane future (prenotato) sono basse per costruzione. Settimana "futura" =
  non finita prima della data della snapshot: barre più chiare e linea progressiva/scarto tratteggiata (parte dall'ultimo
  punto chiuso). Tessere invariate. **Da fare nella Fase 4** (deciso con l'utente, 01/11/2026): toggle del grafico
  Risultato finale (default) / Alla stessa data, stima `riferimento finale × (prenotato 2026 alla stessa data ÷ finale
  2026)` per settimana e hotel, etichettata come stima sul ritmo 2026 e chiamata "Ritmo vs riferimento", non WAVE; le
  settimane chiuse non cambiano. Utile solo dalle snapshot di metà marzo 2027 (2022–2025 non hanno snapshot).
- Confronto anno precedente: nel 2026 non disponibile (nessuna snapshot 2025, scelta dell'utente: niente dato 2025
  dallo storico); funzionerà dal 2027.
- Dati reali 2026 (snapshot 21/09): DPH 98,7%, CLB 86,8%, INT 88,8%. Limite noto: il riferimento settimanale è la
  quota del mese per giorni, quindi dentro un mese le prime settimane (più deboli) risultano basse e le ultime alte
  (CLB giugno: 50% → 128%) — è la stagionalità interna al mese, non un errore.

**Fase 1 — fatto** (storico e riferimento):
- Tabella `wave_storico` (`models/wave.py`, migrazione `wave001_2026`): struttura × anno × mese, `netto`
  Numeric(14,4), lordo/tassa/metodo/fonte/note informativi, `modificato_manualmente` + `netto_originale`. Solo anni
  < `PRIMO_ANNO_HOTELOS` (2026): gli anni di HotelOS non vengono mai salvati qui.
- `services/wave.py` (puro): `PERIODI` (inizio = apr+mag, giugno…settembre), `valori_per_periodo()`,
  `riferimenti(valori_anni, anno)` (migliore degli anni < anno; a parità vale il più vecchio),
  `riferimento_stagione()` (somma dei migliori), `riferimento_settimana(rif, week_start)` (quota giornaliera del
  riferimento del mese per i giorni di giugno–settembre; apr/mag esclusi → None), `wave()`.
- `services/wave_import.py::parse_storico()` — foglio "Storico", colonne per intestazione; ignorate con avviso righe
  2026+, mesi fuori apr–set, strutture sconosciute, netto vuoto; errore su foglio/colonne mancanti o doppioni.
- `services/wave_dati.py`: `valori_mensili(db, oggi)` (storico + `report_fatturati()` arrangiamenti ÷ 1,10 per ogni
  anno dal 2026; `in_corso` se oggi ≤ `fine_stagione()` = `hotel_seasons.close_date`, MMS → DPH, BON → INT,
  default 30/9), `riferimento_anno(db, anno, oggi)`.
- Router `routers/wave.py` (prefix `/wave`, lettura `richiedi_utente_attivo`, scrittura `richiedi_admin`):
  `GET /storico`, `POST /storico/import?conferma=false|true` (anteprima e conferma con lo stesso upload; righe
  corrette a mano mai toccate → `bloccate`), `POST /storico` (mese mancante a mano), `PUT /storico/{id}`
  (`netto` / `note` / `ripristina`), `DELETE /storico/{id}?conferma=true`, `GET /riferimento?anno=`.
- Admin → Revenue → "Indice WAVE — storico" (`?s=wave-storico`, `pages/admin/AdminWave.jsx`).
- Test `tests/test_wave.py` (16). Sul file reale: 79 righe, riferimenti di stagione identici al foglio "Riferimento
  WAVE" (DPH 482.310, CLB 624.823, INT 555.209, MMS 80.620, BON 57.908).
- Anteprima sul DB reale (Corrispettivi, quindi fatturato — il WAVE ufficiale della Fase 2 userà i dati Revenue):
  stagione 2026 DPH 482.278 € (100%), CLB 533.128 (85%), INT 495.533 (89%), MMS 79.544 (99%), BON 73.262 (127%).
  Record 2026 che entrano nel riferimento 2027: DPH inizio e settembre, CLB inizio, INT giugno, MMS inizio e giugno,
  BON tutti tranne giugno.

Decisioni (31/10/2026, oltre a quelle della specifica):
- Storico importato così com'è (anche le 5 differenze tra file segnalate nel foglio Note), correzioni da Admin.
- Dal 2026 il **record** si aggiorna dai Corrispettivi: hotel = `arrangiamenti` di `report_fatturati()` ÷ 1,10
  (penali, shop e tassa esclusi, come lo storico 2025); ristoranti = arrangiamenti MMS/BON ÷ 1,10.
- **L'anno in corso non concorre al record** finché la stagione non è chiusa.
- Mesi fuori da aprile–settembre ignorati.
- **Riferimento di un anno X = migliore degli anni precedenti a X** (non di tutti gli anni): un record di X
  risulta > 100%; il primo anno di una struttura (INT, BON 2025) non ha riferimento.
- **Il WAVE si misura sempre sui dati Revenue** (`daily_revenue.revenue_total` ÷ 1,10, notte per notte) — settimane,
  mesi, stagione e futuro — contro il riferimento per data documento (strada "A"): coerente con la linea
  dell'occupazione e col prenotato; sul singolo mese di inizio/fine stagione può scostarsi (CLB settembre 2025:
  maturato +43% sul fatturato), sulla stagione 1–2%. Verificato sul 2026: `daily_revenue` è **IVA inclusa e senza
  tassa di soggiorno** (stagione: DPH 523.621 vs arrangiamenti lordi 530.506, CLB 596.736 vs 586.441, INT 542.284 vs
  545.086; con la tassa sarebbero +2,5%).
- **Grafico settimanale**: nelle settimane di aprile–maggio nessuna barra WAVE (solo occupazione) + etichetta
  "Inizio stagione (apr+mag): X%"; la settimana a cavallo maggio/giugno conta solo i giorni di giugno (quelli di
  maggio vanno nel blocco).
- **Home**: due tachimetri ("a oggi, completo" = settimane passate hotel + ristoranti; "proiezione hotel" =
  prenotato + pickup), con **soglie automatiche dal budget**: WAVE del budget = budget ÷ 1,10 (hotel: stessa base
  dei dati Revenue; ristoranti: `budget_ristoranti`, IVA inclusa) ÷ riferimento; verde ≥ WAVE del budget, arancio
  fino a 5 punti sotto, rosso oltre; tacca sul budget.
