#!/bin/bash
# Ferma uvicorn se in esecuzione e lo riavvia con --reload

BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"

# Termina qualsiasi processo che occupa la porta 8000
PIDS=$(lsof -ti:8000 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "Fermo processo sulla porta 8000 (PID: $PIDS)…"
  kill -9 $PIDS 2>/dev/null
  # Aspetta che la porta si liberi (max 5 secondi)
  for i in 1 2 3 4 5; do
    sleep 1
    lsof -ti:8000 > /dev/null 2>&1 || break
    echo "  attendo liberazione porta… ($i/5)"
  done
fi

echo "Avvio backend in $BACKEND_DIR"
cd "$BACKEND_DIR"
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
