# HotelOS — Migrazione dal Mac Mini a un box Linux

> **Stato: HotelOS gira sul server Linux e funziona, pubblicato e verificato anche da remoto**
> (22 settembre 2026 — vedi "Fasi 1-7", "Backup" e "Fase 8" sotto per tutti i dettagli). L'utente
> ha confermato l'accesso funzionante da telefono fuori dalla LAN (`https://hotelos.kmdimare-hub.com`).
> **Resta solo da decidere quando spegnere il Mac** (vedi "Domande aperte" e l'ultima sezione in
> fondo) — fino ad allora il Mac resta acceso come fallback in sola lettura, l'utente lavora già
> sul server nuovo. Questo file resta un taccuino di lavoro — aggiungere idee/decisioni qui man
> mano. Riferimento generico di deploy: [`GUIDA_DEPLOY.md`](GUIDA_DEPLOY.md).

## Server Ubuntu e accesso remoto (fatto, settembre 2026)
Macchina: Ubuntu 26.04.1 LTS, IP locale `192.168.100.40` (stessa LAN del Raspberry Pi di backup),
utente `gino` (accesso SSH da Mac già a chiave, passwordless; `sudo` richiede invece password).

**Accesso remoto via Cloudflare Tunnel** (non VPN, non port forwarding sul router — nessuna porta
aperta, connessione sempre in uscita dal server verso Cloudflare):
- Account Cloudflare + Zero Trust (piano Free), team `kmdimare`.
- Dominio dedicato **`kmdimare-hub.com`**, registrato direttamente su Cloudflare Registrar (a
  costo, senza markup) — scelto un dominio nuovo invece di kmdimare.com/duparchotel.it perché
  Cloudflare non permette più di aggiungere un sottodominio come zona a sé (funzionalità un tempo
  disponibile, ora bloccata lato UI) e spostare l'intero dominio esistente a Cloudflare avrebbe
  comportato rischi per sito/email già in produzione su Keliweb — un dominio nuovo dedicato solo a
  infrastruttura evita entrambi i problemi, a fronte di ~10€/anno.
- `cloudflared` installato come servizio systemd sul server (repo APT ufficiale Cloudflare),
  tunnel `server-kmdimare`, connesso stabilmente (4 connessioni ridondanti Roma/Milano).
- Primo hostname pubblicato: `ssh.kmdimare-hub.com` → tipo servizio **SSH** → `localhost:22`.
  Protetto da una Cloudflare Access Application ("SSH Server kmdimare") con policy "solo io"
  (Allow su email specifica) e il toggle **"Allow access through browser-based RDP, SSH, or VNC
  sessions"** attivo — permette un terminale SSH renderizzato nel browser (login Cloudflare Access
  con OTP email o account Cloudflare, poi credenziali SSH vere) **senza installare nessuna app**
  sui dispositivi client. Testato funzionante da telefono.
- Hardening locale applicato in parallelo: `ufw` attivo (solo SSH in ingresso dalla LAN, tutto il
  resto negato — irrilevante per l'esposizione esterna dato che il tunnel è sempre outbound, ma
  buona igiene) + `fail2ban` con jail `sshd` attivo.
- **Riusabile per la migrazione**: lo stesso tunnel può pubblicare altri hostname (tipo servizio
  **HTTP**, non SSH) per HotelOS/nginx quando si farà il cutover — risponde alla domanda aperta
  sotto su certbot: con Cloudflare Tunnel **non serve certbot**, il TLS è terminato da Cloudflare
  stessa sull'edge, nginx interno resta in HTTP semplice dietro al tunnel.

