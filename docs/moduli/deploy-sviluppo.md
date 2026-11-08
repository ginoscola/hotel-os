<!-- Spostato da CLAUDE.md il 07/11/2026, testo invariato: dove si legge "questa sezione" o "in CLAUDE.md" si intende questo file. Le regole generali restano in CLAUDE.md. -->

## Variabili ambiente e deploy
Frontend: `VITE_API_URL` in `.env` / `.env.production`. **Mai URL hardcoded.**
`api/client.js` usa `import.meta.env.VITE_API_URL || 'http://localhost:8000'`.
Deploy Linux (attivo dal 23 settembre 2026, server `kmdimare-server`): nginx serve il frontend
statico e fa da reverse proxy verso uvicorn (systemd, `hotelos-backend`) — **su origini/porte
separate**, non un unico proxy per prefissi (bug reale trovato migrando: pagine come
`/dashboard/gruppo` collidono col path dell'endpoint API omonimo). Nessun certbot: TLS terminato da
Cloudflare Tunnel. Dettagli completi, template di config e motivazioni in `docs/MIGRAZIONE_LINUX.md`
e `docs/GUIDA_DEPLOY.md` (+ `deploy/` per i file pronti). Aggiornare `cors_origins` in DB dopo deploy
(richiede anche `sudo systemctl restart hotelos-backend`: letto solo all'avvio, non a ogni richiesta).
⚠️ **Il frontend è servito da nginx come file statici pre-compilati da `frontend/dist/`, non dal
dev server Vite**: dopo ogni modifica frontend serve `cd frontend && npm run build` prima che sia
visibile agli utenti — un riavvio del solo backend non basta e non c'entra, sono due processi
indipendenti. Bug reale (23/09/2026): dopo un fix al pannello Backup, il backend rispondeva già
correttamente ma il browser continuava a mostrare il vecchio testo perché `dist/` risaliva a prima
della modifica. Verifica rapida che il bundle sia aggiornato: confrontare la data di
`dist/assets/index-*.js` con quella dell'ultima modifica ai file `.jsx` toccati.
⚠️ **Il browser teneva in cache `index.html` e mostrava la versione vecchia anche con `dist/` aggiornato**
(bug reale, 28/09/2026: voce Admin "Libreria UI" e pannello Backup nuovi invisibili all'utente, mentre
il server — verificato con `curl` sull'indirizzo pubblico, Cloudflare `cf-cache-status: DYNAMIC` —
serviva già il bundle nuovo). nginx non mandava `Cache-Control`, quindi il browser applicava una cache
euristica a `index.html`, che punta al bundle con hash. Fix in `deploy/hotelos.nginx.conf`:
`Cache-Control: no-cache` su `location /` (index.html sempre ricontrollato) e
`public, max-age=31536000, immutable` su `/assets/` (file con hash, cambiano nome a ogni build).
Se un utente vede ancora "la versione di prima" dopo un build: prima verificare con
`curl -s https://hotelos.kmdimare-hub.com/ | grep -o 'assets/index-[^"]*'` che il server dia il bundle
nuovo, poi ricarica forzata nel browser.
⚠️ **Upload grandi da ufficio: "Network Error"** (bug reale, 01/10/2026, import PDF cedolini ~20 MB).
Due cause in sequenza: (1) nginx API senza `client_max_body_size` → default 1 MB, 413 senza header
CORS che il browser mostra come "Network Error" — fix in `deploy/hotelos-api.nginx.conf` (50M +
`proxy_read/send_timeout 300s`; il file va copiato a mano in `/etc/nginx/sites-available/hotelos-api`
+ `nginx -t && systemctl reload nginx`, Claude non ha sudo su nginx). (2) Anche in LAN il frontend
chiamava l'indirizzo pubblico (`VITE_API_URL`), quindi l'upload usciva su internet e rientrava dal
tunnel Cloudflare: uplink lento, cloudflared "Incoming request ended abruptly: context canceled",
timeout dopo ~3 min. Fix: `API_URL` in `api/client.js` (esportato, usato anche da `Login.jsx`) — se
la pagina è aperta da `192.168.x.x:8080` le chiamate vanno a `:8081` sullo stesso host (nginx API in
LAN), altrimenti `VITE_API_URL`. Nuovi punti che costruiscono URL API a mano devono importare
`API_URL`, non rileggere `VITE_API_URL`. Import Dipendenti con `timeout: 180000` dedicato.

**Dipendenze frontend** (08/10/2026, fuori stagione): `npm audit` a **0 vulnerabilità**. v3.19.2:
axios 1.20 / form-data 4.0.6 (`npm audit fix`). v3.19.3: **react-router-dom 7** (6.30 → 7.18; l'app
usa solo BrowserRouter/Routes/Route/Link/NavLink/Navigate + hook base, nessuna route `*` né link
relativi, quindi nessun cambiamento di comportamento v7 da gestire) e **vite 8 + @vitejs/plugin-react 6**
(motore rolldown/oxc: build ~0,5s invece di ~4,6s; richiede Node ≥ 20.19/22.12 — server su 22.22).
`vite.config.js` invariato. L'avviso "chunks larger than 500 kB" ora cita
`build.rolldownOptions` invece di `rollupOptions`: se un giorno si fa code-splitting, usare quella chiave.
**npm**: dall'08/10/2026 è npm **10.9.9** in `/usr/local/bin/npm` (`sudo npm install -g npm@10`), che
ha la precedenza su npm 9.2.0 del pacchetto Ubuntu (`/usr/bin/npm`, lasciato come riserva; per tornarci
`sudo npm uninstall -g npm && hash -r`). npm 9.2 toglieva i campi `"libc"` dal lockfile a ogni
`npm install` (campo nato con npm 10): modifica innocua, ormai non più prodotta.

## Comandi sviluppo
⚠️ **Dal 23 settembre 2026 lo sviluppo avviene sul server Linux**, non più sul Mac Mini (migrazione
completata — vedi `docs/MIGRAZIONE_LINUX.md`): VSCode Remote-SSH (alias `kmdimare-remote` da fuori
LAN, IP diretto `gino@192.168.100.40` da dentro) sulla cartella `/srv/progetti/hotel-os`, non più
`/Users/ginoscola/hotel-os`. I comandi sotto restano identici, cambia solo dove/su quale macchina si
lanciano — il backend/frontend del Mac Mini sono stati fermati e disattivati (non più avviati da
launchd, `it.hotelos.backend`/`frontend`/`backup` spostati fuori da `~/Library/LaunchAgents/`).
```bash
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev
cd backend && source venv/bin/activate && pytest tests/ -v
cd backend && source venv/bin/activate && ruff check app tests   # controllo statico (ruff.toml, requirements-dev.txt)
cd frontend && npm run lint                                       # eslint (eslint.config.js): trova identificatori non definiti che vite build non vede
cd backend && source venv/bin/activate && alembic check           # modelli = DB reale? deve dire "No new upgrade operations detected"
cd backend && source venv/bin/activate && pip-audit -r requirements-lock.txt --no-deps --disable-pip   # vulnerabilità note pacchetti Python
cd frontend && npm audit                                          # vulnerabilità note pacchetti npm
```
**Dipendenze Python (dal 08/11/2026, v4.30.9)**: `requirements.txt` = dipendenze dirette con versione
esatta (`==`); `requirements-lock.txt` = ambiente di produzione completo, comprese le dipendenze
indirette (è quello da installare su un server nuovo o dopo un ripristino);
`requirements-dev.txt` = ruff, pytest, httpx, pip-audit. Prima c'erano solo minimi (`>=`): una
reinstallazione avrebbe preso versioni mai provate (es. FastAPI 0.162 invece di 0.141). Produzione e
sviluppo usano lo **stesso venv** (`backend/venv`, vedi unit systemd). **Aggiornare un pacchetto** =
lavoro a sé: cambiare la versione in `requirements.txt`, `pip install -r requirements.txt`, test
completi, rigenerare il lock con le sole dipendenze di produzione (non `pip freeze` nudo: includerebbe
gli strumenti di sviluppo), riavvio backend. `bcrypt` resta a 4.0.1 per compatibilità con passlib 1.7.4.

**Modelli e DB allineati (v4.30.9)**: indici e vincoli creati dalle migrazioni vanno dichiarati anche
nel modello (`Index(...)` in `__table_args__`), altrimenti il DB di test (`create_all()`) ne è privo e i
test non li vedono. Dopo ogni migrazione: `alembic check`.
**Riavvio sul server**: `./restart_server.sh` (= `sudo systemctl restart hotelos-backend` + attesa
backend pronto + status), `./restart_server.sh --build` per ricompilare anche il frontend.
Lanciabile da qualsiasi cartella come **`hotelos-restart`** (`hotelos-restart --build`): link
`~/.local/bin/hotelos-restart` → `restart_server.sh`. `~/.local/bin` va nel PATH sia da
`~/.profile` (shell di login, SSH) sia da `~/.bashrc` (riga aggiunta a mano): **il terminale
integrato di VSCode non è una shell di login e non legge `~/.profile`** — con la sola riga di
`.profile` il comando dava "command not found". Lo script ricava la propria cartella con
`readlink -f "$0"`, quindi segue il link (con `dirname "$0"` puntava a `~/.local/bin` e `--build`
non trovava il frontend). Il link non è nel repo: se si rifà il server, ricrearlo con
`ln -s /srv/progetti/hotel-os/restart_server.sh ~/.local/bin/hotelos-restart`. Mai
uccidere/rilanciare uvicorn a mano sulla porta 8000: il backend è un servizio systemd (utente
`hotelos`, `Restart=on-failure`), systemd lo riavvierebbe e i due processi si contenderebbero la
porta. Regola sudoers `/etc/sudoers.d/hotelos` (NOPASSWD solo per
`/usr/bin/systemctl restart hotelos-backend`): Claude può riavviare con `sudo -n`, ma **solo su
richiesta esplicita dell'utente**, mai di propria iniziativa. Gli script solo-Mac (`dev.sh`, `Avvia HotelOS.command`, `installa-backup.sh` + `.plist`
launchd) sono in `scripts/mac-legacy/`, tenuti solo come riferimento — non funzionano su Linux
(osascript, brew, launchd).
File test: `uploads/PlanningForecast-{CLB,DPH,INT}{1,2}.csv`.
⚠️ La fixture `client` nei test di integrazione deve sovrascrivere anche `richiedi_admin`/
`richiedi_utente_attivo` (non solo `get_db`), altrimenti gli endpoint protetti rispondono 401 e i
fallimenti a cascata mascherano bug reali — vedi Modulo Budget più sotto, dove questo mascheramento
ha nascosto per mesi che il salvataggio budget non funzionava mai. Pattern corretto in tutti i file
test a luglio 2026: `app.dependency_overrides[richiedi_admin] = lambda: SimpleNamespace(id=None)`
(id=None se il codice usa `utente.id` per popolare FK verso `users`, altrimenti `lambda: None` basta).
**Database di test dedicato** (ottobre 2026): `hotel_os_test` (owner `hotelos_user`), URL in
`TEST_DATABASE_URL` di `backend/.env`, letto **solo** da `tests/_db.py` (`from tests._db import
TEST_DB_URL` in ogni file di test con DB — mai un URL scritto nel test). `_db.py` blocca l'avvio se
l'URL manca, coincide con `DATABASE_URL` o il nome non finisce in `_test`: i fixture fanno
`create_all`/`drop_all`/TRUNCATE. Schema da `Base.metadata.create_all()` (non dalle migrazioni),
quindi i semi delle migrazioni non ci sono: chi ne ha bisogno li inserisce nel fixture (es.
`payroll_cost_types` + CC `KMDIMARE`/`CLB` in `test_dipendenti.py`). Nessun test usa più
`SessionLocal` (il DB reale). Ricreare il DB se sparisce: `sudo -u postgres createdb -O hotelos_user
hotel_os_test` (`hotelos_user` non ha CREATEDB). Suite completa: 933 test verdi (04/11/2026). I tre
file che prima "fallivano verso revenue-master" (`test_parser_e_bulk`, `test_navigazione_confronto_export`,
`test_upload_endpoint`) erano in realtà 401 da override auth mancante + aspettative superate (riga
TOTALE negli export giornalieri, rifiuto file identici in `parse_coppia`): corretti.

⚠️ **`app/models/__init__.py` importa tutti i moduli modello attivi** (revenue, rooms, corrispettivi,
analisi_ricavi, usali, produzione, shared — non `fiscal.py`, dismesso) per registrare in SQLAlchemy le
`relationship()` che referenziano una classe per stringa (es. `Hotel.rooms` → `"Room"`, definita in
un modulo diverso da dove viene dichiarata la relationship). Senza questo, uno script/test che importa
solo `app.models.revenue` fallisce con `InvalidRequestError: ... failed to locate a name ('Room')` —
bug reale che nascondeva un problema più serio in `test_dipendenti.py` (vedi sotto).

⚠️ **`tests/test_dipendenti.py` usa CF_TEST/ANNO_TEST sintetici, mai i CF/anno reali del PDF di test**:
fino a ottobre 2026 non esisteva un DB di test separato (i test giravano sullo stesso database di
produzione — oggi girano su `hotel_os_test`, vedi sopra, ma la regola resta). Il fixture `_pulisci_db()` cancellava Employee/EmployeeMonthly/PayrollEntry per
codice fiscale SENZA distinguere test da produzione — dato che i CF nel PDF fixture sono di dipendenti
reali (Balducci Annie, Sanchioni Manuel, Palazzi Alice, ecc.), eseguire questi test ha azzerato i loro
dati reali su tutti i mesi (incidente reale, luglio 2026, recuperato nella stessa sessione — mascherato
per mesi dal bug del mapper sopra, che falliva prima di arrivare al cleanup). Fix: `dati_pdf_isolato`
(fixture) sostituisce CF e anno con valori sintetici (`ZZTEST00NA01A000A`, anno 1901) prima di
chiamare `importa_payroll()` — mai passare `dati_pdf` grezzo a `importa_payroll()` in un test.

⚠️ **Se il backend non raggiunge più le stampanti RT** (`import-da-stampante` → "No route to host"
persistente, pur con rete/permessi a posto): il processo uvicorn potrebbe essere acceso da prima che
un permesso macOS (es. Rete locale per l'app da cui è partito il terminale) fosse concesso o cambiato.
`--reload` ricarica solo il codice Python, non riavvia il processo del sistema operativo, quindi non
recepisce cambi di permessi avvenuti dopo l'avvio. Soluzione: killare il processo uvicorn e riavviarlo
da zero (non basta salvare un file per far scattare il reload).
