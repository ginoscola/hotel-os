"""Attività ricorrenti (scadenziario operativo). Solo calcoli, nessun accesso al DB.

Ogni attività del catalogo ha una frequenza (giornaliera, settimanale, mensile, annuale) e genera occorrenze con una
scadenza e una finestra: è "fatta" se nella finestra c'è un'evidenza (data di un import o del dato caricato, letta
dal router) oppure una spunta a mano. Con più `parti` (es. i tre hotel di Revenue) servono evidenze per tutte.
Finestre: giornaliera = il giorno del dato (scadenza il giorno dopo), settimanale = la settimana lun–dom della
scadenza, mensile = il mese, annuale = l'anno solare. Frequenze, giorni e mesi sono modificabili da Admin
(`applica_parametri`).
"""

import calendar
from bisect import bisect_left
from dataclasses import dataclass, replace
from datetime import date, timedelta
from typing import Optional

FREQUENZE = ("giornaliera", "settimanale", "mensile", "annuale")
STATI = ("in_ritardo", "da_fare", "fatta")
TUTTI_I_MESI = tuple(range(1, 13))
MESI_LUNGHI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre",
               "ottobre", "novembre", "dicembre"]
ETICHETTE_PARTI = {"disdetta": "disdette", "non_disdetta": "non disdette"}
GIORNI_LUNGHI = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"]


@dataclass(frozen=True)
class Attivita:
    codice: str
    titolo: str
    gruppo: str
    frequenza: str
    giorno: int = 1                 # settimanale: 0 = lunedì; mensile/annuale: giorno del mese (31 = ultimo)
    mese: Optional[int] = None      # solo annuale
    mesi: tuple = TUTTI_I_MESI      # mesi in cui l'attività va fatta
    stagione: tuple = ()            # giornaliere: hotel la cui stagione limita i giorni
    parti: tuple = ()               # evidenze richieste tutte (es. DPH, CLB, INT)
    automatica: bool = True         # False = HotelOS non può verificarla: solo spunta a mano
    link: str = ""
    nota: str = ""
    attiva: bool = True


ESTATE = (5, 6, 7, 8, 9)
DOPO_ESTATE = (6, 7, 8, 9, 10)       # dati del mese prima, da giugno (maggio) a ottobre (settembre)
INVERNO = (10, 11, 12, 1, 2, 3, 4, 5)