**✅ Accesso Claude Code/Mac fuori LAN — fatto, 18 settembre 2026**: l'utente lavorerà anche da
casa in inverno, fuori dalla LAN `192.168.100.x`, dove l'SSH diretto (`ssh gino@192.168.100.40`)
non funziona. Risolto con un **Service Token** Cloudflare Access dedicato (`claude-code-mac`,
Zero Trust → Access controls → Service credentials), autorizzato sulla Access Application SSH
esistente tramite una seconda policy con **Action = "Service Auth"** (non "Allow" — è un tipo di
regola a parte, non tocca la policy "solo io" già esistente per l'accesso umano via browser).
- `cloudflared` installato sul Mac via `brew install cloudflared` (CLI, non un'app grafica).
- ⚠️ **Le credenziali del service token vanno passate come `TUNNEL_SERVICE_TOKEN_ID` /
  `TUNNEL_SERVICE_TOKEN_SECRET`, NON `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET`** (queste
  ultime sono per altri sottocomandi di `cloudflared access`, tipo `login`/`curl` — `access ssh`/
  `access tcp` le ignora silenziosamente e ricade sul login via browser, senza errore esplicito
  che lo segnali). Verificato con `cloudflared access ssh --help`, sezione OPTIONS, che mostra
  esplicitamente il nome della env var accanto a ogni flag.
- Credenziali salvate in `~/.ssh/kmdimare-access-env` sul Mac (chmod 600, fuori dal repo).
- `~/.ssh/config` sul Mac: host alias `kmdimare-remote` → `ProxyCommand bash -c 'source
  ~/.ssh/kmdimare-access-env && exec cloudflared access ssh --hostname %h'`. Uso:
  `ssh kmdimare-remote` (passa sempre dal tunnel, funziona da qualunque rete). L'accesso diretto
  in LAN resta invariato: `ssh gino@192.168.100.40`.
- Il server, raggiunto per la prima volta con l'hostname `ssh.kmdimare-hub.com`/alias
  `kmdimare-remote`, ha richiesto una nuova verifica host-key SSH (mai vista con questo nome,
  pur essendo la stessa macchina già fidata via IP) — registrate le stesse chiavi già presenti
  per `192.168.100.40` anche sotto i nuovi nomi in `~/.ssh/known_hosts`, senza abbassare
  `StrictHostKeyChecking`.
- Testato funzionante end-to-end da LAN (dovrebbe funzionare identico da fuori, dato che passa
  comunque dal tunnel e non dalla rete locale — da riconfermare la prima volta che l'utente lavora
  davvero da casa).
- Se in futuro serve lo stesso accesso da un'altra macchina: creare un **nuovo** service token
  dedicato (non riusare `claude-code-mac`) per poter revocare l'accesso di una macchina senza
  toccare le altre — scelta consigliata, non imposta tecnicamente (le stesse credenziali
  funzionerebbero comunque se copiate).

**⏳ In sospeso (22 settembre 2026): stesso accesso per il Mac di casa dell'utente**, per poter
lavorare con Claude Code/VSCode Remote-SSH anche da lì, non solo da questo Mac. Fatto fin qui:
- Nuovo service token dedicato **`claude-code-mac-casa`** creato (Access controls → **Service
  credentials**, non più "Service Tokens" nella UI attuale — rinominato), Client ID/Secret salvati
  dall'utente in un password manager (mai passati in chat).
- Nuova policy **Service Auth** aggiunta sull'Access Application SSH esistente ("SSH Server
  kmdimare"), Include → Selector **"Service Token"** → Value = `claude-code-mac-casa` — senza
  toccare la policy "solo io" già esistente per l'accesso umano via browser.

**Da fare quando l'utente è fisicamente al Mac di casa** (comandi pronti, solo da eseguire lì —
Client ID/Secret dal password manager al posto dei segnaposto):
```bash
brew install cloudflared

mkdir -p ~/.ssh
cat > ~/.ssh/kmdimare-access-env << 'EOF'
export TUNNEL_SERVICE_TOKEN_ID="INCOLLA_QUI_IL_CLIENT_ID"
export TUNNEL_SERVICE_TOKEN_SECRET="INCOLLA_QUI_IL_CLIENT_SECRET"
EOF
chmod 600 ~/.ssh/kmdimare-access-env

cat >> ~/.ssh/config << 'EOF'

Host kmdimare-remote
    HostName ssh.kmdimare-hub.com
    User gino
    ProxyCommand bash -c 'source ~/.ssh/kmdimare-access-env && exec cloudflared access ssh --hostname %h'
EOF
```
Poi `ssh kmdimare-remote` (accetta la nuova host key la prima volta) — stesso pattern già testato e
funzionante su questo Mac. Una volta dentro: VSCode → Remote-SSH: Connect to Host → `kmdimare-remote`
→ apri `/srv/progetti/hotel-os`.

**Decisione presa (21 settembre 2026): niente Cloudflare Access sull'hostname HTTP di HotelOS.**
Ripensato rispetto alla nota del 17 settembre sotto (lista email/Access Group) — l'utente ha
chiesto qualcosa di più semplice da gestire lui stesso: l'hostname HTTP (es.
`hotelos.kmdimare-hub.com`) sarà pubblicato sul tunnel come route HTTP **senza** una Cloudflare
Access Application davanti, stesso pattern già in uso per `status.kmdimare-hub.com` (pubblico,
TLS terminato da Cloudflare, nessun login Cloudflare). L'accesso è gestito interamente
dall'autenticazione già presente in HotelOS (JWT 8h, ruoli admin/viewer, rate limit 5/15min per IP
sul login — vedi sezione "Autenticazione" in CLAUDE.md): assegnare/revocare un accesso = creare o
disattivare un utente in Admin → Utenti, un solo posto invece di due liste (Cloudflare + HotelOS)
da tenere sincronizzate. Compromesso accettato consapevolmente: la pagina di login e le API sono
raggiungibili da chiunque su internet, protette solo dall'auth applicativa (non da un filtro di
rete prima ancora di arrivare all'app, come invece fa SSH). Se in futuro dovesse servire un filtro
di rete aggiuntivo senza tornare a una lista puntuale, un Access Group ampio (es. intero dominio
email aziendale) resta un'opzione di mezzo, non fatta ora.

~~Nota superata (17 settembre 2026)~~: si era ipotizzata una Cloudflare Access Application con
lista email/Access Group per lo staff, invece della policy "solo io" usata per SSH — sostituita
dalla decisione sopra.

## Dashboard di stato server + avvisi automatici (fatto, 18 settembre 2026)
Non parte della migrazione HotelOS in senso stretto, ma costruita sullo stesso server nel tempo
morto in attesa della finestra di migrazione — documentata qui perché vive sulla stessa macchina.

**Dashboard pubblica** (`https://status.kmdimare-hub.com`, nessun login — scelta esplicita
dell'utente: comodità di apertura rapida da telefono preferita alla protezione, dato che i dati
esposti sono solo metriche di sistema, non credenziali): mostra CPU (uso % + temperatura per
core), RAM, spazio disco, temperatura/salute S.M.A.R.T. del disco, uptime. Auto-refresh ogni 10s.
- Backend: FastAPI + `psutil`, `/opt/hotelos-status/main.py`, gira come utente dedicato non
  privilegiato `statusapp` (systemd service `hotelos-status`, bind `127.0.0.1:8001`).
- Le temperature CPU vengono da `sensors -j` (lm-sensors) — leggibile senza root, chiamato
  direttamente dal processo dell'app. **Le ventole non sono monitorabili**: `sensors-detect` non
  rileva sensori RPM su questa scheda madre, limite hardware non risolvibile via software.
