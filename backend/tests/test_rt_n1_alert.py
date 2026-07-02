"""Test unitari per l'alert su esente_n1 (tassa di soggiorno) non multiplo della tariffa per persona.

RT1 (Du Parc/Club Hotel) = 2,50 €/persona, RT2 (International) = 2,00 €/persona.
Tutti i test sono unitari (nessun endpoint HTTP, nessun DB).
"""
from decimal import Decimal

from app.routers.corrispettivi import _n1_non_quadra


class TestN1NonQuadra:
    def test_rt1_multiplo_esatto_non_segnala(self):
        assert _n1_non_quadra(Decimal('70.00'), 'RT1') is False   # 28 persone-notte

    def test_rt1_non_multiplo_segnala(self):
        assert _n1_non_quadra(Decimal('70.50'), 'RT1') is True    # 28.2, errore

    def test_rt2_multiplo_esatto_non_segnala(self):
        assert _n1_non_quadra(Decimal('50.00'), 'RT2') is False   # 25 persone-notte

    def test_rt2_non_multiplo_segnala(self):
        assert _n1_non_quadra(Decimal('51.00'), 'RT2') is True    # 25.5, errore

    def test_zero_non_segnala(self):
        assert _n1_non_quadra(Decimal('0'), 'RT1') is False

    def test_none_non_segnala(self):
        assert _n1_non_quadra(None, 'RT1') is False

    def test_rt_code_sconosciuto_non_segnala(self):
        assert _n1_non_quadra(Decimal('70.50'), 'RT9') is False
