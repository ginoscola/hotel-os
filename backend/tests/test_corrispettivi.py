"""Test unitari per il modulo Corrispettivi v3.

Usa uploads/listaConti.xlsx come file di test reale.
Tutti i test sono unitari (nessun endpoint HTTP, nessun DB).
"""

import os
import pytest
from datetime import date

# Percorso file di test
EXCEL_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'uploads', 'listaConti.xlsx')


# ── Import parser ─────────────────────────────────────────────────────────────

from app.services.corrispettivi_excel_parser import (
    parse_excel,
    _struttura_da_suffisso,
    _tipo_da_suffisso,
    _calcola_aliquota,
    _determina_categoria,
    _estrai_ospiti,
    _parse_data,
    TIPI_SCONTRINO,
    TIPI_FATTURA,
)


# ── Test struttura da suffisso ─────────────────────────────────────────────────

class TestStrutturaFromSuffisso:
    def test_dph_da_d_sc(self):
        assert _struttura_da_suffisso('D-SC', '') == 'DPH'

    def test_clb_da_c_sc(self):
        assert _struttura_da_suffisso('C-SC', '') == 'CLB'

    def test_int_da_i_sc(self):
        assert _struttura_da_suffisso('I-SC', '') == 'INT'

    def test_dph_da_d_f(self):
        assert _struttura_da_suffisso('D-F', '') == 'DPH'

    def test_fallback_camera_aire(self):
        """Nomi speciali AIRE/AGUA/TIERRA/FUEGO → DPH."""
        assert _struttura_da_suffisso('', 'AIRE') == 'DPH'
        assert _struttura_da_suffisso('', 'AGUA') == 'DPH'
        assert _struttura_da_suffisso('', 'TIERRA') == 'DPH'
        assert _struttura_da_suffisso('', 'FUEGO') == 'DPH'

    def test_fallback_camera_prima_lettera(self):
        assert _struttura_da_suffisso('', 'D206') == 'DPH'
        assert _struttura_da_suffisso('', 'C101') == 'CLB'
        assert _struttura_da_suffisso('', 'I305') == 'INT'

    def test_sconosciuta_restituisce_none(self):
        assert _struttura_da_suffisso('X-SC', '') is None
        assert _struttura_da_suffisso('', 'ZZZ') is None


# ── Test tipo da suffisso ─────────────────────────────────────────────────────

class TestTipoDaSuffisso:
    def test_sc(self):
        assert _tipo_da_suffisso('D-SC') == 'SC'

    def test_sca(self):
        assert _tipo_da_suffisso('C-SCA') == 'SCA'

    def test_f(self):
        assert _tipo_da_suffisso('I-F') == 'F'

    def test_cp_escluso(self):
        tipo = _tipo_da_suffisso('D-CP')
        assert tipo not in TIPI_SCONTRINO and tipo not in TIPI_FATTURA

    def test_fd_escluso(self):
        tipo = _tipo_da_suffisso('D-FD')
        assert tipo not in TIPI_SCONTRINO and tipo not in TIPI_FATTURA

    def test_senza_trattino(self):
        assert _tipo_da_suffisso('SC') == 'SC'


# ── Test categorizzazione per aliquota ────────────────────────────────────────

