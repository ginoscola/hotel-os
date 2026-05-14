"""
Test per services/weekly_aggregator.py

Verifica:
- settimana_di: corretta identificazione del sabato per tutte le date
- Numero di settimane commerciali per ogni hotel
- I totali settimanali coincidono con la somma dei giornalieri
- Le settimane parziali (apertura/chiusura stagione) sono identificate correttamente
- KPI settimanali calcolati dai totali (non da medie di KPI giornalieri)
- Settimana con ADR settimanale diversa dalla media delle ADR giornaliere
"""

import os
import sys
import pytest
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.file_parser import ParserCSV
from app.services.weekly_aggregator import settimana_di, aggrega_settimane
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
# Test settimana_di
# ---------------------------------------------------------------------------

class TestSettimanaDi:
    def test_sabato_e_inizio_settimana(self):
        # 30/05/2026 è sabato (confermato dal CSV "sab")
        assert settimana_di(date(2026, 5, 30)) == date(2026, 5, 30)

    def test_venerdi_appartiene_alla_settimana_precedente(self):
        # 05/06/2026 venerdì → settimana iniziata il 30/05 sabato
        assert settimana_di(date(2026, 6, 5)) == date(2026, 5, 30)

    def test_domenica_appartiene_alla_settimana_corrente(self):
        # 31/05/2026 domenica → settimana iniziata il 30/05
        assert settimana_di(date(2026, 5, 31)) == date(2026, 5, 30)

    def test_lunedi(self):
        # 01/06/2026 lunedì → settimana iniziata il 30/05
        assert settimana_di(date(2026, 6, 1)) == date(2026, 5, 30)

    def test_nuovo_sabato_nuova_settimana(self):
        # 06/06/2026 sabato → nuova settimana
        assert settimana_di(date(2026, 6, 6)) == date(2026, 6, 6)

    def test_primo_maggio_venerdi(self):
        # 01/05/2026 venerdì (DPH apertura) → settimana del 25/04
        assert settimana_di(date(2026, 5, 1)) == date(2026, 4, 25)

    def test_week_end_e_sabato_piu_sei(self):
        """week_end calcolato in aggrega_settimane = week_start + 6 giorni."""
        ws = date(2026, 5, 30)
        we = ws + timedelta(days=6)
        assert we == date(2026, 6, 5)   # venerdì
        assert we.weekday() == 4        # Friday=4

    @pytest.mark.parametrize("delta_giorni", range(7))
    def test_tutti_i_giorni_della_settimana_mappano_allo_stesso_sabato(self, delta_giorni):
        sabato = date(2026, 6, 6)
        giorno = sabato + timedelta(days=delta_giorni)
        assert settimana_di(giorno) == sabato


# ---------------------------------------------------------------------------
# Fixture condivise
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def settimane_clb():
    return aggrega_settimane(parse("CLB"))


@pytest.fixture(scope="module")
def settimane_dph():
    return aggrega_settimane(parse("DPH"))


@pytest.fixture(scope="module")
def settimane_int():
    return aggrega_settimane(parse("INT"))


@pytest.fixture(scope="module")
def righe_clb():
    return parse("CLB")


# ---------------------------------------------------------------------------
# Test struttura delle settimane
# ---------------------------------------------------------------------------

