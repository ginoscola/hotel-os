# HotelOS — Migrazione dal Mac Mini a un box Linux

> **Stato: pianificata per la settimana del 21-27 settembre 2026, ad albergo chiuso** (decisione
> dell'utente il 18 settembre 2026 — non ancora la data esatta, solo la settimana). La macchina
> esiste già e l'accesso remoto è pronto (vedi "Server Ubuntu e accesso remoto" sotto),
> provisionati a settembre 2026 prima ancora di partire con la migrazione vera e propria.
> Questo file è un taccuino di lavoro — aggiungere idee/decisioni qui man mano, anche in forma
> sparsa, prima di partire davvero. Quando si parte, seguire questo file insieme a
> [`GUIDA_DEPLOY.md`](GUIDA_DEPLOY.md) (i passi generici di deploy da zero — qui ci sono solo le
> differenze/aggiunte specifiche della migrazione).

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

**Nuovo requisito emerso (17 settembre 2026)**: quando HotelOS sarà sulla macchina Linux, dovrà
essere raggiungibile dall'esterno non solo dal proprietario ma anche da **persone fidate** a cui
verranno dati accessi (staff/collaboratori) — quindi la Cloudflare Access Application che
proteggerà l'hostname HTTP di HotelOS (quando creata) non potrà usare una policy "solo io" a
singola email come quella SSH attuale, ma una policy con una **lista di email** (o un Access
Group dedicato, più comodo da aggiornare quando cambia lo staff con accesso). Da progettare nel
dettaglio quando si arriva a pubblicare l'hostname HotelOS, non ancora fatto.

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
4. **Pubblicare HotelOS sul tunnel già esistente**: nuovo "Published application route" sullo
   stesso tunnel `server-kmdimare` (non un tunnel nuovo), hostname tipo `hotelos.kmdimare-hub.com`
   → tipo **HTTP** → `localhost:80` (o la porta di nginx) + nuova Cloudflare Access Application
   con policy a **lista di email** (staff fidato — vedi nota sopra, non "solo io"). Nessun DNS da
   toccare al router/registrar per il resto: è la stessa infrastruttura già pronta da oggi.
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

## Idee / note sparse
_(aggiungere qui nel tempo)_
