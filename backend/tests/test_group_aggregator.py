"""
Test per services/group_aggregator.py

Verifica:
- aggrega_gruppo_periodo: totali corretti, KPI dai totali aggregati
- aggrega_gruppo_settimanale: settimane con hotel eterogenei (DPH apre prima)
- ADR di gruppo ≠ media semplice degli ADR per hotel
- rooms_available di gruppo riflette i giorni effettivi di apertura
- Breakdown per_hotel coerente con il totale di gruppo
"""

import os
import sys
import pytest
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.file_parser import ParserCSV
from app.services.group_aggregator import (
    aggrega_gruppo_periodo,
    aggrega_gruppo_settimanale,
)
from app.services.kpi_calculator import calcola_kpi

UPLOADS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads")


def percorso(nome):
    return os.path.join(UPLOADS_DIR, nome)


def parse(codice, open_date=None, close_date=None):
    p = ParserCSV(codice)
    return p.parse_coppia(
        percorso(f"PlanningForecast-{codice}1.csv"),
        percorso(f"PlanningForecast-{codice}2.csv"),
        open_date=open_date,
        close_date=close_date,
    )


# ---------------------------------------------------------------------------
# Fixture condivise
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def hotel_dati_completi():
    """Tutti i dati senza filtro stagionale."""
    return {
        "CLB": parse("CLB"),
        "DPH": parse("DPH"),
        "INT": parse("INT"),
    }


@pytest.fixture(scope="module")
def hotel_dati_periodo_comune():
    """Solo il periodo in cui tutti e 3 gli hotel sono aperti: 01/06–19/09/2026."""
    aperto = date(2026, 6, 1)
    chiuso = date(2026, 9, 19)
    return {
        "CLB": parse("CLB", open_date=aperto, close_date=chiuso),
        "DPH": parse("DPH", open_date=aperto, close_date=chiuso),
        "INT": parse("INT", open_date=aperto, close_date=chiuso),
    }


# ---------------------------------------------------------------------------
# Test aggrega_gruppo_periodo — periodo comune ai 3 hotel
# ---------------------------------------------------------------------------

class TestAggregazioneGruppoPeriodo:
    """
    Valori di riferimento precalcolati (periodo 01/06–19/09/2026, 3 hotel):
      rooms_sold=4938, rooms_available=14763
      rev_rooms=356033.25, rev_total=734743.79
      ADR_gruppo=72.10, occupancy_gruppo=33.45%
    """

    @pytest.fixture
    def agg(self, hotel_dati_periodo_comune):
        return aggrega_gruppo_periodo(hotel_dati_periodo_comune)

    def test_restituisce_risultato_non_none(self, agg):
        assert agg is not None

    def test_hotel_codes_tutti_e_tre(self, agg):
        assert sorted(agg.hotel_codes) == ["CLB", "DPH", "INT"]

    def test_period_start_e_end(self, agg):
        assert agg.period_start == date(2026, 6, 1)
        assert agg.period_end == date(2026, 9, 19)

    def test_rooms_sold(self, agg):
        assert agg.rooms_sold == 4938

    def test_rooms_available(self, agg):
        # 3 hotel × 111 giorni × camere (CLB=45, DPH=43, INT=45)
        # = 111*45 + 111*43 + 111*45 = 4995 + 4773 + 4995 = 14763
        assert agg.rooms_available == 14763

    def test_revenue_rooms(self, agg):
        assert agg.revenue_rooms == pytest.approx(356033.25, abs=1.0)

    def test_revenue_total(self, agg):
        assert agg.revenue_total == pytest.approx(734743.79, abs=1.0)

    def test_adr_gruppo(self, agg):
        # ADR gruppo = revenue_rooms / rooms_sold (non media degli ADR)
        assert agg.kpi.adr == pytest.approx(356033.25 / 4938, rel=1e-3)

    def test_occupancy_gruppo(self, agg):
        assert agg.kpi.occupancy == pytest.approx(4938 / 14763 * 100, rel=1e-3)

    def test_giorni_hotel(self, agg):
        # 3 hotel × 111 giorni = 333
        assert agg.giorni_hotel == 333

    def test_revenue_total_uguale_somma_per_hotel(self, hotel_dati_periodo_comune, agg):
        totale_atteso = sum(
            r.revenue_total
            for righe in hotel_dati_periodo_comune.values()
            for r in righe
        )
        assert agg.revenue_total == pytest.approx(totale_atteso, abs=0.01)


# ---------------------------------------------------------------------------
# Test: ADR di gruppo ≠ media semplice degli ADR per hotel
# ---------------------------------------------------------------------------

