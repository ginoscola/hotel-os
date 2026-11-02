"""Tesoreria — abbinamento degli impegni con i movimenti bancari, usato da impegni, piani e import degli estratti.

- Fiscali: un addebito "Delega Unificata" chiude tutti gli F24 con la stessa scadenza.
- Tassa di soggiorno: bonifico al Comune senza data fissa.
- Affitti: controparte e importo esatto chiudono da soli; solo uno dei due → proposto (pagamenti parziali o nomi diversi).
- Mutuo: importo esatto vicino alla scadenza. Ricorrenti: stessa categoria, sempre proposti se l'importo varia.
Chiude da solo solo l'importo esatto: le stime non coincidono quasi mai. Le scelte dell'utente non cambiano.
"""

from datetime import timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.tesoreria import (
    TesoreriaCategoria, TesoreriaContrattoAffitto, TesoreriaImpegno, TesoreriaMovimento, TesoreriaRicorrente,
)
from app.services.tesoreria_calendario import ZERO, abbina_gruppo
from app.services.tesoreria_piani import nome_corrisponde

FINESTRA_F24 = (1, 5)                # l'addebito arriva fino a qualche giorno dopo la scadenza
FINESTRA_TASSA = (20, 20)            # bonifico al Comune, senza data fissa
FINESTRA_AFFITTO = (45, 60)          # pagamenti spesso spostati rispetto al contratto
FINESTRA_MUTUO = (3, 5)
FINESTRA_RICORRENTE = (20, 20)
TIPI_SINGOLI = {"affitto", "mutuo", "ricorrente"}
TIPI_SENZA_BANCA = {"intervento", "carta"}   # interventi dallo scadenzario, carte dallo stato dell'estratto


def importo_impegno(i: TesoreriaImpegno) -> Decimal:
    return i.importo_confermato if i.importo_confermato is not None else i.importo_stimato


def _movimenti(db: Session, categoria_filtro, giorno, finestra) -> list:
    prima, dopo = finestra
    return db.query(TesoreriaMovimento).join(
        TesoreriaCategoria, TesoreriaCategoria.id == TesoreriaMovimento.categoria_id,
    ).filter(
        categoria_filtro, TesoreriaMovimento.importo < 0,
        TesoreriaMovimento.data_contabile >= giorno - timedelta(days=prima),
        TesoreriaMovimento.data_contabile <= giorno + timedelta(days=dopo),
    ).all()


def _segna(impegni, movimento_id, tipo, esito):
    for i in impegni:
        i.movimento_id, i.abbinamento = movimento_id, tipo
        if tipo == "automatico":
            i.stato = "pagato"
    esito["automatici" if tipo == "automatico" else "proposti"] += len(impegni)


def _abbina_affitto(db, i, contratti, usati, esito):
    contratto = contratti.get(i.codice.split(":")[1])
    importo = importo_impegno(i)
    candidati = [m for m in _movimenti(db, TesoreriaCategoria.codice == "affitti", i.data_scadenza, FINESTRA_AFFITTO)
                 if m.id not in usati]
    con_nome = [m for m in candidati if contratto and nome_corrisponde(m.controparte, contratto.nomi_banca)]
    esatti = [m for m in con_nome if -m.importo == importo]
    if esatti:
        scelto, tipo = min(esatti, key=lambda m: abs((m.data_contabile - i.data_scadenza).days)), "automatico"
    elif con_nome:
        scelto, tipo = min(con_nome, key=lambda m: (abs(-m.importo - importo), abs((m.data_contabile - i.data_scadenza).days))), "proposto"
    else:
        return
    usati.add(scelto.id)
    _segna([i], scelto.id, tipo, esito)


def _abbina_mutuo(db, i, usati, esito):
    importo = importo_impegno(i)
    candidati = [(m.id, -m.importo, abs((m.data_contabile - i.data_scadenza).days))
                 for m in _movimenti(db, TesoreriaCategoria.codice == "mutuo_rate", i.data_scadenza, FINESTRA_MUTUO)
                 if m.id not in usati]
    scelta = abbina_gruppo(importo, candidati)
    if scelta:
        usati.add(scelta[0])
        _segna([i], scelta[0], scelta[1], esito)


def _abbina_ricorrente(db, i, ricorrenti, usati, esito):
    r = ricorrenti.get(int(i.codice.split(":")[1]))
    if r is None:
        return
    importo = importo_impegno(i)
    # Stessa categoria di tante altre uscite: solo importi vicini (±20%) sono candidati credibili
    candidati = [(m.id, -m.importo, abs((m.data_contabile - i.data_scadenza).days))
                 for m in _movimenti(db, TesoreriaCategoria.id == r.categoria_id, i.data_scadenza, FINESTRA_RICORRENTE)
                 if m.id not in usati and abs(-m.importo - importo) <= importo * Decimal("0.2")]
    scelta = abbina_gruppo(importo, candidati)
    if scelta:
        usati.add(scelta[0])
        _segna([i], scelta[0], scelta[1], esito)


def abbina_impegni(db: Session) -> dict:
    """Propone il movimento bancario per gli impegni aperti. Non fa commit."""
    # Movimento eliminato (FK SET NULL): l'impegno torna aperto
    for i in db.query(TesoreriaImpegno).filter(TesoreriaImpegno.movimento_id.is_(None),
                                               TesoreriaImpegno.abbinamento.in_(("automatico", "confermato"))):
        i.abbinamento = None
        i.stato = "confermato" if i.importo_confermato is not None else "stimato"

    aperti = db.query(TesoreriaImpegno).filter(
        TesoreriaImpegno.stato != "pagato",
        TesoreriaImpegno.abbinamento.is_(None) | (TesoreriaImpegno.abbinamento == "proposto"),
    ).order_by(TesoreriaImpegno.data_scadenza).all()
    for i in aperti:
        if i.abbinamento == "proposto":
            i.movimento_id, i.abbinamento = None, None
    db.flush()
    usati = {m for (m,) in db.query(TesoreriaImpegno.movimento_id).filter(TesoreriaImpegno.movimento_id.isnot(None))}
    contratti = {c.codice: c for c in db.query(TesoreriaContrattoAffitto).all()}
    ricorrenti = {r.id: r for r in db.query(TesoreriaRicorrente).all()}
    esito = {"automatici": 0, "proposti": 0}

    gruppi = {}
    for i in aperti:
        if i.tipo == "affitto":
            _abbina_affitto(db, i, contratti, usati, esito)
        elif i.tipo == "mutuo":
            _abbina_mutuo(db, i, usati, esito)
        elif i.tipo == "ricorrente":
            _abbina_ricorrente(db, i, ricorrenti, usati, esito)
        elif i.tipo not in TIPI_SENZA_BANCA:
            categoria = "tassa_soggiorno" if i.tipo == "tassa_soggiorno" else "f24"
            gruppi.setdefault((categoria, i.data_scadenza), []).append(i)

    for (categoria, giorno), impegni in sorted(gruppi.items(), key=lambda g: g[0][1]):
        finestra = FINESTRA_TASSA if categoria == "tassa_soggiorno" else FINESTRA_F24
        candidati = [(m.id, -m.importo, abs((m.data_contabile - giorno).days))
                     for m in _movimenti(db, TesoreriaCategoria.codice == categoria, giorno, finestra) if m.id not in usati]
        da_pagare = sum((max(importo_impegno(i) - i.coperto_credito, ZERO) for i in impegni), ZERO)
        scelta = abbina_gruppo(da_pagare, candidati) if da_pagare > 0 else None
        if scelta:
            usati.add(scelta[0])
            _segna(impegni, scelta[0], scelta[1], esito)
    return esito
