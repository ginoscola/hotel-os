"""
Test end-to-end del endpoint POST /upload/coppia/{hotel_code}.

Usa un database PostgreSQL di test (revenue_master_test) separato dal DB di produzione.
Le tabelle vengono create prima della suite e distrutte dopo.
Ogni test riparte con daily_revenue vuota (fixture autouse pulisce la tabella).

Verifica:
- Risposta HTTP corretta (status, campi)
- Contatori righe (inserite, aggiornate, scartate)
- KPI periodo calcolati correttamente dai totali
- Anomalie rilevate per dati noti (CLB settembre ha revenue_rooms negativi)
- Idempotenza: secondo upload → righe_aggiornate, nessuna duplicazione nel DB
- Upsert: modifica un record e ri-importa → valore aggiornato in DB
- Errori: hotel non valido → 400, file malformato → 422
"""

import os
import sys
import io
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.database import Base, get_db
from app.main import app
from app.models.revenue import DailyRevenue, ImportSession  # noqa: F401 — necessario per Base.metadata

UPLOADS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "uploads"))
TEST_DB_URL = "postgresql://ginoscola@localhost:5432/revenue_master_test"


def percorso(nome):
    return os.path.join(UPLOADS_DIR, nome)


# ---------------------------------------------------------------------------
# Fixture DB di test
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
        # Reinserisce gli hotel base (necessario perché la validazione ora usa il DB)
        conn.execute(text("""
            INSERT INTO hotels (code, name, default_rooms) VALUES
            ('CLB', 'Club Hotel', 45),
            ('DPH', 'Hotel Du Parc', 43),
            ('INT', 'Hotel International', 45)
        """))
        conn.commit()


def _conta_righe_db(test_engine, hotel_code: str) -> int:
    with test_engine.connect() as conn:
        return conn.execute(
            text("SELECT COUNT(*) FROM daily_revenue WHERE hotel_code = :hc"),
            {"hc": hotel_code},
        ).scalar()


def _leggi_riga_db(test_engine, hotel_code: str, data_str: str):
    """Restituisce il dizionario dei valori di una riga dal DB."""
    with test_engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT * FROM daily_revenue "
                "WHERE hotel_code = :hc AND data = :d"
            ),
            {"hc": hotel_code, "d": data_str},
        ).mappings().first()
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# Helper per aprire i file CSV come multipart/form-data
# ---------------------------------------------------------------------------

def _files_clb():
    return {
        "file1": ("CLB1.csv", open(percorso("PlanningForecast-CLB1.csv"), "rb"), "text/csv"),
        "file2": ("CLB2.csv", open(percorso("PlanningForecast-CLB2.csv"), "rb"), "text/csv"),
    }


def _files_dph():
    return {
        "file1": ("DPH1.csv", open(percorso("PlanningForecast-DPH1.csv"), "rb"), "text/csv"),
        "file2": ("DPH2.csv", open(percorso("PlanningForecast-DPH2.csv"), "rb"), "text/csv"),
    }


# ---------------------------------------------------------------------------
# Test: upload CLB — happy path
# ---------------------------------------------------------------------------

