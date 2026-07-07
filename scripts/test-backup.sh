#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_LOG="$HOME/hotelos-backups/logs/backup_log.jsonl"

echo "── Esecuzione backup di test (verbose) ──"
bash -x "$SCRIPT_DIR/hotelos-backup.sh"

echo ""
echo "── Ultimo record di log ──"
if [ -f "$BACKUP_LOG" ]; then
  tail -n 1 "$BACKUP_LOG"
else
  echo "Nessun log trovato in $BACKUP_LOG"
fi