CATALOGO = [
    # ── Ogni giorno, in stagione ──
    Attivita("corr_welcome", "Import corrispettivi Welcome (giorno prima)", "Corrispettivi", "giornaliera",
             mesi=ESTATE, stagione=("DPH", "CLB", "INT"), link="/corrispettivi",
             nota="Excel Welcome dei documenti emessi: fatta se ci sono documenti di quel giorno."),
    Attivita("rt1", "Chiusura RT1 (Du Parc + Club) — CORRISP.xml", "Corrispettivi", "giornaliera",
             mesi=ESTATE, stagione=("DPH", "CLB"), link="/corrispettivi", nota="Controllo RT → Importa CORRISP.xml."),
    Attivita("rt2", "Chiusura RT2 (International) — CORRISP.xml", "Corrispettivi", "giornaliera",
             mesi=ESTATE, stagione=("INT",), link="/corrispettivi", nota="Controllo RT → Importa CORRISP.xml."),
    Attivita("incassi_mms", "Incasso Mare Mosso", "Corrispettivi", "giornaliera", mesi=ESTATE, stagione=("DPH",),
             link="/corrispettivi", nota="Corrispettivi giornalieri → cella MMS."),
    Attivita("incassi_bon", "Incasso Buona Onda", "Corrispettivi", "giornaliera", mesi=ESTATE, stagione=("INT",),
             link="/corrispettivi", nota="Corrispettivi giornalieri → cella BON."),
    # ── Ogni settimana ──
    Attivita("revenue", "Revenue: PlanningForecast dei tre hotel", "Revenue", "settimanale", giorno=0,
             mesi=(3, 4, 5, 6, 7, 8, 9), parti=("DPH", "CLB", "INT"), link="/import",
             nota="Due file per hotel; fatta se c'è la snapshot della settimana per ogni hotel."),
    Attivita("banca", "Estratti conto della banca (XML)", "Tesoreria", "settimanale", giorno=0,
             link="/tesoreria", nota="Import e saldi → conto principale e POS."),
    Attivita("cassa", "Versamenti contanti in Cassa", "Corrispettivi", "settimanale", giorno=0, mesi=ESTATE,
             link="/corrispettivi", nota="Tab Cassa: fatta se c'è un versamento nella settimana."),
    # ── Ogni mese ──
    Attivita("produzione", "Statistiche Produzione del mese prima", "Statistiche Produzione", "mensile", giorno=5,
             mesi=DOPO_ESTATE, link="/statistiche-produzione"),
    Attivita("analisi_ricavi", "Analisi Ricavi (Passbi) del mese prima", "Corrispettivi", "mensile", giorno=5,
             mesi=DOPO_ESTATE, link="/corrispettivi"),
    Attivita("prenotazioni", "Prenotazioni Welcome: disdette e non disdette", "Forecast", "mensile", giorno=5,
             parti=("disdetta", "non_disdetta"), link="/forecast", nota="Forecast → Importa Welcome, due file."),
    Attivita("previsione", "Salva previsione di cassa", "Tesoreria", "mensile", giorno=5, link="/tesoreria",
             nota="Previsione → Salva previsione: serve per confrontare previsto e reale."),
    Attivita("passcom", "Scadenzario fornitori Passcom", "Tesoreria", "mensile", giorno=5, link="/tesoreria"),
    Attivita("fatture_ade", "ZIP fatture ricevute dall'AdE (mese prima)", "Tesoreria", "mensile", giorno=5,
             link="/tesoreria",
             nota="Portale Fatture e Corrispettivi: Ricevute, data di ricezione, mese intero. Fatta se è caricato "
                  "uno ZIP che arriva a fine mese (Import e saldi)."),
    Attivita("cedolini", "Cedolini del mese prima", "Dipendenti", "mensile", giorno=10, link="/dipendenti",
             nota="Servono anche alla Tesoreria per gli stipendi del 10."),
    Attivita("coperti", "Coperti Mare Mosso e scontrini Buona Onda", "USALI", "mensile", giorno=10,
             mesi=DOPO_ESTATE, parti=("MMS", "BON"), link="/usali", nota="Food & Beverage → Coperti."),
    Attivita("amex", "Estratto American Express (chiusura il 6)", "Tesoreria", "mensile", giorno=10,
             link="/tesoreria", nota="Import e saldi → saldo manuale = importo dovuto."),
    Attivita("utenze", "Utenze: kWh, acqua, gas", "Statistiche Produzione", "mensile", giorno=15,
             link="/statistiche-produzione", nota="Occupazione e Consumo, dati del mese prima."),
    Attivita("caparre", "Completa la coda delle caparre", "Tesoreria", "mensile", giorno=15, mesi=INVERNO,
             automatica=False, link="/tesoreria"),
    Attivita("ce_contabile", "Export della contabilità (CE contabile)", "USALI", "mensile", giorno=20,
             link="/usali", nota="Conto Economico contabile → Import."),
    Attivita("tasca", "Saldo prepagata TASCA", "Tesoreria", "mensile", giorno=28, link="/tesoreria"),
    Attivita("bcc", "Estratto carta BCC (chiusura il 28)", "Tesoreria", "mensile", giorno=31, link="/tesoreria",
             nota="Import e saldi → saldo manuale = saldo attuale."),
    # ── Ogni anno ──
    Attivita("dich_iva", "Dichiarazione IVA {anno} (anno {prima}): credito IVA", "Tesoreria", "annuale", giorno=30,
             mese=4, automatica=False, link="/admin?s=tes-fiscale",
             nota="Dove: cassetto fiscale AdE → Dichiarazioni fiscali → modello «IVA {anno}», presentato nel {anno} "
                  "per l'anno d'imposta {prima} (se c'è, anche l'integrativa: vale l'ultima). Cosa serve: il credito "
                  "IVA annuo, quadro VL, rigo VL33. Dove va: Admin → Tesoreria → Dati fiscali, crediti IVA (oltre "
                  "5.000 € si usa in F24 solo dopo la presentazione). In alternativa: PDF in "
                  "uploads/tesoreria_campioni/fisco e lo inserisce Claude."),
    Attivita("tari_acconto", "Avviso TARI {anno} di acconto", "Tesoreria", "annuale", giorno=31, mese=5,
             automatica=False, link="/tesoreria",
             nota="Arriva per PEC dal Comune di Gabicce Mare verso maggio: acconto = 75% dell'anno prima, rate 30/6 "
                  "e 30/9. Dove va: Tesoreria → Impegni → avviso TARI, caricando il PDF della PEC."),
    Attivita("advertising", "Piano advertising della stagione successiva", "Tesoreria", "annuale", giorno=30, mese=9,
             automatica=False, link="/admin?s=tes-advertising"),
    Attivita("redditi", "Dichiarazioni Redditi SC e IRAP {anno} (anno {prima}): IRES e IRAP", "Tesoreria",
             "annuale", giorno=31, mese=10, automatica=False, link="/admin?s=tes-fiscale",
             nota="Dove: cassetto fiscale AdE → Dichiarazioni fiscali → modelli «Redditi Società di capitali (SC) "
                  "{anno}» e «IRAP {anno}», presentati nel {anno} per l'anno d'imposta {prima} (lo studio li invia "
                  "entro il 31/10: se non ci sono ancora, chiederli allo studio). Cosa serve: dalla Redditi SC l'IRES "
                  "dovuta e gli acconti versati (quadro RN), dall'IRAP l'imposta dovuta (quadro IR). Servono a "
                  "calcolare il 2° acconto di novembre e saldo e acconti dell'anno dopo. Dove va: Admin → Tesoreria "
                  "→ Dati fiscali. In alternativa: PDF in uploads/tesoreria_campioni/fisco e li inserisce Claude."),
    Attivita("tari_conguaglio", "Avviso TARI {anno} di conguaglio", "Tesoreria", "annuale", giorno=31, mese=10,
             automatica=False, link="/tesoreria",
             nota="Arriva per PEC dal Comune di Gabicce Mare verso fine ottobre: tariffe definitive, rata unica entro "
                  "il 1° dicembre. Dove va: Tesoreria → Impegni → avviso TARI, caricando il PDF della PEC."),
    Attivita("interventi", "Interventi dell'inverno: importi e rate", "Tesoreria", "annuale", giorno=31, mese=10,
             automatica=False, link="/admin?s=tes-interventi"),
    Attivita("stagioni", "Stagioni operative dell'anno dopo", "Admin", "annuale", giorno=30, mese=11,
             link="/admin?s=stagioni"),
    Attivita("budget", "Budget dell'anno dopo", "Budget", "annuale", giorno=15, mese=12, link="/budget"),
    Attivita("compensi", "Compensi soci dell'anno dopo", "Tesoreria", "annuale", giorno=31, mese=12, automatica=False,
             link="/admin?s=tes-compensi"),
]
PER_CODICE = {a.codice: a for a in CATALOGO}


