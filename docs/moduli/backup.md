<!-- Spostato da CLAUDE.md il 07/11/2026, testo invariato: dove si legge "questa sezione" o "in CLAUDE.md" si intende questo file. Le regole generali restano in CLAUDE.md. -->

## Sistema di backup automatico notturno
⚠️ **Dal 23 settembre 2026: il backup gira solo sul server Linux** (`hotelos-backup.timer`/
`.service`, systemd, stessa ora 03:00), non più sul Mac Mini — vedi `docs/MIGRAZIONE_LINUX.md` per
tutti i dettagli della migrazione. Il Mac Mini non esegue più né il backup né l'app stessa (backend/
frontend/backup launchd disattivati e spostati fuori da `~/Library/LaunchAgents/`, non cancellati).
La cronologia sotto (bug, fix, installazione via launchd) resta riferimento storico valido per la
**logica dello script** (`hotelos-backup.sh`, invariata, portata su systemd senza riscriverla — solo
resa portabile path/host/password, vedi doc migrazione), non per dove gira oggi.

**3 copie**: locale (server) → Raspberry Pi (rsync via SSH) → repository GitHub privato `hotelos-backup`.
- Script principale: `scripts/hotelos-backup.sh` (pg_dump formato custom `-F c`, legge `DB_NAME`/`DB_USER`
  da `backend/.env` con lo stesso parsing usato dal router `backup.py` — non duplicare la logica altrove;
  path `pg_dump`/host/password resi portabili Mac↔Linux nella migrazione di settembre 2026).
- **Scheduling: systemd timer** (`deploy/hotelos-backup.timer` + `deploy/hotelos-backup.service`,
  installati in `/etc/systemd/system/`, `WantedBy=timers.target`, esecuzione ogni notte alle 03:00) —
  sostituisce il vecchio launchd di macOS (`scripts/mac-legacy/it.hotelos.backup.plist` + `scripts/mac-legacy/installa-backup.sh`,
  rimasti nel repo come riferimento storico/Mac ma non più il meccanismo attivo dopo la migrazione al
  server Linux di settembre 2026). Verifica: `systemctl status hotelos-backup.timer`.
- Test manuale: `bash scripts/test-backup.sh` (esegue un backup reale con output verbose).
- Stato senza eseguire nulla: `bash scripts/verifica-backup.sh`.
- Log: `~/hotelos-backups/logs/backup_log.jsonl` (una riga JSON per esecuzione: esito
  success/partial/error, dimensione dump, esito Raspberry/GitHub, durata).
- Retention: 7 copie locale, 7 su Raspberry, 3 su GitHub (repository dedicato, push con `--force`
  ogni notte — accettato: il repo esiste solo per questo scopo, force-push sovrascrive la history
  a ogni esecuzione invece di farla crescere indefinitamente con dump binari).
- Repository GitHub: `hotelos-backup` (privato, da creare manualmente — lo script non lo crea).
  Contiene i `.dump` binari committati direttamente + un `README.md` con la data ultimo backup.
- Endpoint (prefix `/admin/backup`, tutti `richiedi_admin`, sola lettura — nessuno tocca il DB):
  `GET status|logs|files`, `POST esegui-ora` (lancia lo script in background via `subprocess.Popen`),
  `POST ripristina/{nome_file}` (restituisce solo i comandi `pg_restore`/`psql`, non esegue nulla).
- Admin: `?s=backup` in `AdminUnificato.jsx` → `frontend/src/pages/admin/AdminBackup.jsx`
  (card stato, tabella log filtrabile, lista dump con istruzioni di ripristino in modale, accordion setup).
- Test: `backend/tests/test_backup.py` — `subprocess` sempre mockato (nessun pg_dump/rsync reale nei
  test), auth verificata via override diretto di `richiedi_admin` (non tramite il bug noto del 401
  su TestClient senza login, citato sopra — evitato qui perché non serve un utente reale in DB).

