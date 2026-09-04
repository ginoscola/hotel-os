"""Test per GET /produzione/ricavi-camere e /produzione/ricavi-camere/export.

Fonte dati: prod_righe (registro Produzione), non i documenti fiscali di Corrispettivi.
Stesso DB di test degli altri suite (revenue_master_test); auth sovrascritta via
override diretto di richiedi_utente_attivo/richiedi_admin.
"""
import os
import sys
from datetime import date
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import Base, get_db
from app.main import app
from app.models.produzione import ProdCategoria, ProdImport, ProdRiga  # noqa: F401
from app.models.rooms import Room  # noqa: F401

TEST_DB_URL = "postgresql://ginoscola@localhost:5432/revenue_master_test"


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
    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    utente_finto = SimpleNamespace(id=None)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[richiedi_utente_attivo] = lambda: utente_finto
    app.dependency_overrides[richiedi_admin] = lambda: utente_finto
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def seed(test_engine, TestSession):
    with test_engine.connect() as conn:
        conn.execute(text(
            "TRUNCATE prod_righe, prod_imports, prod_dettaglio_categoria, prod_categorie, "
            "rooms, hotels RESTART IDENTITY CASCADE"
        ))
        conn.execute(text("""
            INSERT INTO hotels (code, name, default_rooms) VALUES
            ('DPH', 'Hotel Du Parc', 43), ('CLB', 'Club Hotel', 45), ('INT', 'Hotel International', 45)
        """))
        conn.execute(text("""
            INSERT INTO rooms (code, hotel_id, struttura_code, nome_tipo, attiva)
            SELECT 'D101', id, 'DPH', 'Comfort', true FROM hotels WHERE code='DPH'
            UNION ALL SELECT 'D102', id, 'DPH', 'Classic', true FROM hotels WHERE code='DPH'
            UNION ALL SELECT 'D999', id, 'DPH', 'Suite',  true FROM hotels WHERE code='DPH'
            UNION ALL SELECT 'C201', id, 'CLB', 'Standard', true FROM hotels WHERE code='CLB'
        """))
        conn.execute(text("""
            INSERT INTO prod_categorie (code, name, includi_report, ordine, attivo) VALUES
            ('alloggio',  'Alloggio',  true,  1, true),
            ('colazione', 'Colazione', true,  2, true),
            ('spiaggia',  'Spiaggia',  true,  8, true),
            ('escluso_pensione', 'Escluso', false, 90, true),
            ('altro',     'Altro',     true, 99, true)
        """))
        conn.commit()

    db = TestSession()
    try:
        cat = {c.code: c.id for c in db.query(ProdCategoria).all()}
        imp = ProdImport(nome_file="seed.xlsx", data_da=date(2026, 6, 1),
                         data_a=date(2026, 6, 30), n_righe_totali=0, n_righe_valide=0)
        db.add(imp)
        db.flush()

        def riga(oid, camera, sc, cat_code, tratt, lordo, imp_, iva, giorno=15,
                 riassetto=False, mese=6):
            return ProdRiga(
                import_id=imp.id, oid_welcome=oid,
                data_riferimento=date(2026, mese, giorno),
                struttura_code=sc, camera=camera, tipo_camera="X",
                categoria_id=cat[cat_code], dettaglio_originale="x",
                is_riassetto=riassetto, prezzo_lordo=lordo, prezzo_netto=lordo,
                imponibile=imp_, iva=iva, aliquota_pct=10, quantita=1,
                trattamento=tratt, is_test=False,
            )

        db.add_all([
            # D101 — 2 stay types
            riga(1, "D101", "DPH", "alloggio",  "Bed & Breakfast", 110.0, 100.0, 10.0),
            riga(2, "D101", "DPH", "colazione",  "Bed & Breakfast", 11.0,  10.0,  1.0),
            riga(3, "D101", "DPH", "alloggio",  "All-Inclusive",   220.0, 200.0, 20.0),
            riga(4, "D101", "DPH", "spiaggia",  "All-Inclusive",   55.0,  50.0,  5.0),
            # D102 — con riga riassetto (esclusa) ed escluso_pensione (esclusa)
            riga(5, "D102", "DPH", "alloggio",  "Mezza Pensione",  90.0,  81.82, 8.18),
            riga(6, "D102", "DPH", "altro",     None,               0.0,   0.0,   0.0, riassetto=True),
            riga(7, "D102", "DPH", "escluso_pensione", "Mezza Pensione", -25.0, -25.0, 0.0),
            # C201 — altro hotel, mese diverso (luglio) per test filtro date
            riga(8, "C201", "CLB", "alloggio",  "Bed & Breakfast", 130.0, 118.18, 11.82, mese=7),
        ])
        db.commit()
    finally:
        db.close()