class TestUploadCLBHappyPath:
    def test_status_200(self, client):
        resp = client.post("/upload/coppia/CLB", files=_files_clb())
        assert resp.status_code == 200

    def test_hotel_code_nel_response(self, client):
        resp = client.post("/upload/coppia/CLB", files=_files_clb())
        assert resp.json()["hotel_code"] == "CLB"

    def test_righe_inserite_113(self, client):
        resp = client.post("/upload/coppia/CLB", files=_files_clb())
        j = resp.json()
        assert j["righe_inserite"] == 113
        assert j["righe_aggiornate"] == 0
        assert j["righe_importate"] == 113

    def test_righe_scartate_maggiore_di_zero(self, client):
        """I CSV contengono righe SDLY/LY che devono essere scartate."""
        resp = client.post("/upload/coppia/CLB", files=_files_clb())
        assert resp.json()["righe_scartate"] > 0

    def test_righe_lette_uguale_a_importate_piu_scartate(self, client):
        resp = client.post("/upload/coppia/CLB", files=_files_clb())
        j = resp.json()
        assert j["righe_lette"] == j["righe_importate"] + j["righe_scartate"] + j["righe_fuori_stagione"]

    def test_periodo_da_e_a(self, client):
        resp = client.post("/upload/coppia/CLB", files=_files_clb())
        j = resp.json()
        assert j["periodo_da"] == "2026-05-30"
        assert j["periodo_a"] == "2026-09-19"

    def test_dati_salvati_nel_db(self, client, test_engine):
        client.post("/upload/coppia/CLB", files=_files_clb())
        assert _conta_righe_db(test_engine, "CLB") == 113

    def test_valori_primo_giorno_in_db(self, client, test_engine):
        """Verifica che i valori del 30/05/2026 siano salvati correttamente."""
        client.post("/upload/coppia/CLB", files=_files_clb())
        riga = _leggi_riga_db(test_engine, "CLB", "2026-05-30")
        assert riga is not None
        assert riga["rooms_sold"] == 27
        assert riga["rooms_available"] == 45
        assert abs(riga["revenue_rooms"] - 1742.11) < 0.01
        assert abs(riga["revenue_fnb"] - 663.00) < 0.01
        assert abs(riga["revenue_extra"] - 54.00) < 0.01
        assert abs(riga["revenue_total"] - 2459.11) < 0.01

    def test_kpi_periodo_presente(self, client):
        resp = client.post("/upload/coppia/CLB", files=_files_clb())
        kpi = resp.json()["kpi_periodo"]
        assert kpi is not None
        assert kpi["rooms_sold"] > 0
        assert kpi["occupancy"] is not None
        assert kpi["adr"] is not None

    def test_kpi_periodo_occupancy_da_totali(self, client):
        """occupancy = rooms_sold_totali / rooms_available_totali * 100."""
        resp = client.post("/upload/coppia/CLB", files=_files_clb())
        kpi = resp.json()["kpi_periodo"]
        occ_attesa = kpi["rooms_sold"] / kpi["rooms_available"] * 100
        assert abs(kpi["occupancy"] - occ_attesa) < 0.001

    def test_kpi_periodo_incidenze_sommano_a_100(self, client):
        resp = client.post("/upload/coppia/CLB", files=_files_clb())
        kpi = resp.json()["kpi_periodo"]
        # inc_rooms + inc_fnb + inc_extra ≈ 100 se revenue_total > 0
        totale_inc = kpi["inc_rooms"] + kpi["inc_fnb"] + kpi["inc_extra"]
        assert abs(totale_inc - 100.0) < 0.1


# ---------------------------------------------------------------------------
# Test: anomalie CLB (revenue_rooms negativi in settembre)
# ---------------------------------------------------------------------------

class TestAnomalieClb:
    def test_anomalie_revenue_rooms_negativo(self, client):
        """CLB ha 8 giorni con RICAVI TRAT negativi in settembre."""
        resp = client.post("/upload/coppia/CLB", files=_files_clb())
        anomalie = resp.json()["anomalie"]
        neg = [a for a in anomalie if a["tipo"] == "revenue_rooms_negativo"]
        assert len(neg) == 8

    def test_anomalia_contiene_data_e_descrizione(self, client):
        resp = client.post("/upload/coppia/CLB", files=_files_clb())
        anomalie = resp.json()["anomalie"]
        neg = [a for a in anomalie if a["tipo"] == "revenue_rooms_negativo"]
        assert neg[0]["data"] is not None
        assert "€" in neg[0]["descrizione"]

    def test_dph_senza_anomalie_revenue_negativo(self, client):
        """DPH non ha revenue_rooms negativi."""
        resp = client.post("/upload/coppia/DPH", files=_files_dph())
        anomalie = resp.json()["anomalie"]
        neg = [a for a in anomalie if a["tipo"] == "revenue_rooms_negativo"]
        assert len(neg) == 0


# ---------------------------------------------------------------------------
# Test: idempotenza — secondo upload aggiorna senza duplicare
# ---------------------------------------------------------------------------

