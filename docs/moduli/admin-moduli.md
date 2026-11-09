<!-- Spostato da CLAUDE.md il 07/11/2026, testo invariato: dove si legge "questa sezione" o "in CLAUDE.md" si intende questo file. Le regole generali restano in CLAUDE.md. -->

## Architettura modulare
Moduli: `revenue` (/dashboard/gruppo), `produzione` (/statistiche-produzione — Statistiche Produzione, vedi sezione dedicata), `budget` (/budget), `usali` (/usali — Conto Economico, Movimenti Attivi, CE contabile, Food & Beverage, vedi sezioni dedicate), `dipendenti` (/dipendenti), `corrispettivi` (/corrispettivi), `forecast` (/forecast), `tesoreria` (/tesoreria — flusso di cassa, vedi sezione Modulo Tesoreria; endpoint con permessi per modulo di `app/permessi.py`).
Tabelle: `modules` (code PK, name, icon, route, ordine, attivo, colore), `module_permissions` (module_code, ruolo, puo_vedere, puo_modificare, puo_importare).
NavBar L1: tab moduli da `GET /modules/`; L2: sotto-nav del modulo attivo.
Su schermi ≤ 768 px (cellulare, v4.32.0) L1 mostra solo logo e pulsante ☰, che apre un menu a tendina con moduli, Admin e
utente/Esci (si chiude al cambio pagina); L2 scorre in orizzontale. Regole solo in `@media` di `NavBar.css`: il computer non cambia.
Stile (v4.34.0, "F6"): L1 a tasti a tutta altezza (64 px) separati dal fondo scuro `--color-nav-fondo`, **senza icone**;
ogni tasto ha in basso una striscia del colore del modulo (`modules.colore`, passato come variabile CSS `--c`), l'attivo è
bianco con riga in alto del colore e si unisce alla L2 chiara (46 px, voce attiva sottolineata). Logo grande con nome e
versione sotto; Admin = ingranaggio SVG in un tasto quadrato (giallo solo dentro `/admin`, v4.35.1); blocco utente con nome e ruolo. Sotto 1360 px i tasti si stringono, sotto 1100 px spariscono nome app e
utente. I nomi dei moduli in `modules.name` sono con la sola iniziale maiuscola (es. "Statistiche occupazione"):
il menu li mostra così come sono, quindi un nuovo modulo va scritto allo stesso modo.
Permessi: al login → `localStorage['moduli_permessi']`; ProtectedRoute verifica `puo_vedere`.
**Permessi lato backend per modulo** (`app/permessi.py`, ottobre 2026): `permessi_modulo(db, utente,
modulo)` è l'unica implementazione delle regole (admin sempre tutto; modulo disattivato = niente per
i non admin; ruolo da `module_permissions`; override per utente solo su `puo_vedere`), usata sia da
`lista_moduli()` (NavBar) sia dalla dipendenza `richiedi_permesso(code, 'vedere'|'modificare'|
'importare')` → 403. Modificare/importare richiedono anche vedere. Oggi la usa solo Tesoreria; gli
altri moduli restano su `richiedi_admin`/`richiedi_utente_attivo`.
**Aggiungere modulo**: riga in `modules` → righe `module_permissions` → pagina JSX → `<Route moduleCode="">` in App.jsx. Appare automaticamente in NavBar (tab L1 + link).
⚠️ **Ma il tab NON risulta evidenziato come attivo se la sua route non è aggiunta anche in
`rilevaModuloAttivo()`** (`NavBar.jsx`): quella funzione decide quale tab colorare come "attivo"
con una whitelist manuale di prefissi (`pathname.startsWith('/budget')` ecc.), separata dal routing
vero e proprio di React Router — non basata su `m.route` dei moduli caricati da `GET /modules/`.
Bug reale (trovato settembre 2026): mancavano sia `produzione` (`/statistiche-produzione`, aggiunto
da `prod004_2026` come modulo separato da USALI) sia `forecast` (`/forecast`), quindi su quelle pagine
restava evidenziato "Statistiche" (default di fallback della funzione). Corretto aggiungendo entrambi
i prefissi mancanti — ma resta un passo manuale da ricordare a ogni nuovo modulo, non automatico.
⚠️ **`getSubnav()` (`NavBar.jsx`) mostrava "— in sviluppo" sotto la NavBar per ogni modulo diverso
da `revenue`** (unico con una vera sotto-nav propria, i link agli hotel): un fallback rimasto da
quando gli altri moduli erano effettivamente non ancora fatti, mai aggiornato mano a mano che sono
stati completati — visibile ancora a settembre 2026 su Forecast, Dipendenti, Corrispettivi e
Statistiche Produzione, tutti e quattro pienamente funzionanti (hanno le proprie tab interne, che
già fanno da sotto-navigazione). Corretto facendoli rientrare in un caso a parte che ritorna `[]`
(nessuna sotto-nav, il banner non compare perché il rendering è condizionato a `subnav.length > 0`)
invece di cadere nel fallback "non ancora implementato". **Budget e Usali non toccati** (non
richiesto): mostrano ancora "in sviluppo" finché non verrà chiesto esplicitamente anche per loro.

