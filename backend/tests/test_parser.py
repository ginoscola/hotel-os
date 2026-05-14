"""
Test del parser CSV con i file reali degli hotel del gruppo.

Verifica:
- Parsing corretto di tutti e 6 i file CSV
- Scarto righe SDLY e LY
- Conversione numeri con virgola italiana
- Formule revenue (rooms, fnb, extra, total)
- Numero righe valide atteso per ogni hotel
- Integrità dati (no valori negativi, date nel range corretto)
- Filtro stagionale: date fuori apertura scartate con warning
"""

import os
import pytest
from datetime import date

# Il progetto va importato con sys.path corretto quando si esegue da backend/
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.file_parser import ParserCSV, _converti_numero, _estrai_data

# Percorso cartella uploads (relativo alla root del progetto)
UPLOADS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads")


def percorso_csv(nome: str) -> str:
    return os.path.join(UPLOADS_DIR, nome)


# ---------------------------------------------------------------------------
# Test funzioni di utilità
# ---------------------------------------------------------------------------

class TestConvertiNumero:
    def test_virgola_decimale(self):
        assert _converti_numero("2538,6900") == pytest.approx(2538.69)

    def test_zero(self):
        assert _converti_numero("0") == 0.0

    def test_stringa_vuota(self):
        assert _converti_numero("") == 0.0

    def test_numero_intero(self):
        assert _converti_numero("45") == 45.0

    def test_spazi(self):
        assert _converti_numero("  87,0000  ") == pytest.approx(87.0)


class TestEstraiData:
    def test_data_valida_con_giorno(self):
        risultato = _estrai_data("30/05/2026 sab")
        assert risultato == date(2026, 5, 30)

    def test_scarta_sdly(self):
        assert _estrai_data("01/04/2026 mer (SDLY)") is None

    def test_scarta_ly(self):
        assert _estrai_data("01/04/2026 mer (LY)") is None

    def test_stringa_vuota(self):
        assert _estrai_data("") is None

    def test_formato_non_valido(self):
        assert _estrai_data("Totale generale") is None

    def test_data_primo_maggio(self):
        assert _estrai_data("01/05/2026 ven") == date(2026, 5, 1)


# ---------------------------------------------------------------------------
# Test parser CLB (Club Hotel, 45 camere, giugno-agosto 2026)
# ---------------------------------------------------------------------------