class TestIdempotenza:
    def test_secondo_upload_produce_righe_aggiornate(self, client):
        client.post("/upload/coppia/CLB", files=_files_clb())
        resp2 = client.post("/upload/coppia/CLB", files=_files_clb())
        j = resp2.json()
        assert j["righe_inserite"] == 0
        assert j["righe_aggiornate"] == 113

    def test_secondo_upload_non_duplica_nel_db(self, client, test_engine):
        client.post("/upload/coppia/CLB", files=_files_clb())
        client.post("/upload/coppia/CLB", files=_files_clb())
        assert _conta_righe_db(test_engine, "CLB") == 113

    def test_upsert_aggiorna_il_valore(self, client, test_engine):
        """
        Simula un aggiornamento: inserisce CLB poi modifica artificialmente un valore
        nel DB e verifica che il secondo upload lo sovrascriva con il valore corretto.
        """
        client.post("/upload/coppia/CLB", files=_files_clb())

        # Modifica manuale nel DB
        with test_engine.connect() as conn:
            conn.execute(
                text("UPDATE daily_revenue SET revenue_rooms = 9999.99 "
                     "WHERE hotel_code = 'CLB' AND data = '2026-05-30'")
            )
            conn.commit()

        # Verifica che il valore sia stato modificato
        riga_mod = _leggi_riga_db(test_engine, "CLB", "2026-05-30")
        assert abs(riga_mod["revenue_rooms"] - 9999.99) < 0.01

        # Secondo upload: deve ripristinare il valore originale
        client.post("/upload/coppia/CLB", files=_files_clb())
        riga_rest = _leggi_riga_db(test_engine, "CLB", "2026-05-30")
        assert abs(riga_rest["revenue_rooms"] - 1742.11) < 0.01


# ---------------------------------------------------------------------------
# Test: upload con filtro stagionale
# ---------------------------------------------------------------------------

class TestUploadConStagione:
    def _configura_stagione_clb(self, client):
        """Configura la stagione 2026 CLB: aperta dal 01/06."""
        client.post(
            "/hotels/CLB/seasons",
            json={
                "season_year": 2026,
                "open_date": "2026-06-01",
                "close_date": "2026-09-19",
                "total_rooms": 45,
            },
        )

    def test_filtro_stagionale_scarta_maggio(self, client):
        self._configura_stagione_clb(client)
        resp = client.post(
            "/upload/coppia/CLB?anno=2026",
            files=_files_clb(),
        )
        j = resp.json()
        # 30/05 e 31/05 fuori stagione → 111 inserite
        assert j["righe_inserite"] == 111
        assert j["righe_fuori_stagione"] == 2

    def test_periodo_da_con_filtro_stagionale(self, client):
        self._configura_stagione_clb(client)
        resp = client.post(
            "/upload/coppia/CLB?anno=2026",
            files=_files_clb(),
        )
        assert resp.json()["periodo_da"] == "2026-06-01"

    def test_warnings_presenti_per_date_scartate(self, client):
        self._configura_stagione_clb(client)
        resp = client.post(
            "/upload/coppia/CLB?anno=2026",
            files=_files_clb(),
        )
        assert len(resp.json()["warnings"]) == 2


# ---------------------------------------------------------------------------
# Test: casi di errore
# ---------------------------------------------------------------------------

