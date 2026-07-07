#!/bin/bash
set -uo pipefail

BACKUP_BASE="$HOME/hotelos-backups"
BACKUP_DB="$BACKUP_BASE/db"
BACKUP_LOG="$BACKUP_BASE/logs/backup_log.jsonl"
RASPBERRY_HOST="192.168.100.149"
RASPBERRY_USER="ginoscola"
RASPBERRY_DIR="~/hotelos-backups"

echo "── Stato ultimo backup ──"
if [ -f "$BACKUP_LOG" ] && [ -s "$BACKUP_LOG" ]; then
  tail -n 1 "$BACKUP_LOG"
else
  echo "Nessun backup ancora eseguito (log assente o vuoto in $BACKUP_LOG)."
fi

echo ""
echo "── File locali ($BACKUP_DB) ──"
if [ -d "$BACKUP_DB" ]; then
  ls -lht "$BACKUP_DB"/*.dump 2>/dev/null || echo "Nessun file .dump presente."
else
  echo "Cartella non ancora creata."
fi

echo ""
echo "── File su Raspberry Pi ──"
if ping -c 1 -t 2 "$RASPBERRY_HOST" > /dev/null 2>&1; then
  echo "Raspberry Pi raggiungibile ($RASPBERRY_HOST)."
  ssh -o ConnectTimeout=5 "$RASPBERRY_USER@$RASPBERRY_HOST" \
    "ls -lht $RASPBERRY_DIR/db/*.dump 2>/dev/null" || echo "Impossibile leggere la cartella remota."
else
  echo "Raspberry Pi NON raggiungibile ($RASPBERRY_HOST)."
fi