- I dati S.M.A.R.T. del disco (`smartctl`, richiede root) **non** vengono letti dal processo web:
  uno script separato (`collector_smart.sh`) gira come root via systemd timer ogni 5 minuti,
  scrive un JSON in `/var/lib/hotelos-status/smart.json` (permessi 644) che il servizio non
  privilegiato si limita a leggere — nessun privilegio elevato concesso al processo esposto in
  rete, nemmeno indirettamente via sudoers.
- Frontend: pagina singola `/opt/hotelos-status/static/index.html`, dark mode, anelli di
  progresso colorati per soglia (verde/giallo/rosso), palette dalla skill `dataviz` del progetto.
- Pubblicata sullo stesso tunnel Cloudflare del resto (`server-kmdimare`), route HTTP →
  `localhost:8001`, nessuna Access Application collegata (= pubblica, a differenza di SSH).

**Avvisi automatici via email** (risponde a un punto esplicito dell'utente su come tenere sicuro
un server che ospiterà più applicazioni nel tempo — vedi discussione 18 settembre 2026):
- Script separato `/opt/hotelos-status/alert_check.py`, systemd timer `hotelos-status-alert` ogni
  5 minuti (gira come root — serve solo per leggere `/var/run/reboot-required` e il file
  credenziali, non esegue altro con privilegi elevati). Chiama l'API locale della dashboard
  (`http://127.0.0.1:8001/api/status`, DRY — non riaggrega le metriche una seconda volta) e
  valuta soglie critiche: CPU/RAM/disco ≥90%, temperatura disco ≥60°C, S.M.A.R.T. in errore,
  riavvio in sospeso dopo un aggiornamento automatico (vedi sotto).
- **Manda email solo sui cambi di stato** (nuovo problema apparso / problema rientrato), mai una
  mail ripetuta ogni 5 minuti finché un problema resta invariato — stato tracciato in
  `/var/lib/hotelos-status/alert_state.json`.
