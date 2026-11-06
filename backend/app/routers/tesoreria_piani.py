"""Tesoreria — piani (Fase 3, blocco B): affitti con rate in data e percentuale, mutuo, ricorrenti, interventi, carte.

I piani sono la fonte; `sincronizza_piani()` ne ricava gli impegni (fonte 'piano') a ogni modifica. Una correzione fatta
sull'impegno (importo confermato, data spostata) e gli impegni pagati non vengono sovrascritti.
Il blocco C userà gli impegni per togliere dalla stima storica ciò che è già coperto.
"""

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.tesoreria import (
    STATI_INTERVENTO, VOCI_COMPENSO, TesoreriaAdvertising, TesoreriaAdvertisingMese, TesoreriaCategoria, TesoreriaCompenso, TesoreriaConto, TesoreriaContrattoAffitto, TesoreriaImpegno,
    TesoreriaAbbinamento, TesoreriaAbbinamentoMovimento, TesoreriaAbbinamentoScadenza, TesoreriaCategoria, TesoreriaConto,
    TesoreriaIntervento, TesoreriaInterventoMovimento, TesoreriaInterventoScadenza, TesoreriaMovimento, TesoreriaRataAffitto, TesoreriaRataCompenso, TesoreriaRataIntervento, TesoreriaRataMutuo, TesoreriaRicorrente, TesoreriaSaldo,
)
from app.routers.tesoreria_impegni_abbina import abbina_impegni, importo_impegno
from app.routers.tesoreria_report import _addebiti_candidati
from app.routers.tesoreria_scadenzario_report import stato_scadenze
from app.routers.tesoreria_shared import euro, puo_importare, puo_modificare, puo_vedere
from app.services.tesoreria_abbinamento import forza_nome
from app.services.tesoreria_fatture import PREFISSO_CHIAVE, impronta_da_chiave
from app.services.tesoreria_parser import ErroreImportTesoreria
from app.services.tesoreria_piani import (
    MESI_STAGIONE, TOLLERANZA_PERCENTUALE, anno_calendario, chiudi_totale, data_addebito_advertising, data_addebito_carta, date_ricorrente, fine_mese, importi_rate, importi_rate_intervento, nome_corrisponde, parse_piano_mutuo,
    percentuali_effettive,
)
from app.services.tesoreria_report import stato_carta
from app.services.tesoreria_spese_straordinarie import (
    CATEGORIA_MODALITA, MODALITA, NOMI_MODALITA, anno_alberghiero, predefiniti,
)
from app.utils.locale_it import MESI_IT

router = APIRouter()

ORIZZONTE_DEFAULT = date(2027, 12, 31)
FINANZIAMENTO_DEFAULT = "036/307528"
SPESE_RATA_DEFAULT = Decimal("1.50")
CENTO = Decimal(100)


def _orizzonte(db: Session) -> date:
    from app.routers.tesoreria_impegni import leggi_parametri   # evita l'import circolare con gli impegni
    return date.fromisoformat(leggi_parametri(db)["orizzonte"])


def _decimale(valore, nome: str) -> Decimal:
    try:
        return Decimal(str(valore).replace(",", "."))
    except (InvalidOperation, ValueError):
        raise HTTPException(400, f"{nome} non valido: {valore!r}")


# ── Generazione degli impegni ───────────────────────────────────────────────────

def _previsti_affitti(db: Session) -> list:
    out = []
    for c in db.query(TesoreriaContrattoAffitto).filter(TesoreriaContrattoAffitto.attivo.is_(True)):
        rate = db.query(TesoreriaRataAffitto).filter(TesoreriaRataAffitto.contratto_id == c.id) \
            .order_by(TesoreriaRataAffitto.anno_competenza, TesoreriaRataAffitto.data_prevista, TesoreriaRataAffitto.id).all()
        for anno in sorted({r.anno_competenza for r in rate}):
            dell_anno = [r for r in rate if r.anno_competenza == anno]
            percentuali = _percentuali_anno(db, c, dell_anno)
            for r, p, importo in zip(dell_anno, percentuali, importi_rate(c.canone_annuo, percentuali)):
                out.append(dict(codice=f"affitto:{c.codice}:{r.id}", tipo="affitto", competenza=str(anno),
                                descrizione=f"Affitto {c.codice} canone {anno}", data=r.data_prevista, importo=importo,
                                base=f"{p.normalize():f}% del canone", stato="confermato"))
    return out


def _percentuali_anno(db: Session, c, dell_anno: list) -> list:
    """`dell_anno` in ordine di data. La percentuale salvata dell'ultima rata resta in tabella: torna valida se se ne aggiunge una dopo."""
    ultima = dell_anno[-1]
    bloccata = ultima.id is not None and (i := _impegno_rata(db, c, ultima.id)) is not None and i.stato == "pagato"
    return percentuali_effettive([r.percentuale for r in dell_anno], bloccata)


def _previsti_mutuo(db: Session, orizzonte: date) -> list:
    return [
        dict(codice=f"mutuo:{r.finanziamento}:{r.numero}", tipo="mutuo", competenza=r.data_scadenza.strftime("%Y-%m"),
             descrizione=f"Rata mutuo {r.finanziamento} n. {r.numero}", data=r.data_scadenza, importo=r.importo + r.spese,
             base=f"Piano della banca (spese {r.spese} € comprese)", stato="confermato")
        for r in db.query(TesoreriaRataMutuo).filter(TesoreriaRataMutuo.pagata_il.is_(None),
                                                     TesoreriaRataMutuo.data_scadenza <= orizzonte)
    ]


def _previsti_ricorrenti(db: Session, oggi: date, orizzonte: date) -> list:
    out = []
    for r in db.query(TesoreriaRicorrente).filter(TesoreriaRicorrente.attivo.is_(True)):
        for d in date_ricorrente(oggi, orizzonte, r.giorno, r.mesi, r.data_da, r.data_a):
            out.append(dict(codice=f"ricorrente:{r.id}:{d:%Y-%m}", tipo="ricorrente", competenza=d.strftime("%Y-%m"),
                            descrizione=r.descrizione, data=d, importo=r.importo, base="Ricorrente", stato="stimato"))
    return out


def _fatture_collegate(db: Session, intervento_id: int) -> list:
    return db.query(TesoreriaInterventoScadenza).filter(TesoreriaInterventoScadenza.intervento_id == intervento_id).all()


def _pagamenti_collegati(db: Session, intervento_id: int) -> list:
    return db.query(TesoreriaInterventoMovimento).filter(TesoreriaInterventoMovimento.intervento_id == intervento_id).all()


STATI_ABBINAMENTO_VALIDI = ("automatico", "confermato")


def _movimenti_di_fatture(db: Session, chiavi) -> set:
    """Movimenti in banca abbinati (automatico o confermato) ad almeno una delle fatture indicate."""
    chiavi = list(chiavi)
    if not chiavi:
        return set()
    return {m for (m,) in db.query(TesoreriaAbbinamentoMovimento.movimento_id).join(
        TesoreriaAbbinamento, TesoreriaAbbinamento.id == TesoreriaAbbinamentoMovimento.abbinamento_id,
    ).join(TesoreriaAbbinamentoScadenza, TesoreriaAbbinamentoScadenza.abbinamento_id == TesoreriaAbbinamento.id).filter(
        TesoreriaAbbinamento.stato.in_(STATI_ABBINAMENTO_VALIDI), TesoreriaAbbinamentoScadenza.chiave.in_(chiavi))}


def coperto_intervento(db: Session, i: TesoreriaIntervento) -> Decimal:
    """Parte della stima già coperta: fatture collegate (aperte = già tra le uscite certe, pagate = già uscite) più i
    pagamenti in banca collegati che non pagano una di quelle fatture (acconti, saldi senza fattura collegata)."""
    fatture = _fatture_collegate(db, i.id)
    di_fatture = _movimenti_di_fatture(db, [f.chiave for f in fatture])
    return (sum((f.importo for f in fatture), Decimal(0))
            + sum((p.importo for p in _pagamenti_collegati(db, i.id) if p.movimento_id not in di_fatture), Decimal(0)))


def residuo_intervento(db: Session, i: TesoreriaIntervento) -> Optional[Decimal]:
    """Stima meno fatture e pagamenti collegati. Mai sotto zero."""
    if i.importo_stimato is None:
        return None
    return max(i.importo_stimato - coperto_intervento(db, i), Decimal(0))


def _rate_dell_intervento(db: Session, intervento_id: int) -> list:
    return db.query(TesoreriaRataIntervento).filter(TesoreriaRataIntervento.intervento_id == intervento_id) \
        .order_by(TesoreriaRataIntervento.data_prevista, TesoreriaRataIntervento.id).all()


def rate_intervento(db: Session, i: TesoreriaIntervento) -> list:
    """[(rata, importo, da fatturare)] in ordine di data; vuota senza importo stimato."""
    rate = _rate_dell_intervento(db, i.id)
    if i.importo_stimato is None or not rate:
        return []
    calcolate = importi_rate_intervento(i.importo_stimato, [r.percentuale for r in rate], coperto_intervento(db, i))
    return [(r, importo, residuo) for r, (importo, residuo) in zip(rate, calcolate)]


