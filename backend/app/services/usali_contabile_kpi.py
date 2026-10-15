"""KPI del Conto Economico USALI contabile (mensili e di periodo).

Importi dalla contabilità (usali_riga, eventualmente già segmentati); camere disponibili/vendute
e presenze dal consuntivo Revenue (`daily_revenue`, snapshot più recente per ogni data — stessa
regola di `_consuntivo_mensile` in forecast.py e `_revenue_mensile_hotel` in usali.py), letto
in un'unica query per l'anno, senza copiare i dati.

Stato produzione per mese:
- 'ok'               → camere disponibili > 0: KPI per camera calcolati
- 'chiuso'           → mese fuori stagione (hotel_seasons): solo costi, KPI per camera vuoti
- 'mancante'         → in stagione ma nessun dato Revenue: KPI per camera vuoti (mai zero)
- 'non_applicabile'  → struttura senza camere (es. BON)
I KPI di periodo per camera sommano numeratori e denominatori dei soli mesi 'ok' (mai medie
dei KPI mensili).
"""

from calendar import monthrange
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import extract, func
from sqlalchemy.orm import Session

from app.models.revenue import DailyRevenue, Hotel, HotelSeason
from app.models.usali_contabile import UsaliCategoriaKpi

CATEGORIE_KPI = ("personale", "food", "beverage", "commissioni", "utenze", "altro")

S_RICAVI = "Ricavi Operativi"
S_COSTI_OP = "Costi Operativi"
S_COSTI_GEN = "Costi Generali"
REP_CAMERE = "Camere"
REP_FNB = "Food & Beverage"

ZERO = Decimal(0)


def _a(riga, nome):
    return riga[nome] if isinstance(riga, dict) else getattr(riga, nome)


# ── Lettura dati ─────────────────────────────────────────────────────────────

def carica_mappa_categorie(db: Session) -> dict:
    """{(conto minuscolo, reparto minuscolo o ''): categoria}"""
    return {
        (m.conto_nome.strip().lower(), (m.reparto or "").strip().lower()): m.categoria
        for m in db.query(UsaliCategoriaKpi).all()
    }


def categoria_di(riga, mappa: dict):
    """Categoria KPI di una riga di costo: prima la regola specifica per reparto, poi quella
    generica. I ricavi non hanno categoria."""
    if _a(riga, "tipo") != "costo":
        return None
    nome = str(_a(riga, "conto_nome")).strip().lower()
    rep = (_a(riga, "reparto") or "").strip().lower()
    return mappa.get((nome, rep)) or mappa.get((nome, ""))


def produzione_mensile(db: Session, struttura: str, anno: int) -> dict:
    """{mese: {'stato', 'camere_disponibili', 'camere_vendute', 'presenze'}} per i 12 mesi."""
    hotel = db.query(Hotel).filter_by(code=struttura).first()
    if hotel is None:
        return {m: {"stato": "non_applicabile", "camere_disponibili": None,
                    "camere_vendute": None, "presenze": None} for m in range(1, 13)}

    da, a = date(anno, 1, 1), date(anno, 12, 31)
    sub = (
        db.query(DailyRevenue.data, func.max(DailyRevenue.snapshot_date).label("max_snap"))
        .filter(DailyRevenue.hotel_code == struttura, DailyRevenue.data.between(da, a),
                DailyRevenue.is_test == False)  # noqa: E712
        .group_by(DailyRevenue.data)
        .subquery()
    )
    righe = (
        db.query(
            extract("month", DailyRevenue.data).label("mese"),
            func.sum(DailyRevenue.rooms_available),
            func.sum(DailyRevenue.rooms_sold),
            func.sum(DailyRevenue.pax),
        )
        .join(sub, (DailyRevenue.data == sub.c.data) & (DailyRevenue.snapshot_date == sub.c.max_snap))
        .filter(DailyRevenue.hotel_code == struttura, DailyRevenue.is_test == False)  # noqa: E712
        .group_by("mese")
        .all()
    )
    dati = {int(m): (int(disp or 0), int(vend or 0), int(pax or 0)) for m, disp, vend, pax in righe}

    stagione = db.query(HotelSeason).filter_by(hotel_id=hotel.id, season_year=anno).first()

    out = {}
    for m in range(1, 13):
        disp, vend, pax = dati.get(m, (0, 0, 0))
        if disp > 0:
            stato = "ok"
        elif stagione is not None and (
            stagione.close_date < date(anno, m, 1)
            or stagione.open_date > date(anno, m, monthrange(anno, m)[1])
        ):
            stato = "chiuso"
        else:
            stato = "mancante"
        ok = stato == "ok"
        out[m] = {
            "stato": stato,
            "camere_disponibili": disp if ok else (0 if stato == "chiuso" else None),
            "camere_vendute": vend if ok else (0 if stato == "chiuso" else None),
            "presenze": pax if ok else (0 if stato == "chiuso" else None),
        }
    return out


