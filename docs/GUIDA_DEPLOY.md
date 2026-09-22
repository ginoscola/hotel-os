# HotelOS — Guida al Deploy

Questa guida copre il deploy su un server Linux headless (Ubuntu/Debian).
Per lo sviluppo locale su macOS seguire solo i Passi 1–3.

---

## Stack in produzione

```
Browser → nginx (porta 443/80) → uvicorn (porta 8000, solo localhost)
                              → frontend/dist/ (file statici)
```

---

## Passo 1 — Prerequisiti

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3-pip \
                   nodejs npm git nginx postgresql certbot python3-certbot-nginx

# Verificare versioni
python3 --version    # deve essere 3.11+
node --version       # deve essere 18+
psql --version
```

Se `python3.11` non è più nei repo apt (release Ubuntu recenti, es. 26.04: verificato settembre
2026) usare il Python di sistema disponibile invece di aggiungere il PPA deadsnakes — tutte le
dipendenze di `requirements.txt` (incluso `bcrypt==4.0.1` pinned) hanno installato senza problemi
su Python 3.14 nella migrazione di settembre 2026, wheel precompilate comprese.

---

## Passo 2 — Database PostgreSQL

```bash
# Creare il database
sudo -u postgres createdb hotel_os

# (Produzione) Creare utente dedicato con password
sudo -u postgres psql -c "CREATE USER revenue_user WITH PASSWORD 'SCEGLI_UNA_PASSWORD';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE hotel_os TO revenue_user;"
```

---

## Passo 3 — Backend

```bash
# Clonare il repository
git clone <url-repository> /opt/hotel-os
cd /opt/hotel-os

# Creare e attivare virtualenv
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Configurare le variabili d'ambiente
cp ../docs/.env.example .env
nano .env   # compilare DATABASE_URL, SECRET_KEY, DEBUG=false
```

### Generare SECRET_KEY sicura

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
# Copiare l'output nel campo SECRET_KEY del file .env
```

### Applicare le migrazioni

```bash
source venv/bin/activate
alembic upgrade head
```

### Aggiornare la configurazione nel database

```bash
# Sostituire con il dominio o IP reale del server
psql $DATABASE_URL -c "UPDATE app_config SET value='https://tuodominio.it' WHERE key='cors_origins';"
```

---

## Passo 4 — Frontend

```bash
cd /opt/hotel-os/frontend

# Impostare l'URL del backend
echo "VITE_API_URL=https://tuodominio.it" > .env.production

# Installare e compilare
npm install
npm run build
# Genera la cartella dist/ con i file statici
```

---

## Passo 5 — Systemd (backend come servizio)

Template pronto in [`deploy/hotelos-backend.service`](../deploy/hotelos-backend.service) — copiarlo
e adattare `WorkingDirectory`/`ExecStart`/`EnvironmentFile` al percorso reale usato.

```bash
sudo cp deploy/hotelos-backend.service /etc/systemd/system/hotelos-backend.service
sudo systemctl daemon-reload
sudo systemctl enable hotelos-backend
sudo systemctl start hotelos-backend
sudo systemctl status hotelos-backend   # deve mostrare "active (running)"
```

Note sul template (verificate in produzione, migrazione settembre 2026 — vedi
`docs/MIGRAZIONE_LINUX.md`):
- `User=hotelos` (utente di servizio dedicato non-root, `useradd --system --no-create-home --shell
  /usr/sbin/nologin hotelos`), non `www-data` — più facile da tracciare/isolare su un server con
  più applicazioni. Se il codice è di proprietà di un altro utente (es. quello con cui si fa
  `git pull`), aggiungere l'utente di servizio al suo gruppo (`usermod -aG <utente> hotelos`)
  invece di allargare i permessi del codice a `other` — e ricordarsi che `EnvironmentFile` (il
  `.env`, spesso `chmod 600`) va reso leggibile dal gruppo (`chmod 640`) o il servizio non parte.
- `ExecStart` usa `venv/bin/python3 -m uvicorn ...`, non `venv/bin/uvicorn` diretto: quest'ultimo
  ha lo shebang assoluto della venv scritto in testa, che si rompe se la cartella viene mai
  spostata — `python3 -m uvicorn` è portabile, costa zero scriverlo così da subito.

---

## Passo 6 — Nginx

