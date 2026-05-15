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

Creare il file `/etc/systemd/system/revenue-backend.service`:

```ini
[Unit]
Description=HotelOS Backend
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/hotel-os/backend
ExecStart=/opt/hotel-os/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/hotel-os/backend/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable revenue-backend
sudo systemctl start revenue-backend
sudo systemctl status revenue-backend   # deve mostrare "active (running)"
```

---

## Passo 6 — Nginx

Creare il file `/etc/nginx/sites-available/hotel-os`:

```nginx
server {
    listen 80;
    server_name tuodominio.it;   # o IP del server

    # File statici frontend
    root /opt/hotel-os/frontend/dist;
    index index.html;

    # React Router: tutte le route non trovate → index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy al backend FastAPI
    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> **Nota:** se il frontend chiama direttamente `https://tuodominio.it/auth/login`
> (senza prefisso `/api/`), impostare invece `VITE_API_URL=https://tuodominio.it`
> e fare proxy di tutte le route backend tramite `location /auth/`, `location /modules/`, ecc.
> oppure usare un sottodominio dedicato (es. `api.tuodominio.it`).

```bash
sudo ln -s /etc/nginx/sites-available/hotel-os /etc/nginx/sites-enabled/
sudo nginx -t          # verifica la configurazione
sudo systemctl reload nginx
```

---

## Passo 7 — SSL con Let's Encrypt

```bash
sudo certbot --nginx -d tuodominio.it
# Certbot modifica automaticamente nginx per HTTPS e rinnovo automatico
```

---

## Aggiornare l'applicazione (deploy aggiornamenti)

```bash
cd /opt/hotel-os
git pull

# Backend: reinstallare dipendenze se cambiate, applicare nuove migrazioni
cd backend && source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
sudo systemctl restart revenue-backend

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