⚠️ **Backup mai riuscito nemmeno una volta dall'installazione (7 luglio) fino al 14 luglio**: la
regex `DB_USER=$(... | sed 's/.*:\/\/\([^:]*\):.*/\1/')` in `hotelos-backup.sh` assume sempre un
formato `user:password@host` — con `DATABASE_URL` reale senza password (`user@host`, il caso di
questo progetto), `[^:]*` si fermava solo al primo `:` (quello della porta), catturando
`ginoscola@localhost` intero invece di `ginoscola` → `pg_dump: role "ginoscola@localhost" does not
exist` ogni notte, mascherato in log come semplice `"pg_dump fallito"` senza lo stderr. La versione
Python equivalente in `backup.py` (`_leggi_db_config()`) faceva il parsing correttamente (split su
`@` poi su `:`) — le due implementazioni "gemelle" erano divergenti, esattamente il rischio che la
nota sopra ("stesso parsing... non duplicare la logica altrove") avrebbe dovuto prevenire ma non
copriva (bash e Python restano comunque due implementazioni separate per forza, essendo lo script
invocato anche da cron/launchd fuori processo). Fix: regex bash allineata alla stessa logica
(`sed -E 's#.*://([^:@/]+).*#\1#'`, si ferma al primo tra `:`/`@`/`/`). Se in futuro emerge un altro
sintomo simile ("pg_dump fallito" senza altro dettaglio), controllare prima `~/hotelos-backups/logs/
launchd-error.log` (stderr reale del processo cron, non nel `.jsonl`) prima di sospettare rete/permessi.

⚠️ **Copia su Raspberry Pi — due cause indipendenti dal bug sopra**, entrambe risolte il 14 luglio
(prima verifica end-to-end mai fatta finora, quindi mai emerse prima): (1) chiave SSH del Mac non
autorizzata sul Raspberry (`Permission denied (publickey,password)` pur con Raspberry raggiungibile
via ping) — fix manuale, richiede la password del Raspberry: `ssh-copy-id ginoscola@192.168.100.149`
(da eseguire dall'utente, non automatizzabile via chat per non lasciare la password nella cronologia
conversazione). (2) `rsync: mkdir "/home/ginoscola/hotelos-backups/db" failed: No such file or
directory` — lo script assume che `~/hotelos-backups/db` esista già sul Raspberry, non la crea lui
(a differenza di quanto fa in locale con `mkdir -p`): creata una tantum con
`ssh ginoscola@192.168.100.149 "mkdir -p ~/hotelos-backups/db"`. Con entrambe risolte, backup
verificato `success` su tutti e tre i livelli (locale+Raspberry+GitHub).

⚠️ **`GET /admin/backup/status` restava bloccato su "non caricato" anche col timer systemd attivo**
(bug reale, corretto 23/09/2026): `_launchd_attivo()` in `backup.py` chiamava ancora `launchctl list`
(comando macOS, non esiste sul server Linux) — l'eccezione veniva silenziata dal `try/except` e
tornava sempre `False`, indipendentemente dallo stato vero del timer. Il timer era in realtà `active`
fin dall'installazione (verificato `systemctl status hotelos-backup.timer`): il pannello Admin
mostrava un falso allarme, non un problema reale di scheduling. Fix: `_launchd_attivo()` →
`_scheduler_attivo()`, controlla `systemctl is-active hotelos-backup.timer`; campo risposta rinominato
`launchd_attivo` → `scheduler_attivo` (frontend `AdminBackup.jsx` ed entrambi i test aggiornati).

⚠️ **Pannello Backup fermo su "Nessun backup" con i backup regolarmente eseguiti** (bug reale,
28/09/2026, v3.16.1): il backup gira come utente `gino` (`hotelos-backup.service`, `User=gino`) e
scrive in `/home/gino/hotelos-backups`, ma il backend gira come utente `hotelos` e `backup.py` usava
`Path.home()` → `/home/hotelos/hotelos-backups`, vuota. Fix: `BACKUP_BASE` letto da
`HOTELOS_BACKUP_DIR` in `backend/.env` (`/home/gino/hotelos-backups`; fallback `Path.home()`), e
permesso di sola lettura per `hotelos` via ACL (`/home/gino` è 750):
`setfacl -m u:hotelos:x /home/gino` + `setfacl -R -m u:hotelos:rX` e `setfacl -R -d -m u:hotelos:rX`
su `/home/gino/hotelos-backups` (default ACL: vale anche per i dump creati dopo).
**"Esegui adesso"** non lancia più lo script direttamente (girava come `hotelos`, senza chiavi SSH per
Raspberry/GitHub e nella cartella sbagliata) ma `sudo -n /usr/bin/systemctl start --no-block
hotelos-backup.service` — stesso servizio del notturno, quindi utente `gino`. Richiede in
`/etc/sudoers.d/hotelos`: `hotelos ALL=(root) NOPASSWD: /usr/bin/systemctl start --no-block
hotelos-backup.service` (senza, l'endpoint risponde 500 con messaggio esplicito). Corretto anche il ping
al Raspberry: `-W 2` (timeout Linux) al posto di `-t 2` (flag Mac, su Linux è il TTL).