⚠️ **Non usare un unico hostname/porta con un proxy nginx per prefissi** (`location /auth/`,
`location /dashboard/`, ecc.) **se il frontend chiama gli endpoint senza prefisso `/api/`** (il
caso di questa app — vedi `frontend/src/api/client.js`, `baseURL` diretto senza prefisso): **bug
reale, scoperto testando la migrazione di settembre 2026** — pagine React come `/dashboard/gruppo`
condividono esattamente lo stesso path del relativo endpoint (`GET /dashboard/gruppo`, chiamato via
AJAX dalla pagina stessa), quindi un proxy per prefissi non può distinguere "il browser vuole la
pagina HTML" da "il JS vuole i dati JSON" sulla stessa origine — la richiesta finisce sempre
proxata al backend, che risponde 404 JSON invece di servire `index.html`. Stesso problema per
`/admin`, `/budget`, `/corrispettivi`, `/dipendenti`, `/forecast`, `/home`, `/usali` (ogni prefisso
router che coincide con una route React Router).

**Soluzione verificata: frontend e backend su origini separate** (porta diversa in LAN, sottodominio
diverso in produzione dietro un tunnel/reverse proxy) — template pronti in
[`deploy/hotelos.nginx.conf`](../deploy/hotelos.nginx.conf) (solo file statici + SPA fallback, nessun
proxy) e [`deploy/hotelos-api.nginx.conf`](../deploy/hotelos-api.nginx.conf) (proxy puro verso il
backend, nessuna logica di path):

```bash
sudo cp deploy/hotelos.nginx.conf /etc/nginx/sites-available/hotelos
sudo cp deploy/hotelos-api.nginx.conf /etc/nginx/sites-available/hotelos-api
sudo ln -s /etc/nginx/sites-available/hotelos /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/hotelos-api /etc/nginx/sites-enabled/hotelos-api
```

Poi impostare `VITE_API_URL` (Passo 4) sull'origine del sito API (es.
`https://api.tuodominio.it` o `http://IP_SERVER:8081`) **prima** di eseguire `npm run build`, e
`cors_origins` nel DB sull'origine del sito frontend — necessario ora che sono origini diverse (con
tutto sulla stessa origine il CORS non servirebbe, ma si ricade nel bug sopra).

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Adattare `listen`/`server_name` nei due file ai valori reali (porta interna in LAN, oppure
`listen 80`/`server_name` con dominio reale se questa macchina riceve traffico direttamente senza
un tunnel/reverse proxy davanti).

---

## Passo 7 — SSL con Let's Encrypt

Non necessario se il TLS è terminato a monte (es. Cloudflare Tunnel — vedi
`docs/MIGRAZIONE_LINUX.md`). Solo se questa macchina riceve traffico HTTPS direttamente:

```bash
sudo certbot --nginx -d tuodominio.it
# Certbot modifica automaticamente nginx per HTTPS e rinnovo automatico
```

---

## Aggiornare l'applicazione (deploy aggiornamenti)

```bash
cd /opt/hotel-os   # o /srv/progetti/hotel-os, a seconda di dove è stato clonato
git pull

# Backend: reinstallare dipendenze se cambiate, applicare nuove migrazioni
cd backend && source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
sudo systemctl restart hotelos-backend

# Frontend: ricompilare
cd ../frontend
npm install
npm run build
sudo systemctl reload nginx
```

---

## Troubleshooting

| Problema | Causa probabile | Soluzione |
|----------|----------------|-----------|
| Login fallisce con "Errore di connessione" | `VITE_API_URL` sbagliato o backend non raggiungibile | Verificare `.env.production` e stato uvicorn |
| Errore CORS | `cors_origins` nel DB non aggiornato | Eseguire UPDATE su `app_config` e riavviare backend |
| Pagine React non trovate (404 su refresh) | nginx non configurato per React Router | Aggiungere `try_files $uri /index.html` |
| Token JWT scaduto subito | `SECRET_KEY` cambiata dopo il login | Effettuare nuovo login |
| Migrazioni falliscono | DB non raggiungibile o `DATABASE_URL` errato | Verificare `.env` e stato PostgreSQL |

---

## Variabili critiche — riepilogo

| Variabile | File | Obbligatorio cambiare |
|-----------|------|-----------------------|
| `DATABASE_URL` | `backend/.env` | Sempre |
| `SECRET_KEY` | `backend/.env` | Sempre (produzione) |
| `VITE_API_URL` | `frontend/.env.production` | Sempre |
| `cors_origins` | DB `app_config` | Sempre |
| `app_name` | DB `app_config` | Opzionale |
