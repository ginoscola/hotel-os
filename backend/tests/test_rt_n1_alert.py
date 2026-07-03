"""Test unitari per l'alert su esente_n1 (tassa di soggiorno) non multiplo della tariffa per persona.

RT1 (Du Parc 2,50€/persona + Club Hotel 2,00€/persona, cassa fiscale condivisa): qualunque
combinazione di persone-notte tra i due hotel è valida, quindi si verifica solo il multiplo
del MCD tra le due tariffe (0,50€), non 2,50€ da sola — altrimenti si segnalano falsi allarmi
su combinazioni legittime (es. 70,50€ = 1 notte Du Parc + 34 notti Club).
RT2 (solo International) = 2,00 €/persona, un solo hotel, nessuna ambiguità.
Tutti i test sono unitari (nessun endpoint HTTP, nessun DB).
"""
from decimal import Decimal

from app.routers.corrispettivi_rt import _n1_non_quadra


class TestN1NonQuadra:
    def test_rt1_multiplo_di_2_50_non_segnala(self):
        assert _n1_non_quadra(Decimal('70.00'), 'RT1') is False   # 28 notti Du Parc

    def test_rt1_combinazione_mista_non_segnala(self):
        """70,50€ = 1 notte Du Parc (2,50€) + 34 notti Club (68,00€): combinazione legittima,
        non deve essere segnalata anche se non è multiplo di 2,50€ da sola."""
        assert _n1_non_quadra(Decimal('70.50'), 'RT1') is False

    def test_rt1_centesimi_sporchi_segnala(self):
        assert _n1_non_quadra(Decimal('0.97'), 'RT1') is True
        assert _n1_non_quadra(Decimal('28.54'), 'RT1') is True

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
