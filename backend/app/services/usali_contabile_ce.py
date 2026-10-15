"""Conto Economico interno (scheda "Conto Economico" di USALI) alimentato dalla contabilità.

Per ogni (struttura, mese) con un import contabile, ricavi e costi del Conto Economico interno
vengono dalle righe `usali_riga`, con una corrispondenza fissa reparto/conto → voce. Eccezione
voluta: il costo del lavoro di Camere / F&B / Altri reparti resta quello dei cedolini (ripartizione
per centro di costo fatta in Dipendenti, coerente col resto di HotelOS); i conti contabili di
categoria "personale" non vanno nelle voci ma in un totale (`personale_contabile`), e la
differenza totale contabile − cedolini finisce in "Costo del lavoro non suddiviso". Così
l'EBITDAR coincide comunque con il GOP della scheda "Conto Economico contabile". Non Operativi (affitti…) e Deprezzamenti stanno sotto l'EBITDAR e
sono esclusi. I mesi senza import contabile restano sulle fonti di sempre (PMS + cedolini +
voci manuali), vedi get_report() in routers/usali.py.

Valori in positivo (ricavi e costi), come le voci del Conto Economico interno.
"""

from collections import defaultdict
from typing import Optional

from sqlalchemy.orm import Session

from app.models.usali_contabile import UsaliRiga
from app.services.usali_contabile_kpi import carica_mappa_categorie, categoria_di

S_RICAVI = "Ricavi Operativi"
S_COSTI_OP = "Costi Operativi"
S_COSTI_GEN = "Costi Generali"

# Voci che _calcola_struttura() legge dal dict `auto` (tutte le altre dal dict `manuali`)
VOCI_AUTO = ("ricavi_camere", "ricavi_fnb")

ATTREZZATURE_FNB = {
    "acquisto e noleggio attrezzature", "porcellana", "cristalleria", "posate", "utensili",
    "arredamento e attrezzature", "attrezzature cucina",
}
LAVANDERIA = {"biancheria", "lavanderia e pulizia a secco"}
CONSULENZE = {"prestazioni professionali"}

REPARTO_GENERALI = {
    "Funzionamento e Manutenzione della Proprietà": "manutenzioni",
    "Informatica e Telecomunicazioni": "informatica",
    "Utenze": "utenze",
    "Vendite e Marketing": "marketing",
}


def voce_interna(riga, categoria: Optional[str]) -> Optional[str]:
    """Voce del Conto Economico interno per una riga contabile di costo NON di personale o di
    ricavo (None = sotto l'EBITDAR). Il personale lo gestisce voci_da_contabile()."""
    sez, rep = riga.sezione, riga.reparto
    nome = (riga.conto_nome or "").strip().lower()

    if sez == S_RICAVI:
        return {
            "Camere": "ricavi_camere",
            "Food & Beverage": "ricavi_fnb",
            "Altri Reparti Operativi": "ricavi_altri_operativi",
        }.get(rep, "ricavi_vari_operativi")

    if sez == S_COSTI_OP:
        if rep == "Camere":
            if nome == "servizi con contratto":
                return "appalto_camere"
            if nome in LAVANDERIA:
                return "lavanderia"
            if nome in CONSULENZE:
                return "consulenze_camere"
            return "altri_costi_camere"
        if rep == "Food & Beverage":
            if categoria in ("food", "beverage"):
                return "fdv_fnb"
            if nome in ATTREZZATURE_FNB:
                return "attrezzature_fnb"
            if nome in CONSULENZE:
                return "consulenze_fnb"
            return "altri_costi_fnb"
        return "fdv_altri_reparti"

    if sez == S_COSTI_GEN:
        if rep in REPARTO_GENERALI:
            return REPARTO_GENERALI[rep]
        return "consulenze" if nome in CONSULENZE else "altri_costi_admin"

    return None   # Non Operativi, Deprezzamenti, non classificato


def mesi_contabili(db: Session, struttura: str, anno: int) -> set:
    return {
        m for (m,) in db.query(UsaliRiga.mese)
        .filter(UsaliRiga.struttura_code == struttura, UsaliRiga.anno == anno).distinct()
    }


def voci_da_contabile(db: Session, struttura: str, anno: int, mesi: list) -> dict:
    """{voce: importo positivo} sommato sui mesi dati, più:
    - 'personale_contabile': costo del personale totale in contabilità (sopra l'EBITDAR)
    - 'gop': GOP contabile, per il controllo EBITDAR = GOP."""
    if not mesi:
        return {}
    mappa = carica_mappa_categorie(db)
    righe = (
        db.query(UsaliRiga)
        .filter(UsaliRiga.struttura_code == struttura, UsaliRiga.anno == anno, UsaliRiga.mese.in_(mesi))
        .all()
    )
    out = defaultdict(float)
    for r in righe:
        if r.sezione not in (S_RICAVI, S_COSTI_OP, S_COSTI_GEN):
            continue
        imp = float(r.importo)
        out["gop"] += imp
        categoria = categoria_di(r, mappa)
        if categoria == "personale":
            out["personale_contabile"] -= imp
            continue
        out[voce_interna(r, categoria)] += imp if r.sezione == S_RICAVI else -imp
    return dict(out)
