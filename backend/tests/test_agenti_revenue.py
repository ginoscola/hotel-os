"""
Riepilogo settimanale Revenue per gli agenti AI (GET /agenti/revenue/settimanale, v4.39.0).

Dati sintetici: due hotel fittizi (HA, HB) per 4 settimane commerciali (sab 01/08 → ven 28/08/2026),
snapshot S1 = 03/08 e S2 = 10/08. Tra S1 e S2: HA perde 1 camera/giorno nella settimana passata
01–07/08 (rettifica) e guadagna 2 camere/giorno dal 08/08 in poi (pick-up).
"""
import json
import os
import sys
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import Base, get_db
from app.main import app
from app.models.revenue import BudgetEntry, DailyRevenue, Hotel

from tests._db import TEST_DB_URL  # noqa: E402

GIORNI = [date(2026, 8, 1) + timedelta(days=i) for i in range(28)]
S1, S2 = date(2026, 8, 3), date(2026, 8, 10)
URL = "/agenti/revenue/settimanale"


@pytest.fixture(scope="module")
def test_engine():
    engine = create_engine(TEST_DB_URL)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture(scope="module")
def Sess(test_engine):
    return sessionmaker(bind=test_engine)


@pytest.fixture(scope="module")
def client(Sess):
    def override_get_db():
        db = Sess()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    utente = SimpleNamespace(id=None, ruolo="viewer")
    app.dependency_overrides[richiedi_admin] = lambda: utente
    app.dependency_overrides[richiedi_utente_attivo] = lambda: utente
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _riga(hotel, giorno, snapshot, camere, ricavo_camere, is_test=False):
    return DailyRevenue(
        hotel_code=hotel, data=giorno, snapshot_date=snapshot, is_test=is_test,
        rooms_sold=camere, rooms_available=40, pax=camere * 2,
        revenue_rooms=ricavo_camere, revenue_fnb=20.0, revenue_extra=5.0,
        revenue_total=ricavo_camere + 25.0,
    )


def _svuota(engine):
    with engine.connect() as conn:
        conn.execute(text("TRUNCATE daily_revenue, budget_entries, hotel_seasons, hotels, imports, "
                          "prenotazioni_cancellate, prenotazioni_cancellate_imports RESTART IDENTITY CASCADE"))
        conn.commit()


@pytest.fixture(autouse=True)
def dati(test_engine, Sess):
    _svuota(test_engine)
    s = Sess()
    s.add_all([Hotel(code="HA", name="Hotel A", default_rooms=40), Hotel(code="HB", name="Hotel B", default_rooms=40)])
    for g in GIORNI:
        passato = g < date(2026, 8, 8)
        s.add(_riga("HA", g, S1, 10, 1000.0))
        s.add(_riga("HA", g, S2, 9 if passato else 12, 900.0 if passato else 1300.0))
        s.add(_riga("HB", g, S1, 20, 1500.0))
        s.add(_riga("HB", g, S2, 20, 1500.0))
    s.commit()
    s.close()
    yield
    _svuota(test_engine)


