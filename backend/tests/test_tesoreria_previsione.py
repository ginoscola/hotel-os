"""Test della previsione di cassa: calcoli puri (riferimento, Budget, crescita, doppi conteggi, scenari, fido) e API."""
import os
import sys
from datetime import date
from decimal import Decimal as D
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

from app.auth import richiedi_admin, richiedi_utente_attivo  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.services.tesoreria_previsione import (  # noqa: E402
    Certa, DatiPrevisione, calcola_scenario, fattore_budget, parametri_default, stima_altri_crediti,
)

from tests._db import TEST_DB_URL  # noqa: E402

ADMIN = SimpleNamespace(id=None, ruolo="admin")
VIEWER = SimpleNamespace(id=None, ruolo="viewer")
utente_corrente = {"u": ADMIN}


def _dati(**extra):
    base = dict(
        oggi=date(2026, 12, 15), orizzonte=date(2027, 3, 31), saldo_iniziale=D("1000"),
        entrate={(2026, 1): D("100"), (2026, 2): D("200"), (2026, 3): D("300"), (2025, 12): D("50")},
        uscite={"personale": {(2026, 1): D("10")}, "fornitori_riba": {(2026, 2): D("100")}, "assegni": {(2025, 1): D("999")}},
        certe=[], budget={2027: D("1200")}, ricavi={2026: D("1000")},
    )
    return DatiPrevisione(**{**base, **extra})


def _mese(righe, m):
    return next(r for r in righe if r["mese"] == m)


def test_fattore_budget():
    assert fattore_budget(2027, {2027: D("1200")}, {2026: D("1000")}) == D("1.2")
    assert fattore_budget(2026, {2027: D("1200")}, {2026: D("1000")}) == 1


def test_entrate_seguono_il_ritmo_della_banca_scalato_sul_budget():
    r = calcola_scenario(_dati(), "realista")
    assert _mese(r, 1)["entrate"] == D("120")
    assert _mese(r, 3)["entrate"] == D("360")


def test_categoria_senza_spese_non_ripesca_anni_vecchi():
    gennaio = _mese(calcola_scenario(_dati(), "realista"), 1)
    assert gennaio["uscite_stimate"]["fornitori"] == 0      # non i 999 di assegni del 2025


def test_crescita_segue_il_budget_o_la_percentuale_scelta():
    r = calcola_scenario(_dati(), "realista")
    assert _mese(r, 2)["uscite_stimate"]["fornitori"] == D("120")   # come il Budget
    assert _mese(r, 1)["uscite_stimate"]["personale"] == D("10")    # 0% di default
    p = parametri_default()
    p["crescita"]["personale"] = 5
    p["crescita"]["fornitori"] = 10
    r = calcola_scenario(_dati(parametri=p), "realista")
    assert _mese(r, 1)["uscite_stimate"]["personale"] == D("10.50")
    assert _mese(r, 2)["uscite_stimate"]["fornitori"] == D("110.0")


def test_scadenzario_e_ricorrenti_non_contati_due_volte():
    certe = [Certa(date(2027, 2, 10), D("70"), "fornitori", "fornitori_bonifici"),
             Certa(date(2027, 1, 5), D("4"), "ricorrenti", "personale")]
    r = calcola_scenario(_dati(certe=certe), "realista")
    febbraio = _mese(r, 2)
    assert febbraio["totale_certe"] == D("70")
    assert febbraio["uscite_stimate"]["fornitori"] == D("50")       # 120 − 70
    assert _mese(r, 1)["uscite_stimate"]["personale"] == D("6")


def test_mese_in_corso_toglie_quanto_gia_avvenuto():
    d = _dati(entrate={(2025, 12): D("500"), (2026, 12): D("100")}, uscite={"utenze": {(2025, 12): D("80"), (2026, 12): D("30")}})
    dicembre = _mese(calcola_scenario(d, "realista"), 12)
    assert dicembre["entrate"] == D("400") and dicembre["uscite_stimate"]["utenze"] == D("50")


def test_scaduto_entra_nel_mese_in_corso():
    d = _dati(certe=[Certa(date(2026, 10, 1), D("40"), "fornitori")])
    assert _mese(calcola_scenario(d, "realista"), 12)["totale_certe"] == D("40")


def test_scenari():
    real = _mese(calcola_scenario(_dati(), "realista"), 2)
    pess = _mese(calcola_scenario(_dati(), "pessimista"), 2)
    ott = _mese(calcola_scenario(_dati(), "ottimista"), 2)
    assert pess["entrate"] == real["entrate"] * D("0.9") and ott["entrate"] == real["entrate"] * D("1.05")
    assert pess["uscite_stimate"]["fornitori"] == D("126")
    assert pess["saldo_finale"] < real["saldo_finale"] < ott["saldo_finale"]


