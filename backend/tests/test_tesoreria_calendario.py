"""Test puri del calendario fiscale della Tesoreria: date di legge, generazione, credito IVA, abbinamento."""
import os
import sys
from datetime import date
from decimal import Decimal as D

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.tesoreria_calendario import (  # noqa: E402
    DatiFiscali, TrancheCredito, abbina_gruppo, genera_scadenze, pasqua, primo_lavorativo, reddito_anno_stimato,
    scadenza_legale, simula_credito, stima_f24,
)


def _codici(previste):
    return {p.codice: p for p in previste}


def test_pasqua_e_pasquetta():
    assert pasqua(2026) == date(2026, 4, 5)
    assert pasqua(2027) == date(2027, 3, 28)
    assert primo_lavorativo(date(2027, 3, 29)) == date(2027, 3, 30)


def test_slittamenti_verificati_sulle_quietanze():
    assert scadenza_legale(date(2025, 11, 16)) == date(2025, 11, 17)   # domenica
    assert scadenza_legale(date(2026, 5, 16)) == date(2026, 5, 18)     # sabato
    assert scadenza_legale(date(2025, 11, 30)) == date(2025, 12, 1)    # domenica
    assert scadenza_legale(date(2026, 3, 16)) == date(2026, 3, 16)


def test_proroga_di_ferragosto():
    assert scadenza_legale(date(2025, 8, 16)) == date(2025, 8, 20)
    assert scadenza_legale(date(2026, 8, 16)) == date(2026, 8, 20)
    assert scadenza_legale(date(2026, 8, 21)) == date(2026, 8, 21)


def test_stima_f24_ordine_delle_fonti():
    dati = DatiFiscali(f24_cedolini={(2026, 8): D("100"), (2026, 9): D("50")}, f24_storico={(2025, 10): D("70")})
    assert stima_f24(dati, 2026, 8)[0] == D("100")
    assert stima_f24(dati, 2026, 10)[0] == D("70")        # niente cedolini: F24 dell'anno prima
    assert stima_f24(dati, 2027, 8)[0] == D("100")        # anno dopo: cedolini dell'anno prima
    assert stima_f24(dati, 2027, 10)[0] == D("70")        # due anni prima
    assert stima_f24(dati, 2027, 3)[0] == D("0.00")


def test_f24_si_paga_il_mese_dopo_anche_a_dicembre():
    dati = DatiFiscali(f24_cedolini={(2026, 12): D("10")})
    p = _codici(genera_scadenze(date(2027, 1, 1), date(2027, 1, 31), dati))
    assert p["f24_dipendenti:2026-12"].data == date(2027, 1, 18)   # 16/1/2027 è sabato


def test_acconti_e_saldo_imposte():
    dati = DatiFiscali(imposte={"ires": {2024: D("4143"), 2025: D("3773"), 2026: D("5000")}, "irap": {}})
    p = _codici(genera_scadenze(date(2026, 11, 1), date(2027, 12, 31), dati))
    assert p["ires:acconto2:2026"].importo == D("1886.50")
    assert p["ires:acconto2:2026"].data == date(2026, 11, 30)
    assert p["ires:saldo:2026"].importo == D("1227.00")            # 5000 − 3773 di acconti
    assert p["ires:saldo:2026"].data == date(2027, 7, 20)
    assert p["ires:acconto1:2027"].importo + p["ires:acconto2:2027"].importo == D("5000.00")
    assert "ires:saldo:2025" not in p                              # a credito o fuori periodo


def test_nessun_saldo_se_a_credito():
    dati = DatiFiscali(imposte={"ires": {2025: D("3773"), 2026: D("3000")}, "irap": {}})
    assert "ires:saldo:2026" not in _codici(genera_scadenze(date(2027, 1, 1), date(2027, 12, 31), dati))


def test_tassa_di_soggiorno_per_trimestre_dall_anno_prima():
    dati = DatiFiscali(tassa_incassata={(2026, 7): D("30"), (2026, 9): D("20")})
    p = _codici(genera_scadenze(date(2027, 1, 1), date(2027, 12, 31), dati))
    assert p["tassa_soggiorno:2027-T3"].importo == D("50.00")
    assert p["tassa_soggiorno:2027-T3"].data == date(2027, 10, 15)
    assert not p["tassa_soggiorno:2027-T3"].compensabile
    assert "tassa_soggiorno:2027-T1" not in p


def test_tari_acconto_e_conguaglio():
    dati = DatiFiscali(tari_totali={2026: D("36753")})
    p = _codici(genera_scadenze(date(2027, 1, 1), date(2027, 12, 31), dati))
    assert p["tari:2027:acconto"].importo == D("27564.75")
    assert p["tari:2027:acconto"].data == date(2027, 6, 30)
    assert p["tari:2027:conguaglio"].importo == D("9188.25")
    assert p["tari:2027:conguaglio"].data == date(2027, 12, 1)
    assert not p["tari:2027:acconto"].compensabile


def test_tari_con_avviso_non_genera_la_stima():
    dati = DatiFiscali(tari_totali={2025: D("33652")}, tari_avvisi={(2026, "conguaglio")})
    assert "tari:2026:conguaglio" not in _codici(genera_scadenze(date(2026, 11, 1), date(2026, 12, 31), dati))


def test_credito_in_ordine_di_scadenza_e_non_compensabili_esclusi():
    tranche = [TrancheCredito(D("100"), date(2026, 1, 1))]
    coperti, residuo = simula_credito([
        (1, date(2026, 12, 16), D("80"), True),
        (2, date(2026, 11, 16), D("70"), True),
        (3, date(2026, 11, 1), D("500"), False),
    ], tranche)
    assert coperti == {3: D("0.00"), 2: D("70"), 1: D("30")}
    assert residuo == D("0")


def test_credito_oltre_5000_solo_dopo_la_dichiarazione():
    tranche = [TrancheCredito(D("20000"), date(2027, 4, 16), date(2027, 1, 1))]
    coperti, residuo = simula_credito([
        (1, date(2027, 2, 16), D("8000"), True),
        (2, date(2027, 3, 16), D("1000"), True),
        (3, date(2027, 5, 16), D("9000"), True),
    ], tranche)
    assert coperti[1] == D("5000.00")
    assert coperti[2] == D("0")
    assert coperti[3] == D("9000")
    assert residuo == D("6000.00")


def test_abbinamento_solo_l_importo_esatto_chiude_da_solo():
    assert abbina_gruppo(D("100.00"), [(1, D("100.00"), 2), (2, D("90.00"), 0)]) == (1, "automatico")
    assert abbina_gruppo(D("100.00"), [(1, D("120.00"), 2), (2, D("95.00"), 3)]) == (2, "proposto")
    assert abbina_gruppo(D("100.00"), []) is None


def test_iva_agosto_ultimo_versato():
    dati = DatiFiscali(iva_agosto={2025: D("18466.35"), 2026: D("5281.61")})
    p = _codici(genera_scadenze(date(2027, 1, 1), date(2027, 12, 31), dati))
    assert p["iva:2027-08"].importo == D("5281.61")
    assert p["iva:2027-08"].data == date(2027, 9, 16)


def test_reddito_stimato():
    assert reddito_anno_stimato({1: D("-10"), 2: D("-20"), 3: D("-30"), 7: D("500")}) == D("-60") + D("500") + 8 * D("-20")
    assert reddito_anno_stimato({7: D("500")}) is None