# ── Calcolo (puro) ───────────────────────────────────────────────────────────

class _Imp:
    """Importi aggregati che servono ai KPI (costi come valori positivi)."""
    __slots__ = ("ricavi", "ricavi_camere", "ricavi_fnb", "costi_camere", "gop",
                 "personale", "personale_reparto", "commissioni_camere", "food", "beverage", "utenze")

    def __init__(self):
        for k in self.__slots__:
            setattr(self, k, ZERO)
        self.personale_reparto = defaultdict(lambda: ZERO)

    def aggiungi(self, altro: "_Imp"):
        for k in self.__slots__:
            if k == "personale_reparto":
                for rep, v in altro.personale_reparto.items():
                    self.personale_reparto[rep] += v
            else:
                setattr(self, k, getattr(self, k) + getattr(altro, k))


def _div(num, den, fattore=1):
    if num is None or den in (None, 0) or den == ZERO:
        return None
    return round(float(Decimal(num) / Decimal(den) * fattore), 2)


def _f(v):
    return None if v is None else round(float(v), 2)


def _kpi(imp: _Imp, prod: dict) -> dict:
    disp = prod.get("camere_disponibili") or 0
    vend = prod.get("camere_vendute") or 0
    per_camera = prod.get("stato") == "ok" and disp > 0
    D = disp if per_camera else None
    V = vend if per_camera else None
    return {
        "camere_disponibili": prod.get("camere_disponibili"),
        "camere_vendute": prod.get("camere_vendute"),
        "presenze": prod.get("presenze"),
        "ricavi": _f(imp.ricavi),
        "ricavi_camere": _f(imp.ricavi_camere),
        "ricavi_fnb": _f(imp.ricavi_fnb),
        "gop": _f(imp.gop),
        # Per camera: solo mesi con camere disponibili
        "occupazione": _div(V, D, 100),
        "adr": _div(imp.ricavi_camere, V),
        "revpar": _div(imp.ricavi_camere, D),
        "trevpar": _div(imp.ricavi, D),
        "goppar": _div(imp.gop, D),
        "cpor": _div(imp.costi_camere, V),
        "utenze_per_camera_venduta": _div(imp.utenze, V),
        # Rapporti sugli importi: indipendenti dalla produzione
        "gop_perc": _div(imp.gop, imp.ricavi, 100),
        "margine_camere_perc": _div(imp.ricavi_camere - imp.costi_camere, imp.ricavi_camere, 100),
        "costo_personale": _f(imp.personale),
        "costo_personale_perc": _div(imp.personale, imp.ricavi, 100),
        "personale_per_reparto": {rep: _f(v) for rep, v in imp.personale_reparto.items()},
        "commissioni_camere": _f(imp.commissioni_camere),
        "commissioni_perc_ricavi_camere": _div(imp.commissioni_camere, imp.ricavi_camere, 100),
        "food_cost": _f(imp.food),
        "food_cost_perc": _div(imp.food, imp.ricavi_fnb, 100),
        "beverage_cost": _f(imp.beverage),
        "beverage_cost_perc": _div(imp.beverage, imp.ricavi_fnb, 100),
        "utenze": _f(imp.utenze),
    }