# ── Parametri da Admin ────────────────────────────────────────────────────────

def valida_parametri(codice: str, body: dict) -> dict:
    """Override valido per un'attività: {giorno?, mese?, mesi?, attiva?}. ValueError se non valido."""
    att = PER_CODICE.get(codice)
    if att is None:
        raise ValueError(f"Attività sconosciuta: {codice}")
    out = {}
    if "giorno" in body:
        g = int(body["giorno"])
        massimo = 6 if att.frequenza == "settimanale" else 31
        minimo = 0 if att.frequenza == "settimanale" else 1
        if not minimo <= g <= massimo:
            raise ValueError(f"Giorno non valido: {g}")
        out["giorno"] = g
    if "mese" in body and att.frequenza == "annuale":
        m = int(body["mese"])
        if not 1 <= m <= 12:
            raise ValueError(f"Mese non valido: {m}")
        out["mese"] = m
    if "mesi" in body:
        mesi = sorted({int(m) for m in body["mesi"]})
        if not mesi or any(not 1 <= m <= 12 for m in mesi):
            raise ValueError("Scegliere almeno un mese valido")
        out["mesi"] = mesi
    if "attiva" in body:
        out["attiva"] = bool(body["attiva"])
    return out


def applica_parametri(parametri: dict) -> list:
    """Catalogo con gli override di Admin; le chiavi sconosciute o non valide sono ignorate."""
    out = []
    for att in CATALOGO:
        try:
            p = valida_parametri(att.codice, parametri.get(att.codice) or {})
        except (ValueError, TypeError):
            p = {}
        if "mesi" in p:
            p["mesi"] = tuple(p["mesi"])
        out.append(replace(att, **p))
    return out


