"""Tesoreria — scheda Scadenzario (Fase 2): stato di ogni scadenza della fotografia corrente, riepilogo,
dettaglio per fornitore, lista "da segnalare allo studio" (pagate in banca o a mano ma ancora aperte in
Passcom) con export, tempi di pagamento per la scheda KPI.

Stato di una scadenza (in quest'ordine): `pareggio` (riga *PAREGGIO*), `pagata_banca` (abbinamento
automatico o confermato), `pagata_manuale`, `da_confermare` (abbinamento proposto), `residuo` (anni
precedenti, da verificare con lo studio), `scaduta`, `aperta`. Poi `compensa_pareggi()` distribuisce i
pareggi del fornitore: le righe coperte per intero diventano `compensata` (`stato_originale` dice cosa
erano), le altre hanno `aperto` (da pagare) o `da_segnalare` (pagata ma non ancora registrata dallo studio).
"""

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.tesoreria import (
    TesoreriaAbbinamento, TesoreriaAbbinamentoMovimento, TesoreriaAbbinamentoScadenza, TesoreriaMovimento,
    TesoreriaPagataManuale,
)
from app.routers.corrispettivi_documenti import _risposta_tabella
from app.routers.tesoreria_abbinamenti import _abbinamenti_json, _alias, _uscite_pagamento, fotografia_corrente
from app.routers.tesoreria_shared import cella_data, cella_importo, euro, puo_vedere
from app.services.tesoreria_abbinamento import forza_nome
from app.services.tesoreria_scadenzario import compensa_pareggi, e_residuo, per_fornitore, riepilogo

router = APIRouter()

ZERO = Decimal("0.00")
STATI_DA_PAGARE = ("aperta", "scaduta", "da_confermare")
STATI_PAGATE = ("pagata_banca", "pagata_manuale")
GIORNI_IN_SCADENZA = 30
MESI_PAGAMENTI_FORNITORE = 18
ETICHETTE_REGOLA = {
    "riba": "Ri.Ba.", "riba_somma": "Ri.Ba.", "sdd": "Addebito diretto", "bonifico": "Bonifico",
    "bonifico_somma": "Bonifico", "assegno": "Assegno", "altra_modalita": "Altra modalità", "manuale": "Abbinato a mano",
}


def _pagamenti_per_chiave(db: Session) -> dict:
    """{chiave: {stato, abbinamento_id, regola, data_pagamento}} degli abbinamenti non scartati."""
    date_mov = defaultdict(list)
    for abb_id, giorno in db.query(TesoreriaAbbinamentoMovimento.abbinamento_id, TesoreriaMovimento.data_contabile) \
            .join(TesoreriaMovimento, TesoreriaMovimento.id == TesoreriaAbbinamentoMovimento.movimento_id):
        date_mov[abb_id].append(giorno)
    out = {}
    for chiave, a in db.query(TesoreriaAbbinamentoScadenza.chiave, TesoreriaAbbinamento) \
            .join(TesoreriaAbbinamento, TesoreriaAbbinamento.id == TesoreriaAbbinamentoScadenza.abbinamento_id) \
            .filter(TesoreriaAbbinamento.stato != "scartato"):
        out[chiave] = {"stato": a.stato, "abbinamento_id": a.id, "regola": a.regola,
                       "data_pagamento": max(date_mov[a.id]) if date_mov[a.id] else None}
    return out


