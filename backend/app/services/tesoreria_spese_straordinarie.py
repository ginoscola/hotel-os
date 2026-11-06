"""Tesoreria — spese straordinarie: fatture collegate con modalità e data di pagamento (v4.29.0). Funzioni pure.

Ogni fattura collegata a una spesa straordinaria ha **come è stata pagata** e **quando** (giorno dell'addebito in
banca). Le stime delle uscite della previsione si fanno sullo storico della banca per categoria e mese, senza i
movimenti `straordinario`: una fattura straordinaria pagata dentro un pagamento cumulativo (Ri.Ba., SDD, bonifico di
più fatture), con carta o con assegno resterebbe nello storico e verrebbe ripetuta negli anni dopo. Qui si calcola
quanto togliere dallo storico, per categoria e mese:
- contanti: niente (non è passata dalla banca);
- pagamento già segnato straordinario (bonifico collegato alla spesa, Ri.Ba. con sole fatture straordinarie): niente,
  è già fuori dallo storico;
- fattura ancora aperta (tra le uscite certe della previsione) o pagamento futuro: niente;
- in un mese non si toglie più di quanto è uscito davvero in quella categoria (l'eccesso diventa un avviso: data o
  modalità probabilmente sbagliate).

Anno della spesa = **anno alberghiero** (1/10–30/9, identificato dall'anno di fine: la piscina fatta a novembre 2026 è
un lavoro 2027), proposto dalla prima data della spesa.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Optional

from app.services.tesoreria_abbinamento import forza_nome, parole

ZERO = Decimal("0.00")

MODALITA = ("bonifico", "riba", "sdd", "assegno", "carta", "contanti")
NOMI_MODALITA = {"bonifico": "Bonifico", "riba": "Ri.Ba.", "sdd": "Addebito diretto (SDD)", "assegno": "Assegno",
                 "carta": "Carta", "contanti": "Contanti"}
# modalità → categoria dello storico della banca da cui togliere l'importo (contanti: nessuna)
CATEGORIA_MODALITA = {"bonifico": "fornitori_bonifici", "riba": "fornitori_riba", "sdd": "fornitori_sdd",
                      "assegno": "assegni", "carta": "carte"}
# categoria del movimento in banca che paga la fattura → modalità
MODALITA_DA_CATEGORIA = {"fornitori_riba": "riba", "fornitori_sdd": "sdd", "assegni": "assegno", "carte": "carta",
                         "fornitori_bonifici": "bonifico"}


def modalita_da_passcom(tipo: Optional[str]) -> Optional[str]:
    """Modalità alla Passcom (RIC.BANC., ADDEB. C/C, BONIFICO, RIMESSA, CONTANTI, ASSEGNO, CARTA, RID) → modalità."""
    t = (tipo or "").upper()
    if t.startswith("RIC.BANC"):
        return "riba"
    if t.startswith("ADDEB") or t.startswith("RID"):
        return "sdd"
    if t.startswith("BONIFICO") or t.startswith("RIMESSA"):
        return "bonifico"
    if t.startswith("CONTANT"):
        return "contanti"
    if t.startswith("ASSEGN"):
        return "assegno"
    if t.startswith("CARTA"):
        return "carta"
    return None


def predefiniti(tipo_pagamento: Optional[str], data_scadenza: Optional[date], pagata_con_carta: bool,
                movimento: Optional[tuple] = None) -> tuple:
    """(modalità, data di pagamento) proposte al collegamento. `movimento` = (codice categoria, data contabile) del
    pagamento trovato in banca: vince su tutto. Poi i fornitori pagati con carta, poi la modalità della fattura con la
    sua scadenza."""
    if movimento is not None:
        categoria, data = movimento
        return MODALITA_DA_CATEGORIA.get(categoria, "bonifico"), data
    if pagata_con_carta:
        return "carta", data_scadenza
    return modalita_da_passcom(tipo_pagamento), data_scadenza


GIORNI_RICERCA_PAGAMENTO = 90      # pagamento cercato in banca entro 90 giorni dalla scadenza della fattura


def nome_compatibile(fornitore: Optional[str], nome_banca: Optional[str]) -> bool:
    """Con l'importo identico al centesimo basta una parola in comune, anche una sigla corta ('B & T S.r.l.' ↔
    'B&T srl Dorelan')."""
    return forza_nome(fornitore or "", nome_banca or "") >= 1 or bool(set(parole(fornitore)) & set(parole(nome_banca)))


def abbina_per_importo(voci, movimenti, giorni: int = GIORNI_RICERCA_PAGAMENTO) -> dict:
    """Pagamento in banca di fatture non abbinate: stessa cifra al centesimo, nome compatibile, data entro `giorni`
    dalla scadenza; il più vicino, un movimento per una sola fattura.
    voci: [(chiave, fornitore, importo, data di riferimento)]; movimenti: [(id, data, importo positivo, nome)].
    Restituisce {chiave: id movimento}."""
    usati, out = set(), {}
    for chiave, fornitore, importo, rif in sorted(voci, key=lambda v: (v[3], v[0])):
        if importo is None or importo <= 0 or rif is None:
            continue
        candidati = [m for m in movimenti if m[0] not in usati and m[2] == importo and abs((m[1] - rif).days) <= giorni
                     and nome_compatibile(fornitore, m[3])]
        if candidati:
            m = min(candidati, key=lambda m: (abs((m[1] - rif).days), m[0]))
            usati.add(m[0])
            out[chiave] = m[0]
    return out


def anno_alberghiero(d: date) -> int:
    return d.year + 1 if d.month >= 10 else d.year


@dataclass
class FatturaSpesa:
    chiave: str
    importo: Decimal                    # negativo per le note di credito
    modalita: Optional[str]
    data_pagamento: Optional[date]
    gia_fuori: bool = False             # il pagamento in banca è già segnato straordinario
    aperta: bool = False                # ancora da pagare (tra le uscite certe della previsione)
    categoria: Optional[str] = None     # categoria del pagamento trovato in banca (vince sulla modalità)


def da_togliere(fatture, oggi: date) -> dict:
    """{categoria: {(anno, mese): importo}} da togliere dallo storico delle uscite."""
    out = {}
    for f in fatture:
        categoria = f.categoria or CATEGORIA_MODALITA.get(f.modalita or "")
        if categoria is None or f.data_pagamento is None or f.data_pagamento > oggi or f.gia_fuori or f.aperta:
            continue
        chiave = (f.data_pagamento.year, f.data_pagamento.month)
        per_cat = out.setdefault(categoria, {})
        per_cat[chiave] = per_cat.get(chiave, ZERO) + f.importo
    return out


def applica_allo_storico(uscite: dict, togliere: dict) -> tuple:
    """Toglie gli importi dallo storico `uscite` ({categoria: {(anno, mese): importo positivo}}), mai sotto zero.
    Restituisce (storico corretto, tolto davvero {categoria: {(anno, mese): importo}}, avvisi)."""
    nuove = {c: dict(v) for c, v in uscite.items()}
    tolto, avvisi = {}, []
    for categoria, mesi in togliere.items():
        for (a, m), importo in sorted(mesi.items()):
            if importo <= 0:
                continue
            presente = Decimal(str(nuove.get(categoria, {}).get((a, m), ZERO)))
            effettivo = min(importo, presente)
            if effettivo > 0:
                nuove.setdefault(categoria, {})[(a, m)] = presente - effettivo
                tolto.setdefault(categoria, {})[(a, m)] = effettivo
            if importo - effettivo > Decimal("0.01"):
                avvisi.append({"categoria": categoria, "anno": a, "mese": m, "importo": importo, "uscito": presente})
    return nuove, tolto, avvisi
