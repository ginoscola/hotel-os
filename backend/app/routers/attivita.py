"""Attività ricorrenti (scadenziario operativo): cosa caricare o aggiornare e quando, con lo stato ricavato dagli
import dei moduli. Solo admin.

Endpoint (prefix /attivita):
  GET    /attivita?anno=&mese=          → settimane del mese con le voci, in ritardo (mese prima e mese in corso),
                                          riepilogo, impegni di Tesoreria del mese
  GET    /attivita/riepilogo            → {in_ritardo, da_fare_7gg} per il riquadro della Home
  GET    /attivita/export?anno=&mese=   → PDF della lista del mese, per settimana, con le caselle
  POST   /attivita/fatto                {codice, scadenze: [..], fatto: bool} → spunta / toglie la spunta a mano
  GET    /attivita/catalogo             → attività con parametri in uso e di default
  PUT    /attivita/parametri/{codice}   {giorno?, mese?, mesi?, attiva?} | {ripristina: true}

Evidenze (`_evidenze`): date degli import o dei dati caricati, lette dalle tabelle dei moduli. Per i dati mensili
caricati per (anno, mese) — cedolini, coperti, utenze — l'evidenza è il 1° del mese dopo: si caricano il mese dopo.
"""

import io
import json
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from reportlab.lib import colors as rl_colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Flowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import Date, cast
from sqlalchemy.orm import Session

from app.auth import richiedi_admin
from app.database import get_db
from app.models.analisi_ricavi import AnalisiRicaviImport
from app.models.attivita import AttivitaFatta
from app.models.corrispettivi import CassaMovimento, CorrispettiviDocumento, CorrispettiviManuale, RtChiusura
from app.models.prenotazioni import PrenotazioneCancellataImport
from app.models.produzione import ProdImport, ProdOccupazioneConsumo
from app.models.revenue import AppConfig, BudgetEntry, Hotel, HotelSeason, ImportSession, PayrollImport
from app.models.tesoreria import (TesoreriaConto, TesoreriaImpegno, TesoreriaImport, TesoreriaPrevisioneSalvata,
                                  TesoreriaSaldo, TesoreriaScadImport)
from app.models.usali import UsaliFnbCoperti
from app.models.usali_contabile import UsaliImport
from app.services.attivita import (CATALOGO, ETICHETTE_PARTI, MESI_LUNGHI, PER_CODICE, applica_parametri,
                                   descrivi_frequenza, in_ritardo, riepilogo, valida_parametri, voci_mese)
from app.utils.locale_it import formatta_data_it

router = APIRouter(prefix="/attivita", tags=["attivita"])

CHIAVE_CONFIG = "attivita_parametri"


# ── Parametri ─────────────────────────────────────────────────────────────────

def _leggi_parametri(db: Session) -> dict:
    riga = db.query(AppConfig).filter(AppConfig.key == CHIAVE_CONFIG).first()
    try:
        valore = json.loads(riga.value) if riga and riga.value else {}
    except ValueError:
        return {}
    return valore if isinstance(valore, dict) else {}


def _catalogo(db: Session) -> list:
    return applica_parametri(_leggi_parametri(db))


# ── Evidenze ──────────────────────────────────────────────────────────────────

def _date(q) -> list:
    return sorted({r[0] for r in q if r[0] is not None})


def _mese_dopo(righe) -> list:
    return sorted({date(a + (m == 12), m % 12 + 1, 1) for a, m in righe})


def _per_parte(righe) -> dict:
    out = {}
    for parte, d in righe:
        if d is not None:
            out.setdefault(parte, set()).add(d)
    return {k: sorted(v) for k, v in out.items()}


def _creato(col):
    return cast(col, Date)