def stato_scadenze(db: Session, oggi: Optional[date] = None) -> dict:
    """Fotografia corrente con lo stato di ogni scadenza, totali e riepilogo per fornitore."""
    oggi = oggi or date.today()
    data_foto, scadenze = fotografia_corrente(db)
    if not scadenze:
        return {"data_fotografia": None, "oggi": oggi.isoformat(), "totali": None, "fornitori": [], "scadenze": []}
    pagamenti = _pagamenti_per_chiave(db)
    manuali = {p.chiave: p for p in db.query(TesoreriaPagataManuale)}
    fornitori = {f["codice_fornitore"]: f for f in per_fornitore(scadenze, data_foto)}

    righe = []
    for s in scadenze:
        p, m = pagamenti.get(s.chiave), manuali.get(s.chiave)
        if s.pareggio:
            stato = "pareggio"
        elif p and p["stato"] in ("automatico", "confermato"):
            stato = "pagata_banca"
        elif m:
            stato = "pagata_manuale"
        elif p:
            stato = "da_confermare"
        elif e_residuo(s, data_foto):
            stato = "residuo"
        elif s.data_scadenza < oggi:
            stato = "scaduta"
        else:
            stato = "aperta"
        data_pag = (p["data_pagamento"] if p and stato == "pagata_banca"
                    else m.data_pagamento if stato == "pagata_manuale" else None)
        righe.append({
            "chiave": s.chiave, "stato": stato, "data_scadenza": s.data_scadenza, "tipo_pagamento": s.tipo_pagamento,
            "tipo_documento": s.tipo_documento, "numero_documento": s.numero_documento,
            "data_documento": s.data_documento, "codice_fornitore": s.codice_fornitore, "fornitore": s.fornitore,
            "importo": s.importo, "descrizione": s.descrizione,
            "abbinamento_id": p["abbinamento_id"] if p else None,
            "abbinamento_stato": p["stato"] if p else None,
            "pagata_come": (ETICHETTE_REGOLA.get(p["regola"], p["regola"]) if stato == "pagata_banca"
                            else "Segnata a mano" if stato == "pagata_manuale" else None),
            "data_pagamento": data_pag, "nota_manuale": m.nota if m else None, "pareggio": s.pareggio,
        })
    compensa_pareggi(righe)

    def somma(filtro, campo="aperto"):
        sel = [r for r in righe if filtro(r)]
        return {"n": len(sel), "importo": sum((r[campo] for r in sel), ZERO)}

    limite = oggi + timedelta(days=GIORNI_IN_SCADENZA)
    tot_riep = riepilogo(scadenze, data_foto)
    totali = {
        "aperto_passcom": tot_riep["aperto"], "totale_file": tot_riep["totale"],
        "da_pagare": somma(lambda r: r["stato"] in STATI_DA_PAGARE),
        "scaduto": somma(lambda r: r["stato"] == "scaduta"),
        "in_scadenza": somma(lambda r: r["stato"] == "aperta" and r["data_scadenza"] <= limite),
        "da_segnalare": somma(lambda r: r["stato"] in STATI_PAGATE, "da_segnalare"),
        "pagate_banca": somma(lambda r: r["stato"] == "pagata_banca", "da_segnalare"),
        "pagate_manuali": somma(lambda r: r["stato"] == "pagata_manuale", "da_segnalare"),
        "da_confermare": somma(lambda r: r["stato"] == "da_confermare"),
        "residui": somma(lambda r: r["stato"] == "residuo"),
        "compensate": somma(lambda r: r["stato"] == "compensata", "compensato"),
        "giorni_in_scadenza": GIORNI_IN_SCADENZA, "limite_residui": tot_riep["limite_residui"],
    }

    per_forn = defaultdict(lambda: {"da_pagare": ZERO, "scaduto": ZERO, "da_segnalare": ZERO, "n_da_confermare": 0,
                                    "residui": ZERO, "n": 0, "prossima_scadenza": None})
    for r in righe:
        f = per_forn[r["codice_fornitore"]]
        f["n"] += 1
        if r["stato"] in STATI_DA_PAGARE:
            f["da_pagare"] += r["aperto"]
            if r["stato"] == "aperta" and (f["prossima_scadenza"] is None or r["data_scadenza"] < f["prossima_scadenza"]):
                f["prossima_scadenza"] = r["data_scadenza"]
        if r["stato"] == "scaduta":
            f["scaduto"] += r["aperto"]
        if r["stato"] in STATI_PAGATE:
            f["da_segnalare"] += r["da_segnalare"]
        if r["stato"] == "da_confermare":
            f["n_da_confermare"] += 1
        if r["stato"] == "residuo":
            f["residui"] += r["aperto"]
    elenco_fornitori = sorted(
        ({"codice_fornitore": c, "fornitore": fornitori[c]["fornitore"], "aperto_passcom": fornitori[c]["aperto"],
          "netto_passcom": fornitori[c]["netto"], **v} for c, v in per_forn.items()),
        key=lambda x: (-x["da_pagare"], -x["da_segnalare"], x["fornitore"]))
    return {"data_fotografia": data_foto, "oggi": oggi, "totali": totali, "fornitori": elenco_fornitori,
            "scadenze": righe}