- Invio via Gmail SMTP (account `ginoscola@gmail.com`, password per le app — **non** la password
  normale dell'account), destinatario `info@kmdimare.com`. Credenziali in
  `/etc/hotelos-status/alert-email.env` (chmod 600, root:root, **fuori dal repo**, mai committare
  questo file né il suo contenuto).
- Verificato con un invio di test reale (18 settembre 2026, arrivato correttamente).

**Aggiornamenti di sicurezza automatici**: verificato che `unattended-upgrades` è già installato e
attivo di default su Ubuntu Cloud (nessuna configurazione aggiuntiva necessaria) — copre i
repository security, gira ogni notte, log in `/var/log/unattended-upgrades/`. Riavvio automatico
**disattivato** di proposito (default Ubuntu): un riavvio a sorpresa su un server di produzione è
peggio di aspettare un riavvio manuale — per questo il flag `reboot_required` è incluso tra le
soglie degli avvisi sopra, così un riavvio in sospeso non passa inosservato a lungo.

## Logical volume dedicata ai file di progetto (fatto, 18 settembre 2026)
Non parte della migrazione HotelOS in senso stretto (come la dashboard di stato sopra), ma creata
sullo stesso server per avere un posto comune dove tenere i file di tutti i progetti (non solo
HotelOS), separato dal filesystem di sistema.

Il disco (238.5G) è già gestito da LVM: `sda3` (235.4G) è l'unico physical volume del volume group
`ubuntu-vg`, ma l'installer Ubuntu aveva allocato alla LV di root solo 100G — quindi c'era già
margine libero nel VG, non serviva ripartizionare il disco fisico.
- Nuova logical volume `lv-progetti`, **60GB**, ext4, montata su `/srv/progetti`, di proprietà
  `gino:gino` (non root, per poterci scrivere senza sudo). Nel VG restano ~75GB liberi per espandere
  questa o altre LV in futuro.
- Mount persistente via UUID in `/etc/fstab` (non via nome device, più robusto ai riordini) —
  verificato che sopravvive a un riavvio reale (non solo `mount -a`).
- **Perché una LV a sé e non solo una cartella sulla LV di root**: isolamento — se un progetto
  riempie il disco per errore (log, cache di build, upload di un cliente), riempie solo
  `/srv/progetti`, non root, quindi non rischia di bloccare anche HotelOS/il sistema stesso.
- **Espandibile in futuro senza perdita dati e senza downtime**: `lvextend -L +XXG
  /dev/ubuntu-vg/lv-progetti` poi `resize2fs /dev/ubuntu-vg/lv-progetti` (a caldo, disco montato,
  nessun riavvio) — finché il VG ha margine libero. Ridurla sarebbe più delicato (richiede
  smontare), per questo la dimensione iniziale (60GB) è stata scelta con margine piuttosto che
  risicata.

## Miniprogetti spostati su /srv/progetti (fatto, 18 settembre 2026)
I due miniprogetti già in produzione sul server (pagina di benvenuto, dashboard di stato) vivevano
fuori da `/srv/progetti` (rispettivamente `/var/www/html` e `/opt/hotelos-status`) — spostati per
coerenza col resto, appena creata la LV dedicata.
- **Pagina di benvenuto**: `/var/www/html/index.html` → `/srv/progetti/pagina-benvenuto/index.html`,
  `root` di nginx (`/etc/nginx/sites-available/default`) aggiornato di conseguenza. `/var/www/html`
  svuotata (non cancellata, resta la cartella vuota del pacchetto Debian).
- **hotelos-status**: intera cartella `/opt/hotelos-status` (incluso `venv`) → `/srv/progetti/hotelos-status`
  via `rsync -a` (preserva owner `statusapp:statusapp`/`root`), poi aggiornati `WorkingDirectory`/
  `ExecStart` nelle 3 unit systemd (`hotelos-status.service`, `hotelos-status-alert.service`,
  `hotelos-status-smart.service`). `/var/lib/hotelos-status` (stato: smart.json, alert_state.json) e
  `/etc/hotelos-status/alert-email.env` (credenziali) **non spostati**: sono runtime/segreti, non
  file di progetto.
  ⚠️ **Spostare una venv rompe gli script con shebang assoluto**: `venv/bin/uvicorn` ha
  `#!/opt/hotelos-status/venv/bin/python3` in testa — spostando la cartella quel path non esiste
  più. Fix: `ExecStart` non invoca più `venv/bin/uvicorn` direttamente ma
  `venv/bin/python3 -m uvicorn main:app ...` — `venv/bin/python3` è un semplice symlink a
  `/usr/bin/python3` (indipendente dal percorso), quindi funziona da qualunque posizione si sposti
  la venv in futuro. Nessun problema analogo per `alert_check.py` (gira su `/usr/bin/python3`
  diretto, solo stdlib, mai dipeso dalla venv) né per `main.py` (usa `Path(__file__).parent` per
  trovare `static/index.html`, si adatta da solo alla nuova posizione).
- **Apache**: non era in uso (`apache2.service` risultava `failed` — conflitto di porta 80 con
  nginx, `Address already in use`, non collegato allo spostamento) ma installato per un possibile
  uso futuro (PHP/MySQL). `DocumentRoot` aggiornato comunque, in una cartella **separata** da quella
  di nginx (`/srv/progetti/apache-www`, non condivisa con `pagina-benvenuto`): se in futuro Apache
  ospiterà un progetto reale, resta isolato dalla pagina di benvenuto invece di dipenderne. Aggiunto
  anche il blocco `<Directory /srv/progetti/apache-www/>` in `apache2.conf` (l'unico già presente
  concedeva accesso solo su `/var/www/`, non su `/srv/`) — verificato solo con `apache2ctl
  configtest` (sintassi), il servizio resta `failed` finché non si risolve il conflitto di porta con
  nginx, fuori dallo scope di questo spostamento.

## Obiettivo
Sostituire il Mac Mini attuale con una macchina Linux come **unica** macchina dev+produzione
(non una macchina aggiuntiva in parallelo). Stack completo: nginx + systemd + certbot (non solo
ambiente di sviluppo).

## Differenze rispetto a un deploy da zero (`GUIDA_DEPLOY.md`)
`GUIDA_DEPLOY.md` assume un database vuoto (`alembic upgrade head`). Qui invece si parte da un
database **esistente**, da ripristinare da uno dei 3 backup già in produzione (vedi sezione
"Sistema di backup automatico notturno" in `CLAUDE.md`):
- Sorgente restore più comoda: repo GitHub privato `hotelos-backup` (ha già l'ultimo `.dump`,
  raggiungibile da una macchina nuova con solo una chiave/deploy key, senza dover prima
  configurare SSH verso il Raspberry Pi).
- Restore: `pg_restore -F c` nel DB vuoto creato al Passo 2 di `GUIDA_DEPLOY.md`, **al posto di**
  `alembic upgrade head` (il dump include già `alembic_version`, niente migrazioni da rieseguire).
- Verificare il restore (conteggio righe tabelle chiave) prima di considerarlo riuscito — non
  fidarsi solo dell'assenza di errori.

## Cose fuori dal backup a 3 copie (da decidere)
- `uploads/` (CSV/PDF import caricati) — mai stato nel sistema di backup, solo il DB. Se serve
  tenerlo, va trasferito a parte (rsync manuale dal Mac) o si accetta di perderlo (i dati
  derivati sono comunque già nel DB).

## Dipendenze di rete/hardware da riportare sulla macchina nuova
- Stampanti RT (`192.168.100.x`) — raggiungibili solo dalla LAN del Mac Mini oggi.
- Raspberry Pi di backup — stessa LAN; nuova chiave SSH da autorizzare (`ssh-copy-id`, richiede
  password, passo manuale non automatizzabile).
- Se il box Linux non è fisicamente sulla stessa rete → serve VPN, altrimenti "Stampante RT" e
  il backup verso il Raspberry smettono di funzionare.

## Sistema di backup — porting da launchd a systemd
Lo script `scripts/hotelos-backup.sh` è bash, già portabile. Da rifare solo l'orchestrazione
attorno: `it.hotelos.backup` (launchd plist) → `hotelos-backup.service` + `.timer` (systemd),
stessa ora (03:00).

## Cutover (switch vero e proprio) — bozza sequenza
1. Ultimo backup manuale sul Mac subito prima dello switch
2. Provisioning Linux (`GUIDA_DEPLOY.md`) + restore da backup (sopra) — la macchina Ubuntu esiste
   già (vedi "Server Ubuntu e accesso remoto" sopra), da qui in poi si parla di installarci sopra
   HotelOS stesso (repo, venv, dipendenze, nginx davanti a uvicorn)
3. Verifica dati: confronto conteggio righe tabelle chiave Mac vs Linux
4. **Pubblicare HotelOS sul tunnel già esistente**: **due** "Published application route" sullo
   stesso tunnel `server-kmdimare` (non un tunnel nuovo) — architettura rivista il 22 settembre
   (vedi sezione "Fasi 1-7 completate" sotto: frontend e backend su porte separate, non un'unica
   origine con proxy per prefissi):
   - `hotelos.kmdimare-hub.com` → tipo **HTTP** → `localhost:8080` (frontend)
   - `hotelos-api.kmdimare-hub.com` → tipo **HTTP** → `localhost:8081` (backend)
   **Senza** Cloudflare Access davanti a nessuno dei due (vedi decisione 21 settembre sopra —
   accesso gestito dal login HotelOS, non da Cloudflare). Nessun DNS da toccare al router/registrar
   per il resto: è la stessa infrastruttura già pronta da oggi. Prima di pubblicare: rebuild
   frontend con `VITE_API_URL=https://hotelos-api.kmdimare-hub.com` e aggiornare `cors_origins`
   nel DB allo stesso hostname.
   Da quel momento anche l'accesso sviluppo (VSCode Remote-SSH, Claude Code) punta al server Linux
   invece che al Mac Mini, riusando lo stesso alias `kmdimare-remote` già configurato e testato —
   nessuna nuova configurazione SSH necessaria, cambia solo cosa c'è nella cartella del progetto.
5. Solo dopo verifica ok, spegnere i servizi sul Mac (non cancellare subito — tenerlo come
   fallback per un periodo)

## Domande aperte (da chiudere prima di partire)
- [x] Distro Linux esatta → **Ubuntu 26.04.1 LTS**, macchina già provisionata (vedi sopra).
- [x] Dominio pubblico / certbot → **risolto**: Cloudflare Tunnel su `kmdimare-hub.com` (vedi
      sopra), nessun certbot necessario, TLS terminato da Cloudflare.
- [ ] Il Mac Mini resta acceso come fallback per un periodo di transizione dopo lo switch, o si
      spegne subito?

## Ricognizione fatta il 21 settembre 2026 (inizio lavoro vero, rimandato a domani per budget)
Sessione Claude Code avviata per iniziare davvero il trasferimento. Fatta solo ricognizione
(nessuna modifica al server né al Mac), rimandata l'esecuzione a domani per poco budget
settimanale residuo — il Mac Mini nel frattempo continua a funzionare invariato.

**Stato server rilevato** (`ssh gino@192.168.100.40`, raggiungibile anche in LAN oltre che via
tunnel):
- Ubuntu 26.04.1 LTS ("resolute")
- Python di sistema: **3.14.4** — `python3.11` (quello usato oggi dal venv sul Mac) **non è più
  nei repo apt** di questa release. Deciso di usare **Python 3.14 di sistema** invece di
  aggiungere il PPA deadsnakes (rischio: potrebbe non supportare ancora una distro così recente).
  Da verificare al momento del setup backend che tutte le dipendenze di `requirements.txt`
  (in particolare `bcrypt==4.0.1` pinned, `psycopg2-binary`, `pdfplumber`) abbiano wheel
  compatibili con 3.14 — se qualcuna non va, alzare la versione minima necessaria nel file.
- Node: v22.22.1 (ok, requirement è ≥18)
- PostgreSQL: 18.6, cluster `main` già attivo su porta 5432 — **più recente della 16.13 in uso sul
  Mac** (Homebrew): `pg_restore -F c` supporta il restore di un dump da una versione precedente in
  un cluster più recente, nessun problema atteso.
- nginx 1.28.3 già attivo (per la pagina di benvenuto e hotelos-status esistenti)
- `/srv/progetti` (LV dedicata) ha 56GB liberi — HotelOS andrà in `/srv/progetti/hotel-os`, non
  `/opt` come nella guida generica, per coerenza con gli altri progetti già lì
- Nessuna chiave SSH verso GitHub configurata sul server: servirà una **deploy key** (sola
  lettura) sul repo `hotel-os` — da generare sul server e far aggiungere all'utente su GitHub
  (Settings → Deploy keys), non automatizzabile senza il suo intervento

**Backup locale verificato aggiornato**: ultimo dump `hotelos_20260921_030003.dump` (03:00 di
oggi), tutte e 3 le copie (locale/Raspberry/GitHub) `success`. Per il restore di test sul server
si userà uno `scp` diretto Mac→server dell'ultimo dump (stessa LAN, più semplice che dare accesso
al repo privato `hotelos-backup` a una seconda macchina).