# ── Occorrenze e stato ────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Occorrenza:
    attivita: Attivita
    scadenza: date
    da: date            # finestra in cui un'evidenza la rende fatta
    a: date
    giorno_dato: Optional[date] = None   # giornaliere: giorno a cui si riferisce il dato


def ultimo_giorno(anno: int, mese: int) -> int:
    return calendar.monthrange(anno, mese)[1]


def _in_stagione(d: date, att: Attivita, stagioni: dict) -> bool:
    if not att.stagione:
        return True
    return any(s[0] <= d <= s[1] for h in att.stagione for s in stagioni.get((h, d.year), ()))


def occorrenze(att: Attivita, anno: int, mese: int, stagioni: dict) -> list:
    """Occorrenze dell'attività con il giorno di riferimento nel mese. `stagioni` = {(hotel, anno): [(apertura,
    chiusura)]}; per una giornaliera con `stagione` e nessuna stagione configurata non ci sono occorrenze."""
    if not att.attiva or mese not in att.mesi:
        return []
    fine = ultimo_giorno(anno, mese)
    if att.frequenza == "giornaliera":
        giorni = (date(anno, mese, g) for g in range(1, fine + 1))
        return [Occorrenza(att, d + timedelta(days=1), d, d, d) for d in giorni if _in_stagione(d, att, stagioni)]
    if att.frequenza == "settimanale":
        out = []
        for g in range(1, fine + 1):
            d = date(anno, mese, g)
            if d.weekday() == att.giorno:
                lun = d - timedelta(days=d.weekday())
                out.append(Occorrenza(att, d, lun, lun + timedelta(days=6)))
        return out
    if att.frequenza == "mensile":
        return [Occorrenza(att, date(anno, mese, min(att.giorno, fine)), date(anno, mese, 1), date(anno, mese, fine))]
    if att.mese == mese:
        return [Occorrenza(att, date(anno, mese, min(att.giorno, fine)), date(anno, 1, 1), date(anno, 12, 31))]
    return []


def _c_e(date_ordinate: list, da: date, a: date) -> bool:
    i = bisect_left(date_ordinate, da)
    return i < len(date_ordinate) and date_ordinate[i] <= a


def stato(occ: Occorrenza, evidenze: dict, fatte: set, oggi: date) -> dict:
    """{stato, manuale, mancanti}. `evidenze` = {parte: date ordinate} ('' senza parti); `fatte` = {(codice,
    scadenza)} spuntate a mano."""
    att = occ.attivita
    if (att.codice, occ.scadenza) in fatte:
        return {"stato": "fatta", "manuale": True, "mancanti": []}
    parti = att.parti or ("",)
    if att.automatica:
        mancanti = [p for p in parti if not _c_e(evidenze.get(p, []), occ.da, occ.a)]
    else:
        mancanti = list(parti)
    if not mancanti:
        s = "fatta"
    elif occ.scadenza < oggi:
        s = "in_ritardo"
    else:
        s = "da_fare"
    return {"stato": s, "manuale": False, "mancanti": [p for p in mancanti if p]}


def settimane(anno: int, mese: int) -> list:
    """Settimane lun–dom che toccano il mese: [(lunedì, domenica)]."""
    primo = date(anno, mese, 1)
    lun = primo - timedelta(days=primo.weekday())
    fine = date(anno, mese, ultimo_giorno(anno, mese))
    out = []
    while lun <= fine:
        out.append((lun, lun + timedelta(days=6)))
        lun += timedelta(days=7)
    return out


