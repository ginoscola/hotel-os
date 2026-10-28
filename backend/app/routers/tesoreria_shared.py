"""Costanti e helper comuni ai router del modulo Tesoreria (prefix /tesoreria).

Permessi: dipendenze per permesso di modulo (`app/permessi.py`), non `richiedi_admin` fisso —
di default solo gli admin, estendibile ad altri ruoli/utenti dal pannello Moduli.
"""

import os
import re
from decimal import Decimal
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from app.models.tesoreria import TesoreriaCategoria, TesoreriaMovimento, TesoreriaRegola
from app.permessi import richiedi_permesso
from app.services.tesoreria_classificatore import RegolaClassificazione, classifica
from app.utils.locale_it import formatta_euro_it

MODULO = "tesoreria"
CATEGORIA_RIPIEGO = "da_classificare"

puo_vedere = richiedi_permesso(MODULO, "vedere")
puo_modificare = richiedi_permesso(MODULO, "modificare")
puo_importare = richiedi_permesso(MODULO, "importare")


def storage_dir() -> Path:
    """Cartella file originali. Letta a ogni chiamata (i test la ridirigono via env)."""
    default = Path(__file__).resolve().parents[3] / "uploads" / "tesoreria"
    return Path(os.getenv("TESORERIA_DIR") or default)


def nome_sicuro(nome: str) -> str:
    nome = Path(nome or "file").name
    return re.sub(r"[^A-Za-z0-9._ -]", "_", nome)[:150] or "file"


def euro(valore: Optional[Decimal]) -> Optional[float]:
    """Decimal → float arrotondato al centesimo, solo per la risposta JSON."""
    return None if valore is None else round(float(valore), 2)


def id_ripiego(db: Session) -> Optional[int]:
    cat = db.query(TesoreriaCategoria.id).filter(TesoreriaCategoria.codice == CATEGORIA_RIPIEGO).first()
    return cat[0] if cat else None


def regole_attive(db: Session) -> list:
    """Regole attive in ordine di applicazione, solo su categorie attive."""
    righe = (
        db.query(TesoreriaRegola)
        .join(TesoreriaCategoria, TesoreriaCategoria.id == TesoreriaRegola.categoria_id)
        .filter(TesoreriaRegola.attiva.is_(True), TesoreriaCategoria.attivo.is_(True))
        .order_by(TesoreriaRegola.priorita, TesoreriaRegola.id)
        .all()
    )
    return [RegolaClassificazione.da_modello(r) for r in righe]


def categoria_automatica(descrizione: str, controparte: str, importo: Decimal,
                         regole: list, ripiego: Optional[int]) -> Optional[int]:
    return classifica(descrizione, controparte or "", importo, regole) or ripiego


def ricalcola_categorie(db: Session, regole: Optional[list] = None) -> dict:
    """Riapplica le regole a tutti i movimenti non classificati a mano. Non fa commit.
    Restituisce {n_controllati, n_cambiati}."""
    regole = regole_attive(db) if regole is None else regole
    ripiego = id_ripiego(db)
    n_cambiati = 0
    movimenti = db.query(TesoreriaMovimento).filter(TesoreriaMovimento.categoria_manuale.is_(False)).all()
    for m in movimenti:
        nuova = categoria_automatica(m.descrizione, m.controparte, m.importo, regole, ripiego)
        if nuova != m.categoria_id:
            m.categoria_id = nuova
            n_cambiati += 1
    return {"n_controllati": len(movimenti), "n_cambiati": n_cambiati}


def movimento_json(m: TesoreriaMovimento, categorie: dict) -> dict:
    cat = categorie.get(m.categoria_id)
    return {
        "id": m.id,
        "conto_id": m.conto_id,
        "import_id": m.import_id,
        "data_contabile": m.data_contabile.isoformat(),
        "data_valuta": m.data_valuta.isoformat() if m.data_valuta else None,
        "importo": euro(m.importo),
        "descrizione": m.descrizione,
        "controparte": m.controparte,
        "causale_abi": m.causale_abi,
        "categoria_id": m.categoria_id,
        "categoria_codice": cat.codice if cat else None,
        "categoria_nome": cat.nome if cat else None,
        "categoria_colore": cat.colore if cat else None,
        "categoria_manuale": m.categoria_manuale,
        "straordinario": m.straordinario,
        "note": m.note,
    }


def mappa_categorie(db: Session) -> dict:
    return {c.id: c for c in db.query(TesoreriaCategoria).all()}


# ── Export (xlsx/csv/pdf con _risposta_tabella di Corrispettivi) ───────────────

def cella_importo(valore, formato: str):
    """Numero vero nell'xlsx; testo in formato italiano in csv ("1234,56", leggibile da Excel) e pdf
    ("1.234,56")."""
    if valore is None:
        return ""
    if formato == "xlsx":
        return round(float(valore), 2)
    testo = formatta_euro_it(valore).removesuffix(" €")
    return testo.replace(".", "") if formato == "csv" else testo


def cella_data(valore) -> str:
    return valore.strftime("%d/%m/%Y") if valore else ""
