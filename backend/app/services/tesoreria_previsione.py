"""Tesoreria — motore della previsione di cassa (Fase 3, blocco C). Solo calcoli, nessun accesso al DB.

Entrate del mese = entrate in banca dello stesso mese di riferimento × fattore (Budget dell'anno ÷ ricavi dell'anno
prima): il Budget dice quanto si fattura, lo storico della banca quando arrivano i soldi (caparre comprese).
Uscite certe = impegni + scadenzario. Uscite stimate = stesso mese di riferimento per categoria, senza straordinari,
con la crescita del gruppo, meno ciò che è già tra le certe o già pagato nel mese in corso.
"""

import calendar
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

ZERO = Decimal(0)
UNO = Decimal(1)
CENTO = Decimal(100)
GIORNI_CASSA_LIBERA = 90

# Categoria → gruppo di stima. Fuori dall'elenco: coperte da impegni (affitti, f24, tassa_soggiorno, mutuo_rate,
# assicurazioni), non operative, e compensi dei soci (decisi ogni anno in Admin, entrano come impegni).
GRUPPI_STIMA = {
    "fornitori_riba": "fornitori", "fornitori_bonifici": "fornitori", "fornitori_sdd": "fornitori", "assegni": "fornitori",
    "personale": "personale", "utenze": "utenze", "ota_marketing": "marketing", "carte": "carte",
    "spiagge": "altre", "auto": "altre", "banca": "altre",
}
GRUPPI_CRESCITA = ("fornitori", "marketing", "carte", "personale", "utenze", "altre")
CATEGORIE_DA_SCADENZARIO = {"fornitori"}
SCENARI = ("pessimista", "realista", "ottimista")
TIPI_FISCO = {"f24_dipendenti", "iva", "ires", "irap", "tari", "tributo_fisso", "tassa_soggiorno"}


def parametri_default() -> dict:
    return {
        # % di crescita sull'anno di riferimento; None = come il Budget
        "crescita": {"fornitori": None, "marketing": None, "carte": None, "personale": 0, "utenze": 0, "altre": 0},
        "scenari": {
            "pessimista": {"incassi_pct": -10, "uscite_stimate_pct": 5},
            "realista": {"incassi_pct": 0, "uscite_stimate_pct": 0},
            "ottimista": {"incassi_pct": 5, "uscite_stimate_pct": 0},
        },
    }


def mesi_tra(da: date, a: date) -> list:
    out, (y, m) = [], (da.year, da.month)
    while (y, m) <= (a.year, a.month):
        out.append((y, m))
        y, m = (y, m + 1) if m < 12 else (y + 1, 1)
    return out


def fine_mese(y: int, m: int) -> date:
    return date(y, m, calendar.monthrange(y, m)[1])


def anno_riferimento(y: int, m: int, oggi: date, presenti: set) -> Optional[int]:
    """Ultimo anno prima di `y` con quel mese già concluso e con dati."""
    for rif in range(y - 1, y - 4, -1):
        if fine_mese(rif, m) < oggi and (rif, m) in presenti:
            return rif
    return None


def fattore_budget(y: int, budget: dict, ricavi: dict) -> Decimal:
    """Budget dell'anno ÷ ricavi dell'anno prima. 1 se manca uno dei due (es. l'anno in corso, già senza budget)."""
    b, r = budget.get(y), ricavi.get(y - 1)
    return b / r if b and r else UNO


def stima_altri_crediti(storico: dict, y: int, m: int) -> Decimal:
    """Altri crediti degli F24 con scadenza nel mese: stesso mese dell'anno prima o, se manca, di due anni prima."""
    for rif in (y - 1, y - 2):
        if (rif, m) in storico:
            return storico[(rif, m)]
    return ZERO


@dataclass
class Certa:
    data: date
    importo: Decimal
    gruppo: str                      # fisco, affitti, mutuo, ricorrenti, interventi, compensi, advertising, carte, fornitori
    categoria: Optional[str] = None  # per sottrarla dalla stima (RAI da utenze, BCC da fornitori_sdd...)
    ident: Optional[int] = None      # id dell'impegno: serve alle prove
    codice: Optional[str] = None


def applica_prova(certe: list, sposta: dict, togli: set, aggiungi: list) -> list:
    """Prova "cosa succede se": date spostate {id impegno: data}, codici tolti, voci aggiunte. Non cambia nulla."""
    out = []
    for c in certe:
        if c.codice in togli:
            continue
        out.append(Certa(sposta.get(c.ident, c.data), c.importo, c.gruppo, c.categoria, c.ident, c.codice))
    return out + list(aggiungi)


@dataclass
class DatiPrevisione:
    oggi: date
    orizzonte: date
    saldo_iniziale: Decimal
    entrate: dict                    # {(y, m): Decimal} storiche dalla banca
    uscite: dict                     # {codice categoria: {(y, m): Decimal positivo}} senza straordinari
    certe: list                      # [Certa]
    budget: dict = field(default_factory=dict)        # {anno: Decimal}
    ricavi: dict = field(default_factory=dict)        # {anno: Decimal}
    fidi: list = field(default_factory=list)          # [(importo, scadenza o None)]
    parametri: dict = field(default_factory=parametri_default)
    advertising: dict = field(default_factory=dict)   # {(y, m): Decimal} advertising addebitato dalle carte nel mese


