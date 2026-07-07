"""Test per gli endpoint di backup automatico (/admin/backup/*).

Nessun endpoint tocca il database: tutto letto da file (log JSONL, directory dump).
subprocess (launchctl, ping, Popen) è sempre mockato — non esegue mai pg_dump/rsync reali.
"""
import json
from unittest.mock import MagicMock, patch

import pytest
from starlette.testclient import TestClient

from app.auth import richiedi_admin
from app.main import app
from app.routers import backup


@pytest.fixture
def client():
    app.dependency_overrides[richiedi_admin] = lambda: None
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def percorsi_temp(tmp_path, monkeypatch):
    """Reindirizza i percorsi del router su una directory temporanea, isolata dai backup reali."""
    log_file = tmp_path / "backup_log.jsonl"
    db_dir = tmp_path / "db"
    db_dir.mkdir()
    monkeypatch.setattr(backup, "BACKUP_LOG_FILE", log_file)
    monkeypatch.setattr(backup, "BACKUP_DB_DIR", db_dir)
    return log_file, db_dir


def _scrivi_log(log_file, record):
    with open(log_file, "a") as f:
        for r in record:
            f.write(json.dumps(r) + "\n")


def _record_esempio(**override):
    base = {
        "timestamp": "2026-07-06T03:00:00Z",
        "esito": "success",
        "dump_file": "hotelos_20260706_030000.dump",
        "dump_size_mb": 24,
        "raspberry_ok": True,
        "github_ok": True,
        "retention_eliminati": 0,
        "errore": "",
        "durata_secondi": 18,
    }
    base.update(override)
    return base


# ---------------------------------------------------------------------------
# Autenticazione
# ---------------------------------------------------------------------------

def test_endpoint_protetto_senza_admin():
    with TestClient(app) as c:
        resp = c.get("/admin/backup/status")
    assert resp.status_code in (401, 403)


# ---------------------------------------------------------------------------
# GET /status
# ---------------------------------------------------------------------------

def test_status_200(client, percorsi_temp):
    log_file, db_dir = percorsi_temp
    _scrivi_log(log_file, [_record_esempio()])
    (db_dir / "hotelos_20260706_030000.dump").write_bytes(b"x" * 1024)

    def side_effect(cmd, **kwargs):
        risultato = MagicMock()
        if cmd[0] == "launchctl":
            risultato.stdout = "1234\t0\tit.hotelos.backup\n"
        elif cmd[0] == "ping":
            risultato.returncode = 0
        return risultato

    with patch.object(backup.subprocess, "run", side_effect=side_effect) as mock_run:
        resp = client.get("/admin/backup/status")

    assert resp.status_code == 200
    data = resp.json()
    assert data["ultimo_backup"]["esito"] == "success"
    assert data["backup_locali"] == 1
    assert data["launchd_attivo"] is True
    assert data["raspberry_raggiungibile"] is True
    assert data["prossimo_backup"] == "03:00"
    assert mock_run.called


def test_status_nessun_backup(client, percorsi_temp):
    with patch.object(backup.subprocess, "run", side_effect=Exception("non raggiungibile")):
        resp = client.get("/admin/backup/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ultimo_backup"] is None
    assert data["backup_locali"] == 0
    assert data["launchd_attivo"] is False
    assert data["raspberry_raggiungibile"] is False


# ---------------------------------------------------------------------------
# GET /logs
# ---------------------------------------------------------------------------

def test_logs_200_ordinati_e_limit(client, percorsi_temp):
    log_file, _ = percorsi_temp
    _scrivi_log(log_file, [
        _record_esempio(timestamp="2026-07-01T03:00:00Z", esito="success"),
        _record_esempio(timestamp="2026-07-02T03:00:00Z", esito="error"),
    ])

    resp = client.get("/admin/backup/logs", params={"limit": 30})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["timestamp"] == "2026-07-02T03:00:00Z"  # ordinati desc


def test_logs_filtro_esito(client, percorsi_temp):
    log_file, _ = percorsi_temp
    _scrivi_log(log_file, [
        _record_esempio(timestamp="2026-07-01T03:00:00Z", esito="success"),
        _record_esempio(timestamp="2026-07-02T03:00:00Z", esito="error"),
    ])

    resp = client.get("/admin/backup/logs", params={"esito": "error"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["esito"] == "error"


def test_logs_riga_malformata_ignorata(client, percorsi_temp):
    log_file, _ = percorsi_temp
    log_file.write_text('{"timestamp":"2026-07-01T03:00:00Z","esito":"success"}\nrigacorrotta\n')

    resp = client.get("/admin/backup/logs")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


# ---------------------------------------------------------------------------
# GET /files
# ---------------------------------------------------------------------------

def test_files_200(client, percorsi_temp):
    _, db_dir = percorsi_temp
    (db_dir / "a.dump").write_bytes(b"x" * (2 * 1024 * 1024))

    resp = client.get("/admin/backup/files")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["nome"] == "a.dump"
    assert data[0]["dimensione_mb"] == pytest.approx(2.0, rel=0.01)


def test_files_directory_assente(client, percorsi_temp, tmp_path):
    backup.BACKUP_DB_DIR = tmp_path / "non-esiste"
    resp = client.get("/admin/backup/files")
    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# POST /ripristina/{nome_file}
# ---------------------------------------------------------------------------

def test_ripristina_restituisce_solo_istruzioni(client, percorsi_temp, monkeypatch, tmp_path):
    _, db_dir = percorsi_temp
    (db_dir / "hotelos_test.dump").write_bytes(b"x")

    env_file = tmp_path / ".env"
    env_file.write_text("DATABASE_URL=postgresql://ginoscola@localhost:5432/revenue_master\n")
    monkeypatch.setattr(backup, "ENV_FILE", env_file)

    with patch.object(backup.subprocess, "Popen") as mock_popen, \
         patch.object(backup.subprocess, "run") as mock_run:
        resp = client.post("/admin/backup/ripristina/hotelos_test.dump")

    assert resp.status_code == 200
    data = resp.json()
    assert "pg_restore" in data["comando_ripristino"]
    assert "revenue_master" in data["comando_ripristino"]
    assert "ginoscola" in data["comando_ripristino"]
    assert "sovrascrive" in data["avvertenza"].lower()
    mock_popen.assert_not_called()
    mock_run.assert_not_called()


def test_ripristina_file_inesistente_404(client, percorsi_temp):
    resp = client.post("/admin/backup/ripristina/non-esiste.dump")
    assert resp.status_code == 404


def test_ripristina_rifiuta_path_traversal(client, percorsi_temp):
    resp = client.post("/admin/backup/ripristina/..%2F..%2Fetc%2Fpasswd.dump")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /esegui-ora
# ---------------------------------------------------------------------------

def test_esegui_ora_chiama_popen_senza_bloccare(client):
    with patch.object(backup.subprocess, "Popen") as mock_popen:
        resp = client.post("/admin/backup/esegui-ora")

    assert resp.status_code == 200
    assert "background" in resp.json()["messaggio"].lower()
    mock_popen.assert_called_once()
    args, _ = mock_popen.call_args
    assert args[0][0] == "bash"