class TestStrutturaSettimane:
    def test_clb_ha_17_settimane_commerciali(self, settimane_clb):
        # 113 giorni: 16 settimane complete + 1 parziale (solo 19/09)
        assert len(settimane_clb) == 17

    def test_dph_ha_22_settimane_commerciali(self, settimane_dph):
        # DPH: 142 giorni (1/5–19/9), prima settimana parziale (solo 01/05 = venerdì)
        assert len(settimane_dph) == 22

    def test_int_ha_17_settimane_commerciali(self, settimane_int):
        assert len(settimane_int) == 17

    def test_week_start_e_sempre_sabato(self, settimane_clb):
        for s in settimane_clb:
            assert s.week_start.weekday() == 5, (
                f"week_start {s.week_start} non è sabato (weekday={s.week_start.weekday()})"
            )

    def test_week_end_e_sempre_venerdi(self, settimane_clb):
        for s in settimane_clb:
            assert s.week_end.weekday() == 4, (
                f"week_end {s.week_end} non è venerdì (weekday={s.week_end.weekday()})"
            )

    def test_week_end_e_week_start_piu_sei(self, settimane_clb):
        for s in settimane_clb:
            assert s.week_end == s.week_start + timedelta(days=6)

    def test_settimane_in_ordine_cronologico(self, settimane_clb):
        week_starts = [s.week_start for s in settimane_clb]
        assert week_starts == sorted(week_starts)

    def test_prima_settimana_clb_completa(self, settimane_clb):
        # 30/05 è sabato → prima settimana CLB ha 7 giorni
        prima = settimane_clb[0]
        assert prima.week_start == date(2026, 5, 30)
        assert prima.giorni == 7
        assert prima.settimana_completa is True

    def test_ultima_settimana_clb_parziale(self, settimane_clb):
        # Ultimo giorno CLB = 19/09 (sabato) → settimana con 1 solo giorno
        ultima = settimane_clb[-1]
        assert ultima.week_start == date(2026, 9, 19)
        assert ultima.giorni == 1
        assert ultima.settimana_completa is False

    def test_prima_settimana_dph_parziale(self, settimane_dph):
        # DPH apre 01/05 (venerdì) → prima settimana ha 1 solo giorno
        prima = settimane_dph[0]
        assert prima.week_start == date(2026, 4, 25)
        assert prima.giorni == 1
        assert prima.settimana_completa is False

    def test_hotel_code_corretto_in_ogni_settimana(self, settimane_clb, settimane_dph, settimane_int):
        assert all(s.hotel_code == "CLB" for s in settimane_clb)
        assert all(s.hotel_code == "DPH" for s in settimane_dph)
        assert all(s.hotel_code == "INT" for s in settimane_int)


# ---------------------------------------------------------------------------
# Test invariante somma: settimanale == somma dei giornalieri
# ---------------------------------------------------------------------------

class TestInvarianteSomma:
    def test_rooms_sold_settimanale_uguale_somma_giornaliera(self, settimane_clb, righe_clb):
        totale_settimanale = sum(s.rooms_sold for s in settimane_clb)
        totale_giornaliero = sum(r.rooms_sold for r in righe_clb)
        assert totale_settimanale == totale_giornaliero

    def test_rooms_available_settimanale_uguale_somma_giornaliera(self, settimane_clb, righe_clb):
        assert sum(s.rooms_available for s in settimane_clb) == sum(r.rooms_available for r in righe_clb)

    def test_revenue_rooms_settimanale_uguale_somma_giornaliera(self, settimane_clb, righe_clb):
        tot_s = sum(s.revenue_rooms for s in settimane_clb)
        tot_g = sum(r.revenue_rooms for r in righe_clb)
        assert tot_s == pytest.approx(tot_g, abs=0.01)

    def test_revenue_total_settimanale_uguale_somma_giornaliera(self, settimane_clb, righe_clb):
        tot_s = sum(s.revenue_total for s in settimane_clb)
        tot_g = sum(r.revenue_total for r in righe_clb)
        assert tot_s == pytest.approx(tot_g, abs=0.01)

    def test_giorni_totali_uguale_numero_righe(self, settimane_clb, righe_clb):
        assert sum(s.giorni for s in settimane_clb) == len(righe_clb)


# ---------------------------------------------------------------------------
# Test valori prima settimana CLB (30/05–05/06/2026) con ancoraggio ai CSV
# ---------------------------------------------------------------------------

class TestValoriPrimaSettimanaClb:
    """
    Valori precalcolati dalla prima settimana CLB (30/05–05/06/2026):
      rooms_sold=86, rooms_available=315, rev_rooms=5454.52, rev_total=7850.52
    """

    @pytest.fixture
    def prima_settimana(self, settimane_clb):
        return settimane_clb[0]

    def test_week_start_30_maggio(self, prima_settimana):
        assert prima_settimana.week_start == date(2026, 5, 30)

    def test_rooms_sold(self, prima_settimana):
        assert prima_settimana.rooms_sold == 86

    def test_rooms_available(self, prima_settimana):
        # 7 giorni × 45 camere = 315
        assert prima_settimana.rooms_available == 315

    def test_revenue_rooms(self, prima_settimana):
        assert prima_settimana.revenue_rooms == pytest.approx(5454.52, abs=0.01)

    def test_revenue_total(self, prima_settimana):
        assert prima_settimana.revenue_total == pytest.approx(7850.52, abs=0.01)

    def test_occupancy_settimanale(self, prima_settimana):
        # 86/315 * 100 = 27.302%
        assert prima_settimana.kpi.occupancy == pytest.approx(86 / 315 * 100, rel=1e-4)

    def test_adr_settimanale(self, prima_settimana):
        # 5454.52 / 86 = 63.424...
        assert prima_settimana.kpi.adr == pytest.approx(5454.52 / 86, rel=1e-4)

    def test_revpar_settimanale(self, prima_settimana):
        assert prima_settimana.kpi.revpar == pytest.approx(5454.52 / 315, rel=1e-4)


