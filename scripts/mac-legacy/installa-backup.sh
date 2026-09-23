#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_SRC="$SCRIPT_DIR/it.hotelos.backup.plist"
PLIST_DST="$HOME/Library/LaunchAgents/it.hotelos.backup.plist"
BACKUP_BASE="$HOME/hotelos-backups"

echo "── Installazione backup automatico HotelOS ──"

echo "[1/4] Creazione cartelle..."
mkdir -p "$BACKUP_BASE/db" "$BACKUP_BASE/logs" "$BACKUP_BASE/github-repo"

echo "[2/4] Copia plist in LaunchAgents..."
cp "$PLIST_SRC" "$PLIST_DST"

echo "[3/4] Caricamento in launchd..."
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"

echo "[4/4] Verifica..."
CARICATO=false
for tentativo in 1 2 3; do
  if launchctl list | grep -q "it.hotelos.backup"; then
    CARICATO=true
    break
  fi
  sleep 1
done
if $CARICATO; then
  echo "OK: it.hotelos.backup caricato in launchd (esecuzione ogni notte alle 03:00)."
else
  echo "ATTENZIONE: it.hotelos.backup non risulta caricato, controlla manualmente con 'launchctl list'."
fi

cat << 'EOF'

── Prossimi passi (una tantum) ──

1. Crea un repository GitHub privato:
   → github.com → New repository → nome: hotelos-backup → Private ✓
   → NON inizializzare con README (lo script lo crea da solo)

2. Verifica che la chiave SSH esistente (~/.ssh/id_ed25519, già usata per
   il repo hotel-os) abbia accesso al nuovo repo hotelos-backup.

3. Testa subito un backup manuale:
   bash scripts/test-backup.sh

4. Verifica lo stato in qualsiasi momento:
   bash scripts/verifica-backup.sh

EOF