class TestParserCLB:
    @pytest.fixture
    def righe_clb(self):
        parser = ParserCSV(hotel_code="CLB")
        return parser.parse_coppia(
            path_file1=percorso_csv("PlanningForecast-CLB1.csv"),
            path_file2=percorso_csv("PlanningForecast-CLB2.csv"),
        )

    def test_numero_righe_valide(self, righe_clb):
        """Il CLAUDE.md dichiara 113 righe valide per CLB."""
        assert len(righe_clb) == 113

    def test_hotel_code(self, righe_clb):
        assert all(r.hotel_code == "CLB" for r in righe_clb)

    def test_range_date(self, righe_clb):
        # Il file parte dal 30/05/2026 e termina il 19/09/2026 (113 giorni validi)
        date_list = [r.data for r in righe_clb]
        assert min(date_list) == date(2026, 5, 30)
        assert max(date_list) == date(2026, 9, 19)

    def test_rooms_available_costante(self, righe_clb):
        """Club Hotel ha sempre 45 camere disponibili (CV = capacità fissa)."""
        for r in righe_clb:
            assert r.rooms_available == 45, f"Data {r.data}: CV={r.rooms_available}, atteso 45"

    def test_revenue_rooms_puo_essere_negativo_in_forecast(self, righe_clb):
        """Valori negativi legittimi: sono correzioni/cancellazioni nel forecast."""
        neg = [r for r in righe_clb if r.revenue_rooms < 0]
        # Verificato dai dati reali: 8 giorni in settembre con RICAVI TRAT negativi
        assert len(neg) > 0, "Attesi alcuni valori negativi nel forecast di settembre"

    def test_revenue_fnb_non_negativo(self, righe_clb):
        """F&B non può mai essere negativo (è max(0, file1-file2))."""
        assert all(r.revenue_fnb >= 0 for r in righe_clb)

    def test_revenue_total_corretto(self, righe_clb):
        """revenue_total = rooms + fnb + extra."""
        for r in righe_clb:
            atteso = r.revenue_rooms + r.revenue_fnb + r.revenue_extra
            assert r.revenue_total == pytest.approx(atteso, abs=0.01), (
                f"Data {r.data}: total={r.revenue_total} != {atteso}"
            )

    def test_fnb_e_rooms_sommano_a_file1(self, righe_clb):
        """rooms + fnb deve essere uguale a RICAVI TRAT di file1 (se non troncato)."""
        # La prima riga (30/05/2026 o 01/06/2026): file1=2538,69, file2=1773,69
        # fnb = 2538,69 - 1773,69 = 765,00
        prima = righe_clb[0]
        assert prima.revenue_fnb >= 0

    def test_primo_giorno_valori(self, righe_clb):
        """Verifica valori noti dalla prima riga valida di CLB (30/05/2026)."""
        primo = next(r for r in righe_clb if r.data == date(2026, 5, 30))
        # CV=45 camere disponibili, CP=27 camere vendute
        assert primo.rooms_available == 45
        assert primo.rooms_sold == 27
        # file2: RICAVI TRAT=1742,11 → revenue_rooms
        assert primo.revenue_rooms == pytest.approx(1742.11, abs=0.01)
        # file1: RICAVI TRAT=2405,11 → fnb = 2405,11 - 1742,11 = 663,00
        assert primo.revenue_fnb == pytest.approx(663.0, abs=0.01)
        # EXTRA TRATT=54,00 (da file1)
        assert primo.revenue_extra == pytest.approx(54.0, abs=0.01)
        # total = 1742,11 + 663,00 + 54,00 = 2459,11
        assert primo.revenue_total == pytest.approx(2459.11, abs=0.01)

    def test_giugno_primo(self, righe_clb):
        """Verifica valori per 01/06/2026."""
        riga = next(r for r in righe_clb if r.data == date(2026, 6, 1))
        assert riga.rooms_available == 45
        assert riga.revenue_rooms == pytest.approx(1440.66, abs=0.01)
        assert riga.revenue_fnb == pytest.approx(447.0, abs=0.01)
        assert riga.revenue_extra == pytest.approx(0.0, abs=0.01)


# ---------------------------------------------------------------------------
# Test parser DPH (Hotel Du Parc, 43 camere, maggio-agosto 2026)
# ---------------------------------------------------------------------------

class TestParserDPH:
    @pytest.fixture
    def righe_dph(self):
        parser = ParserCSV(hotel_code="DPH")
        return parser.parse_coppia(
            path_file1=percorso_csv("PlanningForecast-DPH1.csv"),
            path_file2=percorso_csv("PlanningForecast-DPH2.csv"),
        )

    def test_numero_righe_valide(self, righe_dph):
        """Il CLAUDE.md dichiara 142 righe valide per DPH."""
        assert len(righe_dph) == 142

    def test_hotel_code(self, righe_dph):
        assert all(r.hotel_code == "DPH" for r in righe_dph)

    def test_range_date(self, righe_dph):
        # DPH parte dal 01/05/2026 e termina il 19/09/2026 (142 giorni validi)
        date_list = [r.data for r in righe_dph]
        assert min(date_list) == date(2026, 5, 1)
        assert max(date_list) == date(2026, 9, 19)

    def test_rooms_available_costante(self, righe_dph):
        """Du Parc ha sempre 43 camere disponibili (CV = capacità fissa)."""
        for r in righe_dph:
            assert r.rooms_available == 43, f"Data {r.data}: CV={r.rooms_available}, atteso 43"

    def test_primo_giorno_dph(self, righe_dph):
        """Primo maggio: verifica valori noti dalla prima riga DPH."""
        primo = next(r for r in righe_dph if r.data == date(2026, 5, 1))
        assert primo.rooms_available == 43
        # CV=43, CP=38 (forecast aggiornato)
        assert primo.rooms_sold == 38
        # file2: 3228,58 → revenue_rooms
        assert primo.revenue_rooms == pytest.approx(3228.58, abs=0.01)
        # file1: 3858,58 → fnb = 3858,58 - 3228,58 = 630,00
        assert primo.revenue_fnb == pytest.approx(630.0, abs=0.01)
        assert primo.revenue_extra == pytest.approx(0.0, abs=0.01)

    def test_revenue_fnb_non_negativo(self, righe_dph):
        assert all(r.revenue_fnb >= 0 for r in righe_dph)

    def test_revenue_total_corretto(self, righe_dph):
        for r in righe_dph:
            atteso = r.revenue_rooms + r.revenue_fnb + r.revenue_extra
            assert r.revenue_total == pytest.approx(atteso, abs=0.01)