def _evidenze(db: Session, da: date, a: date) -> dict:
    """{codice: {parte: [date ordinate]}} nell'intervallo (parte '' per le attività senza parti)."""
    tra = lambda col: col.between(da, a)   # noqa: E731
    ev = {}
    ev["corr_welcome"] = {"": _date(db.query(CorrispettiviDocumento.data_documento).distinct().filter(
        CorrispettiviDocumento.is_test.is_(False), CorrispettiviDocumento.struttura_code.in_(["DPH", "CLB", "INT"]),
        tra(CorrispettiviDocumento.data_documento)))}
    for rt in ("RT1", "RT2"):
        ev[rt.lower()] = {"": _date(db.query(RtChiusura.data_chiusura).distinct().filter(
            RtChiusura.rt_code == rt, tra(RtChiusura.data_chiusura)))}
    for s in ("MMS", "BON"):
        ev[f"incassi_{s.lower()}"] = {"": _date(db.query(CorrispettiviManuale.data_giorno).filter(
            CorrispettiviManuale.struttura_code == s, CorrispettiviManuale.is_test.is_(False),
            tra(CorrispettiviManuale.data_giorno)))}
    ev["revenue"] = _per_parte(db.query(ImportSession.hotel_code, ImportSession.snapshot_date).filter(
        tra(ImportSession.snapshot_date)))
    ev["banca"] = {"": _date(db.query(_creato(TesoreriaImport.created_at)).filter(
        tra(_creato(TesoreriaImport.created_at))))}
    ev["cassa"] = {"": _date(db.query(CassaMovimento.data).filter(
        CassaMovimento.tipo == "versamento", CassaMovimento.is_test.is_(False), tra(CassaMovimento.data)))}
    ev["produzione"] = {"": _date(db.query(_creato(ProdImport.created_at)).filter(
        ProdImport.is_test.is_(False), tra(_creato(ProdImport.created_at))))}
    ev["analisi_ricavi"] = {"": _date(db.query(_creato(AnalisiRicaviImport.created_at)).filter(
        AnalisiRicaviImport.is_test.is_(False), tra(_creato(AnalisiRicaviImport.created_at))))}
    ev["prenotazioni"] = _per_parte(db.query(PrenotazioneCancellataImport.tipo,
                                             _creato(PrenotazioneCancellataImport.created_at)).filter(
        PrenotazioneCancellataImport.is_test.is_(False), tra(_creato(PrenotazioneCancellataImport.created_at))))
    ev["previsione"] = {"": _date(db.query(_creato(TesoreriaPrevisioneSalvata.created_at)).filter(
        tra(_creato(TesoreriaPrevisioneSalvata.created_at))))}
    ev["passcom"] = {"": _date(db.query(_creato(TesoreriaScadImport.created_at)).filter(
        tra(_creato(TesoreriaScadImport.created_at))))}
    ev["ce_contabile"] = {"": _date(db.query(_creato(UsaliImport.created_at)).filter(
        tra(_creato(UsaliImport.created_at))))}
    ev["cedolini"] = {"": _mese_dopo(db.query(PayrollImport.anno, PayrollImport.mese).filter(
        PayrollImport.is_test.is_(False)).distinct())}
    coperti = {}
    for s, anno, mese in db.query(UsaliFnbCoperti.struttura_code, UsaliFnbCoperti.anno, UsaliFnbCoperti.mese):
        coperti.setdefault(s, []).append((anno, mese))
    ev["coperti"] = {s: _mese_dopo(v) for s, v in coperti.items()}
    ev["utenze"] = {"": _mese_dopo(db.query(ProdOccupazioneConsumo.anno, ProdOccupazioneConsumo.mese).filter(
        ProdOccupazioneConsumo.voce_code.like("utenze_%")).distinct())}
    for codice, conto in (("amex", "AMEX"), ("bcc", "CARTA_BCC"), ("tasca", "TASCA")):
        ev[codice] = {"": _date(db.query(TesoreriaSaldo.data).join(TesoreriaConto).filter(
            TesoreriaConto.codice == conto, TesoreriaSaldo.origine == "manuale", tra(TesoreriaSaldo.data)))}
    # annuali: il budget e le stagioni dell'anno dopo si preparano nell'anno prima
    ev["budget"] = {"": sorted({date(y - 1, 12, 1) for (y,) in db.query(BudgetEntry.season_year).filter(
        BudgetEntry.version == "v1").distinct()})}
    ev["stagioni"] = {"": sorted({date(y - 1, 12, 1) for (y,) in db.query(HotelSeason.season_year).distinct()})}
    return ev