**Decisione accesso esterno**: vedi sezione sopra ("Decisione presa 21 settembre 2026") — niente
Cloudflare Access sull'hostname HTTP, login gestito da HotelOS stesso.

**Piano concordato per la ripresa (fasi 1-7, nessun impatto sul Mac, nessuna esposizione
pubblica)**:
1. Pacchetti server (`python3-venv`, ecc.) + DB `hotel_os` con utente dedicato
2. Deploy key GitHub + clone in `/srv/progetti/hotel-os`
3. venv Python 3.14 + `pip install -r requirements.txt` (verificare compatibilità) + `.env` nuovo
   (nuova `SECRET_KEY` → tutti gli utenti dovranno rifare login dopo il cutover, atteso)
4. Restore dati: `scp` ultimo dump dal Mac + `pg_restore -F c` + verifica conteggio righe tabelle
   chiave Mac vs server (non fidarsi della sola assenza di errori)
5. Frontend: `npm install && npm run build`
6. systemd `hotelos-backend.service` (utente dedicato non-root) + nginx site (non esposto
   pubblicamente in questa fase)
7. `uploads/` via `rsync` dal Mac (mai stato nel backup automatico) + verifica raggiungibilità
   stampanti RT e Raspberry Pi di backup dal server (stessa LAN, atteso ok)

Poi (fase 8 in poi, solo dopo verifica interna): pubblicazione hostname sul tunnel Cloudflare,
test end-to-end, e solo con ok esplicito dell'utente il cutover reale — **prima del cutover vero
serve un restore fresco finale** (quello di test sarà ormai vecchio di giorni, il Mac continua ad
accumulare dati nel frattempo).

## Fasi 1-7 completate e verificate (22 settembre 2026)
Eseguite in una sessione Claude Code, testate end-to-end. Nessun impatto sul Mac (resta invariato,
continua a girare), nessuna esposizione pubblica (tutto raggiungibile solo dalla LAN per ora).
Accesso app di test: **`http://192.168.100.40:8080`** (vedi architettura nginx sotto).