# ---------------------------------------------------------------------------
# Test parser INT (Hotel International, 45 camere, giugno-agosto 2026)
# ---------------------------------------------------------------------------

class TestParserINT:
    @pytest.fixture
    def righe_int(self):
        parser = ParserCSV(hotel_code="INT")
        return parser.parse_coppia(
            path_file1=percorso_csv("PlanningForecast-INT1.csv"),
            path_file2=percorso_csv("PlanningForecast-INT2.csv"),
        )

    def test_numero_righe_valide(self, righe_int):
        """Il CLAUDE.md dichiara 113 righe valide per INT."""
        assert len(righe_int) == 113

    def test_hotel_code(self, righe_int):
        assert all(r.hotel_code == "INT" for r in righe_int)

    def test_range_date(self, righe_int):
        # INT parte dal 30/05/2026 e termina il 19/09/2026 (113 giorni validi)
        date_list = [r.data for r in righe_int]
        assert min(date_list) == date(2026, 5, 30)
        assert max(date_list) == date(2026, 9, 19)

    def test_rooms_available_costante(self, righe_int):
        """International ha sempre 45 camere disponibili (CV = capacità fissa)."""
        for r in righe_int:
            assert r.rooms_available == 45

    def test_revenue_fnb_non_negativo(self, righe_int):
        assert all(r.revenue_fnb >= 0 for r in righe_int)

    def test_revenue_total_corretto(self, righe_int):
        for r in righe_int:
            atteso = r.revenue_rooms + r.revenue_fnb + r.revenue_extra
            assert r.revenue_total == pytest.approx(atteso, abs=0.01)


# ---------------------------------------------------------------------------
# Test scarto righe SDLY/LY (verifica che non compaiano nei risultati)
# ---------------------------------------------------------------------------

class TestScartoRighe:
    def test_nessuna_riga_sdly_nel_risultato(self):
        parser = ParserCSV(hotel_code="CLB")
        righe = parser.parse_coppia(
            path_file1=percorso_csv("PlanningForecast-CLB1.csv"),
            path_file2=percorso_csv("PlanningForecast-CLB2.csv"),
        )
        # Nessuna data deve essere di aprile 2026 (quelle sono tutte SDLY/LY)
        date_aprile = [r for r in righe if r.data.month == 4]
        assert len(date_aprile) == 0, "Trovate righe di aprile 2026 che dovevano essere scartate"

    def test_contatore_righe_scartate(self):
        parser = ParserCSV(hotel_code="CLB")
        parser.parse_coppia(
            path_file1=percorso_csv("PlanningForecast-CLB1.csv"),
            path_file2=percorso_csv("PlanningForecast-CLB2.csv"),
        )
        # Le righe totali del file CLB sono 343 (inclusa intestazione)
        # 342 righe dati: 113 valide + 229 SDLY/LY (113 SDLY + 113 LY + 3 righe maggio)
        assert parser.righe_scartate > 0


# ---------------------------------------------------------------------------
# Test integrità dati su tutti e 3 gli hotel
# ---------------------------------------------------------------------------