def _previsti_interventi(db: Session) -> list:
    out = []
    for i in db.query(TesoreriaIntervento).filter(TesoreriaIntervento.inclusa_in_previsione.is_(True)):
        if i.stato == "pagato":
            continue
        rate = rate_intervento(db, i)
        for n, (r, _, residuo) in enumerate(rate, 1):
            if residuo > 0:
                rata = f" (rata {n} di {len(rate)})" if len(rate) > 1 else ""
                out.append(dict(codice=f"intervento:{i.id}:{r.id}", tipo="intervento", competenza=r.data_prevista.strftime("%Y-%m"),
                                descrizione=f"Intervento: {i.descrizione}{rata}", data=r.data_prevista, importo=residuo,
                                base=f"Intervento ({i.stato})", stato="stimato"))
    return out


def _rate_del_compenso(db: Session, compenso_id: int) -> list:
    return db.query(TesoreriaRataCompenso).filter(TesoreriaRataCompenso.compenso_id == compenso_id) \
        .order_by(TesoreriaRataCompenso.data_prevista, TesoreriaRataCompenso.id).all()


def _previsti_compensi(db: Session) -> list:
    out = []
    for c in db.query(TesoreriaCompenso):
        rate = _rate_del_compenso(db, c.id)
        for n, (r, importo) in enumerate(zip(rate, importi_rate(c.importo, [x.percentuale for x in rate])), 1):
            rata = f" (rata {n} di {len(rate)})" if len(rate) > 1 else ""
            out.append(dict(codice=f"compenso:{c.voce}:{c.anno_competenza}:{r.id}", tipo="compenso", competenza=str(c.anno_competenza),
                            descrizione=f"Compensi {c.voce} {c.anno_competenza}{rata}", data=r.data_prevista, importo=importo,
                            base=f"{r.percentuale.normalize():f}% del compenso deciso", stato="confermato"))
    return out


def _mesi_advertising(db: Session, advertising_id: int) -> list:
    """Mesi del piano in ordine di stagione, da ottobre a settembre."""
    mesi = db.query(TesoreriaAdvertisingMese).filter(TesoreriaAdvertisingMese.advertising_id == advertising_id).all()
    return sorted(mesi, key=lambda r: MESI_STAGIONE.index(r.mese))


def _previsti_advertising(db: Session, oggi: date, carte: list) -> list:
    """Spesa di ogni mese → uscita con l'addebito della carta del mese dopo. Saltata se già addebitata o se l'estratto
    di quel mese è già inserito (lo contiene già)."""
    con_estratto = {(p["codice"].split(":")[1], p["data"].year, p["data"].month) for p in carte}
    out = []
    for a in db.query(TesoreriaAdvertising):
        conto = db.get(TesoreriaConto, a.conto_id)
        for r in _mesi_advertising(db, a.id):
            anno = anno_calendario(a.anno, r.mese)
            data = data_addebito_advertising(anno, r.mese, conto.giorno_addebito)
            if r.importo <= 0 or data < oggi or (conto.codice, data.year, data.month) in con_estratto:
                continue
            out.append(dict(codice=f"advertising:{anno}:{r.mese}", tipo="advertising", competenza=f"{anno}-{r.mese:02d}",
                            descrizione=f"Advertising {MESI_IT[r.mese - 1]} {anno} ({conto.nome})", data=data, importo=r.importo,
                            base="Spesa decisa in Admin", stato="confermato"))
    return out


def _previsti_carte(db: Session, oggi: date) -> list:
    """L'ultimo estratto inserito e non ancora addebitato è un'uscita certa. I mesi dopo li stima il blocco C."""
    out = []
    for c in db.query(TesoreriaConto).filter(TesoreriaConto.tipo == "carta_credito", TesoreriaConto.attivo.is_(True)):
        s = db.query(TesoreriaSaldo).filter(TesoreriaSaldo.conto_id == c.id, TesoreriaSaldo.data <= oggi) \
            .order_by(TesoreriaSaldo.data.desc()).first()
        if s is None or not s.saldo:
            continue
        stato = stato_carta(s.data, s.saldo, _addebiti_candidati(db, s.data, s.saldo), c.testo_addebito, oggi)
        if stato["stato"] == "da_addebitare":
            out.append(dict(codice=f"carta:{c.codice}:{s.data}", tipo="carta", competenza=s.data.strftime("%Y-%m"),
                            descrizione=f"Estratto {c.nome} del {s.data:%d/%m/%Y}",
                            data=data_addebito_carta(s.data, c.giorno_addebito, oggi), importo=s.saldo,
                            base="Estratto inserito", stato="confermato"))
    return out


STATI_PAGATA = ("pagata_banca", "pagata_manuale", "pagata_carta")


STATI_SDI_CHIUSA = STATI_PAGATA + ("chiusa",)


def _stato_fatture_sdi(db: Session, oggi: date) -> dict:
    """{impronta: riga di stato_fatture} (import locale: tesoreria_fatture_stato non deve dipendere dai piani)."""
    from app.routers.tesoreria_fatture_stato import stato_fatture
    return {r["fattura"].impronta: r for r in stato_fatture(db, oggi)["righe"]}


def _migra_fatture_sdi(db: Session, righe_sdi: dict) -> None:
    """Fattura SDI collegata e poi registrata dallo studio: il collegamento passa alle sue scadenze Passcom."""
    gia = {c for (c,) in db.query(TesoreriaInterventoScadenza.chiave)}
    viste = set()
    for f in db.query(TesoreriaInterventoScadenza).filter(TesoreriaInterventoScadenza.chiave.like(f"{PREFISSO_CHIAVE}%")).all():
        impronta = impronta_da_chiave(f.chiave)
        riga = righe_sdi.get(impronta)
        if not riga or riga["stato"] != "in_scadenzario" or not riga["passcom"]:
            continue
        if (f.intervento_id, impronta) not in viste:
            viste.add((f.intervento_id, impronta))
            for s in riga["passcom"]:
                if s["chiave"] not in gia:
                    gia.add(s["chiave"])
                    db.add(TesoreriaInterventoScadenza(intervento_id=f.intervento_id, chiave=s["chiave"], fornitore=s["fornitore"],
                                                       data_scadenza=s["data_scadenza"], numero_documento=f.numero_documento,
                                                       importo=Decimal(str(s["importo"])), modalita_pagamento=f.modalita_pagamento,
                                                       data_pagamento=f.data_pagamento))
        db.delete(f)
    db.flush()


def _segna_pagamenti_straordinari(db: Session) -> None:
    """I pagamenti in banca delle fatture collegate a una spesa straordinaria escono dalle stime degli anni dopo.
    Solo se il pagamento copre esclusivamente fatture collegate (una Ri.Ba. con fatture ordinarie resta ordinaria)."""
    collegate = {c for (c,) in db.query(TesoreriaInterventoScadenza.chiave)}
    if not collegate:
        return
    per_abb = {}
    for abb_id, chiave in db.query(TesoreriaAbbinamentoScadenza.abbinamento_id, TesoreriaAbbinamentoScadenza.chiave).join(
            TesoreriaAbbinamento, TesoreriaAbbinamento.id == TesoreriaAbbinamentoScadenza.abbinamento_id).filter(
            TesoreriaAbbinamento.stato.in_(STATI_ABBINAMENTO_VALIDI)):
        per_abb.setdefault(abb_id, set()).add(chiave)
    abbinamenti = [a for a, chiavi in per_abb.items() if chiavi <= collegate]
    if not abbinamenti:
        return
    ids = [m for (m,) in db.query(TesoreriaAbbinamentoMovimento.movimento_id)
           .filter(TesoreriaAbbinamentoMovimento.abbinamento_id.in_(abbinamenti))]
    db.query(TesoreriaMovimento).filter(TesoreriaMovimento.id.in_(ids), TesoreriaMovimento.straordinario.is_(False)) \
        .update({TesoreriaMovimento.straordinario: True}, synchronize_session=False)


def _aggiorna_interventi_pagati(db: Session, oggi: date) -> None:
    """Spesa pagata: fatture e pagamenti a coprire tutta la stima, fatture tutte pagate (o uscite dallo scadenzario)."""
    con_sdi = db.query(TesoreriaInterventoScadenza.id).filter(TesoreriaInterventoScadenza.chiave.like(f"{PREFISSO_CHIAVE}%")).first()
    righe_sdi = _stato_fatture_sdi(db, oggi) if con_sdi else {}
    if con_sdi:
        _migra_fatture_sdi(db, righe_sdi)
    _segna_pagamenti_straordinari(db)
    ids = {i for (i,) in db.query(TesoreriaInterventoScadenza.intervento_id)} | {i for (i,) in db.query(TesoreriaInterventoMovimento.intervento_id)}
    collegati = db.query(TesoreriaIntervento).filter(TesoreriaIntervento.id.in_(ids or [0]), TesoreriaIntervento.stato != "pagato").all()
    if not collegati:
        return
    aperte = {s["chiave"]: s["stato"] for s in stato_scadenze(db, oggi)["scadenze"]}

    def pagata(f) -> bool:
        if f.chiave.startswith(PREFISSO_CHIAVE):
            riga = righe_sdi.get(impronta_da_chiave(f.chiave))
            return riga is None or riga["stato"] in STATI_SDI_CHIUSA
        return f.chiave not in aperte or aperte[f.chiave] in STATI_PAGATA

    for i in collegati:
        if all(pagata(f) for f in _fatture_collegate(db, i.id)) and residuo_intervento(db, i) == 0:
            i.stato = "pagato"