def _peggiore(stati: list) -> str:
    return next(s for s in STATI if s in stati)


def testo(t: str, anno: int) -> str:
    """Titoli e note con l'anno dell'occorrenza: {anno} e {prima} (= anno − 1)."""
    return t.replace("{anno}", str(anno)).replace("{prima}", str(anno - 1))


def _voce(att: Attivita, anno: int) -> dict:
    return {"codice": att.codice, "titolo": testo(att.titolo, anno), "gruppo": att.gruppo,
            "frequenza": att.frequenza, "automatica": att.automatica, "link": att.link, "nota": testo(att.nota, anno)}


def voci_mese(catalogo: list, anno: int, mese: int, evidenze: dict, fatte: set, stagioni: dict,
              oggi: date) -> list:
    """Per ogni settimana del mese le voci con scadenza (o giorno del dato, per le giornaliere) in quella settimana.
    Le giornaliere sono una voce per settimana con l'elenco dei giorni. [{inizio, fine, voci}]."""
    out = [{"inizio": lun, "fine": dom, "voci": []} for lun, dom in settimane(anno, mese)]

    def settimana(d):
        return next(s for s in out if s["inizio"] <= d <= s["fine"])

    for att in catalogo:
        ev = evidenze.get(att.codice, {})
        giornalieri = {}
        for occ in occorrenze(att, anno, mese, stagioni):
            st = stato(occ, ev, fatte, oggi)
            if att.frequenza == "giornaliera":
                giornalieri.setdefault(settimana(occ.giorno_dato)["inizio"], []).append((occ, st))
                continue
            settimana(occ.scadenza)["voci"].append({
                **_voce(att, occ.scadenza.year), **st, "scadenza": occ.scadenza, "scadenze": [occ.scadenza], "giorni": None,
            })
        for lun, elenco in giornalieri.items():
            giorni = [{"data": o.giorno_dato, "scadenza": o.scadenza, **s} for o, s in elenco]
            settimana(lun)["voci"].append({
                **_voce(att, lun.year), "stato": _peggiore([g["stato"] for g in giorni]),
                "manuale": all(g["manuale"] for g in giorni), "mancanti": [],
                "scadenza": giorni[-1]["scadenza"], "scadenze": [g["scadenza"] for g in giorni], "giorni": giorni,
            })
    for s in out:
        s["voci"].sort(key=lambda v: (v["scadenza"], v["titolo"]))
    return out


def in_ritardo(per_mese: list) -> list:
    """Voci in ritardo di più mesi (liste di `voci_mese`), una sola voce per attività giornaliera con i soli giorni in
    ritardo."""
    out, giornaliere = [], {}
    for mese in per_mese:
        for sett in mese:
            for v in sett["voci"]:
                if v["stato"] != "in_ritardo":
                    continue
                if v["giorni"] is None:
                    out.append(v)
                    continue
                g = [x for x in v["giorni"] if x["stato"] == "in_ritardo"]
                if v["codice"] in giornaliere:
                    giornaliere[v["codice"]]["giorni"] += g
                else:
                    giornaliere[v["codice"]] = {**v, "giorni": g}
    for v in giornaliere.values():
        v["scadenze"] = [x["scadenza"] for x in v["giorni"]]
        v["scadenza"] = v["giorni"][0]["scadenza"]
        out.append(v)
    return sorted(out, key=lambda v: (v["scadenza"], v["titolo"]))


def riepilogo(sett: list) -> dict:
    conta = {s: 0 for s in STATI}
    for s in sett:
        for v in s["voci"]:
            conta[v["stato"]] += 1
    return conta


def descrivi_frequenza(att: Attivita) -> str:
    if att.frequenza == "giornaliera":
        testo = "ogni giorno" + (" in stagione" if att.stagione else "")
    elif att.frequenza == "settimanale":
        testo = f"ogni {GIORNI_LUNGHI[att.giorno]}"
    elif att.frequenza == "mensile":
        testo = "entro fine mese" if att.giorno >= 31 else f"entro il {att.giorno} del mese"
    else:
        testo = f"entro il {att.giorno} {MESI_LUNGHI[att.mese - 1]}"
    return testo