def test_fido_vale_fino_alla_scadenza_e_cassa_libera():
    d = _dati(saldo_iniziale=D("-500"), entrate={}, uscite={}, fidi=[(D("600"), date(2027, 1, 31))],
              certe=[Certa(date(2027, 2, 15), D("30"), "fisco")])
    r = calcola_scenario(d, "realista")
    assert _mese(r, 1)["stato"] == "sotto_zero" and _mese(r, 1)["fido"] == D("600")
    assert _mese(r, 2)["stato"] == "sotto_fido" and _mese(r, 2)["fido"] == 0
    assert _mese(r, 1)["cassa_libera"] == D("-530")


def test_altri_crediti_dall_anno_prima():
    storico = {(2025, 11): D("10"), (2026, 9): D("20")}
    assert stima_altri_crediti(storico, 2027, 9) == D("20")
    assert stima_altri_crediti(storico, 2027, 11) == D("10")
    assert stima_altri_crediti(storico, 2027, 1) == 0


# ── API ─────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def test_engine():
    engine = create_engine(TEST_DB_URL)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture(scope="module")
def client(test_engine):
    Sessione = sessionmaker(bind=test_engine)

    def override_get_db():
        db = Sessione()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[richiedi_utente_attivo] = lambda: utente_corrente["u"]
    app.dependency_overrides[richiedi_admin] = lambda: utente_corrente["u"]
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def pulisci(test_engine):
    utente_corrente["u"] = ADMIN
    with test_engine.begin() as conn:
        conn.execute(text("TRUNCATE tesoreria_impegni, tesoreria_movimenti, tesoreria_saldi, tesoreria_categorie, tesoreria_conti, "
                          "tesoreria_scadenze, tesoreria_scad_import, app_config, user_module_permissions, module_permissions, modules, users "
                          "RESTART IDENTITY CASCADE"))
        conn.execute(text("INSERT INTO modules (code, name, ordine, attivo) VALUES ('tesoreria', 'TESORERIA', 30, true)"))
        conn.execute(text("""
            INSERT INTO module_permissions (module_code, ruolo, puo_vedere, puo_modificare, puo_importare)
            VALUES ('tesoreria', 'admin', true, true, true), ('tesoreria', 'viewer', true, false, false)
        """))


def test_previsione_risponde_con_tre_scenari(client):
    client.put("/tesoreria/impegni/parametri", json={"orizzonte": f"{date.today().year + 1}-12-31"})
    r = client.get("/tesoreria/previsione")
    assert r.status_code == 200, r.text
    assert set(r.json()["scenari"]) == {"pessimista", "realista", "ottimista"}
    assert r.json()["scenari"]["realista"][0]["saldo_iniziale"] == 0


def test_parametri_salvati_e_validati(client):
    r = client.put("/tesoreria/previsione/parametri", json={"crescita": {"personale": 3.5, "marketing": None}, "scenari": {"pessimista": {"incassi_pct": -15}}})
    assert r.status_code == 200, r.text
    p = client.get("/tesoreria/previsione/parametri").json()
    assert p["crescita"]["personale"] == 3.5 and p["scenari"]["pessimista"]["incassi_pct"] == -15
    assert p["scenari"]["pessimista"]["uscite_stimate_pct"] == 5
    assert client.put("/tesoreria/previsione/parametri", json={"crescita": {"boh": 1}}).status_code == 400
    assert client.put("/tesoreria/previsione/parametri", json={"scenari": {"pessimista": {"incassi_pct": "x"}}}).status_code == 400


def test_altri_crediti_riducono_il_da_pagare_prima_del_credito_iva(client):
    anno = date.today().year + 1
    client.put("/tesoreria/impegni/parametri", json={
        "orizzonte": f"{anno}-03-31", "altri_crediti_f24": {f"{anno - 1}-03": 30},
        "crediti_iva": [{"importo": 50, "disponibile_dal": "2020-01-01"}],
        "f24_storico": {f"{anno - 1}-02": 100},
    })
    client.post("/tesoreria/impegni/genera")
    i = {x["codice"]: x for x in client.get("/tesoreria/impegni").json()["impegni"]}[f"f24_dipendenti:{anno}-02"]
    assert (i["importo"], i["coperto_altri"], i["coperto_credito"], i["da_pagare"]) == (100, 30, 50, 20)


def test_permessi(client):
    utente_corrente["u"] = VIEWER
    assert client.get("/tesoreria/previsione/parametri").status_code == 200
    assert client.put("/tesoreria/previsione/parametri", json={}).status_code == 403
