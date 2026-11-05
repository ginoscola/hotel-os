"""Tesoreria — stato delle fatture ricevute rispetto a scadenzario Passcom e banca (Fase 5, blocco B).

Le regole sono in `services/tesoreria_fatture.py` (pure). Qui si leggono i dati e si costruiscono:
- `aggiorna_fornitori_piva(db)`: impara partita IVA ↔ codice fornitore Passcom dalle fatture trovate nella
  fotografia corrente (Passcom non ha la partita IVA). Non fa commit.
- `rate_xml_da_abbinare(db)`: rate delle fatture non in Passcom, recenti, da cercare in banca insieme alle scadenze
  Passcom (stesso motore, stessa tabella degli abbinamenti, chiave `XML:{impronta}#{rata}`).
- `stato_fatture(db, oggi)`: stato di ogni fattura (senza il testo XML) + debiti da registrare per la previsione.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session, load_only

from app.models.tesoreria import (
    TesoreriaAbbinamento, TesoreriaAbbinamentoScadenza, TesoreriaFattura, TesoreriaFatturaScadenza,
    TesoreriaFornitorePiva, TesoreriaPagataManuale,
)
from app.services.tesoreria_abbinamento import forza_nome
from app.services.tesoreria_fatture import (
    PREFISSO_CHIAVE, STATI_DEBITO, compensa_note, da_abbinare, data_ricevuta, giorni_abituali, impronta_da_chiave,
    indice_passcom, limite_da_registrare, rate_da_pagare, stato_fattura, trova_in_passcom,
)

CAMPI_ELENCO = (
    "id", "import_id", "impronta", "id_sdi", "nome_file", "data_ricezione", "cedente_paese", "cedente_piva",
    "cedente_cf", "cedente_denominazione", "tipo_documento", "numero", "data_documento", "totale", "imponibile",
    "imposta", "ritenuta", "causale", "n_ddt", "ha_allegati",
)


@dataclass
class _Rata:
    numero: int
    modalita: Optional[str]
    data_scadenza: Optional[date]
    importo: Optional[Decimal]


def carica_fatture(db: Session) -> list:
    """Fatture senza il testo XML, con `rate` (lista di `_Rata`) attaccate."""
    fatture = db.query(TesoreriaFattura).options(
        load_only(*[getattr(TesoreriaFattura, c) for c in CAMPI_ELENCO])).all()
    rate = defaultdict(list)
    for r in db.query(TesoreriaFatturaScadenza).order_by(TesoreriaFatturaScadenza.numero_rata):
        rate[r.fattura_id].append(_Rata(r.numero_rata, r.modalita, r.data_scadenza, r.importo))
    for f in fatture:
        f.rate = rate.get(f.id, [])
    return fatture


def _codici_piva(db: Session) -> dict:
    return {p.piva: p for p in db.query(TesoreriaFornitorePiva)}


def _contesto(db: Session) -> dict:
    """Fotografia Passcom, limite "da registrare" e collegamenti fattura → scadenze Passcom."""
    from app.routers.tesoreria_abbinamenti import fornitori_carta, fotografia_corrente
    data_foto, scadenze = fotografia_corrente(db)
    ultima_reg = max((s.data_registrazione for s in scadenze if s.data_registrazione and not s.pareggio), default=None)
    fatture = carica_fatture(db)
    codici = _codici_piva(db)
    indice = indice_passcom(scadenze)
    in_passcom = {}
    for f in fatture:
        if f.autofattura:
            continue
        noto = codici.get(f.cedente_piva)
        trovate = trova_in_passcom(f, indice, noto.codice_fornitore if noto else None, forza_nome)
        if trovate:
            in_passcom[f.id] = trovate
    return {"data_foto": data_foto, "ultima_registrazione": ultima_reg, "limite": limite_da_registrare(ultima_reg),
            "fatture": fatture, "codici": codici, "in_passcom": in_passcom, "carta": fornitori_carta(db)}


def aggiorna_fornitori_piva(db: Session, ctx: Optional[dict] = None) -> int:
    """Salva partita IVA → codice Passcom delle fatture trovate nello scadenzario. Restituisce i nuovi/cambiati."""
    ctx = ctx or _contesto(db)
    n = 0
    for f in ctx["fatture"]:
        trovate = ctx["in_passcom"].get(f.id)
        if not trovate or not f.cedente_piva or len({s.codice_fornitore for s in trovate}) != 1:
            continue
        s = trovate[0]
        noto = ctx["codici"].get(f.cedente_piva)
        if noto is None:
            noto = TesoreriaFornitorePiva(piva=f.cedente_piva, codice_fornitore=s.codice_fornitore, fornitore=s.fornitore)
            db.add(noto)
            ctx["codici"][f.cedente_piva] = noto
            n += 1
        elif noto.codice_fornitore != s.codice_fornitore:
            noto.codice_fornitore, noto.fornitore = s.codice_fornitore, s.fornitore
            n += 1
    db.flush()
    return n


def _codice(f, codici: dict) -> str:
    noto = codici.get(f.cedente_piva)
    return noto.codice_fornitore if noto else f"PIVA:{f.cedente_piva or f.cedente_cf or f.id}"[:20]


def _giorni(fatture: list) -> dict:
    return giorni_abituali((f.cedente_piva, f.data_documento, r.data_scadenza) for f in fatture for r in f.rate)


def rate_xml_da_abbinare(db: Session, oggi: Optional[date] = None, ctx: Optional[dict] = None) -> list:
    """Rate delle fatture recenti non presenti in Passcom (né autofatture, né di fornitori pagati con carta)."""
    oggi = oggi or date.today()
    ctx = ctx or _contesto(db)
    giorni = _giorni(ctx["fatture"])
    out = []
    for f in ctx["fatture"]:
        if f.autofattura or f.id in ctx["in_passcom"] or not da_abbinare(data_ricevuta(f), ctx["limite"], oggi):
            continue
        codice = _codice(f, ctx["codici"])
        if codice in ctx["carta"]:
            continue
        out.extend(rate_da_pagare(f, codice, giorni.get(f.cedente_piva)))
    return out


def _pagamenti_xml(db: Session) -> dict:
    """{impronta: {stati degli abbinamenti non scartati}} delle rate XML."""
    out = defaultdict(set)
    for chiave, stato in db.query(TesoreriaAbbinamentoScadenza.chiave, TesoreriaAbbinamento.stato).join(
        TesoreriaAbbinamento, TesoreriaAbbinamento.id == TesoreriaAbbinamentoScadenza.abbinamento_id,
    ).filter(TesoreriaAbbinamentoScadenza.chiave.like(f"{PREFISSO_CHIAVE}%"), TesoreriaAbbinamento.stato != "scartato"):
        out[impronta_da_chiave(chiave)].add(stato)
    return out


def stato_fatture(db: Session, oggi: Optional[date] = None) -> dict:
    """Stato di ogni fattura, conteggi per stato e debiti da registrare (rate al netto delle note di credito)."""
    oggi = oggi or date.today()
    ctx = _contesto(db)
    pagamenti = _pagamenti_xml(db)
    manuali = {impronta_da_chiave(k) for (k,) in db.query(TesoreriaPagataManuale.chiave)
               .filter(TesoreriaPagataManuale.chiave.like(f"{PREFISSO_CHIAVE}%"))}
    giorni = _giorni(ctx["fatture"])
    righe, rate_debito = [], []
    for f in ctx["fatture"]:
        codice = _codice(f, ctx["codici"])
        stato = stato_fattura(f, f.id in ctx["in_passcom"], pagamenti.get(f.impronta, set()), f.impronta in manuali,
                              codice in ctx["carta"], ctx["limite"], oggi)
        rate = rate_da_pagare(f, codice, giorni.get(f.cedente_piva)) if not f.autofattura else []
        if stato in STATI_DEBITO:
            rate_debito.extend(rate)
        passcom = ctx["in_passcom"].get(f.id, [])
        righe.append({
            "fattura": f, "stato": stato, "codice_fornitore": codice if not codice.startswith("PIVA:") else None,
            "da_pagare": sum((r.importo for r in rate), Decimal("0.00")), "rate": rate,
            "passcom": [{"chiave": s.chiave, "codice_fornitore": s.codice_fornitore, "fornitore": s.fornitore,
                         "data_scadenza": s.data_scadenza, "importo": s.importo, "tipo_pagamento": s.tipo_pagamento}
                        for s in passcom],
        })
    conteggi = defaultdict(lambda: {"n": 0, "importo": Decimal("0.00")})
    for r in righe:
        conteggi[r["stato"]]["n"] += 1
        conteggi[r["stato"]]["importo"] += r["da_pagare"]
    return {
        "data_fotografia": ctx["data_foto"], "ultima_registrazione": ctx["ultima_registrazione"],
        "limite_da_registrare": ctx["limite"], "oggi": oggi, "righe": righe, "conteggi": dict(conteggi),
        "debiti": compensa_note(rate_debito),
    }
