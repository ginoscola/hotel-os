"""
Test per services/kpi_calculator.py

Verifica:
- Formule matematiche di ogni singolo KPI
- Divisione per zero → None (mai eccezione)
- Incidenze percentuali coerenti con i ricavi totali
- calcola_kpi con valori reali dal CSV CLB
"""

import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.kpi_calculator import (
    KPICalcolati, TotaliRighe, aggrega_totali_righe, calcola_kpi, kpi_da_riga, _safe_div,
)
from app.services.file_parser import ParserCSV, RigaRevenue
from datetime import date

UPLOADS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads")


def _riga(hotel="CLB", giorno=1, rooms_sold=20, rooms_available=45,
          revenue_rooms=1000.0, revenue_fnb=300.0, revenue_extra=50.0, revenue_total=1350.0):
    return RigaRevenue(
        hotel_code=hotel,
        data=date(2026, 6, giorno),
        rooms_sold=rooms_sold,
        rooms_available=rooms_available,
        pax=0,
        revenue_rooms=revenue_rooms,
        revenue_fnb=revenue_fnb,
        revenue_extra=revenue_extra,
        revenue_total=revenue_total,
    )


def percorso(nome):
    return os.path.join(UPLOADS_DIR, nome)


# ---------------------------------------------------------------------------
# Test aggrega_totali_righe
# ---------------------------------------------------------------------------

class TestAggregatTotaliRighe:
    def test_somme_corrette(self):
        righe = [_riga(giorno=1), _riga(giorno=2, rooms_sold=22, revenue_rooms=1100.0, revenue_fnb=320.0, revenue_extra=0.0, revenue_total=1420.0)]
        t = aggrega_totali_righe(righe)
        assert t.rooms_sold == 42
        assert t.rooms_available == 90
        assert t.revenue_rooms == pytest.approx(2100.0)
        assert t.revenue_fnb == pytest.approx(620.0)
        assert t.revenue_extra == pytest.approx(50.0)
        assert t.revenue_total == pytest.approx(2770.0)

    def test_lista_vuota(self):
        t = aggrega_totali_righe([])
        assert t.rooms_sold == 0
        assert t.rooms_available == 0
        assert t.revenue_total == 0.0

    def test_coerente_con_calcola_kpi_diretto(self):
        """aggrega_totali_righe + calcola_kpi deve dare lo stesso risultato del calcolo manuale."""
        righe = [_riga(giorno=1), _riga(giorno=2, rooms_sold=22, revenue_rooms=1100.0, revenue_fnb=320.0, revenue_extra=0.0, revenue_total=1420.0)]
        t = aggrega_totali_righe(righe)
        kpi_via_aggrega = calcola_kpi(t.rooms_sold, t.rooms_available, t.revenue_rooms, t.revenue_fnb, t.revenue_extra, t.revenue_total)
        kpi_diretto = calcola_kpi(42, 90, 2100.0, 620.0, 50.0, 2770.0)
        assert kpi_via_aggrega.occupancy == pytest.approx(kpi_diretto.occupancy)
        assert kpi_via_aggrega.adr == pytest.approx(kpi_diretto.adr)
        assert kpi_via_aggrega.revpar == pytest.approx(kpi_diretto.revpar)

    def test_singola_riga_uguale_a_kpi_da_riga(self):
        """Con una sola riga, aggrega_totali_righe deve produrre gli stessi input di kpi_da_riga."""
        r = _riga()
        t = aggrega_totali_righe([r])
        kpi_aggrega = calcola_kpi(t.rooms_sold, t.rooms_available, t.revenue_rooms, t.revenue_fnb, t.revenue_extra, t.revenue_total)
        kpi_diretta = kpi_da_riga(r)
        assert kpi_aggrega.occupancy == pytest.approx(kpi_diretta.occupancy)
        assert kpi_aggrega.adr == pytest.approx(kpi_diretta.adr)


# ---------------------------------------------------------------------------
# Test funzione di divisione sicura
# ---------------------------------------------------------------------------

class TestSafeDiv:
    def test_divisione_normale(self):
        assert _safe_div(10.0, 2.0) == pytest.approx(5.0)

    def test_denominatore_zero(self):
        assert _safe_div(10.0, 0.0) is None

    def test_denominatore_negativo(self):
        # rooms_available negativo non ha senso fisico → None
        assert _safe_div(10.0, -1.0) is None

    def test_numeratore_zero(self):
        assert _safe_div(0.0, 5.0) == pytest.approx(0.0)

    def test_numeratore_negativo(self):
        # revenue_rooms negativo è possibile nel forecast (correzioni)
        assert _safe_div(-100.0, 10.0) == pytest.approx(-10.0)


