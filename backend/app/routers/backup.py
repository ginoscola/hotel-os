"""Router per il backup automatico notturno di HotelOS (locale + Raspberry Pi + GitHub).

Prefix: /admin/backup — tutti gli endpoint richiedono ruolo admin.

Endpoint:
  GET  /admin/backup/status                 → riepilogo ultimo backup + stato launchd/Raspberry
  GET  /admin/backup/logs                   → storico backup da backup_log.jsonl
  GET  /admin/backup/files                  → dump .dump presenti in locale
  POST /admin/backup/esegui-ora             → lancia hotelos-backup.sh in background
  POST /admin/backup/ripristina/{nome_file} → restituisce solo i comandi di ripristino (non esegue nulla)

Legge solo log e directory già esistenti; nessun endpoint tocca il database.
Lo script che genera i dati letti qui è scripts/hotelos-backup.sh.
"""
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from app.auth import richiedi_admin

router = APIRouter(prefix="/admin/backup", tags=["admin-backup"], dependencies=[Depends(richiedi_admin)])

_ROOT_DIR = Path(__file__).resolve().parents[3]
BACKUP_BASE = Path.home() / "hotelos-backups"
BACKUP_DB_DIR = BACKUP_BASE / "db"
BACKUP_LOG_FILE = BACKUP_BASE / "logs" / "backup_log.jsonl"
SCRIPT_PATH = _ROOT_DIR / "scripts" / "hotelos-backup.sh"
ENV_FILE = _ROOT_DIR / "backend" / ".env"
LAUNCHD_LABEL = "it.hotelos.backup"
RASPBERRY_HOST = "192.168.100.149"
ORARIO_BACKUP = "03:00"


def _leggi_record_log() -> list:
    """Legge tutti i record da backup_log.jsonl, ignorando righe malformate."""
    if not BACKUP_LOG_FILE.exists():
        return []
    record = []
    for riga in BACKUP_LOG_FILE.read_text().splitlines():
        riga = riga.strip()
        if not riga:
            continue
        try:
            record.append(json.loads(riga))
        except json.JSONDecodeError:
            continue
    return record


def _leggi_ultimo_backup() -> Optional[dict]:
    record = _leggi_record_log()
    if not record:
        return None
    return sorted(record, key=lambda r: r.get("timestamp", ""))[-1]


def _launchd_attivo() -> bool:
    try:
        risultato = subprocess.run(
            ["launchctl", "list"], capture_output=True, text=True, timeout=5
        )
        return LAUNCHD_LABEL in risultato.stdout
    except Exception:
        return False


def _raspberry_raggiungibile() -> bool:
    try:
        risultato = subprocess.run(
            ["ping", "-c", "1", "-t", "2", RASPBERRY_HOST],
            capture_output=True, timeout=5,
        )
        return risultato.returncode == 0
    except Exception:
        return False


def _leggi_db_config() -> tuple:
    """Legge (db_user, db_name) da backend/.env (DATABASE_URL), come lo script bash."""
    testo = ENV_FILE.read_text()
    riga = next(r for r in testo.splitlines() if r.startswith("DATABASE_URL"))
    url = riga.split("=", 1)[1].strip()
    resto = url.split("://", 1)[1]
    userinfo, hostpart = resto.split("@", 1)
    db_user = userinfo.split(":", 1)[0]
    db_name = hostpart.split("/", 1)[1].split("?", 1)[0]
    return db_user, db_name


@router.get("/status")
def stato_backup() -> dict:
    ultimo = _leggi_ultimo_backup()
    backup_locali = len(list(BACKUP_DB_DIR.glob("*.dump"))) if BACKUP_DB_DIR.exists() else 0
    return {
        "ultimo_backup": ultimo,
        "backup_locali": backup_locali,
        "launchd_attivo": _launchd_attivo(),
        "raspberry_raggiungibile": _raspberry_raggiungibile(),
        "prossimo_backup": ORARIO_BACKUP,
    }


@router.get("/logs")
def lista_log(limit: int = 30, esito: Optional[str] = None) -> list:
    record = _leggi_record_log()
    if esito:
        record = [r for r in record if r.get("esito") == esito]
    record.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    return record[:limit]


@router.get("/files")
def lista_file() -> list:
    if not BACKUP_DB_DIR.exists():
        return []
    file_info = []
    for percorso in BACKUP_DB_DIR.glob("*.dump"):
        stat = percorso.stat()
        file_info.append({
            "nome": percorso.name,
            "dimensione_mb": round(stat.st_size / (1024 * 1024), 2),
            "data_creazione": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        })
    file_info.sort(key=lambda f: f["data_creazione"], reverse=True)
    return file_info


@router.post("/esegui-ora")
def esegui_backup_ora() -> dict:
    subprocess.Popen(["bash", str(SCRIPT_PATH)])
    return {"messaggio": "Backup avviato in background. Controlla i log tra qualche minuto."}


@router.post("/ripristina/{nome_file}")
def istruzioni_ripristino(nome_file: str) -> dict:
    nome_file = Path(nome_file).name  # solo basename, niente path traversal
    if not nome_file.endswith(".dump"):
        raise HTTPException(status_code=400, detail="Il file deve avere estensione .dump")
    percorso = BACKUP_DB_DIR / nome_file
    if not percorso.exists():
        raise HTTPException(status_code=404, detail=f"File '{nome_file}' non trovato in {BACKUP_DB_DIR}")

    db_user, db_name = _leggi_db_config()
    percorso_completo = str(percorso)

    return {
        "comando_ripristino": (
            f"pg_restore -U {db_user} -d {db_name} --clean --if-exists {percorso_completo}"
        ),
        "comando_verifica": (
            f"psql -U {db_user} -d {db_name} -c 'SELECT count(*) FROM hotels;'"
        ),
        "avvertenza": (
            "Questo sovrascrive il database attuale. Eseguire solo dal terminale "
            "dopo aver fermato il backend."
        ),
    }
