"""Costruzione del Conto Economico USALI contabile dalle righe foglia (usali_riga).

Funzione pura: tutti i totali (Profitto reparti, GOP, EBITDA, Netto…) sono ricalcolati dalle
foglie, mai letti dall'export. Le righe in ingresso possono essere oggetti UsaliRiga o dict con
le stesse chiavi (anno, mese, importo, sezione, reparto, sottoreparto, conto_nome, ordine,
percorso_testo) — dopo la segmentazione l'importo è la quota del segmento.

Righe in uscita: lista piatta già ordinata, con id/parent per l'espansione lato frontend.
"""

from decimal import Decimal

S_RICAVI = "Ricavi Operativi"
S_COSTI_OP = "Costi Operativi"
S_COSTI_GEN = "Costi Generali"
S_NON_OP = "Non Operativi"
S_DEPREZZ = "Deprezzamenti"
S_NON_CLASS = "Non classificato"

ZERO = Decimal(0)


def _a(riga, nome):
    return riga[nome] if isinstance(riga, dict) else getattr(riga, nome)


class _Acc:
    """Importi di un nodo: per mese del periodo, progressivo da inizio anno, anno precedente."""
    __slots__ = ("mesi", "ytd", "prec", "ordine")

    def __init__(self):
        self.mesi = {}
        self.ytd = ZERO
        self.prec = ZERO
        self.ordine = None

    def aggiungi(self, altro: "_Acc"):
        for m, v in altro.mesi.items():
            self.mesi[m] = self.mesi.get(m, ZERO) + v
        self.ytd += altro.ytd
        self.prec += altro.prec
        return self

    @staticmethod
    def somma(*accs):
        out = _Acc()
        for a in accs:
            if a is not None:
                out.aggiungi(a)
        return out


def _f(v):
    return None if v is None else round(float(v), 2)