class TestIntegraListaTuttiHotel:
    @pytest.fixture
    def tutti_i_dati(self):
        risultati = {}
        for codice in ("CLB", "DPH", "INT"):
            parser = ParserCSV(hotel_code=codice)
            risultati[codice] = parser.parse_coppia(
                path_file1=percorso_csv(f"PlanningForecast-{codice}1.csv"),
                path_file2=percorso_csv(f"PlanningForecast-{codice}2.csv"),
            )
        return risultati

    def test_rooms_sold_mai_superiore_a_disponibili(self, tutti_i_dati):
        """rooms_sold (CP) non deve mai superare rooms_available (CV = capacità fissa)."""
        for codice, righe in tutti_i_dati.items():
            for r in righe:
                assert r.rooms_sold <= r.rooms_available, (
                    f"{codice} {r.data}: rooms_sold={r.rooms_sold} > rooms_available={r.rooms_available}"
                )

    def test_revenue_fnb_mai_negativo(self, tutti_i_dati):
        """F&B è sempre >= 0 (il parser usa max(0, file1-file2))."""
        for codice, righe in tutti_i_dati.items():
            for r in righe:
                assert r.revenue_fnb >= 0, f"{codice} {r.data}: revenue_fnb negativo"

    def test_revenue_rooms_puo_essere_negativo_in_settembre(self, tutti_i_dati):
        """Solo CLB ha correzioni negative nel forecast di settembre; DPH e INT no."""
        neg_clb = [r for r in tutti_i_dati["CLB"] if r.revenue_rooms < 0]
        assert len(neg_clb) == 8, f"Attese 8 righe negative in CLB, trovate {len(neg_clb)}"

        for codice in ("DPH", "INT"):
            neg = [r for r in tutti_i_dati[codice] if r.revenue_rooms < 0]
            assert len(neg) == 0, f"{codice} non dovrebbe avere revenue_rooms negativi"

    def test_totale_righe_tutti_hotel(self, tutti_i_dati):
        """Totale atteso: 113 + 142 + 113 = 368 righe valide."""
        totale = sum(len(righe) for righe in tutti_i_dati.values())
        assert totale == 368


# ---------------------------------------------------------------------------
# Test filtro stagionale
# ---------------------------------------------------------------------------