def _stagioni(db: Session, anni: set) -> dict:
    out = {}
    for code, anno, apre, chiude in db.query(Hotel.code, HotelSeason.season_year, HotelSeason.open_date,
                                              HotelSeason.close_date).join(Hotel, Hotel.id == HotelSeason.hotel_id) \
            .filter(HotelSeason.season_year.in_(anni)):
        out.setdefault((code, anno), []).append((apre, chiude))
    return out


def _fatte(db: Session) -> set:
    return {(c, s) for c, s in db.query(AttivitaFatta.codice, AttivitaFatta.scadenza)}


def _mese_prima(anno: int, mese: int) -> tuple:
    return (anno - 1, 12) if mese == 1 else (anno, mese - 1)


def _calcola(db: Session, mesi: list, oggi: date) -> list:
    """voci_mese per ogni (anno, mese), con una sola lettura delle evidenze."""
    anni = {a for a, _ in mesi}
    catalogo = _catalogo(db)
    evidenze = _evidenze(db, date(min(anni), 1, 1), date(max(anni), 12, 31))
    fatte, stagioni = _fatte(db), _stagioni(db, anni)
    return [voci_mese(catalogo, a, m, evidenze, fatte, stagioni, oggi) for a, m in mesi]


def _impegni(db: Session, anno: int, mese: int, oggi: date) -> dict:
    """Impegni di Tesoreria (fisco, affitti, mutuo…) con scadenza nel mese: quanti non ancora pagati in banca."""
    da = date(anno, mese, 1)
    a = (da + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    righe = db.query(TesoreriaImpegno).filter(TesoreriaImpegno.data_scadenza.between(da, a)).all()
    pagato = lambda i: i.stato == "pagato" or (i.movimento_id is not None  # noqa: E731
                                               and i.abbinamento in ("automatico", "confermato"))
    aperti = [i for i in righe if not pagato(i)]
    return {"totale": len(righe), "da_pagare": len(aperti),
            "scaduti": sum(1 for i in aperti if i.data_scadenza < oggi)}


def _json(v: dict) -> dict:
    def d(x):
        return x.isoformat() if isinstance(x, date) else x
    out = {k: d(x) for k, x in v.items() if k not in ("scadenze", "giorni")}
    out["scadenze"] = [d(x) for x in v["scadenze"]]
    out["giorni"] = None if v["giorni"] is None else [{k: d(x) for k, x in g.items()} for g in v["giorni"]]
    return out


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("")
def lista(anno: Optional[int] = Query(None), mese: Optional[int] = Query(None, ge=1, le=12),
          db: Session = Depends(get_db), _=Depends(richiedi_admin)):
    oggi = date.today()
    anno, mese = anno or oggi.year, mese or oggi.month
    corrente, prima = (oggi.year, oggi.month), _mese_prima(oggi.year, oggi.month)
    richiesti = [(anno, mese)] + [m for m in (prima, corrente) if m != (anno, mese)]
    calcolati = dict(zip(richiesti, _calcola(db, richiesti, oggi)))
    sett = calcolati[(anno, mese)]
    return {
        "anno": anno, "mese": mese, "oggi": oggi.isoformat(),
        "settimane": [{"inizio": s["inizio"].isoformat(), "fine": s["fine"].isoformat(),
                       "voci": [_json(v) for v in s["voci"]]} for s in sett],
        "riepilogo": riepilogo(sett),
        "in_ritardo": [_json(v) for v in in_ritardo([calcolati[prima], calcolati[corrente]])],
        "impegni": _impegni(db, anno, mese, oggi),
    }


@router.get("/riepilogo")
def riepilogo_home(db: Session = Depends(get_db), _=Depends(richiedi_admin)):
    oggi = date.today()
    prima, corrente = _calcola(db, [_mese_prima(oggi.year, oggi.month), (oggi.year, oggi.month)], oggi)
    entro = oggi + timedelta(days=7)
    da_fare = sum(1 for s in corrente for v in s["voci"] if v["stato"] == "da_fare" and v["scadenza"] <= entro)
    return {"in_ritardo": len(in_ritardo([prima, corrente])), "da_fare_7gg": da_fare}


class CorpoFatto(BaseModel):
    codice: str
    scadenze: list[date]
    fatto: bool = True


@router.post("/fatto")
def segna_fatto(body: CorpoFatto, db: Session = Depends(get_db), utente=Depends(richiedi_admin)):
    if body.codice not in PER_CODICE:
        raise HTTPException(status_code=404, detail="Attività sconosciuta")
    esistenti = {s for (s,) in db.query(AttivitaFatta.scadenza).filter(
        AttivitaFatta.codice == body.codice, AttivitaFatta.scadenza.in_(body.scadenze))}
    if body.fatto:
        for s in set(body.scadenze) - esistenti:
            db.add(AttivitaFatta(codice=body.codice, scadenza=s, utente_id=getattr(utente, "id", None)))
    else:
        db.query(AttivitaFatta).filter(AttivitaFatta.codice == body.codice,
                                       AttivitaFatta.scadenza.in_(body.scadenze)).delete(synchronize_session=False)
    db.commit()
    return {"ok": True}


@router.get("/catalogo")
def catalogo(db: Session = Depends(get_db), _=Depends(richiedi_admin)):
    parametri = _leggi_parametri(db)
    in_uso = {a.codice: a for a in applica_parametri(parametri)}
    out = []
    for base in CATALOGO:
        a = in_uso[base.codice]
        out.append({
            "codice": a.codice, "titolo": a.titolo, "gruppo": a.gruppo, "frequenza": a.frequenza,
            "automatica": a.automatica, "nota": a.nota, "giorno": a.giorno, "mese": a.mese, "mesi": list(a.mesi),
            "attiva": a.attiva, "descrizione": descrivi_frequenza(a), "modificata": base.codice in parametri,
            "default": {"giorno": base.giorno, "mese": base.mese, "mesi": list(base.mesi), "attiva": base.attiva},
        })
    return out


@router.put("/parametri/{codice}")
def salva_parametri(codice: str, body: dict, db: Session = Depends(get_db), _=Depends(richiedi_admin)):
    if codice not in PER_CODICE:
        raise HTTPException(status_code=404, detail="Attività sconosciuta")
    parametri = _leggi_parametri(db)
    if body.get("ripristina"):
        parametri.pop(codice, None)
    else:
        try:
            parametri[codice] = {**parametri.get(codice, {}), **valida_parametri(codice, body)}
        except (ValueError, TypeError) as e:
            raise HTTPException(status_code=400, detail=str(e))
    riga = db.query(AppConfig).filter(AppConfig.key == CHIAVE_CONFIG).first()
    if riga is None:
        riga = AppConfig(key=CHIAVE_CONFIG, description="Attività ricorrenti: frequenze modificate da Admin")
        db.add(riga)
    riga.value = json.dumps(parametri)
    db.commit()
    return {"ok": True}


# ── PDF ───────────────────────────────────────────────────────────────────────

_STATO_PDF = {"fatta": "fatta", "da_fare": "", "in_ritardo": "IN RITARDO"}


def _gg(d: date) -> str:
    return f"{d.day:02d}/{d.month:02d}"


class Casella(Flowable):
    """Casella da spuntare a penna; con la spunta se l'attività risulta già fatta."""

    def __init__(self, fatta: bool, lato: float = 8):
        super().__init__()
        self.fatta, self.lato = fatta, lato
        self.width = self.height = lato

    def draw(self):
        c = self.canv
        c.setStrokeColor(rl_colors.HexColor("#1e293b"))
        c.setLineWidth(0.8)
        c.rect(0, 0, self.lato, self.lato)
        if self.fatta:
            c.setStrokeColor(rl_colors.HexColor("#15803d"))
            c.setLineWidth(1.4)
            c.line(1.5, 4, 3.5, 1.5)
            c.line(3.5, 1.5, 7, 7)


def _righe_pdf(voci: list, p) -> list:
    righe = []
    for v in voci:
        casella = Casella(v["stato"] == "fatta")
        if v["giorni"]:
            g = v["giorni"]
            quando = f"ogni giorno {_gg(g[0]['data'])}–{_gg(g[-1]['data'])}"
            mancano = [x["data"] for x in g if x["stato"] != "fatta"]
            dettaglio = (f"mancano {', '.join(_gg(d) for d in mancano[:8])}{'…' if len(mancano) > 8 else ''}"
                         if mancano and v["stato"] != "da_fare" else "")
        else:
            quando = formatta_data_it(v["scadenza"])
            dettaglio = ("manca " + ", ".join(ETICHETTE_PARTI.get(x, x) for x in v["mancanti"])) if v["mancanti"] and v["stato"] != "fatta" else ""
        stato = _STATO_PDF[v["stato"]]
        if stato == "IN RITARDO":
            stato = '<font color="#b91c1c"><b>IN RITARDO</b></font>'
        righe.append([casella, Paragraph(v["titolo"], p), Paragraph(v["gruppo"], p),
                      Paragraph(quando, p), Paragraph(" ".join(x for x in (stato, dettaglio) if x), p)])
    return righe


def _tabella_pdf(righe: list, larghezza: float) -> Table:
    pesi = [0.05, 0.42, 0.16, 0.15, 0.22]
    t = Table([["", "Attività", "Modulo", "Scadenza", "Stato"]] + righe,
              colWidths=[larghezza * w for w in pesi], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), rl_colors.HexColor("#1e3a5f")),
        ("TEXTCOLOR", (0, 0), (-1, 0), rl_colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 1), (0, -1), "CENTER"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [rl_colors.white, rl_colors.HexColor("#f1f5f9")]),
        ("GRID", (0, 0), (-1, -1), 0.25, rl_colors.HexColor("#cbd5e1")),
    ]))
    return t


