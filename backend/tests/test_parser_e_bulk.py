"""
Test per le nuove funzionalità del parser (Excel, snapshot_date, hotel_code da file)
e per l'endpoint di bulk import.

Usa lo stesso DB di test (revenue_master_test) configurato in test_upload_endpoint.py.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date, datetime

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.database import Base, get_db
from app.main import app
from app.models.revenue import DailyRevenue, ImportSession  # noqa: F401 — per Base.metadata
from app.services.file_parser import (
    ParserCSV,
    estrai_hotel_code_da_file,
    estrai_snapshot_date,
)

UPLOADS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "uploads"))
TEST_DB_URL = "postgresql://ginoscola@localhost:5432/revenue_master_test"


# ---------------------------------------------------------------------------
# Fixture DB di test (stessa convenzione di test_upload_endpoint.py)
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def test_engine():
    engine = create_engine(TEST_DB_URL)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture(scope="module")
def TestSession(test_engine):
    return sessionmaker(bind=test_engine)


@pytest.fixture(scope="module")
def client(test_engine, TestSession):
    """TestClient con DB di test iniettato come dipendenza."""
    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def pulisci_tabelle(test_engine):
    """Svuota le tabelle rilevanti e reinserisce gli hotel base prima di ogni test."""
    with test_engine.connect() as conn:
        conn.execute(text("TRUNCATE daily_revenue, hotel_seasons, hotels, imports RESTART IDENTITY CASCADE"))
        # Reinserisce gli hotel base (richiesto dalla validazione DB-driven)
        conn.execute(text("""
            INSERT INTO hotels (code, name, default_rooms) VALUES
            ('CLB', 'Club Hotel', 45),
            ('DPH', 'Hotel Du Parc', 43),
            ('INT', 'Hotel International', 45)
        """))
        conn.commit()


# ---------------------------------------------------------------------------
# Test: estrazione snapshot_date dal nome file
# ---------------------------------------------------------------------------

def test_snapshot_date_da_prefisso_valido():
    """Prefisso YYYYMMDD_ presente → restituisce la data corrispondente."""
    assert estrai_snapshot_date("20260505_PlanningForecast-CLB1.csv") == date(2026, 5, 5)


def test_snapshot_date_nessun_prefisso_restituisce_none():
    """Nessun prefisso YYYYMMDD → restituisce None (non date.today())."""
    assert estrai_snapshot_date("PlanningForecast-CLB1.csv") is None


def test_snapshot_date_solo_prefisso():
    """Nome corto tipo YYYYMMDD_CLB1.csv → estrae comunque la data corretta."""
    assert estrai_snapshot_date("20260505_CLB1.csv") == date(2026, 5, 5)


def test_snapshot_date_excel():
    """File Excel con prefisso → data estratta correttamente."""
    assert estrai_snapshot_date("20260505_INT2.xlsx") == date(2026, 5, 5)


def test_snapshot_date_prefisso_con_path():
    """Funziona anche se viene passato un percorso completo."""
    assert estrai_snapshot_date("/uploads/20260601_PlanningForecast-DPH1.csv") == date(2026, 6, 1)


# ---------------------------------------------------------------------------
# Test: estrazione hotel_code dal nome file
# ---------------------------------------------------------------------------

def test_hotel_code_da_nome_file_clb():
    assert estrai_hotel_code_da_file("20260505_PlanningForecast-CLB1.csv") == "CLB"


def test_hotel_code_da_nome_file_dph():
    assert estrai_hotel_code_da_file("PlanningForecast-DPH2.xlsx") == "DPH"


def test_hotel_code_da_nome_file_int():
    assert estrai_hotel_code_da_file("PlanningForecast-INT1.csv") == "INT"


def test_hotel_code_da_nome_file_assente():
    """Nome file senza schema PlanningForecast → None."""
    assert estrai_hotel_code_da_file("random_file.csv") is None


def test_hotel_code_da_nome_file_case_insensitive():
    """Il match è case-insensitive ma restituisce sempre uppercase."""
    assert estrai_hotel_code_da_file("planningforecast-clb1.csv") == "CLB"


def test_hotel_code_separatore_underscore():
    """Separatore _ invece di - viene gestito correttamente."""
    assert estrai_hotel_code_da_file("20260316_PlanningForecast_INT1.xlsx") == "INT"


def test_hotel_code_senza_separatore():
    """Nessun separatore tra PlanningForecast e codice hotel."""
    assert estrai_hotel_code_da_file("20260330_PlanningForecastINT1.xlsx") == "INT"


def test_hotel_code_typo_e_minuscolo():
    """Typo nel nome + codice minuscolo vengono gestiti correttamente."""
    assert estrai_hotel_code_da_file("20260413_PlanningForecas_int1.xlsx") == "INT"


def test_hotel_code_solo_prefisso_data():
    """Nome senza PlanningForecast, solo prefisso data e codice: 20260505_CLB1.csv → CLB."""
    assert estrai_hotel_code_da_file("20260505_CLB1.csv") == "CLB"


def test_hotel_code_qualsiasicosa_nel_mezzo():
    """Qualsiasi testo intermedio: 20260505_qualsiasicosa_DPH2.xlsx → DPH."""
    assert estrai_hotel_code_da_file("20260505_qualsiasicosa_DPH2.xlsx") == "DPH"


def test_hotel_code_senza_prefisso_data():
    """Senza prefisso data: PlanningForecast-INT1.csv → INT."""
    assert estrai_hotel_code_da_file("PlanningForecast-INT1.csv") == "INT"


def test_hotel_code_excel_senza_planning():
    """File xlsx senza PlanningForecast: 20260505_INT2.xlsx → INT."""
    assert estrai_hotel_code_da_file("20260505_INT2.xlsx") == "INT"


# ---------------------------------------------------------------------------
# Test: parser Excel — file xlsx sintetico
# ---------------------------------------------------------------------------

def test_parser_excel_produce_stessi_risultati_csv():
    """
    Crea un file xlsx sintetico con le stesse colonne del CSV e verifica
    che il parser produca dati corretti (date, numeri, fnb=0 con stesso file).
    """
    import openpyxl
    import tempfile

    wb = openpyxl.Workbook()
    ws = wb.active
    # Intestazioni obbligatorie
    ws.append(["DATA", "EVENTI", "CV", "CP", "PAX", "RICAVI TRAT", "EXTRA TRATT", "ADR", "RPAR", "RMP", "OCCUP"])
    # Righe con date come datetime (come arriva da Excel reale)
    ws.append([datetime(2026, 6, 1, 0, 0), "", 45, 30, 60, 2000.50, 150.00, 66.68, 44.45, 66.68, 66.67])
    ws.append([datetime(2026, 6, 2, 0, 0), "", 45, 25, 50, 1800.00, 120.00, 72.00, 40.00, 72.00, 55.56])

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
        path_xlsx = f.name
    wb.save(path_xlsx)

    try:
        parser = ParserCSV("CLB")
        # Stesso file per entrambi → fnb = max(0, ricavi_trat - ricavi_trat) = 0
        righe = parser.parse_coppia(path_xlsx, path_xlsx)

        assert len(righe) == 2
        assert righe[0].data == date(2026, 6, 1)
        assert righe[1].data == date(2026, 6, 2)
        # revenue_rooms = ricavi_trat del file "alloggio" (file2 = stesso file)
        assert abs(righe[0].revenue_rooms - 2000.50) < 0.01
        assert righe[0].revenue_fnb == 0.0  # stesso file → differenza = 0
        assert abs(righe[0].revenue_extra - 150.00) < 0.01
        assert righe[0].rooms_sold == 30
        assert righe[0].rooms_available == 45
    finally:
        os.unlink(path_xlsx)


def test_parser_excel_ignora_righe_sdly():
    """Le righe con stringa SDLY nel campo DATA vengono scartate anche da file Excel."""
    import openpyxl
    import tempfile

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["DATA", "EVENTI", "CV", "CP", "PAX", "RICAVI TRAT", "EXTRA TRATT"])
    ws.append([datetime(2026, 6, 1, 0, 0), "", 45, 30, 60, 2000.00, 100.00])
    # Riga SDLY: la stringa non è un datetime, viene passata come stringa
    ws.append(["01/06/2026 (SDLY)", "", 45, 28, 56, 1900.00, 95.00])

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
        path_xlsx = f.name
    wb.save(path_xlsx)

    try:
        parser = ParserCSV("CLB")
        righe = parser.parse_coppia(path_xlsx, path_xlsx)
        assert len(righe) == 1
        assert righe[0].data == date(2026, 6, 1)
    finally:
        os.unlink(path_xlsx)


# ---------------------------------------------------------------------------
# Test: bulk import
# ---------------------------------------------------------------------------

class TestBulkImport:
    def test_bulk_scan_cartella_uploads(self, client, test_engine):
        """Import massivo dalla cartella uploads/ con i file CSV reali."""
        resp = client.post(f"/upload/bulk?cartella={UPLOADS_DIR}")
        assert resp.status_code == 200
        j = resp.json()
        assert j["coppie_trovate"] >= 3   # CLB, DPH, INT
        assert j["coppie_importate"] >= 3
        assert j["coppie_errore"] == 0

    def test_bulk_idempotente(self, client):
        """Seconda esecuzione bulk: tutte le coppie vengono saltate."""
        client.post(f"/upload/bulk?cartella={UPLOADS_DIR}")
        resp2 = client.post(f"/upload/bulk?cartella={UPLOADS_DIR}")
        j = resp2.json()
        assert j["coppie_importate"] == 0
        assert j["coppie_saltate"] >= 3

    def test_bulk_cartella_inesistente_restituisce_400(self, client):
        resp = client.post("/upload/bulk?cartella=/cartella/inesistente")
        assert resp.status_code == 400

    def test_bulk_imports_salvati_nel_db(self, client, test_engine):
        """Dopo il bulk import, la tabella imports deve contenere i record."""
        client.post(f"/upload/bulk?cartella={UPLOADS_DIR}")
        with test_engine.connect() as conn:
            n = conn.execute(
                text("SELECT COUNT(*) FROM imports WHERE stato IN ('success','warning')")
            ).scalar()
        assert n >= 3

    def test_bulk_risposta_contiene_risultati(self, client):
        """La risposta deve contenere un risultato per ogni coppia trovata."""
        resp = client.post(f"/upload/bulk?cartella={UPLOADS_DIR}")
        j = resp.json()
        assert len(j["risultati"]) == j["coppie_trovate"]

    def test_bulk_stato_importato_nei_risultati(self, client):
        """I risultati importati con successo hanno stato 'importato'."""
        resp = client.post(f"/upload/bulk?cartella={UPLOADS_DIR}")
        importati = [r for r in resp.json()["risultati"] if r["stato"] == "importato"]
        assert len(importati) >= 3