def _get(client, **params):
    r = client.get(URL, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_default_ultima_contro_penultima(client):
    d = _get(client)
    assert d["meta"]["snapshot"] == S2.isoformat()
    assert d["meta"]["snapshot_confronto"] == S1.isoformat()
    assert d["meta"]["hotel"] == ["HA", "HB"]
    assert d["avvisi"] == []


def test_snapshot_di_test_ignorata(client, Sess):
    s = Sess()
    s.add(_riga("HA", GIORNI[0], date(2026, 8, 20), 1, 1.0, is_test=True))
    s.commit()
    s.close()
    assert _get(client)["meta"]["snapshot"] == S2.isoformat()


def test_pickup_gruppo_e_hotel(client):
    d = _get(client)
    # HA: −1 camera × 7 giorni passati, +2 × 21 giorni futuri = +35; HB invariato
    assert d["gruppo"]["pickup"]["camere"] == 35
    ha = next(h for h in d["hotel"] if h["hotel_code"] == "HA")
    hb = next(h for h in d["hotel"] if h["hotel_code"] == "HB")
    assert ha["pickup"]["camere"] == 35
    assert ha["pickup"]["revenue_rooms"] == pytest.approx(-100 * 7 + 300 * 21)
    assert hb["pickup"]["camere"] == 0
    # KPI sui totali: ricavi camere in valore assoluto anche per il gruppo
    assert d["gruppo"]["kpi"]["revenue_rooms"] == pytest.approx(900 * 7 + 1300 * 21 + 1500 * 28)
    assert d["gruppo"]["kpi"]["camere_residue"] == 40 * 28 * 2 - d["gruppo"]["kpi"]["rooms_sold"]


def test_settimane_future_e_rettifiche_quadrano(client):
    d = _get(client)
    assert [s["week_start"] for s in d["settimane_future"]] == ["2026-08-08", "2026-08-15", "2026-08-22"]
    assert d["settimane_future"][0]["in_corso"] is True
    assert d["settimane_future"][1]["in_corso"] is False
    assert [s["week_start"] for s in d["rettifiche_passato"]] == ["2026-08-01"]
    rett = d["rettifiche_passato"][0]
    assert rett["variazione"]["camere"] == -7
    assert [h["hotel_code"] for h in rett["hotel"]] == ["HA"]
    somma = (sum(s["gruppo"]["pickup"]["revenue_total"] for s in d["settimane_future"])
             + sum(r["variazione"]["revenue_total"] for r in d["rettifiche_passato"]))
    assert somma == pytest.approx(d["gruppo"]["pickup"]["revenue_total"])


def test_risposta_compatta_senza_serie_giornaliere(client):
    testo = json.dumps(_get(client))
    assert '"giorni"' not in testo
    assert len(testo) < 30_000


def test_budget_assente_dichiarato(client):
    d = _get(client)
    assert d["meta"]["budget_disponibile"] is False
    assert "Nessun budget 2026" in d["meta"]["motivo_budget"]
    assert d["gruppo"]["vs_budget"] is None


def test_budget_parziale(client, Sess):
    s = Sess()
    ha = s.query(Hotel).filter_by(code="HA").one()
    s.add(BudgetEntry(hotel_id=ha.id, season_year=2026, week_start=date(2026, 8, 15), version="v1",
                      rooms_sold_budget=70, rooms_available_budget=280, revenue_rooms_budget=7000,
                      revenue_fnb_budget=140, revenue_extra_budget=35, revenue_total_budget=7175))
    s.commit()
    s.close()
    d = _get(client)
    assert d["meta"]["budget_disponibile"] is True and d["meta"]["budget_hotel"] == ["HA"]
    assert d["gruppo"]["vs_budget"]["hotel_inclusi"] == ["HA"]
    # OTB HA settimana 15/08: 12 camere × 7 = 84 contro 70 a budget
    assert d["gruppo"]["vs_budget"]["scostamento"]["camere"] == 14
    sett = next(x for x in d["settimane_future"] if x["week_start"] == "2026-08-15")
    voce_ha = next(h for h in sett["hotel"] if h["hotel_code"] == "HA")
    voce_hb = next(h for h in sett["hotel"] if h["hotel_code"] == "HB")
    assert voce_ha["vs_budget"]["scostamento"]["camere"] == 14
    assert voce_hb["vs_budget"] is None


def test_anno_precedente(client, Sess):
    d = _get(client)
    assert d["meta"]["anno_precedente_disponibile"] is False and d["gruppo"]["vs_anno_precedente"] is None
    snap_ap = S2 - timedelta(days=364)
    s = Sess()
    for g in GIORNI:
        s.add(_riga("HA", g - timedelta(days=364), snap_ap, 5, 500.0))
    s.commit()
    s.close()
    d = _get(client)
    assert d["meta"]["snapshot_anno_precedente"] == snap_ap.isoformat()
    ha = next(h for h in d["hotel"] if h["hotel_code"] == "HA")
    assert ha["vs_anno_precedente"]["anno_precedente"]["rooms_sold"] == 5 * 28
    sett = next(x for x in d["settimane_future"] if x["week_start"] == "2026-08-15")
    voce_ha = next(h for h in sett["hotel"] if h["hotel_code"] == "HA")
    assert voce_ha["vs_anno_precedente"]["differenza"]["camere"] == (12 - 5) * 7
    # l'anno precedente non deve diventare la snapshot di confronto del pick-up
    assert d["meta"]["snapshot_confronto"] == S1.isoformat()


def test_hotel_mancante_nel_confronto(client, Sess):
    s = Sess()
    s.query(DailyRevenue).filter_by(hotel_code="HB", snapshot_date=S1).delete()
    s.commit()
    s.close()
    d = _get(client)
    assert any("HB" in a for a in d["avvisi"])
    assert d["gruppo"]["pickup"] is None
    hb = next(h for h in d["hotel"] if h["hotel_code"] == "HB")
    assert hb["pickup"] is None
    assert next(h for h in d["hotel"] if h["hotel_code"] == "HA")["pickup"]["camere"] == 35


def test_parametri_espliciti_ed_errori(client):
    d = _get(client, snapshot=S1.isoformat())
    assert d["meta"]["snapshot_confronto"] is None and d["gruppo"]["pickup"] is None
    assert client.get(URL, params={"snapshot": "2026-01-01"}).status_code == 404
    assert client.get(URL, params={"snapshot": S1.isoformat(), "confronto": S2.isoformat()}).status_code == 400


def test_nessun_dato(client, test_engine):
    _svuota(test_engine)
    assert client.get(URL).status_code == 404