**`sudo` non automatizzabile da Claude Code** (richiede password interattiva, confermato):
tutti i passi che lo richiedono sono stati preparati come blocchi di comandi pronti da incollare,
eseguiti manualmente dall'utente sul server. Tutto il resto (git, venv, pip, npm, psql come utente
applicativo, rsync, ssh-keygen) eseguito direttamente da Claude Code via SSH.

**Pacchetti già tutti presenti** (fase 1): nessun `apt install` servito — Python 3.14 di sistema ha
già il modulo `venv`, pip, git, node/npm, client psql e nginx erano già installati dalla
provisione iniziale del server. L'unico passo sudo della fase 1 è stata la creazione di DB/utente:
- Database **`hotel_os`** (rinominato rispetto a `revenue_master` usato sul Mac — solo il nome
  cambia, il contenuto del dump è identico e il restore non dipende dal nome del DB sorgente)
- Utente **`hotelos_user`** con password dedicata (generata, salvata solo in `backend/.env` sul
  server, permessi 640)

**Deploy key GitHub** (fase 2): chiave ed25519 dedicata sola-lettura (`~/.ssh/hotelos_deploy_key`
sul server), alias SSH `github-hotelos` in `~/.ssh/config` del server. Clone in
`/srv/progetti/hotel-os` riuscito.

**venv Python 3.14** (fase 3): `pip install -r requirements.txt` completato **senza nessun problema
di compatibilità** — inclusi i pacchetti a rischio identificati nella ricognizione (`bcrypt==4.0.1`
pinned, ha wheel `cp36-abi3` quindi universale; `psycopg2-binary` e `pdfplumber` hanno entrambi
wheel precompilate per `cp314`). Nessun bisogno del PPA deadsnakes, la scelta di Python 3.14 di
sistema si è rivelata corretta.

**Restore dati** (fase 4): dump del 22 settembre (03:00, lo stesso giorno) trasferito via `scp`
diretto Mac→server (stessa LAN). `pg_restore -F c --no-owner --role=hotelos_user`. **Verificato
riga per riga**, non solo assenza di errori: conteggio di 9 tabelle chiave (daily_revenue,
corrispettivi_documenti, prod_righe, employees, employee_monthly, users, hotels, rt_chiusure,
prenotazioni_cancellate) identico Mac vs server, e `alembic_version` (`prod006_2026`) coincide
anche con l'head del repo — nessun drift.

**Frontend** (fase 5): `npm install && npm run build` senza problemi.

**systemd + nginx** (fase 6) — **⚠️ architettura rivista rispetto al piano originale**: il piano
iniziale prevedeva un solo hostname/porta con nginx che facesse da proxy verso il backend per una
lista di prefissi (`/auth`, `/dashboard`, `/corrispettivi`, ecc.), lasciando tutto il resto alla
SPA. **Scoperto un bug reale testando**: pagine del frontend come `/dashboard/gruppo` condividono
**esattamente lo stesso path** del relativo endpoint API (`GET /dashboard/gruppo`, chiamato via
AJAX dalla pagina stessa una volta caricata) — stesso problema per `/admin`, `/budget`,
`/corrispettivi`, `/dipendenti`, `/forecast`, `/home`, `/usali` (tutti prefissi router backend che
coincidono con una route React Router). Su un'unica origine non c'è modo di distinguere "il
browser vuole la pagina HTML" da "il JS della pagina vuole i dati JSON" sullo stesso URL — la
richiesta bare `/dashboard/gruppo` finiva sempre proxata al backend, che risponde 404 JSON invece
di servire `index.html`. **Fix**: frontend e backend su **porte separate**, non un'unica origine
con proxy per prefissi:
- `hotelos.nginx.conf` → porta **8080**, serve solo `frontend/dist` con `try_files ... /index.html`
  (SPA fallback puro, nessun proxy)
- `hotelos-api.nginx.conf` → porta **8081**, proxy puro verso `127.0.0.1:8000` (backend), nessuna
  logica di path
- `VITE_API_URL=http://192.168.100.40:8081` nella build frontend; `cors_origins` in DB aggiornato a
  `http://192.168.100.40:8080` (ora necessario: origini diverse, prima con tutto sulla stessa
  origine il CORS non serviva) — verificato con una richiesta cross-origin reale (header
  `Origin: http://192.168.100.40:8080`), risposta include `access-control-allow-origin` corretto.
  Nessuna lista di prefissi da mantenere sincronizzata con `main.py` in futuro (il rischio esatto
  che la nota "instabile" di `GUIDA_DEPLOY.md` sui prefissi aveva già previsto).
- **Impatto sulla fase 8 (pubblicazione)**: serviranno **due hostname sul tunnel Cloudflare**, non
  uno solo — es. `hotelos.kmdimare-hub.com` → `localhost:8080` (frontend) e
  `hotelos-api.kmdimare-hub.com` → `localhost:8081` (backend), con build frontend finale
  `VITE_API_URL=https://hotelos-api.kmdimare-hub.com` e `cors_origins` aggiornato di conseguenza.
  Stesso pattern "sottodominio dedicato" già indicato come alternativa in `GUIDA_DEPLOY.md`, solo
  risolto via porta invece che sottodominio in questa fase di test LAN.
- Backend gira come utente di servizio dedicato **`hotelos`** (system user, no login shell, membro
  del gruppo `gino` per leggere codice/`.env` senza allargare permessi oltre il necessario) —
  stesso principio già applicato a `statusapp` per hotelos-status. Unit systemd:
  `ExecStart=.../venv/bin/python3 -m uvicorn ...` (non `venv/bin/uvicorn` diretto), stessa
  precauzione già documentata per hotelos-status sullo shebang assoluto — qui non stiamo spostando
  la venv, ma il pattern è comunque più portabile e costa zero.