def _crescita(gruppo: str, fattore: Decimal, parametri: dict) -> Decimal:
    valore = parametri["crescita"].get(gruppo, 0)
    return fattore if valore is None else UNO + Decimal(str(valore)) / CENTO


def _mesi_con_dati(d: DatiPrevisione) -> set:
    """Mesi coperti dagli estratti conto. L'anno di riferimento è unico per tutte le categorie: una categoria senza
    spese in quel mese vale zero, non va a cercare lo stesso mese di un anno più vecchio."""
    return set(d.entrate).union(*(set(v) for v in d.uscite.values()))


def stime_mese(d: DatiPrevisione, y: int, m: int) -> dict:
    """{gruppo: stima} del mese, scenario realista, prima di togliere le uscite certe."""
    rif = anno_riferimento(y, m, d.oggi, _mesi_con_dati(d))
    if rif is None:
        return {}
    fattore = fattore_budget(y, d.budget, d.ricavi)
    gruppi = {}
    for categoria, gruppo in GRUPPI_STIMA.items():
        crescita = _crescita(gruppo, fattore, d.parametri) if y > d.oggi.year else UNO
        storico = d.uscite.get(categoria, {}).get((rif, m), ZERO)
        if categoria == "carte":
            # L'advertising è deciso in Admin ed entra come impegno: qui restano solo le altre spese con carta
            storico = max(storico - d.advertising.get((rif, m), ZERO), ZERO)
        gruppi[gruppo] = gruppi.get(gruppo, ZERO) + storico * crescita
    return gruppi


def entrate_mese(d: DatiPrevisione, y: int, m: int) -> Decimal:
    rif = anno_riferimento(y, m, d.oggi, _mesi_con_dati(d))
    if rif is None:
        return ZERO
    return d.entrate.get((rif, m), ZERO) * fattore_budget(y, d.budget, d.ricavi)


def _gia_avvenuto(storico: dict, y: int, m: int) -> Decimal:
    return storico.get((y, m), ZERO)


def calcola_scenario(d: DatiPrevisione, scenario: str) -> list:
    p = d.parametri["scenari"][scenario]
    k_incassi = UNO + Decimal(str(p["incassi_pct"])) / CENTO
    k_stime = UNO + Decimal(str(p["uscite_stimate_pct"])) / CENTO
    mesi = mesi_tra(d.oggi, d.orizzonte)
    corrente = mesi[0]

    certe_mese = {}
    for c in d.certe:
        chiave = max((c.data.year, c.data.month), corrente)    # uno scaduto si paga nel mese in corso
        if chiave <= mesi[-1]:
            certe_mese.setdefault(chiave, []).append(c)

    righe, saldo = [], d.saldo_iniziale
    for y, m in mesi:
        certe = certe_mese.get((y, m), [])
        per_gruppo = {}
        tolte = {}
        for c in certe:
            per_gruppo[c.gruppo] = per_gruppo.get(c.gruppo, ZERO) + c.importo
            gruppo_stima = GRUPPI_STIMA.get(c.categoria) if c.categoria else None
            if gruppo_stima:
                tolte[gruppo_stima] = tolte.get(gruppo_stima, ZERO) + c.importo

        entrate = entrate_mese(d, y, m)
        stime = stime_mese(d, y, m)
        if (y, m) == corrente:
            entrate = max(entrate - _gia_avvenuto(d.entrate, y, m), ZERO)
            for categoria, gruppo in GRUPPI_STIMA.items():
                if gruppo in stime:
                    tolte[gruppo] = tolte.get(gruppo, ZERO) + _gia_avvenuto(d.uscite.get(categoria, {}), y, m)
        stimate = {g: max(v - tolte.get(g, ZERO), ZERO) * k_stime for g, v in stime.items()}
        entrate *= k_incassi
        tot_certe = sum(per_gruppo.values(), ZERO)
        tot_stimate = sum(stimate.values(), ZERO)
        iniziale = saldo
        saldo = saldo + entrate - tot_certe - tot_stimate
        righe.append({
            "anno": y, "mese": m, "saldo_iniziale": iniziale, "entrate": entrate, "uscite_certe": per_gruppo,
            "uscite_stimate": stimate, "totale_certe": tot_certe, "totale_stimate": tot_stimate, "saldo_finale": saldo,
        })

    for r in righe:
        fine = fine_mese(r["anno"], r["mese"])
        limite = fine + timedelta(days=GIORNI_CASSA_LIBERA)
        impegnato = sum((c.importo for c in d.certe if fine < c.data <= limite), ZERO)
        fido = sum((imp for imp, scad in d.fidi if scad is None or fine <= scad), ZERO)
        r["cassa_impegnata_90"] = impegnato
        r["cassa_libera"] = r["saldo_finale"] - impegnato
        r["fido"] = fido
        r["stato"] = "sotto_fido" if r["saldo_finale"] < -fido else "sotto_zero" if r["saldo_finale"] < 0 else "ok"
    return righe
