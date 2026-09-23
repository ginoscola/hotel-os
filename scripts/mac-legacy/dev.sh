#!/bin/bash
# Avvia backend e frontend in due finestre terminale separate

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Backend
osascript -e "tell application \"Terminal\" to do script \"cd '$PROJECT_DIR/backend' && source venv/bin/activate && uvicorn app.main:app --reload --port 8000\""

# Frontend
osascript -e "tell application \"Terminal\" to do script \"cd '$PROJECT_DIR/frontend' && npm run dev\""

echo "Backend:  http://localhost:8000"
echo "Frontend: http://localhost:5173"
