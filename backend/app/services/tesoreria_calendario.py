"""Tesoreria — calendario fiscale: date di legge, generazione delle scadenze, simulazione del credito IVA,
abbinamento con la banca. Solo calcoli, nessun accesso al DB (i dati arrivano da routers/tesoreria_impegni.py).

Importi per tipo:
- F24 dipendenti (16 del mese dopo): cedolini del mese; senza cedolini, gli F24 storici dello stesso mese o
  l'anno prima. È il DOVUTO LORDO: i crediti del sostituto d'imposta (1701, 1704, 1631, 1627) non sono stimati.
- IVA: solo agosto (16/9), gli altri mesi sono a credito. Importo = ultimo versato: una stima da vendite e acquisti
  sbagliava di oltre 4 volte sul 2026 (23.140 € contro 5.282 €: credito del mese prima e fatture d'affitto).
- IRES/IRAP: acconti metà e metà dell'imposta dell'anno prima, saldo = imposta anno prima − suoi acconti.
- Tassa di soggiorno: incassata nel trimestre, versata il mese dopo.
- TARI: acconto 75% del totale dell'anno prima, poi conguaglio; con l'avviso valgono gli importi veri.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

ZERO = Decimal("0.00")
QUOTA_ACCONTO_TARI = Decimal("0.75")
LIMITE_CREDITO_ANTE_DICHIARAZIONE = Decimal("5000.00")
TRIMESTRI = {1: (1, 2, 3), 2: (4, 5, 6), 3: (7, 8, 9), 4: (10, 11, 12)}


def _cent(v) -> Decimal:
    return Decimal(v).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# ── Date ──────────────────────────────────────────────────────────────────────

def pasqua(anno: int) -> date:
    """Algoritmo di Gauss (forma anonima gregoriana)."""
    a, b, c = anno % 19, anno // 100, anno % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mese = (h + l - 7 * m + 114) // 31
    giorno = (h + l - 7 * m + 114) % 31 + 1
    return date(anno, mese, giorno)


def festivi(anno: int) -> set:
    fissi = [(1, 1), (1, 6), (4, 25), (5, 1), (6, 2), (8, 15), (11, 1), (12, 8), (12, 25), (12, 26)]
    return {date(anno, m, g) for m, g in fissi} | {pasqua(anno) + timedelta(days=1)}


def primo_lavorativo(d: date) -> date:
    while d.weekday() >= 5 or d in festivi(d.year):
        d += timedelta(days=1)
    return d


def scadenza_legale(d: date) -> date:
    """Proroga di Ferragosto (versamenti dal 1° al 20 agosto → 20/8), poi slittamento al primo giorno lavorativo."""
    if d.month == 8 and d.day <= 20:
        d = date(d.year, 8, 20)
    return primo_lavorativo(d)


# ── Generazione ───────────────────────────────────────────────────────────────

@dataclass
class ScadenzaPrevista:
    codice: str
    tipo: str
    descrizione: str
    competenza: str
    data: date
    importo: Decimal
    base: str
    compensabile: bool = True


@dataclass
class DatiFiscali:
    f24_cedolini: dict = field(default_factory=dict)     # {(anno, mese di paga): Decimal}
    f24_storico: dict = field(default_factory=dict)      # {(anno, mese di paga): Decimal}
    iva_agosto: dict = field(default_factory=dict)       # {anno: Decimal versato}
    tassa_incassata: dict = field(default_factory=dict)  # {(anno, mese): Decimal}
    imposte: dict = field(default_factory=dict)          # {'ires'|'irap': {anno: Decimal}}
    imposte_stimate: set = field(default_factory=set)    # {(tipo, anno)} calcolate e non da dichiarazione
    tari_totali: dict = field(default_factory=dict)      # {anno: Decimal}
    tari_avvisi: set = field(default_factory=set)        # {(anno, 'acconto'|'conguaglio')} già da avviso
    fissi: list = field(default_factory=list)            # [{codice, descrizione, mese, giorno, importo}]


def stima_f24(dati: DatiFiscali, anno: int, mese: int) -> tuple:
    """(importo, base). Per lo stesso mese, dall'anno più recente: prima i cedolini, poi gli F24 storici."""
    for a in range(anno, anno - 3, -1):
        nota = "" if a == anno else " (anni precedenti)"
        if (a, mese) in dati.f24_cedolini:
            return dati.f24_cedolini[(a, mese)], f"Cedolini {mese:02d}/{a}{nota}"
        if (a, mese) in dati.f24_storico:
            return dati.f24_storico[(a, mese)], f"F24 versato per {mese:02d}/{a}{nota}"
    return ZERO, "Nessun dato: inserire l'importo"