def costruisci_report(righe, anno: int, mese_da: int, mese_a: int,
                      mesi_importati: set, prec_disponibile: bool) -> dict:
    """
    righe: foglie di (anno, mese ≤ mese_a) e (anno-1, mese_da..mese_a).
    mesi_importati: {(anno, mese)} con almeno una riga in DB per la struttura (un mese senza
    import mostra valori vuoti, non zero).
    """
    mesi = list(range(mese_da, mese_a + 1))
    nodi = {}

    def nodo(chiave, ordine):
        acc = nodi.get(chiave)
        if acc is None:
            acc = nodi[chiave] = _Acc()
        if acc.ordine is None or ordine < acc.ordine:
            acc.ordine = ordine
        return acc

    for r in righe:
        a, m = _a(r, "anno"), _a(r, "mese")
        imp = Decimal(str(_a(r, "importo")))
        nel_periodo = a == anno and mese_da <= m <= mese_a
        ytd = a == anno and m <= mese_a
        prec = a == anno - 1 and mese_da <= m <= mese_a
        if not (nel_periodo or ytd or prec):
            continue
        sez = _a(r, "sezione") or S_NON_CLASS
        rep = _a(r, "reparto")
        sot = _a(r, "sottoreparto")
        ordine = _a(r, "ordine")
        chiavi = [("sez", sez)]
        if rep:
            chiavi.append(("rep", sez, rep))
            if sot:
                chiavi.append(("sot", sez, rep, sot))
        chiavi.append(("conto", sez, rep, sot, _a(r, "percorso_testo"), _a(r, "conto_nome")))
        for k in chiavi:
            acc = nodo(k, ordine)
            if nel_periodo:
                acc.mesi[m] = acc.mesi.get(m, ZERO) + imp
            if ytd:
                acc.ytd += imp
            if prec:
                acc.prec += imp

    sez_acc = {s: nodi.get(("sez", s)) for s in
               (S_RICAVI, S_COSTI_OP, S_COSTI_GEN, S_NON_OP, S_DEPREZZ, S_NON_CLASS)}
    ricavi = sez_acc[S_RICAVI] or _Acc()
    ricavi_tot = sum(ricavi.mesi.values(), ZERO)

    out = []

    def emetti(id_, parent, livello, tipo, nome, acc, chiave=None):
        valori = [
            _f(acc.mesi.get(m, ZERO)) if (anno, m) in mesi_importati else None
            for m in mesi
        ]
        totale = sum((acc.mesi.get(m, ZERO) for m in mesi if (anno, m) in mesi_importati), ZERO)
        out.append({
            "id": id_, "parent": parent, "livello": livello, "tipo": tipo, "nome": nome,
            "chiave": chiave,
            "valori": valori,
            "totale": _f(totale),
            "progressivo": _f(acc.ytd),
            "anno_prec": _f(acc.prec) if prec_disponibile else None,
            "delta_anno_prec": _f(totale - acc.prec) if prec_disponibile else None,
            "perc_ricavi": _f(totale / ricavi_tot * 100) if ricavi_tot else None,
        })

    def emetti_sezione(sez):
        acc = sez_acc[sez]
        if acc is None:
            return
        sid = f"sez:{sez}"
        emetti(sid, None, 0, "sezione", sez, acc, chiave=sez)
        figli = sorted((k for k in nodi if k[0] != "sez" and k[1] == sez), key=lambda k: nodi[k].ordine)
        for k in figli:
            if k[0] == "rep":
                emetti(f"rep:{sez}|{k[2]}", sid, 1, "reparto", k[2], nodi[k])
            elif k[0] == "sot":
                emetti(f"sot:{sez}|{k[2]}|{k[3]}", f"rep:{sez}|{k[2]}", 2, "sottoreparto", k[3], nodi[k])
            else:
                _, _, rep, sot, perc, nome = k
                if sot:
                    parent, liv = f"sot:{sez}|{rep}|{sot}", 3
                elif rep:
                    parent, liv = f"rep:{sez}|{rep}", 2
                else:
                    parent, liv = sid, 1
                emetti(f"conto:{perc}", parent, liv, "conto", nome, nodi[k], chiave=perc)

    # ── Profitto per reparto: ricavi reparto + costi reparto (costi già negativi) ──
    reparti = []
    for sez in (S_RICAVI, S_COSTI_OP):
        for k in sorted((k for k in nodi if k[0] == "rep" and k[1] == sez), key=lambda k: nodi[k].ordine):
            if k[2] not in reparti:
                reparti.append(k[2])
    profitto_reparti = _Acc.somma(sez_acc[S_RICAVI], sez_acc[S_COSTI_OP])
    gop = _Acc.somma(profitto_reparti, sez_acc[S_COSTI_GEN])
    ebitda = _Acc.somma(gop, sez_acc[S_NON_OP])
    netto = _Acc.somma(ebitda, sez_acc[S_DEPREZZ], sez_acc[S_NON_CLASS])

    emetti_sezione(S_RICAVI)
    emetti_sezione(S_COSTI_OP)
    emetti("tot:profitto_reparti", None, 0, "subtotale", "Profitto dei Reparti Operativi",
           profitto_reparti, chiave="profitto_reparti")
    for rep in reparti:
        acc = _Acc.somma(nodi.get(("rep", S_RICAVI, rep)), nodi.get(("rep", S_COSTI_OP, rep)))
        emetti(f"profitto:{rep}", "tot:profitto_reparti", 1, "profitto_reparto", rep, acc, chiave=rep)
    emetti_sezione(S_COSTI_GEN)
    emetti("tot:gop", None, 0, "totale", "Profitto Operativo Lordo (GOP)", gop, chiave="gop")
    emetti_sezione(S_NON_OP)
    emetti("tot:ebitda", None, 0, "totale", "EBITDA", ebitda, chiave="ebitda")
    emetti_sezione(S_DEPREZZ)
    emetti_sezione(S_NON_CLASS)
    emetti("tot:netto", None, 0, "totale", "Reddito Netto", netto, chiave="netto")

    sintesi = {r["chiave"]: r for r in out if r["tipo"] in ("subtotale", "totale")}
    for sez in (S_RICAVI, S_COSTI_OP, S_COSTI_GEN, S_NON_OP, S_DEPREZZ):
        sintesi[sez] = next((r for r in out if r["tipo"] == "sezione" and r["chiave"] == sez), None)

    return {
        "anno": anno, "mese_da": mese_da, "mese_a": mese_a, "mesi": mesi,
        "mesi_importati": [m for m in mesi if (anno, m) in mesi_importati],
        "prec_disponibile": prec_disponibile,
        "righe": out,
        "sintesi": {
            "ricavi": sintesi[S_RICAVI],
            "profitto_reparti": sintesi["profitto_reparti"],
            "gop": sintesi["gop"],
            "ebitda": sintesi["ebitda"],
            "netto": sintesi["netto"],
        },
    }