- nginx: **non toccata** la configurazione esistente (`default`, porta 80, pagina di benvenuto) —
  HotelOS vive su porte proprie, stesso principio già in uso per hotelos-status (porta 8001,
  raggiunta dal tunnel direttamente, non tramite nginx come gateway condiviso).
- File di config generati in `/srv/progetti/hotel-os/deploy/` (nel repo del server, non
  committati — `hotelos-backend.service`, `hotelos.nginx.conf`, `hotelos-api.nginx.conf`) prima di
  copiarli nei percorsi di sistema con sudo: permette di prepararli/rivederli senza sudo e ridurre
  i blocchi di comandi da far incollare all'utente a uno per volta.

**`uploads/`** (fase 7): 18 file, 26MB, trasferiti via `rsync` dal Mac, verificato stesso conteggio.

**Raggiungibilità di rete** (fase 7): confermata per tutti e tre — RT1 (Du Parc/Club Hotel,
`192.168.100.134`), RT2 (International, **`192.168.10.110`** — nota: subnet diversa `192.168.10.x`,
non `192.168.100.x` come il resto, raggiungibile comunque via routing) e Raspberry Pi di backup
(`192.168.100.149`). Nuova chiave SSH dedicata generata sul server e autorizzata sul Raspberry
(`ssh-copy-id`, password inserita manualmente dall'utente) — verificato login passwordless e
lettura della cartella backup.

**⚠️ `ufw` bloccava le porte 8080/8081**: la policy di default nega tutto il traffico in ingresso
tranne SSH (`sudo ufw status numbered` mostrava solo le regole OpenSSH) — sintomo: pagina che non
si apre e **nessun errore visibile** nel browser (pacchetti droppati in silenzio, non un rifiuto
attivo, quindi niente "connessione rifiutata"; solo un timeout silenzioso se si aspetta abbastanza).
Fix: `sudo ufw allow from 192.168.100.0/24 to any port 8080 proto tcp` (e stessa cosa per 8081) —
aperto solo alla LAN, non "Anywhere" come SSH, coerente con la fase di solo test interno. Da
ricordare per la Fase 8: quando si pubblicano gli hostname sul tunnel, il traffico da Cloudflare
arriva comunque da localhost (il tunnel è un processo sulla stessa macchina), quindi queste regole
LAN non serviranno per l'accesso pubblico via tunnel, ma vanno mantenute (o allargate) se si vuole
comunque continuare a testare/accedere anche dalla LAN diretta in parallelo.

**✅ Verificato dall'utente (22 settembre 2026)**: login funzionante da browser reale su
`http://192.168.100.40:8080`, dati reali visibili. Fasi 1-7 considerate concluse.

## Backup — porting da launchd a systemd (fatto, 22 settembre 2026)
Eseguito subito dopo la verifica delle fasi 1-7, stessa sessione. Script `hotelos-backup.sh`
invariato nella logica, reso portabile in due punti scoperti solo provandolo davvero sul server
(entrambi committati, valgono anche per il Mac, nessuna regressione — testato di nuovo lì dopo la
modifica):
- **`pg_dump` non più a path assoluto Homebrew** (`/opt/homebrew/bin/pg_dump`, esisteva solo su
  macOS): cercato con `command -v`, fallback su path noti Mac/Linux. Su Linux è semplicemente
  `/usr/bin/pg_dump`.
- **Host e password letti da `DATABASE_URL`**, non solo `DB_NAME`/`DB_USER` come prima: sul Mac
  l'auth locale non richiede password (`ginoscola@localhost`, peer/trust), ma il server usa un
  utente DB con password (`hotelos_user`) — senza questo `pg_dump` avrebbe fallito ogni notte,
  stesso tipo di bug silenzioso già capitato in passato con la regex `DB_USER` (vedi nota storica
  sopra). `DB_HOST`/`DB_PASSWORD` vuoti sul Mac restano innocui (nessun comportamento diverso).

**Identità git mai configurata sull'utente `gino` del server** (`git commit` nel repo di backup
falliva con "Please tell me who you are"): `git config --global user.name/user.email` impostati
una tantum, stessi valori del Mac.