def _f24_dipendenti(dati, anno) -> list:
    out = []
    for mese_paga in range(1, 13):
        a, m = (anno, mese_paga + 1) if mese_paga < 12 else (anno + 1, 1)
        importo, base = stima_f24(dati, anno, mese_paga)
        out.append(ScadenzaPrevista(
            f"f24_dipendenti:{anno}-{mese_paga:02d}", "f24_dipendenti",
            f"F24 dipendenti {mese_paga:02d}/{anno}", f"{anno}-{mese_paga:02d}",
            scadenza_legale(date(a, m, 16)), importo, base,
        ))
    return out


def _iva(dati, anno) -> list:
    precedenti = [a for a in dati.iva_agosto if a <= anno]
    if not precedenti:
        return []
    importo, base = dati.iva_agosto[max(precedenti)], f"IVA di agosto versata nel {max(precedenti)}"
    return [ScadenzaPrevista(f"iva:{anno}-08", "iva", f"IVA agosto {anno}", f"{anno}-08",
                             scadenza_legale(date(anno, 9, 16)), importo, base)]


def _imposte(dati, anno, data_acconto: date) -> list:
    out = []
    for tipo, nome in (("ires", "IRES"), ("irap", "IRAP")):
        valori = dati.imposte.get(tipo, {})
        prec = valori.get(anno - 1)
        if prec is None:
            continue
        stimata = (tipo, anno - 1) in dati.imposte_stimate
        base = f"{nome} {anno - 1}" + (" stimata" if stimata else " da dichiarazione")
        data1, data2 = scadenza_legale(data_acconto), scadenza_legale(date(anno, 11, 30))
        acconti_prec = valori.get(anno - 2)
        if acconti_prec is not None and prec - acconti_prec > 0:
            out.append(ScadenzaPrevista(f"{tipo}:saldo:{anno - 1}", tipo, f"{nome} saldo {anno - 1}", str(anno - 1),
                                        data1, _cent(prec - acconti_prec),
                                        f"{base} − acconti versati"))
        meta = _cent(prec / 2)
        out.append(ScadenzaPrevista(f"{tipo}:acconto1:{anno}", tipo, f"{nome} 1° acconto {anno}", str(anno), data1,
                                    meta, f"Metà di {base}"))
        out.append(ScadenzaPrevista(f"{tipo}:acconto2:{anno}", tipo, f"{nome} 2° acconto {anno}", str(anno), data2,
                                    _cent(prec - meta), f"Metà di {base}"))
    return out


def _tassa_soggiorno(dati, anno, giorno: int) -> list:
    out = []
    for t, mesi in TRIMESTRI.items():
        a_sc, m_sc = (anno, mesi[-1] + 1) if t < 4 else (anno + 1, 1)
        for rif, base in ((anno, f"Incassata {t}° trimestre {anno}"),
                          (anno - 1, f"Incassata {t}° trimestre {anno - 1} (anno prima)")):
            importo = sum((dati.tassa_incassata.get((rif, m), ZERO) for m in mesi), ZERO)
            if importo:
                out.append(ScadenzaPrevista(
                    f"tassa_soggiorno:{anno}-T{t}", "tassa_soggiorno", f"Tassa di soggiorno {t}° trimestre {anno}",
                    f"{anno}-T{t}", primo_lavorativo(date(a_sc, m_sc, giorno)), _cent(importo), base,
                    compensabile=False,
                ))
                break
    return out


def _tari(dati, anno) -> list:
    totale = dati.tari_totali.get(anno - 1)
    if totale is None:
        return []
    acconto = _cent(totale * QUOTA_ACCONTO_TARI)
    out = []
    if (anno, "acconto") not in dati.tari_avvisi:
        out.append(ScadenzaPrevista(f"tari:{anno}:acconto", "tari", f"TARI {anno} acconto", str(anno),
                                    primo_lavorativo(date(anno, 6, 30)), acconto,
                                    f"75% del totale {anno - 1}", compensabile=False))
    if (anno, "conguaglio") not in dati.tari_avvisi:
        out.append(ScadenzaPrevista(f"tari:{anno}:conguaglio", "tari", f"TARI {anno} conguaglio", str(anno),
                                    primo_lavorativo(date(anno, 12, 1)), _cent(totale - acconto),
                                    f"Totale {anno - 1} − acconto", compensabile=False))
    return out