def _fuori_mese(voci: list, anno: int, mese: int) -> list:
    """Voci in ritardo che non appartengono al mese (per le giornaliere: solo i giorni di altri mesi)."""
    out = []
    for v in voci:
        if v["giorni"] is None:
            if (v["scadenza"].year, v["scadenza"].month) != (anno, mese):
                out.append(v)
            continue
        g = [x for x in v["giorni"] if (x["data"].year, x["data"].month) != (anno, mese)]
        if g:
            out.append({**v, "giorni": g, "scadenze": [x["scadenza"] for x in g]})
    return out


@router.get("/export")
def esporta(anno: Optional[int] = Query(None), mese: Optional[int] = Query(None, ge=1, le=12),
            db: Session = Depends(get_db), _=Depends(richiedi_admin)):
    oggi = date.today()
    anno, mese = anno or oggi.year, mese or oggi.month
    prima = _mese_prima(oggi.year, oggi.month)
    corrente = (oggi.year, oggi.month)
    richiesti = [(anno, mese)] + [m for m in (prima, corrente) if m != (anno, mese)]
    calcolati = dict(zip(richiesti, _calcola(db, richiesti, oggi)))

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=24, bottomMargin=24, leftMargin=28, rightMargin=28,
                            title=f"Attività {MESI_LUNGHI[mese - 1]} {anno}")
    stili = getSampleStyleSheet()
    p = stili["BodyText"].clone("cella", fontSize=8, leading=10)
    larghezza = A4[0] - doc.leftMargin - doc.rightMargin
    el = [Paragraph(f"Attività ricorrenti — {MESI_LUNGHI[mese - 1]} {anno}", stili["Heading2"]),
          Paragraph(f"Generato il {formatta_data_it(oggi)}. Stato ricavato dagli import di HotelOS.", p),
          Spacer(1, 8)]
    ritardi = _fuori_mese(in_ritardo([calcolati[prima], calcolati[corrente]]), anno, mese) \
        if (anno, mese) == corrente else []
    if ritardi:
        el += [Paragraph("In ritardo dal mese prima", stili["Heading4"]), _tabella_pdf(_righe_pdf(ritardi, p), larghezza),
               Spacer(1, 8)]
    for s in calcolati[(anno, mese)]:
        if not s["voci"]:
            continue
        titolo = f"Settimana dal {formatta_data_it(s['inizio'])} al {formatta_data_it(s['fine'])}"
        el += [Paragraph(titolo, stili["Heading4"]), _tabella_pdf(_righe_pdf(s["voci"], p), larghezza), Spacer(1, 6)]
    imp = _impegni(db, anno, mese, oggi)
    if imp["totale"]:
        el.append(Paragraph(f"Impegni di Tesoreria del mese (F24, affitti, mutuo…): {imp['totale']}, "
                            f"da pagare {imp['da_pagare']} — vedi Tesoreria → Impegni.", p))
    doc.build(el)
    buf.seek(0)
    nome = f"attivita_{anno}-{mese:02d}.pdf"
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{nome}"'})