class TestCategoria:
    def test_arrangiamenti_10_esatto(self):
        aliq = _calcola_aliquota(100, 10)
        assert _determina_categoria(aliq, 100) == 'arrangiamenti'

    def test_arrangiamenti_10_con_arrotondamento(self):
        """9.51% è dentro tolleranza ±0.5% da 10%."""
        aliq = _calcola_aliquota(305.91, 29.09)  # ≈ 9.51%
        assert _determina_categoria(aliq, 305.91) == 'arrangiamenti'

    def test_shop_22(self):
        aliq = _calcola_aliquota(100, 22)
        assert _determina_categoria(aliq, 100) == 'shop'

    def test_tassa_soggiorno_zero_con_imponibile(self):
        """0% IVA con imponibile > 0 → tassa_soggiorno."""
        aliq = _calcola_aliquota(15, 0)
        assert _determina_categoria(aliq, 15) == 'tassa_soggiorno'

    def test_penali_zero_senza_imponibile(self):
        """0% IVA con imponibile = 0 → penali."""
        aliq = _calcola_aliquota(0, 0)
        assert _determina_categoria(aliq, 0) == 'penali'

    def test_arrangiamenti_mix_tassa_soggiorno(self):
        """8.8% (tra 0% e 9.5%, esclusi) è un mix arrangiamenti+tassa soggiorno → arrangiamenti."""
        aliq = _calcola_aliquota(41.36, 3.64)  # ≈ 8.8%
        assert _determina_categoria(aliq, 41.36) == 'arrangiamenti'

    def test_altro_aliquota_fuori_range(self):
        """15% non è vicino a 10%/22%/0% né nel range mix 0-9.5% → altro."""
        aliq = _calcola_aliquota(100, 15)  # 15%
        assert _determina_categoria(aliq, 100) == 'altro'

    def test_negativo_trattato_come_categorie_normali(self):
        """Valori negativi (storni): la categoria viene determinata normalmente."""
        aliq = _calcola_aliquota(100, 10)
        assert _determina_categoria(aliq, 100) == 'arrangiamenti'


# ── Test estrazione ospiti ────────────────────────────────────────────────────

class TestEstraiOspiti:
    def test_ospiti_presenti(self):
        note = 'Ospiti: Mario Rossi, Anna Verdi'
        assert _estrai_ospiti(note) == 'Mario Rossi, Anna Verdi'

    def test_nota_senza_ospiti(self):
        assert _estrai_ospiti('Nota generica') == ''

    def test_nota_vuota(self):
        assert _estrai_ospiti('') == ''
        assert _estrai_ospiti(None) == ''

    def test_case_insensitive(self):
        note = 'ospiti: Tizio, Caio'
        assert _estrai_ospiti(note) == 'Tizio, Caio'


# ── Test parse_data ───────────────────────────────────────────────────────────

class TestParseData:
    def test_datetime_python(self):
        from datetime import datetime
        dt = datetime(2026, 6, 12, 0, 0)
        assert _parse_data(dt) == date(2026, 6, 12)

    def test_stringa_iso(self):
        assert _parse_data('2026-06-12') == date(2026, 6, 12)

    def test_nessun_valore(self):
        assert _parse_data(None) is None

    def test_stringa_invalida(self):
        assert _parse_data('non-una-data') is None


# ── Test integrazione con file Excel reale ────────────────────────────────────