def _json(valore):
    """Decimal → float, date → ISO, ricorsivo (per la risposta)."""
    if isinstance(valore, Decimal):
        return euro(valore)
    if isinstance(valore, date):
        return valore.isoformat()
    if isinstance(valore, dict):
        return {k: _json(v) for k, v in valore.items()}
    if isinstance(valore, list):
        return [_json(v) for v in valore]
    return valore


def tempi_pagamento(db: Session, da: date, a: date) -> dict:
    """Tempi di pagamento dagli abbinamenti (automatici e confermati) con pagamento nel periodo: giorni dalla
    data della fattura al pagamento in banca e rispetto alla scadenza, medie pesate sull'importo."""
    date_mov = defaultdict(list)
    for abb_id, giorno in db.query(TesoreriaAbbinamentoMovimento.abbinamento_id, TesoreriaMovimento.data_contabile) \
            .join(TesoreriaMovimento, TesoreriaMovimento.id == TesoreriaAbbinamentoMovimento.movimento_id):
        date_mov[abb_id].append(giorno)
    pesi = ZERO
    somma_fattura, somma_scadenza = ZERO, ZERO
    per_forn = defaultdict(lambda: [ZERO, ZERO, 0, ""])         # peso, giorni×peso da fattura, n, nome
    n = 0
    for s, a_ in db.query(TesoreriaAbbinamentoScadenza, TesoreriaAbbinamento) \
            .join(TesoreriaAbbinamento, TesoreriaAbbinamento.id == TesoreriaAbbinamentoScadenza.abbinamento_id) \
            .filter(TesoreriaAbbinamento.stato.in_(("automatico", "confermato"))):
        if not date_mov[a_.id] or s.importo <= 0 or not s.data_documento:
            continue
        pagato = max(date_mov[a_.id])
        if not (da <= pagato <= a):
            continue
        peso = s.importo
        g_fatt = Decimal((pagato - s.data_documento).days)
        pesi += peso
        somma_fattura += g_fatt * peso
        somma_scadenza += Decimal((pagato - s.data_scadenza).days) * peso
        f = per_forn[a_.codice_fornitore]
        f[0] += peso
        f[1] += g_fatt * peso
        f[2] += 1
        f[3] = a_.fornitore
        n += 1
    fornitori = sorted(
        ({"codice_fornitore": c, "fornitore": v[3], "n": v[2], "importo": euro(v[0]),
          "giorni_da_fattura": round(float(v[1] / v[0]), 1)} for c, v in per_forn.items()),
        key=lambda x: -x["importo"])
    return {
        "n": n, "importo": euro(pesi),
        "giorni_da_fattura": round(float(somma_fattura / pesi), 1) if pesi else None,
        "giorni_dopo_scadenza": round(float(somma_scadenza / pesi), 1) if pesi else None,
        "fornitori": fornitori[:10],
    }


# ── Endpoint ────────────────────────────────────────────────────────────────────