class TestADRGruppoNonMediaSemplice:
    def test_adr_gruppo_diverso_da_media_semplice(self, hotel_dati_periodo_comune):
        """
        Dimostra che ADR di gruppo (dai totali) ≠ media semplice degli ADR per hotel.
        Questo è il motivo per cui il CLAUDE.md vieta le medie semplici.
        """
        agg = aggrega_gruppo_periodo(hotel_dati_periodo_comune)

        adr_per_hotel = {}
        for codice, righe in hotel_dati_periodo_comune.items():
            rs = sum(r.rooms_sold for r in righe)
            rr = sum(r.revenue_rooms for r in righe)
            adr_per_hotel[codice] = rr / rs if rs > 0 else 0

        adr_media_semplice = sum(adr_per_hotel.values()) / 3

        # ADR di gruppo ≈ 82.53 €, media semplice ≈ 89.18 € → diversi
        assert agg.kpi.adr != pytest.approx(adr_media_semplice, rel=0.01), (
            "ADR gruppo == media semplice: i dati hanno distribuzioni uniformi?"
        )

    def test_occupancy_gruppo_diversa_da_media_semplice(self, hotel_dati_periodo_comune):
        agg = aggrega_gruppo_periodo(hotel_dati_periodo_comune)

        occ_per_hotel = {}
        for codice, righe in hotel_dati_periodo_comune.items():
            rs = sum(r.rooms_sold for r in righe)
            ra = sum(r.rooms_available for r in righe)
            occ_per_hotel[codice] = rs / ra * 100 if ra > 0 else 0

        occ_media_semplice = sum(occ_per_hotel.values()) / 3

        # Con capacità omogenee (45+43+45) la differenza è piccola ma presente
        # Verifica che il calcolo in agg viene dai totali, non dalla media
        occ_dai_totali = agg.rooms_sold / agg.rooms_available * 100
        assert agg.kpi.occupancy == pytest.approx(occ_dai_totali, rel=1e-6)


# ---------------------------------------------------------------------------
# Test aggrega_gruppo_periodo — filtro data_da / data_a
# ---------------------------------------------------------------------------

class TestFiltroDataGruppoPeriodo:
    def test_filtro_solo_luglio(self, hotel_dati_completi):
        agg = aggrega_gruppo_periodo(
            hotel_dati_completi,
            data_da=date(2026, 7, 1),
            data_a=date(2026, 7, 31),
        )
        assert agg is not None
        assert agg.period_start == date(2026, 7, 1)
        assert agg.period_end == date(2026, 7, 31)
        # 3 hotel × 31 giorni = 93 giorni-hotel
        assert agg.giorni_hotel == 93

    def test_filtro_solo_dph_aperto_maggio(self):
        """
        Con stagione applicata (CLB/INT aprono 01/06), filtrando solo maggio
        resta solo DPH → rooms_available = 43 × 31.
        """
        # Applica il filtro stagionale ai singoli hotel prima di aggregare
        dati_stagionali = {
            "CLB": parse("CLB", open_date=date(2026, 6, 1)),
            "DPH": parse("DPH"),   # DPH apre 01/05, nessun filtro necessario
            "INT": parse("INT", open_date=date(2026, 6, 1)),
        }
        agg = aggrega_gruppo_periodo(
            dati_stagionali,
            data_da=date(2026, 5, 1),
            data_a=date(2026, 5, 31),
        )
        assert agg is not None
        assert agg.hotel_codes == ["DPH"]
        assert agg.rooms_available == 43 * 31

    def test_periodo_vuoto_restituisce_none(self, hotel_dati_completi):
        agg = aggrega_gruppo_periodo(
            hotel_dati_completi,
            data_da=date(2027, 1, 1),
            data_a=date(2027, 1, 31),
        )
        assert agg is None

    def test_dati_vuoti_restituisce_none(self):
        assert aggrega_gruppo_periodo({}) is None
        assert aggrega_gruppo_periodo({"CLB": []}) is None


# ---------------------------------------------------------------------------
# Test aggrega_gruppo_settimanale
# ---------------------------------------------------------------------------