def sincronizza_piani(db: Session, oggi: date) -> dict:
    """Allinea gli impegni di fonte 'piano' ai piani. Non fa commit."""
    _aggiorna_interventi_pagati(db, oggi)
    orizzonte = _orizzonte(db)
    carte = _previsti_carte(db, oggi)
    previsti = (_previsti_affitti(db) + _previsti_mutuo(db, orizzonte) + _previsti_ricorrenti(db, oggi, orizzonte)
                + _previsti_interventi(db) + _previsti_compensi(db) + _previsti_advertising(db, oggi, carte) + carte)
    esistenti = {i.codice: i for i in db.query(TesoreriaImpegno).filter(TesoreriaImpegno.fonte == "piano")}
    n_nuovi = n_aggiornati = 0
    for p in previsti:
        i = esistenti.get(p["codice"])
        if i is None:
            db.add(TesoreriaImpegno(codice=p["codice"], tipo=p["tipo"], fonte="piano", descrizione=p["descrizione"],
                                    competenza=p["competenza"], data_scadenza=p["data"], importo_stimato=p["importo"],
                                    base_stima=p["base"], compensabile=False, stato=p["stato"]))
            n_nuovi += 1
        elif i.stato != "pagato":
            i.importo_stimato, i.base_stima, i.descrizione, i.competenza = p["importo"], p["base"], p["descrizione"], p["competenza"]
            if not i.data_manuale:
                i.data_scadenza = p["data"]
            n_aggiornati += 1
    codici = {p["codice"] for p in previsti}
    n_rimossi = 0
    for codice, i in esistenti.items():
        if codice in codici or i.stato == "pagato":
            continue
        db.delete(i)
        n_rimossi += 1
    db.flush()
    return {"n_nuovi": n_nuovi, "n_aggiornati": n_aggiornati, "n_rimossi": n_rimossi}


def _applica(db: Session) -> None:
    sincronizza_piani(db, date.today())
    abbina_impegni(db)
    db.commit()


# ── Affitti ─────────────────────────────────────────────────────────────────────

def _contratto_o_404(db, contratto_id) -> TesoreriaContrattoAffitto:
    c = db.get(TesoreriaContrattoAffitto, contratto_id)
    if c is None:
        raise HTTPException(404, "Contratto non trovato")
    return c


def _rata_o_404(db, rata_id) -> TesoreriaRataAffitto:
    r = db.get(TesoreriaRataAffitto, rata_id)
    if r is None:
        raise HTTPException(404, "Rata non trovata")
    return r


def _impegno_rata(db, contratto, rata_id) -> Optional[TesoreriaImpegno]:
    return db.query(TesoreriaImpegno).filter(TesoreriaImpegno.codice == f"affitto:{contratto.codice}:{rata_id}").first()


def _verifica_percentuali(db, c, anno, data_rata, percentuale, escludi=None):
    """Controlla il piano dell'anno come sarà dopo la modifica, con l'ultima rata automatica."""
    if percentuale <= 0:
        raise HTTPException(400, "La percentuale deve essere maggiore di zero")
    altre = [r for r in db.query(TesoreriaRataAffitto).filter(TesoreriaRataAffitto.contratto_id == c.id,
                                                              TesoreriaRataAffitto.anno_competenza == anno)
             if r.id != escludi]
    prova = TesoreriaRataAffitto(id=escludi, data_prevista=data_rata, percentuale=percentuale)
    piano = sorted([*altre, prova], key=lambda r: (r.data_prevista, r.id if r.id is not None else float("inf")))
    effettive = _percentuali_anno(db, c, piano)
    if min(effettive) <= 0 or sum(effettive) > CENTO + TOLLERANZA_PERCENTUALE:
        raise HTTPException(400, f"Le rate del canone {anno} prima dell'ultima arrivano già al 100%: ridurle, oppure eliminare l'ultima e reinserirla")


def _contratto_json(db, c: TesoreriaContrattoAffitto) -> dict:
    rate = db.query(TesoreriaRataAffitto).filter(TesoreriaRataAffitto.contratto_id == c.id) \
        .order_by(TesoreriaRataAffitto.anno_competenza, TesoreriaRataAffitto.data_prevista, TesoreriaRataAffitto.id).all()
    anni = []
    righe = []
    for anno in sorted({r.anno_competenza for r in rate}):
        dell_anno = [r for r in rate if r.anno_competenza == anno]
        pagato = Decimal(0)
        percentuali = _percentuali_anno(db, c, dell_anno)
        for n, (r, p, importo) in enumerate(zip(dell_anno, percentuali, importi_rate(c.canone_annuo, percentuali))):
            i = _impegno_rata(db, c, r.id)
            effettivo = importo_impegno(i) if i else importo
            if i and i.stato == "pagato":
                pagato += effettivo
            righe.append({"id": r.id, "anno_competenza": anno, "data_prevista": (i.data_scadenza if i else r.data_prevista).isoformat(),
                          "percentuale": float(p), "automatica": n == len(dell_anno) - 1 and n > 0 and not (i and i.stato == "pagato"),
                          "importo": euro(effettivo), "nota": r.nota, "stato": i.stato if i else "stimato",
                          "abbinamento": i.abbinamento if i else None})
        pianificato = sum(percentuali, Decimal(0))
        anni.append({"anno": anno, "canone": euro(c.canone_annuo), "pagato": euro(pagato), "residuo": euro(c.canone_annuo - pagato),
                     "percentuale_pianificata": float(pianificato),
                     "da_pianificare": euro(max(c.canone_annuo * (CENTO - pianificato) / CENTO, Decimal(0)))})
    return {"id": c.id, "codice": c.codice, "controparte": c.controparte, "nomi_banca": c.nomi_banca,
            "canone_annuo": euro(c.canone_annuo), "note": c.note, "attivo": c.attivo, "rate": righe, "anni": anni}


class ContrattoIn(BaseModel):
    codice: Optional[str] = None
    controparte: Optional[str] = None
    nomi_banca: Optional[list[str]] = None
    canone_annuo: Optional[str] = None
    note: Optional[str] = None
    attivo: Optional[bool] = None


class RataIn(BaseModel):
    anno_competenza: Optional[int] = None
    data_prevista: Optional[date] = None
    percentuale: Optional[str] = None
    nota: Optional[str] = None