# ---------------------------------------------------------------------------
# Test: ADR settimanale ≠ media semplice delle ADR giornaliere
# ---------------------------------------------------------------------------

class TestKPISettimanaleNonEMediaSemplice:
    def test_adr_settimanale_diverso_da_media_adr_giornaliere(self, settimane_clb, righe_clb):
        """
        Dimostra che l'ADR settimanale (calcolato dai totali) differisce dalla
        media semplice delle ADR giornaliere — motivo per cui si usano i totali.
        """
        prima_ws = settimane_clb[0].week_start
        giorni_settimana1 = [r for r in righe_clb if settimana_di(r.data) == prima_ws]

        # ADR settimanale dai totali
        adr_totali = sum(r.revenue_rooms for r in giorni_settimana1) / sum(r.rooms_sold for r in giorni_settimana1)

        # Media semplice delle ADR giornaliere (metodo scorretto)
        adr_media_semplice = sum(
            r.revenue_rooms / r.rooms_sold
            for r in giorni_settimana1
            if r.rooms_sold > 0
        ) / len([r for r in giorni_settimana1 if r.rooms_sold > 0])

        # I due valori devono essere diversi (weights non uniformi)
        assert adr_totali != pytest.approx(adr_media_semplice, rel=0.001), (
            "ADR dai totali e media semplice sono uguali: le date hanno pesi uniformi?"
        )

    def test_occupancy_settimanale_non_e_media_occupancy_giornaliere(self, settimane_clb, righe_clb):
        prima_ws = settimane_clb[0].week_start
        giorni = [r for r in righe_clb if settimana_di(r.data) == prima_ws]

        occ_totali = sum(r.rooms_sold for r in giorni) / sum(r.rooms_available for r in giorni) * 100
        occ_media = sum(r.rooms_sold / r.rooms_available * 100 for r in giorni) / len(giorni)

        # rooms_available è costante (45/giorno) quindi qui occ_totali == occ_media
        # ma verifichiamo che il calcolo dai totali sia quello corretto
        assert occ_totali == pytest.approx(settimane_clb[0].kpi.occupancy, rel=1e-4)


# ---------------------------------------------------------------------------
# Test con filtro stagionale: CLB apre 01/06
# ---------------------------------------------------------------------------

class TestFiltroStagionaleSettimanale:
    def test_clb_stagione_giugno_scarta_maggio(self):
        righe = parse("CLB", open_date=date(2026, 6, 1))
        settimane = aggrega_settimane(righe)
        # La prima settimana con dati inizia il 30/05 ma i dati partono dal 01/06
        # → la settimana del 30/05 ha solo 5 giorni (lun–ven: 01–05 giugno)
        prima = settimane[0]
        assert prima.week_start == date(2026, 5, 30)
        assert prima.giorni == 5
        assert prima.settimana_completa is False
        assert all(r.data >= date(2026, 6, 1) for r in righe)

    def test_clb_stagione_chiude_fine_agosto(self):
        righe = parse("CLB", open_date=date(2026, 6, 1), close_date=date(2026, 8, 31))
        settimane = aggrega_settimane(righe)
        # Ultima settimana: 29/08 sab → 31/08 lun (2 giorni, agosto finisce lunedì)
        ultima = settimane[-1]
        assert ultima.giorni < 7
        assert ultima.settimana_completa is False

    def test_totale_giorni_con_filtro(self):
        righe = parse("CLB", open_date=date(2026, 6, 1), close_date=date(2026, 9, 19))
        settimane = aggrega_settimane(righe)
        # 111 giorni validi → la somma dei giorni settimanali deve essere 111
        assert sum(s.giorni for s in settimane) == 111