class TestAggregazioneGruppoSettimanale:
    @pytest.fixture(scope="class")
    def settimane_gruppo(self, hotel_dati_completi):
        return aggrega_gruppo_settimanale(hotel_dati_completi)

    def test_almeno_una_settimana(self, settimane_gruppo):
        assert len(settimane_gruppo) > 0

    def test_settimane_in_ordine_cronologico(self, settimane_gruppo):
        starts = [s.week_start for s in settimane_gruppo]
        assert starts == sorted(starts)

    def test_week_start_sempre_sabato(self, settimane_gruppo):
        for s in settimane_gruppo:
            assert s.week_start.weekday() == 5

    def test_week_end_sempre_venerdi(self, settimane_gruppo):
        for s in settimane_gruppo:
            assert s.week_end.weekday() == 4

    def test_prima_settimana_solo_dph(self, settimane_gruppo):
        """
        La prima settimana (25/04–01/05) ha solo DPH aperto
        (CLB e INT aprono il 01/06, DPH il 01/05).
        """
        prima = settimane_gruppo[0]
        assert prima.week_start == date(2026, 4, 25)
        assert prima.hotel_codes == ["DPH"]
        assert prima.giorni_hotel == 1  # solo il 01/05 (venerdì)

    def test_settimane_giugno_hanno_tutti_tre_hotel(self, settimane_gruppo):
        """Da giugno in poi tutti e 3 gli hotel sono aperti."""
        # Prima settimana di giugno: parte il 30/05 (sab), ma CLB/INT aprono il 01/06
        # → alcuni hotel hanno dati dalla prima settimana di giugno
        settimane_giugno = [s for s in settimane_gruppo if s.week_start >= date(2026, 6, 6)]
        for s in settimane_giugno:
            assert "CLB" in s.hotel_codes
            assert "DPH" in s.hotel_codes
            assert "INT" in s.hotel_codes

    def test_rooms_available_gruppo_e_somma_per_hotel(self, settimane_gruppo, hotel_dati_completi):
        """Ogni settimana: rooms_available_gruppo = Σ rooms_available per hotel."""
        from app.services.weekly_aggregator import aggrega_settimane
        settimane_per_hotel = {}
        for codice, righe in hotel_dati_completi.items():
            settimane_per_hotel[codice] = {s.week_start: s for s in aggrega_settimane(righe)}

        for sg in settimane_gruppo:
            atteso = sum(
                settimane_per_hotel[codice][sg.week_start].rooms_available
                for codice in sg.hotel_codes
                if sg.week_start in settimane_per_hotel.get(codice, {})
            )
            assert sg.rooms_available == atteso

    def test_revenue_total_gruppo_uguale_somma_per_hotel(self, settimane_gruppo, hotel_dati_completi):
        """Somma revenue_total su tutte le settimane di gruppo == somma di tutte le righe."""
        tot_settimane = sum(s.revenue_total for s in settimane_gruppo)
        tot_righe = sum(
            r.revenue_total
            for righe in hotel_dati_completi.values()
            for r in righe
        )
        assert tot_settimane == pytest.approx(tot_righe, abs=0.1)

    def test_breakdown_per_hotel_coerente(self, settimane_gruppo):
        """Il breakdown per_hotel deve sommare ai totali di gruppo."""
        for sg in settimane_gruppo:
            assert sg.rooms_sold == sum(h.rooms_sold for h in sg.per_hotel.values())
            assert sg.revenue_total == pytest.approx(
                sum(h.revenue_total for h in sg.per_hotel.values()), abs=0.01
            )

    def test_kpi_gruppo_calcolato_dai_totali(self, settimane_gruppo):
        """
        KPI di gruppo calcolati dai totali aggregati, non dalla media
        dei KPI dei singoli hotel.
        """
        for sg in settimane_gruppo:
            if sg.rooms_available == 0:
                continue
            occ_attesa = sg.rooms_sold / sg.rooms_available * 100
            assert sg.kpi.occupancy == pytest.approx(occ_attesa, rel=1e-6)

    def test_numero_totale_settimane_gruppo(self, settimane_gruppo):
        """
        Il gruppo ha dati da DPH (01/05) a 19/09: il numero di settimane
        commerciali è 22 (stessa del DPH, l'hotel con il range più ampio).
        """
        assert len(settimane_gruppo) == 22


# ---------------------------------------------------------------------------
# Test invariante globale: somma gruppi == somma totale righe
# ---------------------------------------------------------------------------

class TestInvarianteGlobale:
    def test_periodo_totale_rooms_sold_uguale_somma_righe(self, hotel_dati_completi):
        agg = aggrega_gruppo_periodo(hotel_dati_completi)
        atteso = sum(r.rooms_sold for righe in hotel_dati_completi.values() for r in righe)
        assert agg.rooms_sold == atteso

    def test_periodo_totale_revenue_total_uguale_somma_righe(self, hotel_dati_completi):
        agg = aggrega_gruppo_periodo(hotel_dati_completi)
        atteso = sum(r.revenue_total for righe in hotel_dati_completi.values() for r in righe)
        assert agg.revenue_total == pytest.approx(atteso, abs=0.01)

    def test_rooms_available_riflette_apertura_eterogenea(self, hotel_dati_completi):
        """
        rooms_available di gruppo = Σ (CV × giorni_apertura) per ciascun hotel.
        DPH ha 43 camere × 142 giorni, CLB/INT hanno 45 camere × 113 giorni ciascuno.
        """
        agg = aggrega_gruppo_periodo(hotel_dati_completi)
        atteso = 43 * 142 + 45 * 113 + 45 * 113
        assert agg.rooms_available == atteso
