# HotelOS — Migrazione dal Mac Mini a un box Linux

> **Stato: progetto futuro, non ancora iniziato.** Questo file è un taccuino di lavoro —
> aggiungere idee/decisioni qui man mano, anche in forma sparsa, prima di partire davvero.
> Quando si parte, seguire questo file insieme a [`GUIDA_DEPLOY.md`](GUIDA_DEPLOY.md) (i passi
> generici di deploy da zero — qui ci sono solo le differenze/aggiunte specifiche della migrazione).

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
2. Provisioning Linux (`GUIDA_DEPLOY.md`) + restore da backup (sopra)
3. Verifica dati: confronto conteggio righe tabelle chiave Mac vs Linux
4. Ripuntare DNS/router/bookmark verso la macchina nuova
5. Solo dopo verifica ok, spegnere i servizi sul Mac (non cancellare subito — tenerlo come
   fallback per un periodo)

## Domande aperte (da chiudere prima di partire)
- [ ] Distro Linux esatta (Ubuntu/Debian presunto in `GUIDA_DEPLOY.md` — confermare)
- [ ] Serve un dominio pubblico raggiungibile da internet per certbot, o il box resta su
      LAN/VPN come il Mac Mini oggi (in quel caso niente certbot, solo nginx come reverse proxy
      interno)?
- [ ] Il Mac Mini resta acceso come fallback per un periodo di transizione dopo lo switch, o si
      spegne subito?

## Idee / note sparse
_(aggiungere qui nel tempo)_
