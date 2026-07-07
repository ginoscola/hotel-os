#!/bin/bash
set -euo pipefail

# ── Configurazione ──────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../backend/.env"

# Legge DB_NAME e DB_USER da backend/.env
DB_NAME=$(grep '^DATABASE_URL' "$ENV_FILE" | sed 's/.*\/\([^?]*\).*/\1/')
DB_USER=$(grep '^DATABASE_URL' "$ENV_FILE" | sed 's/.*:\/\/\([^:]*\):.*/\1/')

BACKUP_BASE="$HOME/hotelos-backups"
BACKUP_DB="$BACKUP_BASE/db"
BACKUP_LOG="$BACKUP_BASE/logs/backup_log.jsonl"
RASPBERRY_HOST="192.168.100.149"
RASPBERRY_USER="ginoscola"
RASPBERRY_DIR="~/hotelos-backups"
GITHUB_BACKUP_DIR="$BACKUP_BASE/github-repo"
GITHUB_REPO="git@github.com:ginoscola/hotelos-backup.git"
RETENTION_LOCALE=7
RETENTION_RASPBERRY=7
RETENTION_GITHUB=3

DATE=$(date +%Y%m%d_%H%M%S)
DUMP_FILE="$BACKUP_DB/hotelos_$DATE.dump"
START_TIME=$(date +%s)

RASPBERRY_OK=false
GITHUB_OK=false
ELIMINATI=0

# ── Funzione log ────────────────────────────────
log_result() {
  local esito=$1
  local errore=${2:-""}
  local end_time
  end_time=$(date +%s)
  local durata=$((end_time - START_TIME))
  local dump_size=0

  [ -f "$DUMP_FILE" ] && dump_size=$(du -m "$DUMP_FILE" | cut -f1)

  printf '{"timestamp":"%s","esito":"%s","dump_file":"%s","dump_size_mb":%s,"raspberry_ok":%s,"github_ok":%s,"retention_eliminati":%s,"errore":"%s","durata_secondi":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$esito" \
    "$(basename "$DUMP_FILE")" \
    "$dump_size" \
    "$RASPBERRY_OK" \
    "$GITHUB_OK" \
    "$ELIMINATI" \
    "$errore" \
    "$durata" >> "$BACKUP_LOG"
}

# ── 1. Crea cartelle ────────────────────────────
mkdir -p "$BACKUP_DB" "$BACKUP_BASE/logs"

# ── 2. Dump PostgreSQL ──────────────────────────
echo "[$(date)] Avvio dump PostgreSQL..."
if ! /opt/homebrew/bin/pg_dump -U "$DB_USER" -d "$DB_NAME" -F c -f "$DUMP_FILE"; then
  log_result "error" "pg_dump fallito"
  exit 1
fi
echo "[$(date)] Dump completato: $(du -h "$DUMP_FILE")"

# ── 3. Copia su Raspberry Pi ────────────────────
echo "[$(date)] Copia su Raspberry Pi..."
if rsync -az --timeout=30 "$DUMP_FILE" "$RASPBERRY_USER@$RASPBERRY_HOST:$RASPBERRY_DIR/db/"; then
  RASPBERRY_OK=true
  echo "[$(date)] Raspberry Pi: OK"
  # Retention sul Raspberry
  ssh "$RASPBERRY_USER@$RASPBERRY_HOST" \
    "ls -t $RASPBERRY_DIR/db/*.dump 2>/dev/null | tail -n +\$((${RETENTION_RASPBERRY}+1)) | xargs -r rm -f" || true
else
  echo "[$(date)] WARNING: Raspberry Pi non raggiungibile"
fi

# ── 4. Push su GitHub ───────────────────────────
echo "[$(date)] Push su GitHub..."

if [ ! -d "$GITHUB_BACKUP_DIR/.git" ]; then
  mkdir -p "$GITHUB_BACKUP_DIR"
  (
    cd "$GITHUB_BACKUP_DIR"
    git init -b main
    git remote add origin "$GITHUB_REPO"
  )
fi

(
  cd "$GITHUB_BACKUP_DIR"

  cp "$DUMP_FILE" "$GITHUB_BACKUP_DIR/"

  # Mantieni solo gli ultimi N dump nel repo
  ls -t "$GITHUB_BACKUP_DIR"/*.dump 2>/dev/null | tail -n +$((RETENTION_GITHUB+1)) | xargs -r rm -f

  cat > "$GITHUB_BACKUP_DIR/README.md" << EOF
# HotelOS Backup

Ultimo backup: $(date '+%d/%m/%Y %H:%M')
File presenti: $(ls -1 *.dump 2>/dev/null | wc -l | tr -d ' ')
EOF

  git add -A
  git commit -m "backup $DATE" --allow-empty -q
)

if (cd "$GITHUB_BACKUP_DIR" && git push origin main --force -q); then
  GITHUB_OK=true
  echo "[$(date)] GitHub: OK"
else
  echo "[$(date)] WARNING: GitHub push fallito"
fi

# ── 5. Retention locale ─────────────────────────
echo "[$(date)] Pulizia backup locali..."
ELIMINATI=$(ls -t "$BACKUP_DB"/*.dump 2>/dev/null | tail -n +$((RETENTION_LOCALE+1)) | wc -l | tr -d ' ')
ls -t "$BACKUP_DB"/*.dump 2>/dev/null | tail -n +$((RETENTION_LOCALE+1)) | xargs -r rm -f

# ── 6. Log finale ───────────────────────────────
if $RASPBERRY_OK && $GITHUB_OK; then
  log_result "success"
elif [ -f "$DUMP_FILE" ]; then
  log_result "partial" "Backup locale OK ma alcune copie remote fallite"
else
  log_result "error" "Dump non completato"
fi

echo "[$(date)] Backup completato."