@router.get("/scadenzario/stato")
def stato(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    return _json(stato_scadenze(db))


@router.get("/scadenzario/fornitore/{codice}")
def dettaglio_fornitore(codice: str, db: Session = Depends(get_db), _=Depends(puo_vedere)):
    """Scadenze del fornitore con il loro stato, abbinamenti, pagamenti trovati in banca (nome simile o
    imparato, ultimi 18 mesi) e totali dei pagamenti mese per mese."""
    st = stato_scadenze(db)
    scadenze = [r for r in st["scadenze"] if r["codice_fornitore"] == codice]
    riepilogo_f = next((f for f in st["fornitori"] if f["codice_fornitore"] == codice), None)
    if not scadenze or not riepilogo_f:
        raise HTTPException(404, "Fornitore non presente nell'ultimo scadenzario")
    nome = scadenze[0]["fornitore"]
    alias = _alias(db).get(codice, set())
    da = date.today() - timedelta(days=MESI_PAGAMENTI_FORNITORE * 31)
    pagamenti = [m for m in _uscite_pagamento(db, set(), da) if forza_nome(nome, m.controparte, alias) >= 1]
    pagamenti.sort(key=lambda m: m.data, reverse=True)
    abbinati = {mid for (mid,) in db.query(TesoreriaAbbinamentoMovimento.movimento_id).join(
        TesoreriaAbbinamento, TesoreriaAbbinamento.id == TesoreriaAbbinamentoMovimento.abbinamento_id,
    ).filter(TesoreriaAbbinamento.stato.in_(("automatico", "confermato", "proposto")))}
    mensile = defaultdict(lambda: ZERO)
    for m in pagamenti:
        mensile[m.data.strftime("%Y-%m")] += -m.importo
    abbinamenti = db.query(TesoreriaAbbinamento).filter(TesoreriaAbbinamento.codice_fornitore == codice) \
        .order_by(TesoreriaAbbinamento.id.desc()).all()
    return _json({
        "codice_fornitore": codice, "fornitore": nome, "riepilogo": riepilogo_f,
        "nomi_in_banca": sorted(alias),
        "scadenze": sorted(scadenze, key=lambda r: r["data_scadenza"]),
        "pagamenti": [{"id": m.id, "data_contabile": m.data, "importo": m.importo, "controparte": m.controparte,
                       "causale_abi": m.causale_abi, "testo": m.testo.strip()[:160], "abbinato": m.id in abbinati}
                      for m in pagamenti],
        "mensile": [{"mese": k, "importo": v} for k, v in sorted(mensile.items())],
        "abbinamenti": _abbinamenti_json(db, abbinamenti),
    })


@router.get("/scadenzario/da-segnalare/export")
def export_da_segnalare(formato: str = Query("xlsx", pattern="^(xlsx|csv|pdf)$"), db: Session = Depends(get_db),
                        _=Depends(puo_vedere)):
    """Scadenze pagate (in banca o a mano) ma ancora aperte in Passcom: la lista da mandare allo studio."""
    st = stato_scadenze(db)
    da_segnalare = {f["codice_fornitore"] for f in st["fornitori"] if f["da_segnalare"] > 0}
    righe = sorted((r for r in st["scadenze"] if r["stato"] in STATI_PAGATE and r["da_segnalare"] != 0
                    and r["codice_fornitore"] in da_segnalare),
                   key=lambda r: (r["fornitore"], r["data_scadenza"]))
    intestazioni = ["Fornitore", "Cod. conto", "Documento", "Data doc.", "Scadenza", "Importo", "Pagata il", "Come"]
    corpo = [[r["fornitore"], r["codice_fornitore"],
              f"{r['tipo_documento'] or ''} {r['numero_documento'] or ''}".strip(), cella_data(r["data_documento"]),
              cella_data(r["data_scadenza"]), cella_importo(r["da_segnalare"], formato), cella_data(r["data_pagamento"]),
              r["pagata_come"] or ""] for r in righe]
    corpo.append(["TOTALE", "", f"{len(righe)} scadenze", "", "",
                  cella_importo(sum((r["da_segnalare"] for r in righe), ZERO), formato), "", ""])
    foto = st["data_fotografia"].strftime("%d/%m/%Y") if st["data_fotografia"] else "—"
    return _risposta_tabella(
        formato, f"scadenze_da_registrare_{date.today().isoformat()}",
        f"Scadenze pagate da registrare (scadenzario Passcom del {foto})", intestazioni, corpo,
        larghezze_pdf=[28, 9, 11, 9, 9, 10, 9, 13], numeriche_pdf=(5,),
    )
