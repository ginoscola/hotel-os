#!/bin/bash
# Riavvia HotelOS sul server Linux (backend systemd; frontend servito da nginx da frontend/dist/).
#   ./restart_server.sh          → riavvia solo il backend
#   ./restart_server.sh --build  → ricompila anche il frontend (serve dopo ogni modifica .jsx)
#
# Il backend gira come servizio systemd `hotelos-backend` (utente `hotelos`): non va ucciso né
# rilanciato a mano con uvicorn, altrimenti systemd lo riavvia e i due processi si contendono la
# porta 8000. Versione Mac precedente (lsof + uvicorn --reload): nello storico git.

set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" = "--build" ]; then
  echo "Build frontend…"
  (cd "$PROJECT_DIR/frontend" && npm run build)
fi

echo "Riavvio hotelos-backend…"
sudo systemctl restart hotelos-backend

# Attendi che il backend risponda (max 15 secondi)
for i in $(seq 1 15); do
  if curl -s -o /dev/null http://127.0.0.1:8000/docs; then
    echo "Backend pronto"
    break
  fi
  sleep 1
done

systemctl --no-pager --lines=5 status hotelos-backend