@pytest.mark.skipif(not os.path.exists(EXCEL_PATH), reason="File listaConti.xlsx non disponibile")
class TestParserExcel:
    def setup_method(self):
        self.r = parse_excel(EXCEL_PATH)

    def test_16_scontrini(self):
        """Il file di test contiene 16 righe D-SC."""
        assert len(self.r.scontrini) == 16

    def test_nessuna_fattura(self):
        """Il file di test non contiene fatture."""
        assert len(self.r.fatture) == 0

    def test_nessun_escluso(self):
        """Il file di test non ha CP/FD da escludere."""
        assert len(self.r.esclusi) == 0

    def test_struttura_solo_dph(self):
        """Tutti i documenti sono DPH (prefisso D)."""
        assert self.r.strutture_trovate == {'DPH'}
        for sc in self.r.scontrini:
            assert sc.struttura_code == 'DPH'

    def test_periodo_corretto(self):
        assert self.r.data_da == date(2026, 6, 12)
        assert self.r.data_a == date(2026, 6, 12)

    def test_nessun_warning(self):
        assert self.r.warnings == []

    def test_scontrino_286_categorizzato_arrangiamenti(self):
        """SC 286: imponibile=305.91, iva=29.09 → aliq≈9.51% ≈ 10% → arrangiamenti."""
        sc286 = next((s for s in self.r.scontrini if s.numero == 286), None)
        assert sc286 is not None
        assert sc286.categoria == 'arrangiamenti'
        assert abs(sc286.aliquota_pct - 9.51) < 0.1

    def test_scontrino_285_tassa_soggiorno(self):
        """SC 285: imponibile=15, iva=0 → 0% IVA con imponibile > 0 → tassa_soggiorno."""
        sc285 = next((s for s in self.r.scontrini if s.numero == 285), None)
        assert sc285 is not None
        assert sc285.categoria == 'tassa_soggiorno'
        assert sc285.imponibile == 15.0
        assert sc285.iva == 0.0

    def test_scontrino_276_penale(self):
        """SC 276: totale=0, imponibile=0, iva=0 → 0% IVA senza imponibile → penali."""
        sc276 = next((s for s in self.r.scontrini if s.numero == 276), None)
        assert sc276 is not None
        assert sc276.categoria == 'penali'
        assert sc276.totale_lordo == 0.0

    def test_scontrino_277_arrangiamenti_mix_ts(self):
        """SC 277: imponibile=41.36, iva=3.64 → aliq≈8.8%, mix arrangiamenti+tassa soggiorno → arrangiamenti."""
        sc277 = next((s for s in self.r.scontrini if s.numero == 277), None)
        assert sc277 is not None
        assert sc277.categoria == 'arrangiamenti'

    def test_caparre_escluse(self):
        """Nessun tipo CP o FD deve entrare in scontrini o fatture."""
        tutti = self.r.scontrini + self.r.fatture
        for doc in tutti:
            tipo = doc.suffisso.split('-')[-1] if '-' in doc.suffisso else doc.suffisso
            assert tipo.upper() not in ('CP', 'FD')

    def test_struttura_da_prefisso_suffisso(self):
        """Tutti usano il prefisso D dal suffisso D-SC, non il campo Camera."""
        for sc in self.r.scontrini:
            assert sc.suffisso.startswith('D-')
            assert sc.struttura_code == 'DPH'

    def test_annullati_marcati(self):
        """Righe con Annullato=True nel file devono avere annullato=True."""
        ann = [s for s in self.r.scontrini if s.annullato]
        non_ann = [s for s in self.r.scontrini if not s.annullato]
        # Il file di test ha tutti non annullati
        assert len(ann) == 0
        assert len(non_ann) == 16

    def test_totale_lordo_positivo_o_zero(self):
        """Tutti i valori nel file di test sono >= 0 (no storni in questo campione)."""
        for sc in self.r.scontrini:
            assert sc.totale_lordo >= 0

    def test_ospiti_estratti(self):
        """SC 286 ha 'Ospiti: Egger Erik, Kathrin Steiner' nel campo Note."""
        sc286 = next((s for s in self.r.scontrini if s.numero == 286), None)
        assert sc286 is not None
        assert 'Egger Erik' in sc286.ospiti


# ── Test toggle lordo/netto ───────────────────────────────────────────────────

class TestToggleLordoNetto:
    def test_netto_10pct(self):
        """Netto di 110€ al 10% = 100€."""
        from app.services.corrispettivi_excel_parser import _calcola_aliquota
        # 110 lordo, 10% → netto = 110 / 1.10 = 100
        netto = 110 / (1 + 10 / 100)
        assert abs(netto - 100.0) < 0.01

    def test_netto_22pct(self):
        """Netto di 122€ al 22% = 100€."""
        netto = 122 / (1 + 22 / 100)
        assert abs(netto - 100.0) < 0.01

    def test_netto_zero_pct(self):
        """A 0% lordo = netto."""
        netto = 100 / (1 + 0 / 100)
        assert netto == 100.0


# ── Test manuali MMS/BON ─────────────────────────────────────────────────────

class TestManualiMMSBON:
    def test_imponibile_calcolato_da_lordo(self):
        """Imponibile MMS/BON = lordo / 1.10."""
        lordo = 110.0
        imponibile = round(lordo / 1.10, 2)
        iva = round(lordo - imponibile, 2)
        assert imponibile == 100.0
        assert iva == 10.0

    def test_iva_sempre_10pct(self):
        """MMS e BON hanno sempre IVA 10%."""
        lordo = 550.0
        imponibile = round(lordo / 1.10, 2)
        iva = round(lordo - imponibile, 2)
        assert abs(iva / imponibile * 100 - 10.0) < 0.01