def _fissi(dati, anno) -> list:
    return [
        ScadenzaPrevista(f"tributo_fisso:{f['codice']}:{anno}", "tributo_fisso", f"{f['descrizione']} {anno}", str(anno),
                         scadenza_legale(date(anno, int(f["mese"]), int(f["giorno"]))), _cent(Decimal(str(f["importo"]))),
                         "Ultimo importo pagato")
        for f in dati.fissi
    ]


def genera_scadenze(da: date, a: date, dati: DatiFiscali, data_acconto_mese_giorno=(7, 20),
                    giorno_tassa: int = 15) -> list:
    """Scadenze con data in [da, a], in ordine di data."""
    out = []
    for anno in range(da.year - 1, a.year + 1):
        m, g = data_acconto_mese_giorno
        out += _f24_dipendenti(dati, anno) + _iva(dati, anno) + _imposte(dati, anno, date(anno, m, g))
        out += _tassa_soggiorno(dati, anno, giorno_tassa) + _tari(dati, anno) + _fissi(dati, anno)
    return sorted((s for s in out if da <= s.data <= a), key=lambda s: (s.data, s.codice))


# ── Stime ─────────────────────────────────────────────────────────────────────

def reddito_anno_stimato(risultato_per_mese: dict) -> Optional[Decimal]:
    """Risultato dei mesi noti + i mesi mancanti alla media di gennaio–marzo, fuori stagione come ottobre–dicembre.
    Senza nessuno di quei tre mesi non si può stimare: None."""
    fuori_stagione = [risultato_per_mese[m] for m in (1, 2, 3) if m in risultato_per_mese]
    if not fuori_stagione:
        return None
    media = sum(fuori_stagione, Decimal(0)) / len(fuori_stagione)
    return sum((risultato_per_mese.get(m, media) for m in range(1, 13)), Decimal(0))


# ── Credito IVA ───────────────────────────────────────────────────────────────

@dataclass
class TrancheCredito:
    importo: Decimal
    disponibile_dal: date                     # dopo la dichiarazione: tutto
    anticipabile_dal: Optional[date] = None   # prima della dichiarazione: fino a 5.000 €


def _disponibile(tranche: list, giorno: date) -> Decimal:
    totale = ZERO
    for t in tranche:
        if giorno >= t.disponibile_dal:
            totale += t.importo
        elif t.anticipabile_dal and giorno >= t.anticipabile_dal:
            totale += min(t.importo, LIMITE_CREDITO_ANTE_DICHIARAZIONE)
    return totale


def simula_credito(impegni: list, tranche: list) -> tuple:
    """`impegni`: [(id, data, importo, compensabile)] da pagare. Consuma il credito in ordine di scadenza.
    Restituisce ({id: coperto}, residuo finale)."""
    coperti, usato = {}, ZERO
    ultima = None
    for ident, giorno, importo, compensabile in sorted(impegni, key=lambda x: (x[1], str(x[0]))):
        ultima = giorno
        if not compensabile or importo <= 0:
            coperti[ident] = ZERO
            continue
        quota = max(min(importo, _disponibile(tranche, giorno) - usato), ZERO)
        coperti[ident] = quota
        usato += quota
    return coperti, (_disponibile(tranche, ultima) - usato) if ultima else sum((t.importo for t in tranche), ZERO)


# ── Abbinamento con la banca ──────────────────────────────────────────────────

def abbina_gruppo(da_pagare: Decimal, candidati: list) -> Optional[tuple]:
    """Un addebito può chiudere più F24 con la stessa scadenza. `candidati`: [(id, |importo|, distanza in giorni)].
    (id, 'automatico') se l'importo coincide al centesimo, altrimenti (id, 'proposto') sul più vicino per importo
    e, a parità, per data. None senza candidati: gli importi stimati non coincidono quasi mai, quindi solo la
    coincidenza esatta chiude da sola."""
    if not candidati:
        return None
    migliore = min(candidati, key=lambda c: (abs(c[1] - da_pagare), c[2]))
    return migliore[0], "automatico" if abs(migliore[1] - da_pagare) <= Decimal("0.01") else "proposto"