# ---------------------------------------------------------------------------
# Test calcola_kpi: divisione per zero
# ---------------------------------------------------------------------------

class TestKPIDivisionePerZero:
    def test_rooms_available_zero_rende_occupancy_none(self):
        kpi = calcola_kpi(0, 0, 0, 0, 0, 0)
        assert kpi.occupancy is None
        assert kpi.revpar is None
        assert kpi.trevpar is None

    def test_rooms_sold_zero_rende_adr_none(self):
        kpi = calcola_kpi(0, 45, 0, 0, 0, 0)
        assert kpi.adr is None
        assert kpi.rmc is None
        assert kpi.fnb_per_camera is None
        assert kpi.extra_per_camera is None

    def test_revenue_total_zero_rende_incidenze_none(self):
        kpi = calcola_kpi(10, 45, 0, 0, 0, 0)
        assert kpi.inc_fnb is None
        assert kpi.inc_rooms is None
        assert kpi.inc_extra is None

    def test_dati_parziali_non_bloccano_altri_kpi(self):
        """Con rooms_sold=0 ma rooms_available>0, revpar è calcolabile."""
        kpi = calcola_kpi(0, 45, 100, 0, 0, 100)
        assert kpi.adr is None          # rooms_sold = 0
        assert kpi.revpar is not None   # rooms_available > 0
        assert kpi.occupancy is not None


# ---------------------------------------------------------------------------
# Test formule matematiche
# ---------------------------------------------------------------------------

class TestFormuleKPI:
    """Valori del primo giorno CLB (30/05/2026) verificati dai CSV reali."""

    @pytest.fixture
    def kpi_clb_30maggio(self):
        # rooms_sold=27, rooms_available=45
        # revenue_rooms=1773.69, revenue_fnb=765.00, revenue_extra=87.00, revenue_total=2625.69
        return calcola_kpi(
            rooms_sold=27,
            rooms_available=45,
            revenue_rooms=1773.69,
            revenue_fnb=765.00,
            revenue_extra=87.00,
            revenue_total=2625.69,
        )

    def test_occupancy(self, kpi_clb_30maggio):
        # 27/45 * 100 = 60.0
        assert kpi_clb_30maggio.occupancy == pytest.approx(60.0)

    def test_adr(self, kpi_clb_30maggio):
        # 1773.69 / 27 = 65.692...
        assert kpi_clb_30maggio.adr == pytest.approx(1773.69 / 27, rel=1e-4)

    def test_revpar(self, kpi_clb_30maggio):
        # 1773.69 / 45 = 39.415...
        assert kpi_clb_30maggio.revpar == pytest.approx(1773.69 / 45, rel=1e-4)

    def test_trevpar(self, kpi_clb_30maggio):
        # 2625.69 / 45 = 58.349...
        assert kpi_clb_30maggio.trevpar == pytest.approx(2625.69 / 45, rel=1e-4)

    def test_rmc(self, kpi_clb_30maggio):
        # 2625.69 / 27 = 97.248...
        assert kpi_clb_30maggio.rmc == pytest.approx(2625.69 / 27, rel=1e-4)

    def test_inc_fnb(self, kpi_clb_30maggio):
        # 765.00 / 2625.69 * 100
        assert kpi_clb_30maggio.inc_fnb == pytest.approx(765.0 / 2625.69 * 100, rel=1e-4)

    def test_inc_rooms(self, kpi_clb_30maggio):
        assert kpi_clb_30maggio.inc_rooms == pytest.approx(1773.69 / 2625.69 * 100, rel=1e-4)

    def test_inc_extra(self, kpi_clb_30maggio):
        assert kpi_clb_30maggio.inc_extra == pytest.approx(87.0 / 2625.69 * 100, rel=1e-4)

    def test_fnb_per_camera(self, kpi_clb_30maggio):
        assert kpi_clb_30maggio.fnb_per_camera == pytest.approx(765.0 / 27, rel=1e-4)

    def test_extra_per_camera(self, kpi_clb_30maggio):
        assert kpi_clb_30maggio.extra_per_camera == pytest.approx(87.0 / 27, rel=1e-4)

    def test_incidenze_sommano_a_100(self, kpi_clb_30maggio):
        """inc_fnb + inc_rooms + inc_extra deve essere circa 100%."""
        totale = (
            kpi_clb_30maggio.inc_fnb
            + kpi_clb_30maggio.inc_rooms
            + kpi_clb_30maggio.inc_extra
        )
        assert totale == pytest.approx(100.0, abs=0.001)

    def test_occupancy_100_quando_tutto_occupato(self):
        kpi = calcola_kpi(43, 43, 1000, 200, 50, 1250)
        assert kpi.occupancy == pytest.approx(100.0)

    def test_occupancy_intervallo_valido(self):
        """occupancy deve stare in [0, 100]."""
        kpi = calcola_kpi(20, 45, 800, 100, 0, 900)
        assert kpi.occupancy is not None
        assert 0.0 <= kpi.occupancy <= 100.0