@router.get("/piani/affitti")
def lista_affitti(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    contratti = db.query(TesoreriaContrattoAffitto).order_by(TesoreriaContrattoAffitto.codice).all()
    return [_contratto_json(db, c) for c in contratti]


@router.post("/piani/affitti")
def crea_contratto(corpo: ContrattoIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    if not corpo.codice or not corpo.controparte or corpo.canone_annuo is None:
        raise HTTPException(400, "Codice, controparte e canone sono obbligatori")
    if db.query(TesoreriaContrattoAffitto).filter(TesoreriaContrattoAffitto.codice == corpo.codice).first():
        raise HTTPException(409, f"Contratto {corpo.codice} già presente")
    c = TesoreriaContrattoAffitto(codice=corpo.codice, controparte=corpo.controparte, nomi_banca=corpo.nomi_banca or [corpo.controparte],
                                  canone_annuo=_decimale(corpo.canone_annuo, "Canone"), note=corpo.note)
    db.add(c)
    db.commit()
    return _contratto_json(db, c)


@router.put("/piani/affitti/{contratto_id}")
def modifica_contratto(contratto_id: int, corpo: ContrattoIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    c = _contratto_o_404(db, contratto_id)
    if corpo.controparte is not None:
        c.controparte = corpo.controparte
    if corpo.nomi_banca is not None:
        c.nomi_banca = corpo.nomi_banca
    if corpo.canone_annuo is not None:
        c.canone_annuo = _decimale(corpo.canone_annuo, "Canone")
    if corpo.note is not None:
        c.note = corpo.note or None
    if corpo.attivo is not None:
        c.attivo = corpo.attivo
    db.flush()
    _applica(db)
    return _contratto_json(db, c)


@router.post("/piani/affitti/{contratto_id}/rate")
def crea_rata(contratto_id: int, corpo: RataIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    c = _contratto_o_404(db, contratto_id)
    if corpo.anno_competenza is None or corpo.data_prevista is None or corpo.percentuale is None:
        raise HTTPException(400, "Anno, data e percentuale sono obbligatori")
    percentuale = _decimale(corpo.percentuale, "Percentuale")
    _verifica_percentuali(db, c, corpo.anno_competenza, corpo.data_prevista, percentuale)
    db.add(TesoreriaRataAffitto(contratto_id=c.id, anno_competenza=corpo.anno_competenza, data_prevista=corpo.data_prevista,
                                percentuale=percentuale, nota=corpo.nota))
    db.flush()
    _applica(db)
    return _contratto_json(db, c)


@router.put("/piani/affitti/rate/{rata_id}")
def modifica_rata(rata_id: int, corpo: RataIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    r = _rata_o_404(db, rata_id)
    c = _contratto_o_404(db, r.contratto_id)
    i = _impegno_rata(db, c, r.id)
    if i and i.stato == "pagato":
        raise HTTPException(409, "Rata già pagata: annullare prima l'abbinamento con la banca")
    if corpo.percentuale is not None or corpo.data_prevista is not None:
        percentuale = _decimale(corpo.percentuale, "Percentuale") if corpo.percentuale is not None else r.percentuale
        with db.no_autoflush:
            _verifica_percentuali(db, c, r.anno_competenza, corpo.data_prevista or r.data_prevista, percentuale, escludi=r.id)
        r.percentuale = percentuale
    if corpo.data_prevista is not None:
        r.data_prevista = corpo.data_prevista
        if i:
            i.data_manuale = False      # da Admin vale la data del piano
    if corpo.nota is not None:
        r.nota = corpo.nota or None
    db.flush()
    _applica(db)
    return _contratto_json(db, c)


@router.delete("/piani/affitti/rate/{rata_id}")
def elimina_rata(rata_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    r = _rata_o_404(db, rata_id)
    c = _contratto_o_404(db, r.contratto_id)
    i = _impegno_rata(db, c, r.id)
    if i and i.stato == "pagato":
        raise HTTPException(409, "Rata già pagata: non si elimina")
    db.delete(r)
    db.flush()
    _applica(db)
    return _contratto_json(db, c)


# ── Mutuo ───────────────────────────────────────────────────────────────────────

@router.get("/piani/mutuo")
def piano_mutuo(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    rate = db.query(TesoreriaRataMutuo).order_by(TesoreriaRataMutuo.finanziamento, TesoreriaRataMutuo.numero).all()
    oggi = date.today()
    aperte = [r for r in rate if r.pagata_il is None and r.data_scadenza >= oggi]
    return {
        "debito_residuo": euro(sum((r.capitale for r in rate if r.pagata_il is None), Decimal(0))),
        "prossima": aperte[0].data_scadenza.isoformat() if aperte else None,
        "rate": [{"numero": r.numero, "finanziamento": r.finanziamento, "data_scadenza": r.data_scadenza.isoformat(),
                  "capitale": euro(r.capitale), "interessi": euro(r.interessi), "importo": euro(r.importo),
                  "spese": euro(r.spese), "residuo": euro(r.residuo),
                  "pagata_il": r.pagata_il.isoformat() if r.pagata_il else None} for r in rate],
    }


@router.post("/piani/mutuo")
async def carica_piano_mutuo(file: UploadFile = File(...), finanziamento: str = Query(FINANZIAMENTO_DEFAULT),
                             spese: str = Query(str(SPESE_RATA_DEFAULT)), db: Session = Depends(get_db),
                             _=Depends(puo_importare)):
    """Il tasso è variabile: ricaricando il piano si aggiornano le rate. Una rata già pagata resta com'è."""
    try:
        piano = parse_piano_mutuo(await file.read())
    except ErroreImportTesoreria as e:
        raise HTTPException(400, str(e))
    esistenti = {r.numero: r for r in db.query(TesoreriaRataMutuo).filter(TesoreriaRataMutuo.finanziamento == finanziamento)}
    importo_spese = _decimale(spese, "Spese")
    numeri = set()
    for p in piano:
        numeri.add(p.numero)
        r = esistenti.get(p.numero)
        if r is None:
            r = TesoreriaRataMutuo(finanziamento=finanziamento, numero=p.numero)
            db.add(r)
        elif r.pagata_il is not None:
            continue
        r.data_scadenza, r.capitale, r.interessi, r.importo = p.scadenza, p.capitale, p.interessi, p.importo
        r.spese, r.residuo, r.pagata_il = importo_spese, p.residuo, p.pagata_il
    for numero, r in esistenti.items():
        if numero not in numeri and r.pagata_il is None:
            db.delete(r)
    db.flush()
    _applica(db)
    return {"n_rate": len(piano), "n_pagate": sum(1 for p in piano if p.pagata_il)}


# ── Ricorrenti ──────────────────────────────────────────────────────────────────

class RicorrenteIn(BaseModel):
    descrizione: Optional[str] = None
    categoria_id: Optional[int] = None
    importo: Optional[str] = None
    giorno: Optional[int] = None
    mesi: Optional[list[int]] = None
    data_da: Optional[date] = None
    data_a: Optional[date] = None
    nota: Optional[str] = None
    attivo: Optional[bool] = None


def _ricorrente_json(r, categorie) -> dict:
    c = categorie.get(r.categoria_id)
    return {"id": r.id, "descrizione": r.descrizione, "categoria_id": r.categoria_id, "categoria": c.nome if c else None,
            "importo": euro(r.importo), "giorno": r.giorno, "mesi": r.mesi, "data_da": r.data_da.isoformat() if r.data_da else None,
            "data_a": r.data_a.isoformat() if r.data_a else None, "nota": r.nota, "attivo": r.attivo}


def _categorie(db) -> dict:
    return {c.id: c for c in db.query(TesoreriaCategoria).all()}


def _valida_ricorrente(corpo: RicorrenteIn, db):
    if corpo.giorno is not None and not 1 <= corpo.giorno <= 31:
        raise HTTPException(400, "Giorno non valido (1–31)")
    if corpo.mesi is not None and (not corpo.mesi or any(not 1 <= m <= 12 for m in corpo.mesi)):
        raise HTTPException(400, "Mesi non validi (1–12)")
    if corpo.categoria_id is not None and db.get(TesoreriaCategoria, corpo.categoria_id) is None:
        raise HTTPException(400, "Categoria non trovata")


@router.get("/piani/ricorrenti")
def lista_ricorrenti(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    categorie = _categorie(db)
    return [_ricorrente_json(r, categorie) for r in db.query(TesoreriaRicorrente).order_by(TesoreriaRicorrente.descrizione)]


@router.post("/piani/ricorrenti")
def crea_ricorrente(corpo: RicorrenteIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    _valida_ricorrente(corpo, db)
    if not corpo.descrizione or corpo.categoria_id is None or corpo.importo is None or not corpo.mesi:
        raise HTTPException(400, "Descrizione, categoria, importo e mesi sono obbligatori")
    r = TesoreriaRicorrente(descrizione=corpo.descrizione, categoria_id=corpo.categoria_id, importo=_decimale(corpo.importo, "Importo"),
                            giorno=corpo.giorno or 1, mesi=corpo.mesi, data_da=corpo.data_da, data_a=corpo.data_a, nota=corpo.nota)
    db.add(r)
    db.flush()
    _applica(db)
    return _ricorrente_json(r, _categorie(db))


@router.put("/piani/ricorrenti/{ricorrente_id}")
def modifica_ricorrente(ricorrente_id: int, corpo: RicorrenteIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    r = db.get(TesoreriaRicorrente, ricorrente_id)
    if r is None:
        raise HTTPException(404, "Ricorrente non trovato")
    _valida_ricorrente(corpo, db)
    for campo in ("descrizione", "categoria_id", "giorno", "mesi", "data_da", "data_a", "nota", "attivo"):
        valore = getattr(corpo, campo)
        if valore is not None:
            setattr(r, campo, valore)
    if corpo.importo is not None:
        r.importo = _decimale(corpo.importo, "Importo")
    db.flush()
    _applica(db)
    return _ricorrente_json(r, _categorie(db))


@router.delete("/piani/ricorrenti/{ricorrente_id}")
def elimina_ricorrente(ricorrente_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    r = db.get(TesoreriaRicorrente, ricorrente_id)
    if r is None:
        raise HTTPException(404, "Ricorrente non trovato")
    db.delete(r)
    db.flush()
    _applica(db)
    return {"ok": True}


# ── Interventi ──────────────────────────────────────────────────────────────────

class InterventoIn(BaseModel):
    descrizione: Optional[str] = None
    struttura_code: Optional[str] = None
    fornitore: Optional[str] = None
    importo_stimato: Optional[str] = None
    stato: Optional[str] = None
    inclusa_in_previsione: Optional[bool] = None
    nota: Optional[str] = None
    anno: Optional[int] = None


def _rate_json(db: Session, i: TesoreriaIntervento) -> list:
    rate = _rate_dell_intervento(db, i.id)
    calcolate = {r.id: (importo, residuo) for r, importo, residuo in rate_intervento(db, i)}
    return [{"id": r.id, "data_prevista": r.data_prevista.isoformat(), "percentuale": float(r.percentuale), "automatica": n == len(rate) - 1,
             "importo": euro(calcolate[r.id][0]) if r.id in calcolate else None,
             "da_fatturare": euro(calcolate[r.id][1]) if r.id in calcolate else None} for n, r in enumerate(rate)]


def _costo_per_modalita(fatture: list, pagamenti: list, di_fatture: set) -> list:
    """Costo del lavoro diviso per modalità di pagamento: fatture collegate + pagamenti in banca senza fattura."""
    tot = {}
    for f in fatture:
        k = f.modalita_pagamento or "non_indicata"
        tot[k] = tot.get(k, Decimal(0)) + f.importo
    senza = sum((p.importo for p in pagamenti if p.movimento_id not in di_fatture), Decimal(0))
    if senza:
        tot["pagamenti_banca"] = senza
    nomi = {**NOMI_MODALITA, "non_indicata": "Non indicata", "pagamenti_banca": "Pagamenti in banca senza fattura"}
    ordine = list(MODALITA) + ["non_indicata", "pagamenti_banca"]
    return [{"modalita": k, "nome": nomi[k], "importo": euro(tot[k])} for k in ordine if k in tot]


def _intervento_json(db: Session, i: TesoreriaIntervento) -> dict:
    fatture = _fatture_collegate(db, i.id)
    pagamenti = _pagamenti_collegati(db, i.id)
    di_fatture = _movimenti_di_fatture(db, [f.chiave for f in fatture])
    return {"id": i.id, "anno": i.anno, "descrizione": i.descrizione, "struttura_code": i.struttura_code, "fornitore": i.fornitore,
            "importo_stimato": euro(i.importo_stimato), "rate": _rate_json(db, i),
            "stato": i.stato, "inclusa_in_previsione": i.inclusa_in_previsione, "nota": i.nota, "n_fatture": len(fatture),
            "n_pagamenti": len(pagamenti), "fatture_collegate": euro(sum((f.importo for f in fatture), Decimal(0))),
            "pagamenti_collegati": euro(sum((p.importo for p in pagamenti), Decimal(0))),
            "coperto": euro(coperto_intervento(db, i)), "residuo": euro(residuo_intervento(db, i)),
            "costo_finale": euro(coperto_intervento(db, i)), "per_modalita": _costo_per_modalita(fatture, pagamenti, di_fatture),
            "n_senza_pagamento": sum(1 for f in fatture if f.modalita_pagamento is None
                                     or (f.modalita_pagamento in CATEGORIA_MODALITA and f.data_pagamento is None))}


def _applica_intervento(i: TesoreriaIntervento, corpo: InterventoIn):
    if corpo.stato is not None and corpo.stato not in STATI_INTERVENTO:
        raise HTTPException(400, "Stato non valido")
    for campo in ("descrizione", "stato", "inclusa_in_previsione"):
        valore = getattr(corpo, campo)
        if valore is not None:
            setattr(i, campo, valore)
    for campo in ("struttura_code", "fornitore", "nota"):
        valore = getattr(corpo, campo)
        if valore is not None:
            setattr(i, campo, valore or None)
    if corpo.importo_stimato is not None:
        i.importo_stimato = _decimale(corpo.importo_stimato, "Importo") if corpo.importo_stimato != "" else None
    if corpo.anno is not None:
        if not 2020 <= corpo.anno <= 2040:
            raise HTTPException(400, "Anno non valido")
        i.anno = corpo.anno


@router.get("/piani/interventi")
def lista_interventi(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    return [_intervento_json(db, i) for i in db.query(TesoreriaIntervento).order_by(
        TesoreriaIntervento.anno.desc().nullsfirst(), TesoreriaIntervento.id)]


@router.post("/piani/interventi")
def crea_intervento(corpo: InterventoIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    if not corpo.descrizione:
        raise HTTPException(400, "La descrizione è obbligatoria")
    i = TesoreriaIntervento(descrizione=corpo.descrizione, anno=anno_alberghiero(date.today()))
    _applica_intervento(i, corpo)
    db.add(i)
    db.flush()
    _applica(db)
    return _intervento_json(db, i)


@router.put("/piani/interventi/{intervento_id}")
def modifica_intervento(intervento_id: int, corpo: InterventoIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    i = db.get(TesoreriaIntervento, intervento_id)
    if i is None:
        raise HTTPException(404, "Intervento non trovato")
    _applica_intervento(i, corpo)
    db.flush()
    _applica(db)
    return _intervento_json(db, i)


@router.delete("/piani/interventi/{intervento_id}")
def elimina_intervento(intervento_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    i = db.get(TesoreriaIntervento, intervento_id)
    if i is None:
        raise HTTPException(404, "Intervento non trovato")
    db.delete(i)
    db.flush()
    _applica(db)
    return {"ok": True}


# ── Rate degli interventi ───────────────────────────────────────────────────────

class RataInterventoIn(BaseModel):
    data_prevista: Optional[date] = None
    percentuale: Optional[str] = None


def _intervento_o_404(db: Session, intervento_id: int) -> TesoreriaIntervento:
    i = db.get(TesoreriaIntervento, intervento_id)
    if i is None:
        raise HTTPException(404, "Intervento non trovato")
    return i


def _chiudi_al_100(db: Session, intervento_id: int) -> None:
    """L'ultima rata per data prende quanto manca al 100%: una rata sola vale tutta la stima."""
    db.flush()
    rate = _rate_dell_intervento(db, intervento_id)
    if rate:
        ultima = CENTO - sum((r.percentuale for r in rate[:-1]), Decimal(0))
        if ultima <= 0 or any(r.percentuale <= 0 for r in rate[:-1]):
            raise HTTPException(400, "Le percentuali delle rate devono essere maggiori di zero e lasciare una quota all'ultima")
        rate[-1].percentuale = ultima


@router.post("/piani/interventi/{intervento_id}/rate")
def crea_rata_intervento(intervento_id: int, corpo: RataInterventoIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    """La nuova rata divide a metà la quota dell'ultima; le percentuali si correggono poi rata per rata."""
    i = _intervento_o_404(db, intervento_id)
    if corpo.data_prevista is None:
        raise HTTPException(400, "La data è obbligatoria")
    rate = _rate_dell_intervento(db, i.id)
    quota = CENTO
    if rate:
        quota = rate[-1].percentuale / 2
        rate[-1].percentuale = quota
    db.add(TesoreriaRataIntervento(intervento_id=i.id, data_prevista=corpo.data_prevista, percentuale=quota))
    _chiudi_al_100(db, i.id)
    _applica(db)
    return _intervento_json(db, i)


@router.put("/piani/interventi/rate/{rata_id}")
def modifica_rata_intervento(rata_id: int, corpo: RataInterventoIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    r = db.get(TesoreriaRataIntervento, rata_id)
    if r is None:
        raise HTTPException(404, "Rata non trovata")
    if corpo.percentuale is not None:
        r.percentuale = _decimale(corpo.percentuale, "Percentuale")
    if corpo.data_prevista is not None:
        r.data_prevista = corpo.data_prevista
    _chiudi_al_100(db, r.intervento_id)
    _applica(db)
    return _intervento_json(db, _intervento_o_404(db, r.intervento_id))


@router.delete("/piani/interventi/rate/{rata_id}")
def elimina_rata_intervento(rata_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    r = db.get(TesoreriaRataIntervento, rata_id)
    if r is None:
        raise HTTPException(404, "Rata non trovata")
    intervento_id = r.intervento_id
    db.delete(r)
    _chiudi_al_100(db, intervento_id)
    _applica(db)
    return _intervento_json(db, _intervento_o_404(db, intervento_id))


# ── Compensi dei soci ───────────────────────────────────────────────────────────

class CompensoIn(BaseModel):
    voce: Optional[str] = None
    anno_competenza: Optional[int] = None
    importo: Optional[str] = None
    nota: Optional[str] = None


def _impegno_compenso(db: Session, c: TesoreriaCompenso, rata_id: int) -> Optional[TesoreriaImpegno]:
    return db.query(TesoreriaImpegno).filter(TesoreriaImpegno.codice == f"compenso:{c.voce}:{c.anno_competenza}:{rata_id}").first()


def _rata_pagata(db: Session, c: TesoreriaCompenso, rata_id: int) -> bool:
    i = _impegno_compenso(db, c, rata_id)
    return i is not None and i.stato == "pagato"


def _compenso_json(db: Session, c: TesoreriaCompenso) -> dict:
    rate = _rate_del_compenso(db, c.id)
    righe = []
    pagato = Decimal(0)
    for n, (r, importo) in enumerate(zip(rate, importi_rate(c.importo, [x.percentuale for x in rate]))):
        i = _impegno_compenso(db, c, r.id)
        pagata = i is not None and i.stato == "pagato"
        effettivo = importo_impegno(i) if i else importo
        if pagata:
            pagato += effettivo
        righe.append({"id": r.id, "data_prevista": (i.data_scadenza if i else r.data_prevista).isoformat(), "percentuale": float(r.percentuale),
                      "automatica": n == len(rate) - 1 and not pagata, "importo": euro(effettivo), "pagata": pagata,
                      "abbinamento": i.abbinamento if i else None})
    pianificato = sum((r.percentuale for r in rate), Decimal(0))
    return {"id": c.id, "voce": c.voce, "anno_competenza": c.anno_competenza, "importo": euro(c.importo), "nota": c.nota, "rate": righe,
            "pagato": euro(pagato), "da_pianificare": euro(max(c.importo * (CENTO - pianificato) / CENTO, Decimal(0)))}


def _compenso_o_404(db: Session, compenso_id: int) -> TesoreriaCompenso:
    c = db.get(TesoreriaCompenso, compenso_id)
    if c is None:
        raise HTTPException(404, "Compenso non trovato")
    return c


def _rata_compenso_modificabile(db: Session, rata_id: int) -> tuple:
    r = db.get(TesoreriaRataCompenso, rata_id)
    if r is None:
        raise HTTPException(404, "Rata non trovata")
    c = _compenso_o_404(db, r.compenso_id)
    if _rata_pagata(db, c, r.id):
        raise HTTPException(409, "Rata già pagata: annullare prima l'abbinamento con la banca")
    return r, c


def _chiudi_compenso_al_100(db: Session, c: TesoreriaCompenso) -> None:
    """L'ultima rata prende quanto manca al 100%. Se è già pagata non cambia: il resto è da pianificare."""
    db.flush()
    rate = _rate_del_compenso(db, c.id)
    if not rate:
        return
    prima = sum((r.percentuale for r in rate[:-1]), Decimal(0))
    if any(r.percentuale <= 0 for r in rate):
        raise HTTPException(400, "Le percentuali delle rate devono essere maggiori di zero")
    if _rata_pagata(db, c, rate[-1].id):
        if prima + rate[-1].percentuale > CENTO + TOLLERANZA_PERCENTUALE:
            raise HTTPException(400, "Le rate supererebbero il 100%")
    elif prima >= CENTO:
        raise HTTPException(400, "Le rate prima dell'ultima arrivano già al 100%")
    else:
        rate[-1].percentuale = CENTO - prima


@router.get("/piani/compensi")
def lista_compensi(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    compensi = db.query(TesoreriaCompenso).order_by(TesoreriaCompenso.anno_competenza.desc(), TesoreriaCompenso.voce).all()
    return [_compenso_json(db, c) for c in compensi]


@router.post("/piani/compensi")
def crea_compenso(corpo: CompensoIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    if corpo.voce not in VOCI_COMPENSO or corpo.anno_competenza is None or corpo.importo is None:
        raise HTTPException(400, "Voce, anno e importo sono obbligatori")
    if db.query(TesoreriaCompenso).filter(TesoreriaCompenso.voce == corpo.voce, TesoreriaCompenso.anno_competenza == corpo.anno_competenza).first():
        raise HTTPException(409, f"Compensi {corpo.voce} {corpo.anno_competenza} già presenti")
    c = TesoreriaCompenso(voce=corpo.voce, anno_competenza=corpo.anno_competenza, importo=_decimale(corpo.importo, "Importo"), nota=corpo.nota or None)
    db.add(c)
    db.commit()
    return _compenso_json(db, c)


@router.put("/piani/compensi/{compenso_id}")
def modifica_compenso(compenso_id: int, corpo: CompensoIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    c = _compenso_o_404(db, compenso_id)
    if corpo.importo is not None:
        c.importo = _decimale(corpo.importo, "Importo")
    if corpo.nota is not None:
        c.nota = corpo.nota or None
    db.flush()
    _applica(db)
    return _compenso_json(db, c)


@router.delete("/piani/compensi/{compenso_id}")
def elimina_compenso(compenso_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    c = _compenso_o_404(db, compenso_id)
    if any(_rata_pagata(db, c, r.id) for r in _rate_del_compenso(db, c.id)):
        raise HTTPException(409, "Ci sono rate già pagate: il compenso non si elimina")
    db.delete(c)
    db.flush()
    _applica(db)
    return {"ok": True}


@router.post("/piani/compensi/{compenso_id}/rate")
def crea_rata_compenso(compenso_id: int, corpo: RataInterventoIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    """Come per gli interventi, la nuova rata divide a metà la quota dell'ultima; se è pagata prende il resto da pianificare."""
    c = _compenso_o_404(db, compenso_id)
    if corpo.data_prevista is None:
        raise HTTPException(400, "La data è obbligatoria")
    rate = _rate_del_compenso(db, c.id)
    if not rate:
        quota = CENTO
    elif _rata_pagata(db, c, rate[-1].id):
        quota = CENTO - sum((r.percentuale for r in rate), Decimal(0))
    else:
        quota = rate[-1].percentuale / 2
        rate[-1].percentuale = quota
    if quota <= 0:
        raise HTTPException(400, "Le rate coprono già il 100% del compenso")
    db.add(TesoreriaRataCompenso(compenso_id=c.id, data_prevista=corpo.data_prevista, percentuale=quota))
    _chiudi_compenso_al_100(db, c)
    _applica(db)
    return _compenso_json(db, c)


@router.put("/piani/compensi/rate/{rata_id}")
def modifica_rata_compenso(rata_id: int, corpo: RataInterventoIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    r, c = _rata_compenso_modificabile(db, rata_id)
    if corpo.percentuale is not None:
        r.percentuale = _decimale(corpo.percentuale, "Percentuale")
    if corpo.data_prevista is not None:
        r.data_prevista = corpo.data_prevista
        i = _impegno_compenso(db, c, r.id)
        if i:
            i.data_manuale = False      # da Admin vale la data del piano
    _chiudi_compenso_al_100(db, c)
    _applica(db)
    return _compenso_json(db, c)


@router.delete("/piani/compensi/rate/{rata_id}")
def elimina_rata_compenso(rata_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    r, c = _rata_compenso_modificabile(db, rata_id)
    db.delete(r)
    _chiudi_compenso_al_100(db, c)
    _applica(db)
    return _compenso_json(db, c)


# ── Advertising pagato con carta ────────────────────────────────────────────────

class AdvertisingIn(BaseModel):
    anno: Optional[int] = None       # anno alberghiero, identificato dall'anno di fine (2026 = ottobre 2025 – settembre 2026)
    conto_id: Optional[int] = None
    totale: Optional[str] = None
    nota: Optional[str] = None
    mesi: Optional[dict] = None      # {mese: importo o null per toglierlo}


def _advertising_json(db: Session, a: TesoreriaAdvertising, oggi: date) -> dict:
    conto = db.get(TesoreriaConto, a.conto_id)
    mesi = _mesi_advertising(db, a.id)
    codici = {f"advertising:{anno_calendario(a.anno, r.mese)}:{r.mese}" for r in mesi}
    impegni = {i.codice: i for i in db.query(TesoreriaImpegno).filter(TesoreriaImpegno.codice.in_(codici))} if codici else {}
    ultimo = mesi[-1].mese if mesi else None
    righe = []
    for r in mesi:
        anno = anno_calendario(a.anno, r.mese)
        data = data_addebito_advertising(anno, r.mese, conto.giorno_addebito)
        i = impegni.get(f"advertising:{anno}:{r.mese}")
        righe.append({"mese": r.mese, "anno": anno, "importo": euro(r.importo), "automatico": r.mese == ultimo and len(mesi) > 1,
                      "data_addebito": (i.data_scadenza if i else data).isoformat(),
                      "in_previsione": i is not None, "addebitato": i is None and data < oggi})
    return {"id": a.id, "anno": a.anno, "etichetta": f"{a.anno - 1}/{str(a.anno)[2:]}", "conto_id": a.conto_id, "conto": conto.nome, "totale": euro(a.totale), "nota": a.nota,
            "mesi": righe, "in_previsione": euro(sum((importo_impegno(i) for i in impegni.values()), Decimal(0)))}


def _advertising_o_404(db: Session, advertising_id: int) -> TesoreriaAdvertising:
    a = db.get(TesoreriaAdvertising, advertising_id)
    if a is None:
        raise HTTPException(404, "Piano advertising non trovato")
    return a


def _carta_o_400(db: Session, conto_id: int) -> TesoreriaConto:
    c = db.get(TesoreriaConto, conto_id)
    if c is None or c.tipo != "carta_credito":
        raise HTTPException(400, "Scegliere una carta di credito")
    return c


def _salva_mesi(db: Session, a: TesoreriaAdvertising, nuovi: Optional[dict]) -> None:
    """Applica i mesi inviati (null = toglie) e fa chiudere il totale all'ultimo mese."""
    esistenti = {r.mese: r for r in _mesi_advertising(db, a.id)}
    importi = {m: r.importo for m, r in esistenti.items()}
    for chiave, valore in (nuovi or {}).items():
        mese = int(chiave)
        if not 1 <= mese <= 12:
            raise HTTPException(400, f"Mese non valido: {chiave}")
        if valore is None or str(valore).strip() == "":
            importi.pop(mese, None)
        else:
            importo = _decimale(valore, f"Importo di {MESI_IT[mese - 1]}")
            if importo < 0:
                raise HTTPException(400, "Gli importi non possono essere negativi")
            importi[mese] = importo
    try:
        importi = chiudi_totale(a.totale, importi)
    except ValueError as e:
        raise HTTPException(400, str(e))
    for mese, r in esistenti.items():
        if mese not in importi:
            db.delete(r)
    for mese, importo in importi.items():
        if mese in esistenti:
            esistenti[mese].importo = importo
        else:
            db.add(TesoreriaAdvertisingMese(advertising_id=a.id, mese=mese, importo=importo))
    db.flush()     # la sessione dell'app non fa autoflush: sincronizza_piani() deve vedere i mesi


@router.get("/piani/advertising")
def lista_advertising(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    oggi = date.today()
    return [_advertising_json(db, a, oggi) for a in db.query(TesoreriaAdvertising).order_by(TesoreriaAdvertising.anno.desc())]


@router.post("/piani/advertising")
def crea_advertising(corpo: AdvertisingIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    if corpo.anno is None or corpo.totale is None or corpo.conto_id is None:
        raise HTTPException(400, "Anno, carta e totale sono obbligatori")
    if db.query(TesoreriaAdvertising).filter(TesoreriaAdvertising.anno == corpo.anno).first():
        raise HTTPException(409, f"Advertising della stagione {corpo.anno - 1}/{str(corpo.anno)[2:]} già presente")
    _carta_o_400(db, corpo.conto_id)
    a = TesoreriaAdvertising(anno=corpo.anno, conto_id=corpo.conto_id, totale=_decimale(corpo.totale, "Totale"), nota=corpo.nota or None)
    db.add(a)
    db.flush()
    _salva_mesi(db, a, corpo.mesi)
    _applica(db)
    return _advertising_json(db, a, date.today())


@router.put("/piani/advertising/{advertising_id}")
def modifica_advertising(advertising_id: int, corpo: AdvertisingIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    a = _advertising_o_404(db, advertising_id)
    if corpo.totale is not None:
        a.totale = _decimale(corpo.totale, "Totale")
    if corpo.conto_id is not None:
        a.conto_id = _carta_o_400(db, corpo.conto_id).id
    if corpo.nota is not None:
        a.nota = corpo.nota or None
    db.flush()
    _salva_mesi(db, a, corpo.mesi)
    _applica(db)
    return _advertising_json(db, a, date.today())


@router.delete("/piani/advertising/{advertising_id}")
def elimina_advertising(advertising_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    db.delete(_advertising_o_404(db, advertising_id))
    db.flush()
    _applica(db)
    return {"ok": True}


# ── Fatture collegate agli interventi ───────────────────────────────────────────

class FatturaIn(BaseModel):
    chiave: Optional[str] = None
    chiavi: Optional[list[str]] = None


class FattureSdiIn(BaseModel):
    fattura_ids: list[int]


class PagamentoFatturaIn(BaseModel):
    modalita_pagamento: Optional[str] = None     # '' = togli
    data_pagamento: Optional[str] = None         # 'YYYY-MM-DD', '' = togli


def _fattura_json(f: TesoreriaInterventoScadenza, movimenti: Optional[dict] = None) -> dict:
    m = (movimenti or {}).get(f.chiave)
    return {"id": f.id, "chiave": f.chiave, "fornitore": f.fornitore, "data_scadenza": f.data_scadenza.isoformat(),
            "numero_documento": f.numero_documento, "importo": euro(f.importo),
            "origine": "sdi" if f.chiave.startswith(PREFISSO_CHIAVE) else "passcom",
            "modalita_pagamento": f.modalita_pagamento, "data_pagamento": f.data_pagamento.isoformat() if f.data_pagamento else None,
            "pagamento_banca": {"data": m[1].isoformat(), "straordinario": m[2]} if m else None}


def _movimenti_per_chiave(db: Session, chiavi) -> dict:
    """{chiave: (codice categoria, data contabile, straordinario)} del pagamento in banca (abbinamento automatico o
    confermato) di ogni fattura; se più movimenti, il più recente."""
    chiavi = list(chiavi)
    if not chiavi:
        return {}
    out = {}
    for chiave, data, cat, straord in db.query(
            TesoreriaAbbinamentoScadenza.chiave, TesoreriaMovimento.data_contabile, TesoreriaCategoria.codice,
            TesoreriaMovimento.straordinario).join(
            TesoreriaAbbinamento, TesoreriaAbbinamento.id == TesoreriaAbbinamentoScadenza.abbinamento_id).join(
            TesoreriaAbbinamentoMovimento, TesoreriaAbbinamentoMovimento.abbinamento_id == TesoreriaAbbinamento.id).join(
            TesoreriaMovimento, TesoreriaMovimento.id == TesoreriaAbbinamentoMovimento.movimento_id).outerjoin(
            TesoreriaCategoria, TesoreriaCategoria.id == TesoreriaMovimento.categoria_id).filter(
            TesoreriaAbbinamento.stato.in_(STATI_ABBINAMENTO_VALIDI), TesoreriaAbbinamentoScadenza.chiave.in_(chiavi)):
        if chiave not in out or data > out[chiave][1]:
            out[chiave] = (cat, data, straord)
    return out


def _nuovo_collegamento(db: Session, intervento_id: int, chiave: str, fornitore: str, data_scadenza: date,
                        numero_documento: Optional[str], importo: Decimal, tipo_pagamento: Optional[str],
                        con_carta: bool, sposta: bool = False) -> str:
    """Collega una scadenza/rata alla spesa con modalità e data proposte. 'nuovo' | 'spostato' | 'gia' | 'altra'."""
    esistente = db.query(TesoreriaInterventoScadenza).filter(TesoreriaInterventoScadenza.chiave == chiave).first()
    if esistente is not None:
        if esistente.intervento_id == intervento_id:
            return "gia"
        if not sposta:
            return "altra"
        esistente.intervento_id = intervento_id
        return "spostato"
    m = _movimenti_per_chiave(db, [chiave]).get(chiave)
    modalita, data = predefiniti(tipo_pagamento, data_scadenza, con_carta, (m[0], m[1]) if m else None)
    db.add(TesoreriaInterventoScadenza(intervento_id=intervento_id, chiave=chiave, fornitore=fornitore,
                                       data_scadenza=data_scadenza, numero_documento=numero_documento, importo=importo,
                                       modalita_pagamento=modalita, data_pagamento=data))
    return "nuovo"


def _debiti_sdi(db: Session) -> list:
    """Rate delle fatture arrivate allo SDI e non ancora registrate dallo studio (le stesse della previsione)."""
    from app.routers.tesoreria_fatture_stato import stato_fatture
    return stato_fatture(db, date.today())["debiti"]


GIORNI_PAGAMENTI_CANDIDATI = 540


def _pagamento_json(p: TesoreriaInterventoMovimento, m: TesoreriaMovimento, di_fatture: set) -> dict:
    return {"id": p.id, "movimento_id": m.id, "data": m.data_contabile.isoformat(), "controparte": m.controparte,
            "causale": m.causale or m.descrizione, "importo": euro(p.importo),
            "di_fattura_collegata": m.id in di_fatture}


@router.get("/piani/interventi/{intervento_id}/fatture")
def fatture_intervento(intervento_id: int, db: Session = Depends(get_db), _=Depends(puo_vedere)):
    """Collegate e collegabili: le scadenze aperte, prima quelle del fornitore previsto."""
    i = db.get(TesoreriaIntervento, intervento_id)
    if i is None:
        raise HTTPException(404, "Intervento non trovato")
    gia = {c for (c,) in db.query(TesoreriaInterventoScadenza.chiave)}
    candidate = []
    for s in stato_scadenze(db, date.today())["scadenze"]:
        if s["chiave"] in gia or s["stato"] in ("pareggio", "residuo") or s["importo"] <= 0:
            continue
        candidate.append({"chiave": s["chiave"], "fornitore": s["fornitore"], "data_scadenza": s["data_scadenza"].isoformat(),
                          "numero_documento": s.get("numero_documento"), "importo": euro(Decimal(str(s["importo"]))),
                          "suggerita": bool(i.fornitore) and nome_corrisponde(s["fornitore"], [i.fornitore]), "origine": "passcom"})
    for r, importo in _debiti_sdi(db):
        if r.chiave in gia:
            continue
        candidate.append({"chiave": r.chiave, "fornitore": r.fornitore, "data_scadenza": r.data_scadenza.isoformat(),
                          "numero_documento": r.numero_documento, "importo": euro(importo), "origine": "sdi",
                          "suggerita": bool(i.fornitore) and forza_nome(i.fornitore, r.fornitore) >= 1})
    candidate.sort(key=lambda c: (not c["suggerita"], c["fornitore"], c["data_scadenza"]))
    fatture = _fatture_collegate(db, i.id)
    di_fatture = _movimenti_di_fatture(db, [f.chiave for f in fatture])
    collegati = _pagamenti_collegati(db, i.id)
    movimenti = {m.id: m for m in db.query(TesoreriaMovimento).filter(TesoreriaMovimento.id.in_([p.movimento_id for p in collegati] or [0]))}
    movimenti_f = _movimenti_per_chiave(db, [f.chiave for f in fatture])
    return {"collegate": [_fattura_json(f, movimenti_f) for f in sorted(fatture, key=lambda f: (f.fornitore, f.data_scadenza))],
            "candidate": candidate[:500],
            "pagamenti": [_pagamento_json(p, movimenti[p.movimento_id], di_fatture) for p in collegati],
            "pagamenti_candidati": _pagamenti_candidati(db, i, di_fatture),
            "coperto": euro(coperto_intervento(db, i)), "residuo": euro(residuo_intervento(db, i))}


def _pagamenti_candidati(db: Session, i: TesoreriaIntervento, di_fatture: set) -> list:
    """Uscite in banca degli ultimi 18 mesi non ancora collegate e non pagamenti di fatture già collegate; prima quelle
    con il nome del fornitore della spesa."""
    gia = {m for (m,) in db.query(TesoreriaInterventoMovimento.movimento_id)}
    righe = db.query(TesoreriaMovimento).join(TesoreriaConto, TesoreriaConto.id == TesoreriaMovimento.conto_id).outerjoin(
        TesoreriaCategoria, TesoreriaCategoria.id == TesoreriaMovimento.categoria_id).filter(
        TesoreriaConto.tipo == "conto", TesoreriaMovimento.importo < 0,
        TesoreriaMovimento.data_contabile >= date.fromordinal(date.today().toordinal() - GIORNI_PAGAMENTI_CANDIDATI),
        (TesoreriaCategoria.escludi_da_operativo.is_(False)) | (TesoreriaCategoria.id.is_(None)),
    ).order_by(TesoreriaMovimento.data_contabile.desc()).all()
    out = []
    for m in righe:
        if m.id in gia or m.id in di_fatture:
            continue
        suggerito = bool(i.fornitore) and forza_nome(i.fornitore, m.controparte or m.descrizione) >= 1
        out.append({"movimento_id": m.id, "data": m.data_contabile.isoformat(), "controparte": m.controparte,
                    "causale": m.causale or m.descrizione, "importo": euro(-m.importo), "straordinario": m.straordinario,
                    "suggerito": suggerito})
    out.sort(key=lambda c: not c["suggerito"])
    return out[:300]


@router.post("/piani/interventi/{intervento_id}/fatture")
def collega_fattura(intervento_id: int, corpo: FatturaIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    """Collega una o più fatture dello scadenzario Passcom o arrivate allo SDI e da registrare (`chiavi`)."""
    i = db.get(TesoreriaIntervento, intervento_id)
    if i is None:
        raise HTTPException(404, "Intervento non trovato")
    chiavi = corpo.chiavi or ([corpo.chiave] if corpo.chiave else [])
    if not chiavi:
        raise HTTPException(400, "Nessuna fattura indicata")
    gia = {c for (c,) in db.query(TesoreriaInterventoScadenza.chiave).filter(TesoreriaInterventoScadenza.chiave.in_(chiavi))}
    if gia:
        raise HTTPException(409, "Fattura già collegata a una spesa straordinaria")
    debiti = {r.chiave: (r, imp) for r, imp in _debiti_sdi(db)} if any(c.startswith(PREFISSO_CHIAVE) for c in chiavi) else {}
    scadenze = {x["chiave"]: x for x in stato_scadenze(db, date.today())["scadenze"]} \
        if any(not c.startswith(PREFISSO_CHIAVE) for c in chiavi) else {}
    for chiave in chiavi:
        if chiave.startswith(PREFISSO_CHIAVE):
            if chiave not in debiti:
                raise HTTPException(404, "Fattura non trovata tra quelle da registrare")
            r, importo = debiti[chiave]
            _nuovo_collegamento(db, i.id, r.chiave, r.fornitore, r.data_scadenza, r.numero_documento, importo,
                                r.tipo_pagamento, False)
        else:
            s = scadenze.get(chiave)
            if s is None:
                raise HTTPException(404, "Scadenza non trovata nello scadenzario attuale")
            _nuovo_collegamento(db, i.id, s["chiave"], s["fornitore"], s["data_scadenza"], s.get("numero_documento"),
                                Decimal(str(s["importo"])), s.get("tipo_pagamento"), s["stato"] == "pagata_carta")
    db.flush()
    _applica(db)
    return _intervento_json(db, i)


@router.post("/piani/interventi/{intervento_id}/fatture-sdi")
def assegna_fatture_sdi(intervento_id: int, corpo: FattureSdiIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    """Assegna alla spesa fatture ricevute dallo SDI, anche già pagate e chiuse (scheda Fatture). Una fattura nello
    scadenzario Passcom attuale si collega con le sue scadenze, le altre con le rate del file. Una fattura già
    assegnata a un'altra spesa viene spostata (modalità e data restano). Le autofatture non si assegnano."""
    from app.routers.tesoreria_fatture_stato import stato_fatture
    i = db.get(TesoreriaIntervento, intervento_id)
    if i is None:
        raise HTTPException(404, "Spesa straordinaria non trovata")
    voluti = set(corpo.fattura_ids)
    if not voluti:
        raise HTTPException(400, "Nessuna fattura indicata")
    esiti = {"nuovo": 0, "spostato": 0, "gia": 0}
    saltate = []
    trovate = 0
    for r in stato_fatture(db, date.today())["righe"]:
        f = r["fattura"]
        if f.id not in voluti:
            continue
        trovate += 1
        if f.autofattura:
            saltate.append(f"{f.cedente_denominazione} n. {f.numero}: autofattura, non è un pagamento")
            continue
        carta = r["stato"] == "pagata_carta"
        if r["passcom"]:
            voci = [(s["chiave"], s["fornitore"], s["data_scadenza"], Decimal(str(s["importo"])), s["tipo_pagamento"])
                    for s in r["passcom"]]
        else:
            voci = [(x.chiave, f.cedente_denominazione or x.fornitore, x.data_scadenza, x.importo, x.tipo_pagamento)
                    for x in r["rate"]]
        for chiave, fornitore, data_scad, importo, tipo in voci:
            esito = _nuovo_collegamento(db, i.id, chiave, (fornitore or "")[:200], data_scad, f.numero, importo, tipo,
                                        carta, sposta=True)
            esiti[esito] += 1
    if trovate < len(voluti):
        raise HTTPException(404, "Fattura non trovata")
    db.flush()
    _applica(db)
    return {"spesa": _intervento_json(db, i), "n_nuove": esiti["nuovo"], "n_spostate": esiti["spostato"],
            "n_gia": esiti["gia"], "saltate": saltate}


@router.put("/piani/interventi/fatture/{fattura_id}")
def modifica_pagamento_fattura(fattura_id: int, corpo: PagamentoFatturaIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    """Come e quando è stata pagata una fattura collegata (giorno dell'addebito in banca)."""
    f = db.get(TesoreriaInterventoScadenza, fattura_id)
    if f is None:
        raise HTTPException(404, "Collegamento non trovato")
    if corpo.modalita_pagamento is not None:
        if corpo.modalita_pagamento and corpo.modalita_pagamento not in MODALITA:
            raise HTTPException(400, "Modalità di pagamento non valida")
        f.modalita_pagamento = corpo.modalita_pagamento or None
    if corpo.data_pagamento is not None:
        try:
            f.data_pagamento = date.fromisoformat(corpo.data_pagamento) if corpo.data_pagamento else None
        except ValueError:
            raise HTTPException(400, "Data di pagamento non valida")
    db.commit()
    return _fattura_json(f, _movimenti_per_chiave(db, [f.chiave]))


@router.delete("/piani/interventi/fatture/{fattura_id}")
def scollega_fattura(fattura_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    f = db.get(TesoreriaInterventoScadenza, fattura_id)
    if f is None:
        raise HTTPException(404, "Collegamento non trovato")
    db.delete(f)
    db.flush()
    _applica(db)
    return {"ok": True}


class PagamentoIn(BaseModel):
    movimento_id: int


@router.post("/piani/interventi/{intervento_id}/pagamenti")
def collega_pagamento(intervento_id: int, corpo: PagamentoIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    """Pagamento in banca (acconto, saldo) collegato alla spesa: riduce la stima ed esce dalle stime degli anni dopo."""
    i = db.get(TesoreriaIntervento, intervento_id)
    if i is None:
        raise HTTPException(404, "Spesa straordinaria non trovata")
    m = db.get(TesoreriaMovimento, corpo.movimento_id)
    if m is None or m.importo >= 0:
        raise HTTPException(400, "Il movimento deve essere un'uscita")
    if db.query(TesoreriaInterventoMovimento).filter(TesoreriaInterventoMovimento.movimento_id == m.id).first():
        raise HTTPException(409, "Pagamento già collegato a una spesa straordinaria")
    if m.id in _movimenti_di_fatture(db, [c for (c,) in db.query(TesoreriaInterventoScadenza.chiave)]):
        raise HTTPException(409, "È il pagamento di una fattura già collegata: è già contato")
    db.add(TesoreriaInterventoMovimento(intervento_id=i.id, movimento_id=m.id, importo=-m.importo, era_straordinario=m.straordinario))
    m.straordinario = True
    db.flush()
    _applica(db)
    return _intervento_json(db, i)


@router.delete("/piani/interventi/pagamenti/{collegamento_id}")
def scollega_pagamento(collegamento_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    p = db.get(TesoreriaInterventoMovimento, collegamento_id)
    if p is None:
        raise HTTPException(404, "Collegamento non trovato")
    m = db.get(TesoreriaMovimento, p.movimento_id)
    if m is not None:
        m.straordinario = p.era_straordinario
    db.delete(p)
    db.flush()
    _applica(db)
    return {"ok": True}