class TestErrori:
    def test_hotel_non_valido_restituisce_400(self, client):
        """Hotel non presente nel DB → 400 con dettaglio che include il codice."""
        resp = client.post(
            "/upload/coppia/XYZ",
            files=_files_clb(),
        )
        assert resp.status_code == 400
        assert "XYZ" in resp.json()["detail"]

    def test_hotel_minuscolo_accettato(self, client):
        """Il codice hotel è case-insensitive."""
        resp = client.post("/upload/coppia/clb", files=_files_clb())
        assert resp.status_code == 200
        assert resp.json()["hotel_code"] == "CLB"

    def test_csv_malformato_restituisce_422(self, client):
        file_rotto = io.BytesIO(b"colonna_sbagliata;altra_colonna\n1;2\n")
        resp = client.post(
            "/upload/coppia/CLB",
            files={
                "file1": ("rotto.csv", file_rotto, "text/csv"),
                "file2": ("rotto.csv", io.BytesIO(b"colonna_sbagliata;altra_colonna\n1;2\n"), "text/csv"),
            },
        )
        assert resp.status_code == 422

    def test_csv_vuoto_restituisce_risposta_valida(self, client):
        """CSV con solo intestazione valida → nessuna riga, risposta 200 con 0 importate."""
        intestazione = b"DATA;EVENTI;CV;CP;PAX;RICAVI TRAT;EXTRA TRATT;ADR;RPAR;RMP;OCCUP\n"
        resp = client.post(
            "/upload/coppia/CLB",
            files={
                "file1": ("vuoto.csv", io.BytesIO(intestazione), "text/csv"),
                "file2": ("vuoto.csv", io.BytesIO(intestazione), "text/csv"),
            },
        )
        assert resp.status_code == 200
        j = resp.json()
        assert j["righe_importate"] == 0
        assert j["kpi_periodo"] is None


# ---------------------------------------------------------------------------
# Test: upload DPH completo — verifica contatori e DB
# ---------------------------------------------------------------------------

class TestUploadDPH:
    def test_dph_inserisce_142_righe(self, client, test_engine):
        resp = client.post("/upload/coppia/DPH", files=_files_dph())
        assert resp.status_code == 200
        assert resp.json()["righe_inserite"] == 142
        assert _conta_righe_db(test_engine, "DPH") == 142

    def test_dph_kpi_rooms_available_corretto(self, client):
        """DPH ha 43 camere × 142 giorni = 6106 room-nights disponibili."""
        resp = client.post("/upload/coppia/DPH", files=_files_dph())
        kpi = resp.json()["kpi_periodo"]
        assert kpi["rooms_available"] == 43 * 142

    def test_upload_clb_e_dph_non_si_sovrappongono(self, client, test_engine):
        """Upload di due hotel diversi non deve creare conflitti nel DB."""
        resp_clb = client.post("/upload/coppia/CLB", files=_files_clb())
        resp_dph = client.post("/upload/coppia/DPH", files=_files_dph())
        assert resp_clb.json()["righe_inserite"] == 113
        assert resp_dph.json()["righe_inserite"] == 142
        assert _conta_righe_db(test_engine, "CLB") == 113
        assert _conta_righe_db(test_engine, "DPH") == 142
        # Totale nel DB deve essere la somma
        with test_engine.connect() as conn:
            totale = conn.execute(text("SELECT COUNT(*) FROM daily_revenue")).scalar()
        assert totale == 113 + 142


# ---------------------------------------------------------------------------
# Test: auto-detect ordine file — file caricati in ordine inverso
# ---------------------------------------------------------------------------

class TestAutoDetectOrdineFile:
    def test_file_invertiti_produce_stessi_kpi(self, client):
        """
        Carica CLB con file1=CLB2 e file2=CLB1 (ordine invertito rispetto al normale).
        Il parser deve rilevare automaticamente quale ha i ricavi più alti e produrre
        gli stessi KPI di un upload con ordine corretto.
        """
        resp_corretto = client.post("/upload/coppia/CLB", files=_files_clb())
        kpi_corretto = resp_corretto.json()["kpi_periodo"]

        # Carica con file invertiti
        files_invertiti = {
            "file1": ("CLB2.csv", open(percorso("PlanningForecast-CLB2.csv"), "rb"), "text/csv"),
            "file2": ("CLB1.csv", open(percorso("PlanningForecast-CLB1.csv"), "rb"), "text/csv"),
        }
        resp_invertito = client.post("/upload/coppia/CLB", files=files_invertiti)
        kpi_invertito = resp_invertito.json()["kpi_periodo"]

        assert abs(kpi_corretto["adr"] - kpi_invertito["adr"]) < 0.01
        assert abs(kpi_corretto["occupancy"] - kpi_invertito["occupancy"]) < 0.001
        assert abs(kpi_corretto["inc_fnb"] - kpi_invertito["inc_fnb"]) < 0.01