# ---------------------------------------------------------------------------
# Test kpi_da_riga con dati reali
# ---------------------------------------------------------------------------

class TestKPIDaRiga:
    @pytest.fixture
    def prima_riga_clb(self):
        parser = ParserCSV("CLB")
        righe = parser.parse_coppia(
            percorso("PlanningForecast-CLB1.csv"),
            percorso("PlanningForecast-CLB2.csv"),
        )
        return next(r for r in righe if r.data == date(2026, 5, 30))

    def test_kpi_da_riga_occupancy(self, prima_riga_clb):
        kpi = kpi_da_riga(prima_riga_clb)
        assert kpi.occupancy == pytest.approx(60.0)

    def test_kpi_da_riga_adr(self, prima_riga_clb):
        kpi = kpi_da_riga(prima_riga_clb)
        assert kpi.adr == pytest.approx(1742.11 / 27, rel=1e-4)

    def test_kpi_da_riga_uguale_a_calcola_kpi(self, prima_riga_clb):
        """kpi_da_riga e calcola_kpi devono dare lo stesso risultato."""
        kpi_riga = kpi_da_riga(prima_riga_clb)
        kpi_diretto = calcola_kpi(
            prima_riga_clb.rooms_sold,
            prima_riga_clb.rooms_available,
            prima_riga_clb.revenue_rooms,
            prima_riga_clb.revenue_fnb,
            prima_riga_clb.revenue_extra,
            prima_riga_clb.revenue_total,
        )
        assert kpi_riga.occupancy == kpi_diretto.occupancy
        assert kpi_riga.adr == kpi_diretto.adr
        assert kpi_riga.revpar == kpi_diretto.revpar


# ---------------------------------------------------------------------------
# Test su tutti i dati reali: invarianti su ogni riga
# ---------------------------------------------------------------------------

class TestInvariantiSuDatiReali:
    @pytest.fixture(scope="class")
    def tutte_le_righe(self):
        righe = []
        for codice in ("CLB", "DPH", "INT"):
            parser = ParserCSV(codice)
            righe += parser.parse_coppia(
                percorso(f"PlanningForecast-{codice}1.csv"),
                percorso(f"PlanningForecast-{codice}2.csv"),
            )
        return righe

    def test_occupancy_mai_superiore_a_100(self, tutte_le_righe):
        for r in tutte_le_righe:
            kpi = kpi_da_riga(r)
            if kpi.occupancy is not None:
                assert kpi.occupancy <= 100.0 + 1e-6, (
                    f"{r.hotel_code} {r.data}: occupancy={kpi.occupancy:.2f}%"
                )

    def test_incidenze_sommano_a_100_quando_revenue_positive(self, tutte_le_righe):
        """Dove revenue_total > 0, le tre incidenze devono sommare a 100."""
        for r in tutte_le_righe:
            if r.revenue_total <= 0:
                continue
            kpi = kpi_da_riga(r)
            if None in (kpi.inc_fnb, kpi.inc_rooms, kpi.inc_extra):
                continue
            totale = kpi.inc_fnb + kpi.inc_rooms + kpi.inc_extra
            assert totale == pytest.approx(100.0, abs=0.01), (
                f"{r.hotel_code} {r.data}: sum_incidenze={totale:.4f}"
            )

    def test_adr_maggiore_di_revpar_quando_occupancy_inferiore_a_100(self, tutte_le_righe):
        """ADR >= RevPAR sempre (ADR = RevPAR solo al 100% di occupazione)."""
        for r in tutte_le_righe:
            if r.revenue_rooms <= 0:
                continue
            kpi = kpi_da_riga(r)
            if kpi.adr is None or kpi.revpar is None:
                continue
            assert kpi.adr >= kpi.revpar - 1e-6, (
                f"{r.hotel_code} {r.data}: ADR={kpi.adr:.2f} < RevPAR={kpi.revpar:.2f}"
            )

    def test_trevpar_maggiore_di_revpar_quando_extra_o_fnb(self, tutte_le_righe):
        """TRevPAR >= RevPAR sempre (TRevPAR include anche F&B ed extra)."""
        for r in tutte_le_righe:
            kpi = kpi_da_riga(r)
            if kpi.trevpar is None or kpi.revpar is None:
                continue
            assert kpi.trevpar >= kpi.revpar - 1e-6, (
                f"{r.hotel_code} {r.data}: TRevPAR={kpi.trevpar:.2f} < RevPAR={kpi.revpar:.2f}"
            )