## Area Admin (`/admin` → AdminUnificato.jsx, sidebar `?s=`)
**Comune**: `utenti` (CRUD), `stagioni` (stagioni operative), `hotel-camere` (nome e camere di default degli hotel, anagrafica
camere con disattivazione al posto dell'eliminazione — `AdminHotelCamere.jsx`, v4.31.0; test `test_rooms_hotels.py`), `moduli` (attiva/disattiva/permessi), `attivita` (frequenze dello scadenziario, vedi "Attività ricorrenti")
**Revenue**: `revenue-import` (bulk import), `revenue-test` (cancella is_test)
**Dipendenti**: `dip-cc` (AdminCentriDiCosto), `dip-colori` (colori CC), `dip-test`
**Corrispettivi**: `corr-tipi-doc`, `corr-pagamenti`, `corr-classificazione` (CorrClassificazioneTrattamenti)
⚠️ **`corr-tipi-doc` e `corr-pagamenti` sono stati vuoti fino a settembre 2026** (bug reale, corretto
in v3.15.8): chiamavano `/corrispettivi/config/tipi-documento|tipi-pagamento`, indirizzi mai esistiti
nel backend (404, verificato anche nello storico git). Correzione scelta per non toccare dati né totali:
- `corr-pagamenti` ora usa la tabella vera `tipi_pagamento` via `/lookup/tipi-pagamento` (GET con
  `solo_attivi=false`, POST `codice/descrizione/categoria/ordine`, PUT `attivo`). Quella tabella alimenta
  **solo** la tendina "Forma di pagamento" di *Modifica documento* in Scontrini/Fatture: i report (Forme di
  pagamento, Cassa, % contante in Home) usano la mappa fissa `METODO_A_CATEGORIA_INCASSO` in
  `corrispettivi_report.py`, quindi modificarla non cambia nessun totale. Nessun endpoint di cancellazione:
  solo attiva/disattiva. (In tabella ci sono sia "XPAY-Nexi" sia "xpay", probabile doppione: lasciato
  all'utente da disattivare dal pannello.)
- `corr-tipi-doc` è ora una **scheda di sola consultazione** (`REGOLE_TIPO_DOCUMENTO` in
  `AdminUnificato.jsx`): non esiste nessuna tabella, la classificazione SC/SCA → scontrino, F → fattura,
  CP/FD/altri → escluso è una regola fissa dell'import (`TIPI_SCONTRINO`/`TIPI_FATTURA` in
  `corrispettivi_excel_parser.py`) legata alle regole fiscali. Renderla configurabile rischierebbe di
  cambiare cosa entra nei totali trasmessi ad AdE — scelta esplicita di non farlo. Se cambia la regola
  nel parser, aggiornare anche la scheda.
Eliminata anche la vecchia `pages/Admin.jsx` (pre-v2.0, non più collegata a nessuna rotta): tutte le
sue sezioni esistono in `AdminUnificato.jsx`, tranne "prefissi struttura", che chiamava un indirizzo
inesistente e non aveva mai funzionato.
**USALI**: `usali-kpi` (range KPI), `usali-cc` (mappatura costi lavoro), `usali-movimenti` (righe Movimenti Attivi per struttura), `usali-fnb` (reparti cedolini → punto vendita della scheda Food & Beverage)
**Budget**: `budget-previsione` (AdminBudgetPrevisione — correttivi e parametri della proiezione fine stagione)
**Statistiche Produzione**: `prod-categorie` (ProdCategorie), `prod-mapping` (ProdMappingDettagli — mapping testo Welcome→categoria)
**Tesoreria**: `tes-conti`, `tes-categorie`, `tes-regole`, `tes-soglie`, `tes-affitti` (rate in data e %), `tes-interventi`, `tes-advertising` (advertising con carta e fornitori pagati con carta), `tes-ricorrenti`, `tes-mutuo`, `tes-fiscale`, `tes-previsione` (crescita uscite e scenari) (tutti in `pages/admin/AdminTesoreria.jsx`)
Stagioni: `GET /hotels/{code}/seasons/{year}`, `POST /hotels/{code}/seasons` (upsert).
Dati test: flag `is_test`; `GET|DELETE /admin/test-stats|test-data`, `GET|DELETE /dipendenti/admin/test-stats|test-data`.

**Sidebar collassabile** (luglio 2026, troppi gruppi/voci per stare tutti espansi): ogni gruppo si
apre/chiude cliccando il titolo, più due bottoni "Espandi"/"Comprimi" in cima per tutti i gruppi
insieme. Stato in `localStorage('admin_sidebar_collassate')` (Set di nomi gruppo collassati). Default
al primo accesso (nessun localStorage): tutti chiusi tranne il gruppo della sezione corrente, così la
voce attiva resta visibile senza dover già sapere di aprire qualcosa. Se si naviga verso una sezione
il cui gruppo è chiuso (es. link diretto da un'altra pagina), quel gruppo si riapre automaticamente
senza toccare lo stato degli altri. Aggiungere un nuovo gruppo in `SEZIONI` non richiede altro codice:
eredita comportamento e persistenza automaticamente.