def calcola_kpi(righe, mappa_categorie: dict, produzione: dict, anno: int,
                mese_da: int, mese_a: int, mesi_importati: set) -> dict:
    """
    righe: foglie dell'anno (mesi ≤ mese_a; quelli prima di mese_da servono solo al GOP
    cumulato da gennaio). produzione: output di produzione_mensile().
    """
    per_mese = defaultdict(_Imp)
    for r in righe:
        if _a(r, "anno") != anno:
            continue
        m = _a(r, "mese")
        imp = Decimal(str(_a(r, "importo")))
        sez, rep = _a(r, "sezione"), _a(r, "reparto")
        acc = per_mese[m]
        if sez == S_RICAVI:
            acc.ricavi += imp
            if rep == REP_CAMERE:
                acc.ricavi_camere += imp
            elif rep == REP_FNB:
                acc.ricavi_fnb += imp
        if sez in (S_RICAVI, S_COSTI_OP, S_COSTI_GEN):
            acc.gop += imp
        if sez == S_COSTI_OP and rep == REP_CAMERE:
            acc.costi_camere -= imp
        cat = categoria_di(r, mappa_categorie)
        costo = -imp   # costi in positivo; una rettifica (importo > 0) li riduce
        if cat == "personale":
            acc.personale += costo
            acc.personale_reparto[rep or sez or "—"] += costo
        elif cat == "commissioni" and sez == S_COSTI_OP and rep == REP_CAMERE:
            acc.commissioni_camere += costo
        elif cat == "food" and sez == S_COSTI_OP and rep == REP_FNB:
            acc.food += costo
        elif cat == "beverage" and sez == S_COSTI_OP and rep == REP_FNB:
            acc.beverage += costo
        elif cat == "utenze":
            acc.utenze += costo

    mesi = list(range(mese_da, mese_a + 1))
    mensili = []
    gop_cumulato = ZERO
    for m in range(1, mese_a + 1):
        importato = (anno, m) in mesi_importati
        imp = per_mese.get(m, _Imp())
        gop_cumulato += imp.gop
        if m < mese_da:
            continue
        prod = produzione.get(m, {"stato": "mancante"})
        if importato:
            k = _kpi(imp, prod)
        else:
            k = {key: None for key in _kpi(_Imp(), {})}
            k.update({key: prod.get(key) for key in ("camere_disponibili", "camere_vendute", "presenze")})
        mensili.append({
            "mese": m, "importato": importato, "stato_produzione": prod.get("stato"),
            "gop_cumulato": _f(gop_cumulato) if importato else None,
            **k,
        })

    # Periodo: importi su tutti i mesi importati; KPI per camera solo sui mesi 'ok'
    tot = _Imp()
    tot_aperti = _Imp()
    disp = vend = pax = 0
    for m in mesi:
        if (anno, m) not in mesi_importati:
            continue
        imp = per_mese.get(m, _Imp())
        tot.aggiungi(imp)
        prod = produzione.get(m, {})
        if prod.get("stato") == "ok":
            tot_aperti.aggiungi(imp)
            disp += prod["camere_disponibili"]
            vend += prod["camere_vendute"]
            pax += prod["presenze"] or 0
    mesi_aperti = [x["mese"] for x in mensili if x["importato"] and x["stato_produzione"] == "ok"]
    periodo = _kpi(tot, {"stato": "ok" if disp else "mancante",
                         "camere_disponibili": disp, "camere_vendute": vend, "presenze": pax})
    # KPI per camera di periodo: numeratori dei soli mesi aperti
    per_camera = _kpi(tot_aperti, {"stato": "ok" if disp else "mancante",
                                   "camere_disponibili": disp, "camere_vendute": vend, "presenze": pax})
    for k in ("occupazione", "adr", "revpar", "trevpar", "goppar", "cpor", "utenze_per_camera_venduta"):
        periodo[k] = per_camera[k]
    if not disp:
        periodo.update({"camere_disponibili": None, "camere_vendute": None, "presenze": None})

    return {
        "anno": anno, "mese_da": mese_da, "mese_a": mese_a,
        "mensili": mensili,
        "periodo": periodo,
        "mesi_per_camera": mesi_aperti,
        "mesi_senza_produzione": [x["mese"] for x in mensili
                                  if x["importato"] and x["stato_produzione"] == "mancante"],
    }