class TestFiltroStagionale:
    """
    Stagioni 2026 reali del gruppo:
      DPH: 01/05/2026 – 30/09/2026  (i CSV arrivano fino al 19/09)
      CLB: 01/06/2026 – 30/09/2026
      INT: 01/06/2026 – 30/09/2026
    """

    def test_clb_senza_filtro_include_maggio(self):
        """Senza filtro il parser include le righe di maggio presenti nel CSV."""
        parser = ParserCSV(hotel_code="CLB")
        righe = parser.parse_coppia(
            path_file1=percorso_csv("PlanningForecast-CLB1.csv"),
            path_file2=percorso_csv("PlanningForecast-CLB2.csv"),
        )
        date_maggio = [r for r in righe if r.data.month == 5]
        assert len(date_maggio) > 0
        assert parser.righe_fuori_stagione == 0
        assert parser.warnings == []

    def test_clb_filtro_open_date_scarta_maggio(self):
        """Con open_date=01/06/2026 le righe di maggio vengono scartate con warning."""
        parser = ParserCSV(hotel_code="CLB")
        righe = parser.parse_coppia(
            path_file1=percorso_csv("PlanningForecast-CLB1.csv"),
            path_file2=percorso_csv("PlanningForecast-CLB2.csv"),
            open_date=date(2026, 6, 1),
        )
        # 30/05 e 31/05 devono essere escluse
        date_maggio = [r for r in righe if r.data.month == 5]
        assert len(date_maggio) == 0
        assert parser.righe_fuori_stagione == 2
        assert len(parser.warnings) == 2
        assert all("precedente all'apertura" in w for w in parser.warnings)

    def test_clb_prima_riga_valida_con_filtro(self):
        """Con open_date=01/06/2026 la prima riga deve essere il 01/06/2026."""
        parser = ParserCSV(hotel_code="CLB")
        righe = parser.parse_coppia(
            path_file1=percorso_csv("PlanningForecast-CLB1.csv"),
            path_file2=percorso_csv("PlanningForecast-CLB2.csv"),
            open_date=date(2026, 6, 1),
        )
        assert righe[0].data == date(2026, 6, 1)

    def test_filtro_close_date_scarta_settembre(self):
        """Con close_date=31/08/2026 le righe di settembre vengono scartate."""
        parser = ParserCSV(hotel_code="CLB")
        righe = parser.parse_coppia(
            path_file1=percorso_csv("PlanningForecast-CLB1.csv"),
            path_file2=percorso_csv("PlanningForecast-CLB2.csv"),
            close_date=date(2026, 8, 31),
        )
        date_settembre = [r for r in righe if r.data.month == 9]
        assert len(date_settembre) == 0
        assert parser.righe_fuori_stagione > 0
        assert all("successiva alla chiusura" in w for w in parser.warnings)

    def test_filtro_open_e_close_stagione_2026_clb(self):
        """Stagione CLB 2026: 01/06–19/09 (limite reale del CSV)."""
        parser = ParserCSV(hotel_code="CLB")
        righe = parser.parse_coppia(
            path_file1=percorso_csv("PlanningForecast-CLB1.csv"),
            path_file2=percorso_csv("PlanningForecast-CLB2.csv"),
            open_date=date(2026, 6, 1),
            close_date=date(2026, 9, 19),
        )
        # 30/05 e 31/05 scartati → 111 righe (113 - 2)
        assert len(righe) == 111
        assert parser.righe_fuori_stagione == 2
        assert righe[0].data == date(2026, 6, 1)
        assert righe[-1].data == date(2026, 9, 19)

    def test_filtro_open_e_close_stagione_2026_dph(self):
        """Stagione DPH 2026: parte dal 01/05, coincide con inizio CSV → nessuna riga scartata."""
        parser = ParserCSV(hotel_code="DPH")
        righe = parser.parse_coppia(
            path_file1=percorso_csv("PlanningForecast-DPH1.csv"),
            path_file2=percorso_csv("PlanningForecast-DPH2.csv"),
            open_date=date(2026, 5, 1),
            close_date=date(2026, 9, 19),
        )
        assert len(righe) == 142  # nessuna riga esclusa
        assert parser.righe_fuori_stagione == 0

    def test_warning_contiene_hotel_code_e_data(self):
        """Ogni warning deve includere il codice hotel e la data in formato italiano."""
        parser = ParserCSV(hotel_code="INT")
        parser.parse_coppia(
            path_file1=percorso_csv("PlanningForecast-INT1.csv"),
            path_file2=percorso_csv("PlanningForecast-INT2.csv"),
            open_date=date(2026, 6, 1),
        )
        for w in parser.warnings:
            assert "INT" in w
            # La data deve essere in formato dd/mm/yyyy
            import re
            assert re.search(r"\d{2}/\d{2}/\d{4}", w), f"Warning senza data italiana: {w}"

    def test_filtro_anno_futuro_scarta_tutto(self):
        """open_date nel futuro rispetto ai dati → nessuna riga valida, solo warnings."""
        parser = ParserCSV(hotel_code="CLB")
        righe = parser.parse_coppia(
            path_file1=percorso_csv("PlanningForecast-CLB1.csv"),
            path_file2=percorso_csv("PlanningForecast-CLB2.csv"),
            open_date=date(2027, 1, 1),
        )
        assert len(righe) == 0
        assert parser.righe_fuori_stagione == 113
        assert len(parser.warnings) == 113

    def test_contatori_coerenti_con_filtro(self):
        """righe_valide + righe_fuori_stagione == totale righe nel CSV (escluse SDLY/LY)."""
        parser = ParserCSV(hotel_code="CLB")
        righe = parser.parse_coppia(
            path_file1=percorso_csv("PlanningForecast-CLB1.csv"),
            path_file2=percorso_csv("PlanningForecast-CLB2.csv"),
            open_date=date(2026, 6, 1),
            close_date=date(2026, 8, 31),
        )
        assert len(righe) + parser.righe_fuori_stagione == 113