**Seconda deploy key GitHub, stavolta in scrittura**: `~/.ssh/hotelos_backup_deploy_key` sul
server, deploy key su `hotelos-backup` con "Allow write access" (a differenza della chiave
`hotel-os` sola-lettura). Per non dover riscrivere l'URL del repo nello script (`git@github.com:
ginoscola/hotelos-backup.git`, letterale, uguale su Mac e server), l'alias in `~/.ssh/config` del
server è sul vero hostname (`Host github.com` → questa chiave) invece che su un alias custom come
per `hotel-os` (`Host github-hotelos` → chiave sola-lettura, riferita esplicitamente nell'URL di
clone) — i due `Host` non confliggono, uno è literal match su `github.com`, l'altro su un nome
inventato.

**Unit systemd**: `hotelos-backup.service` (`Type=oneshot`, `User=gino` — non l'utente di servizio
`hotelos` del backend, serve l'identità con le chiavi SSH verso Raspberry/GitHub e l'ambiente HOME
corretto) + `hotelos-backup.timer` (`OnCalendar=*-*-* 03:00:00`, stessa ora del Mac,
`Persistent=true` — a differenza di launchd, systemd non recupera automaticamente un run perso se
il server era spento, va dichiarato esplicitamente). Log su file dedicati
(`~/hotelos-backups/logs/backup-{stdout,stderr}.log`, non più `launchd.log`/`launchd-error.log`) +
lo stesso `backup_log.jsonl` strutturato di sempre, invariato.

**Verificato end-to-end due volte**: prima lanciando lo script a mano via SSH, poi con
`sudo systemctl start hotelos-backup.service` (ambiente systemd reale, più minimale di una shell
SSH interattiva — verifica non ridondante, un `PATH`/`HOME` diverso avrebbe potuto rompere
qualcosa che a mano funzionava). Entrambe le volte: dump locale OK, copia su Raspberry Pi OK, push
GitHub OK, riga `"esito":"success"` in `backup_log.jsonl`. Timer attivo e schedulato (confermato
con `systemctl list-timers`).
⚠️ **Doppio backup in parallelo durante la transizione**: finché il Mac resta acceso, entrambe le
macchine faranno un backup alle 03:00 — innocuo (il Raspberry accumula dump da entrambe le fonti,
la retention tiene comunque solo gli ultimi 7; il push GitHub è `--force` quindi l'ultimo dei due
che gira "vince", nessun dato perso perché il Raspberry ha comunque entrambe le copie). Da non
preoccuparsene fino alla decisione finale su quando spegnere il Mac (vedi "Domande aperte").

## Fase 8 — pubblicazione sul tunnel (fatto, 22 settembre 2026, stesso pomeriggio)
Verificato dall'utente che i dati erano invariati rispetto al restore di stamattina (nessun lavoro
nel frattempo sul Mac) prima di procedere — **testata anche `import-da-stampante` per davvero**
(non solo ping) su RT1 e RT2 con `on_conflict=salta` su una data già presente in DB (nessuna
scrittura, solo lettura): entrambe le stampanti raggiunte e parsate correttamente dal server nuovo,
valori (incluso un legittimo 0,00€ su RT2) coincidenti esattamente con quanto già salvato. Deciso
che l'utente può già usare il server nuovo per il lavoro quotidiano **in LAN**, trattando il Mac
come solo fallback in lettura da questo momento (nessun lavoro in parallelo sui due, per non far
divergere i database).

**Route sul tunnel create dall'utente via dashboard Cloudflare Zero Trust** (Networks → Tunnels →
`server-kmdimare` → Public Hostname — stesso posto/procedura già usata per `ssh`/`status`, gestione
del tunnel "remotely-managed" via token, nessun `config.yml` locale sul server: **le route non sono
automatizzabili da Claude Code**, richiedono la dashboard):
- `hotelos.kmdimare-hub.com` → HTTP → `localhost:8080` (frontend)
- `hotelos-api.kmdimare-hub.com` → HTTP → `localhost:8081` (backend)
- Nessuna Cloudflare Access Application su nessuna delle due (deciso il 21 settembre, vedi sopra).

⚠️ **Rebuild frontend fatto due volte, la prima annullata subito**: la prima build con
`VITE_API_URL=https://hotelos-api.kmdimare-hub.com` è stata fatta PRIMA che l'utente creasse
davvero le route sul tunnel — avrebbe rotto l'accesso LAN che l'utente poteva star usando in quel
momento (il frontend richiama sempre l'origine API scelta in build, non quella da cui è stato
caricato). Ripristinata subito la build puntata alla LAN (`http://192.168.100.40:8081`), rifatta
quella pubblica solo dopo aver verificato che entrambe le route rispondevano per davvero
(`curl`, non solo "salvato nella dashboard"). Da ricordare per un domani: **non rifare mai la build
di produzione finché la route Cloudflare non è confermata raggiungibile**, l'ordine conta.

⚠️ **DNS della seconda route non propagato subito sul resolver locale del Mac** (`curl: Could not
resolve host`) pur essendo già visibile interrogando direttamente `1.1.1.1` (resolver Cloudflare) —
verificato con `dig @1.1.1.1`, poi confermato il funzionamento reale con `curl --resolve` (forza
l'IP, bypassa la cache DNS locale) prima di aspettare la propagazione naturale. Non un problema
della route in sé, solo un ritardo di cache DNS locale — si è risolto da solo in pochi minuti.

**`cors_origins` impostato su entrambe le origini** (non solo quella pubblica):
`https://hotelos.kmdimare-hub.com,http://192.168.100.40:8080` — l'utente continua a poter accedere
anche dalla LAN diretta, non solo da fuori, senza errori CORS. Verificato con richieste reali
(header `Origin` impostato a mano) per entrambe le origini, risposta `access-control-allow-origin`
corretta su entrambe.
⚠️ **`cors_origins` letto dal backend solo all'avvio** (`main.py`, nota già nota — vedi sezione
Configurazione app in CLAUDE.md), non a ogni richiesta: dopo l'`UPDATE` su `app_config` è servito
`sudo systemctl restart hotelos-backend` (altro comando sudo, altro giro di copia-incolla
dell'utente) prima che il nuovo CORS avesse effetto — altrimenti la modifica risulta "fatta" nel DB
ma silenziosamente senza effetto finché non si riavvia.

**Verificato end-to-end** (login reale via `curl`, non solo `HTTP 200` sulla home): funziona sia
`https://hotelos.kmdimare-hub.com` (pubblico) sia `http://192.168.100.40:8080` (LAN diretta),
stesso backend, stesso database.

**✅ Confermato dall'utente (22 settembre 2026, stesso pomeriggio) da telefono, fuori LAN**:
`https://hotelos.kmdimare-hub.com` funzionante da un vero browser mobile su rete diversa da quella
dell'hotel — non solo `curl` dal Mac. Fase 8 considerata conclusa a tutti gli effetti.

## Non ancora fatto, da chiudere prima del cutover vero (spegnimento Mac)
- Restore fresco finale (i dati di oggi sono comunque aggiornati ad oggi — rifarlo solo se passano
  altri giorni prima dello spegnimento vero e proprio del Mac)
- Decidere quando spegnere il Mac (vedi "Domande aperte" in cima al file, ancora aperta)

## Idee / note sparse
_(aggiungere qui nel tempo)_
