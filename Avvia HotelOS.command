#!/bin/bash
# Doppio click per avviare HotelOS (backend + frontend)
# I processi restano attivi anche dopo aver chiuso il terminale

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

# --- Ferma tutti i processi HotelOS esistenti ---
echo "Fermo processi in esecuzione..."

for PORT in 8000 5173 5174; do
  PIDS=$(lsof -ti:$PORT 2>/dev/null)
  if [ -n "$PIDS" ]; then
    kill -9 $PIDS 2>/dev/null
    echo "  Porta $PORT liberata (PID: $PIDS)"
  fi
done

pkill -9 -f "uvicorn app.main:app" 2>/dev/null
pkill -9 -f "vite" 2>/dev/null

for PORT in 8000 5173; do
  for i in {1..5}; do
    if ! lsof -ti:$PORT &>/dev/null; then break; fi
    sleep 1
  done
done

# --- PostgreSQL ---
PG_DATA="/opt/homebrew/var/postgresql@16"
PG_PID="$PG_DATA/postmaster.pid"

if [ -f "$PG_PID" ]; then
  PID=$(head -1 "$PG_PID")
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PG_PID"
  fi
fi

if ! pg_isready -h localhost -q 2>/dev/null; then
  echo "Avvio PostgreSQL..."
  brew services start postgresql@16
  for i in {1..15}; do
    sleep 1
    pg_isready -h localhost -q 2>/dev/null && break
  done
fi

if ! pg_isready -h localhost -q 2>/dev/null; then
  osascript -e 'display dialog "Errore: PostgreSQL non si è avviato.\n\nControlla i log con:\nbrew services info postgresql@16" buttons {"OK"} default button "OK" with icon stop'
  exit 1
fi
echo "PostgreSQL OK"

# --- Backend in background persistente ---
echo "Avvio backend..."
cd "$PROJECT_DIR/backend"
source venv/bin/activate
nohup uvicorn app.main:app --port 8000 --host 0.0.0.0 --reload > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
disown $BACKEND_PID
echo "  Backend PID: $BACKEND_PID (log: logs/backend.log)"

# Attendi che il backend sia pronto (max 15 secondi)
echo "Attendo backend..."
for i in {1..15}; do
  sleep 1
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/docs | grep -q "200"; then
    echo "Backend pronto"
    break
  fi
done

# --- Frontend in background persistente ---
echo "Avvio frontend..."
cd "$PROJECT_DIR/frontend"
nohup npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
disown $FRONTEND_PID
echo "  Frontend PID: $FRONTEND_PID (log: logs/frontend.log)"

# Attendi che il frontend sia pronto e rileva la porta
echo "Attendo frontend..."
FRONTEND_PORT=5173
for i in {1..15}; do
  sleep 1
  for P in 5173 5174 5175; do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:$P | grep -q "200"; then
      FRONTEND_PORT=$P
      break 2
    fi
  done
done

# Salva i PID per poterli fermare in seguito
echo "$BACKEND_PID" > "$LOG_DIR/backend.pid"
echo "$FRONTEND_PID" > "$LOG_DIR/frontend.pid"

# Apri nel browser locale
open "http://localhost:$FRONTEND_PORT"

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "N/D")
osascript -e "display notification \"Accessibile in rete: http://$IP:$FRONTEND_PORT\" with title \"HotelOS avviato\" subtitle \"Locale: http://localhost:$FRONTEND_PORT\""

echo ""
echo "HotelOS avviato (processi persistenti)"
echo "  Locale:  http://localhost:$FRONTEND_PORT"
echo "  Rete:    http://$IP:$FRONTEND_PORT"
echo ""
echo "Log:  tail -f $LOG_DIR/backend.log"
echo "      tail -f $LOG_DIR/frontend.log"
echo ""
echo "Per fermare tutto:  kill \$(cat $LOG_DIR/backend.pid) \$(cat $LOG_DIR/frontend.pid)"