def test_hotel_singolo_totali_e_scomposizione(client):
    r = client.get("/produzione/ricavi-camere",
                   params={"hotel_code": "DPH", "data_da": "2026-01-01", "data_a": "2026-12-31"})
    assert r.status_code == 200
    j = r.json()

    camere = {c["camera"]: c for c in j["camere"]}
    assert set(camere) == {"D101", "D102"}

    # D101: 110+11+220+55 = 396 lordo; riassetto/escluso non presenti qui
    d101 = camere["D101"]
    assert d101["totale"]["lordo"] == 396.0
    assert d101["totale"]["imponibile"] == 360.0
    # somma categorie == totale
    assert round(sum(v["lordo"] for v in d101["per_categoria"].values()), 2) == 396.0
    # somma trattamenti == totale
    assert round(sum(v["lordo"] for v in d101["per_trattamento"].values()), 2) == 396.0
    assert d101["per_categoria"]["alloggio"]["lordo"] == 330.0
    assert d101["per_trattamento"]["All-Inclusive"]["lordo"] == 275.0
    assert d101["per_trattamento"]["Bed & Breakfast"]["lordo"] == 121.0

    # D102: solo la riga alloggio 90 (riassetto e escluso_pensione esclusi)
    assert camere["D102"]["totale"]["lordo"] == 90.0

    # Totale hotel = 396 + 90
    assert j["totale"]["totale"]["lordo"] == 486.0
    assert j["data_range_disponibile"]["min"] == "2026-06-15"


def test_ordinamento_numerico_camera(client):
    j = client.get("/produzione/ricavi-camere",
                   params={"hotel_code": "DPH", "includi_zero": "true"}).json()
    # Ordine numerico per numero camera (prefisso hotel escluso): D101, D102, D999
    assert [c["camera"] for c in j["camere"]] == ["D101", "D102", "D999"]


def test_filtro_date_esclude_luglio(client):
    j = client.get("/produzione/ricavi-camere",
                   params={"hotel_code": "CLB", "data_da": "2026-06-01", "data_a": "2026-06-30"}).json()
    assert j["camere"] == []
    j2 = client.get("/produzione/ricavi-camere",
                    params={"hotel_code": "CLB", "data_da": "2026-07-01", "data_a": "2026-07-31"}).json()
    assert len(j2["camere"]) == 1 and j2["camere"][0]["camera"] == "C201"


def test_gruppo_aggrega_tutte_le_strutture(client):
    j = client.get("/produzione/ricavi-camere",
                   params={"hotel_code": "GRUPPO", "data_da": "2026-01-01", "data_a": "2026-12-31"}).json()
    assert j["is_gruppo"] is True
    strutture = {c["struttura_code"] for c in j["camere"]}
    assert strutture == {"DPH", "CLB"}
    assert j["totale"]["totale"]["lordo"] == 486.0 + 130.0


def test_includi_zero_aggiunge_camere_anagrafica(client):
    base = client.get("/produzione/ricavi-camere", params={"hotel_code": "DPH"}).json()
    con_zero = client.get("/produzione/ricavi-camere",
                          params={"hotel_code": "DPH", "includi_zero": "true"}).json()
    assert len(base["camere"]) == 2
    # D999 esiste in rooms ma non ha ricavi → compare solo con includi_zero
    camere_zero = {c["camera"] for c in con_zero["camere"]}
    assert "D999" in camere_zero
    d999 = next(c for c in con_zero["camere"] if c["camera"] == "D999")
    assert d999["totale"]["lordo"] == 0.0
    assert d999["tipo_camera"] == "Suite"


def test_hotel_code_non_valido(client):
    r = client.get("/produzione/ricavi-camere", params={"hotel_code": "XXX"})
    assert r.status_code == 400


@pytest.mark.parametrize("formato", ["xlsx", "csv", "pdf"])
@pytest.mark.parametrize("vista", ["categoria", "trattamento"])
def test_export_tutti_i_formati(client, formato, vista):
    r = client.get("/produzione/ricavi-camere/export",
                   params={"hotel_code": "GRUPPO", "vista": vista, "formato": formato, "lordo": "false"})
    assert r.status_code == 200
    assert len(r.content) > 100
    assert f".{formato}" in r.headers["content-disposition"]
