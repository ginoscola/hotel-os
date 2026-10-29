"""Calcoli puri sullo scadenzario fornitori Passcom (modulo Tesoreria, Fase 2). Nessun accesso DB.

Funzionano sia sulle scadenze lette dal file (`ScadenzaPasscom`) sia su quelle salvate
(`TesoreriaScadenza`): servono solo gli attributi `chiave`, `data_scadenza`, `codice_fornitore`,
`fornitore`, `importo`, `pareggio`, `data_registrazione`.

Regole (decise con l'utente, 29/10/2026):
- l'aperto si calcola **per fornitore al netto dei pareggi**: un fornitore con saldo ≤ 0 non ha nulla da
  pagare (pagamenti/compensazioni registrati a date diverse dalle fatture che chiudono);
- **residui**: scadenze anteriori al 1° gennaio dell'anno precedente a quello della fotografia (es. fino
  al 2024 per una fotografia del 2026), da verificare con lo studio, fuori dalla vista per settimana;
- i pareggi coprono prima le scadenze già pagate in banca (lo studio ha registrato il pagamento come
  pareggio: non vanno segnalate), poi le aperte dalla più vecchia (`compensa_pareggi`). Caso reale MARR:
  pagamenti di luglio–settembre registrati come pareggi, non collegati alle fatture.
"""

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Optional

ZERO = Decimal("0.00")


def anno_contabile(scadenze) -> Optional[int]:
    """Anno dell'ultima data di registrazione: l'anno contabile di Passcom a cui appartiene il file."""
    date_reg = [s.data_registrazione for s in scadenze if s.data_registrazione]
    return max(date_reg).year if date_reg else None


def limite_residui(data_fotografia: date) -> date:
    return date(data_fotografia.year - 1, 1, 1)


def e_residuo(scadenza, data_fotografia: date) -> bool:
    return scadenza.data_scadenza < limite_residui(data_fotografia)


def unisci_fotografia(gruppi_scadenze) -> list:
    """Scadenze di più file della stessa fotografia, senza contare due volte la stessa chiave."""
    viste, out = set(), []
    for scadenze in gruppi_scadenze:
        for s in scadenze:
            if s.chiave not in viste:
                viste.add(s.chiave)
                out.append(s)
    return out


def per_fornitore(scadenze, data_fotografia: date) -> list:
    """Riepilogo per fornitore, ordinato per aperto decrescente."""
    gruppi = defaultdict(lambda: {"n": 0, "fatture": ZERO, "pareggi": ZERO, "residui": ZERO, "n_residui": 0,
                                  "scadenza_min": None, "scadenza_max": None})
    nomi = {}
    for s in scadenze:
        g = gruppi[s.codice_fornitore]
        nomi[s.codice_fornitore] = s.fornitore
        g["n"] += 1
        if s.pareggio:
            g["pareggi"] += s.importo
        else:
            g["fatture"] += s.importo
        if e_residuo(s, data_fotografia):
            g["residui"] += s.importo
            g["n_residui"] += 1
        g["scadenza_min"] = min(filter(None, [g["scadenza_min"], s.data_scadenza]))
        g["scadenza_max"] = max(filter(None, [g["scadenza_max"], s.data_scadenza]))
    out = []
    for codice, g in gruppi.items():
        netto = g["fatture"] + g["pareggi"]
        out.append({"codice_fornitore": codice, "fornitore": nomi[codice], **g,
                    "netto": netto, "aperto": max(netto, ZERO)})
    return sorted(out, key=lambda x: (-x["aperto"], x["fornitore"]))


def riepilogo(scadenze, data_fotografia: date) -> dict:
    """Totali della fotografia: totale file, aperto netto, fornitori a saldo ≤ 0, residui."""
    fornitori = per_fornitore(scadenze, data_fotografia)
    residui = [s for s in scadenze if e_residuo(s, data_fotografia)]
    return {
        "n_scadenze": len(scadenze),
        "n_pareggi": sum(1 for s in scadenze if s.pareggio),
        "totale": sum((s.importo for s in scadenze), ZERO),
        "aperto": sum((f["aperto"] for f in fornitori), ZERO),
        "n_fornitori": len(fornitori),
        "n_fornitori_saldati": sum(1 for f in fornitori if f["netto"] <= 0),
        "n_residui": len(residui),
        "residui": sum((s.importo for s in residui), ZERO),
        "limite_residui": limite_residui(data_fotografia),
        "fornitori": fornitori,
    }


def confronta(precedenti, attuali) -> dict:
    """Confronto tra due fotografie per chiave: scadenze nuove e scadenze sparite (= chiuse in
    contabilità dallo studio)."""
    prec = {s.chiave: s for s in precedenti}
    att = {s.chiave: s for s in attuali}
    nuove = [s for k, s in att.items() if k not in prec]
    chiuse = [s for k, s in prec.items() if k not in att]
    return {"nuove": nuove, "chiuse": chiuse,
            "importo_nuove": sum((s.importo for s in nuove), ZERO),
            "importo_chiuse": sum((s.importo for s in chiuse), ZERO)}


def compensa_pareggi(righe: list) -> None:
    """Distribuisce i pareggi di ogni fornitore sulle sue scadenze (modifica le righe sul posto).

    I `*PAREGGIO*` sono pagamenti/compensazioni che lo studio ha registrato senza collegarli alle singole
    fatture. Per fornitore, il credito dei pareggi (più le note di credito ancora aperte) copre:
    1. prima le scadenze già pagate (in banca o a mano): lo studio le ha già registrate, non vanno segnalate;
    2. poi le scadenze aperte, dalla più vecchia.
    Ogni riga è un dict con `stato`, `importo`, `data_scadenza`, `codice_fornitore`, `pareggio`; riceve
    `compensato` (quota coperta), `aperto` (quota ancora da pagare, per le aperte) e `da_segnalare` (quota
    pagata ma non ancora registrata, per le pagate). Una riga coperta per intero diventa `compensata`.
    """
    pagate = ("pagata_banca", "pagata_manuale")
    per_forn = {}
    for r in righe:
        r["compensato"], r["aperto"], r["da_segnalare"] = ZERO, ZERO, ZERO
        if not r["pareggio"] and r["importo"] < 0 and r["stato"] in pagate:
            r["da_segnalare"] = r["importo"]       # nota di credito dentro una Ri.Ba. pagata: riduce il totale
        per_forn.setdefault(r["codice_fornitore"], []).append(r)
    for gruppo in per_forn.values():
        credito = -sum((r["importo"] for r in gruppo if r["pareggio"]), ZERO)
        credito += -sum((r["importo"] for r in gruppo if not r["pareggio"] and r["importo"] < 0
                         and r["stato"] not in pagate), ZERO)
        credito = max(credito, ZERO)
        ordinate = sorted((r for r in gruppo if not r["pareggio"] and r["importo"] > 0),
                          key=lambda r: (r["stato"] not in pagate, r["data_scadenza"]))
        for r in gruppo:
            if not r["pareggio"] and r["importo"] < 0 and r["stato"] not in pagate:
                r["compensato"], r["stato_originale"], r["stato"] = r["importo"], r["stato"], "compensata"
        for r in ordinate:
            quota = min(credito, r["importo"])
            credito -= quota
            r["compensato"] = quota
            resto = r["importo"] - quota
            if r["stato"] in pagate:
                r["da_segnalare"] = resto
            else:
                r["aperto"] = resto
            if resto == 0:
                r["stato_originale"] = r["stato"]
                r["stato"] = "compensata"
