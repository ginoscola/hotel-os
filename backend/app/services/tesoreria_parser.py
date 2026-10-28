"""Parser degli estratti conto bancari in formato XML CBI (BCC, conti 095081 e 217746).

Formato: `CBIBdyBkToCstmrStmtReq` con un `<Stmt>` per ogni giorno con movimenti. Per ogni Stmt:
- `Acct/Id/IBAN` → riconosce il conto (niente scelta manuale);
- `Bal` con `Tp/CdOrPrtry/Cd` = OPBD (apertura) / CLBD (chiusura) / CLAV (disponibile, ignorato:
  il fido non è nel file); importo sempre positivo, segno in `CdtDbtInd` (DBIT = saldo negativo);
- `Ntry`: `Amt` + `CdtDbtInd` (CRDT entrata / DBIT uscita), `BookgDt`/`ValDt` ("2026-10-28+01:00"),
  `AcctSvcrRef` (riferimento univoco della banca, stabile tra esportazioni), `BkTxCd/Prtry/Cd`
  (causale ABI, es. '48//00'), `AddtlTxInf` (descrizione completa, comprese le info aggiuntive).

Controlli bloccanti (`ErroreImportTesoreria`): un solo IBAN, solo movimenti contabilizzati (BOOK),
data contabile = giorno dello Stmt, apertura + movimenti = chiusura per ogni giorno, chiusura di un
giorno = apertura del successivo.

Saldi restituiti: chiusura di ogni giorno + apertura del primo giorno come saldo del giorno prima
(il saldo non cambia nei giorni senza movimenti, quindi vale anche se è un festivo).

Funzioni pure (nessun accesso DB): `parse_estratto_cbi(contenuto: bytes)`.
"""

import hashlib
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional
from xml.etree import ElementTree as ET

CENT = Decimal("0.01")


class ErroreImportTesoreria(ValueError):
    """Errore bloccante: l'import non può procedere (messaggio mostrato all'utente)."""


@dataclass
class MovimentoBanca:
    data_contabile: date
    data_valuta: Optional[date]
    importo: Decimal                    # negativo = uscita
    descrizione: str
    controparte: str
    causale_abi: Optional[str]
    riferimento: Optional[str]          # AcctSvcrRef
    impronta: str                       # chiave antiduplicato per conto


@dataclass
class RisultatoEstratto:
    iban: str
    movimenti: list                     # [MovimentoBanca], in ordine di data contabile
    saldi: dict                         # date -> Decimal (saldo a fine giornata)
    data_da: Optional[date]
    data_a: Optional[date]
    avvisi: list = field(default_factory=list)


# ── Utility ────────────────────────────────────────────────────────────────────

def _testo(el, percorso: str) -> Optional[str]:
    trovato = el.find(percorso)
    if trovato is None or trovato.text is None:
        return None
    return trovato.text.strip()


def _data(valore: Optional[str]) -> Optional[date]:
    """'2026-10-28+01:00' → date(2026, 10, 28)."""
    if not valore:
        return None
    try:
        return date.fromisoformat(valore[:10])
    except ValueError:
        raise ErroreImportTesoreria(f"Data non valida nel file: {valore!r}")


def _importo(el, contesto: str) -> Decimal:
    testo = _testo(el, "{*}Amt")
    segno = _testo(el, "{*}CdtDbtInd")
    try:
        valore = Decimal(testo).quantize(CENT)
    except (InvalidOperation, TypeError):
        raise ErroreImportTesoreria(f"Importo non valido ({contesto}): {testo!r}")
    if segno == "DBIT":
        return -valore
    if segno == "CRDT":
        return valore
    raise ErroreImportTesoreria(f"Segno non valido ({contesto}): {segno!r}")


def normalizza(testo: str) -> str:
    """Maiuscolo e spazi multipli compressi: forma usata per regole e impronte."""
    return re.sub(r"\s+", " ", testo or "").strip().upper()


_RE_ORDINANTE = re.compile(
    r"Ragione sociale ordinante:\s*(.+?)\s*(?:Indirizzo ordinante|ID_BONIFICO|Localita|"
    r"Descrizione aggiuntiva|Info aggiuntive|$)",
    re.IGNORECASE,
)
_RE_ASTERISCO = re.compile(
    r"\*+\s*(.+?)\s*(?:Info aggiuntive|Data ordine|Intestazione ordinante|$)", re.IGNORECASE,
)
_RE_ISTANTANEO = re.compile(r"^INSTANT DEL .*? BEN (.+)$", re.IGNORECASE)
LUNGHEZZA_CONTROPARTE = 120


def estrai_controparte(descrizione: str, importo: Decimal) -> str:
    """Controparte del movimento: il nome è sempre all'inizio, seguito dalla causale libera.

    - Entrate: testo dopo 'Ragione sociale ordinante:' (fino a Indirizzo / ID_BONIFICO / Localita).
    - Altrimenti: testo dopo il primo '*' (es. 'Bonifico tramite Internet Banking *HOTEL
      INTERNATIONAL S.N.saldo FT 3'), fino alle info aggiuntive; per i bonifici istantanei
      ('*INSTANT DEL … BEN Mario RossiSaldo FT 1') il testo dopo 'BEN'.

    La banca non separa il nome dalla causale (lo tronca a 24 caratteri se più lungo, altrimenti ci
    attacca subito la causale): le regole sul nome usano quindi l'operatore 'inizia', non 'contiene'
    (una causale che nomina un hotel non deve diventare un affitto). Le regole sui giroconti usano
    la controparte, mai la descrizione intera: ogni bonifico in uscita contiene 'Intestazione
    ordinante: KM DI MARE SRL' nelle info aggiuntive.
    """
    testo = re.sub(r"\s+", " ", descrizione or "").strip()
    if importo > 0:
        m = _RE_ORDINANTE.search(testo)
        if m and m.group(1).strip():
            return m.group(1).strip()[:LUNGHEZZA_CONTROPARTE]
    m = _RE_ASTERISCO.search(testo)
    if not m:
        return ""
    controparte = m.group(1).strip()
    istantaneo = _RE_ISTANTANEO.match(controparte)
    if istantaneo:
        controparte = istantaneo.group(1).strip()
    return controparte[:LUNGHEZZA_CONTROPARTE]


def impronta_movimento(riferimento: Optional[str], data_contabile: date, data_valuta: Optional[date],
                       importo: Decimal, descrizione: str, occorrenza: int) -> str:
    """Chiave antiduplicato: il riferimento della banca se presente, altrimenti un hash dei dati
    del movimento con l'indice di occorrenza tra le righe identiche dello stesso file (due
    commissioni da 0,25 € uguali nello stesso giorno restano due movimenti distinti)."""
    if riferimento:
        return f"R:{riferimento}"
    base = "|".join([
        data_contabile.isoformat(), data_valuta.isoformat() if data_valuta else "",
        str(importo), normalizza(descrizione), str(occorrenza),
    ])
    return "H:" + hashlib.sha256(base.encode("utf-8")).hexdigest()


# ── Parsing ────────────────────────────────────────────────────────────────────

def parse_estratto_cbi(contenuto: bytes) -> RisultatoEstratto:
    try:
        radice = ET.fromstring(contenuto)
    except ET.ParseError as e:
        raise ErroreImportTesoreria(f"Il file non è un XML valido: {e}")

    stmts = radice.findall(".//{*}Stmt")   # iter() non accetta il namespace jolly {*}
    if not stmts:
        raise ErroreImportTesoreria(
            "Il file non è un estratto conto XML CBI (nessun blocco <Stmt>). "
            "Esportare dall'home banking il formato XML."
        )

    iban_trovati = {_testo(s, "{*}Acct/{*}Id/{*}IBAN") for s in stmts}
    iban_trovati.discard(None)
    if len(iban_trovati) != 1:
        raise ErroreImportTesoreria(
            f"Il file deve contenere un solo conto: IBAN trovati {sorted(iban_trovati) or 'nessuno'}"
        )
    iban = iban_trovati.pop().replace(" ", "").upper()

    giorni = []    # (giorno, apertura, chiusura, [ntry...])
    for s in stmts:
        saldi = {}
        for b in s.findall("{*}Bal"):
            tipo = _testo(b, "{*}Tp/{*}CdOrPrtry/{*}Cd")
            saldi[tipo] = (_importo(b, f"saldo {tipo}"), _data(_testo(b, "{*}Dt/{*}Dt")))
        if "OPBD" not in saldi or "CLBD" not in saldi:
            raise ErroreImportTesoreria("Estratto senza saldo di apertura o di chiusura (OPBD/CLBD)")
        giorno = saldi["CLBD"][1]
        if giorno is None:
            raise ErroreImportTesoreria("Saldo di chiusura senza data")
        giorni.append((giorno, saldi["OPBD"][0], saldi["CLBD"][0], s.findall("{*}Ntry")))

    giorni.sort(key=lambda g: g[0])
    date_giorni = [g[0] for g in giorni]
    doppi = [d for d, n in Counter(date_giorni).items() if n > 1]
    if doppi:
        raise ErroreImportTesoreria(f"Giorni ripetuti nel file: {', '.join(d.strftime('%d/%m/%Y') for d in doppi)}")

    movimenti = []
    saldi_finali = {}
    occorrenze = Counter()
    for i, (giorno, apertura, chiusura, ntry) in enumerate(giorni):
        somma = Decimal("0.00")
        for e in ntry:
            stato = _testo(e, "{*}Sts")
            if stato != "BOOK":
                raise ErroreImportTesoreria(
                    f"Movimento non contabilizzato (stato {stato!r}) del {giorno:%d/%m/%Y}: "
                    "esportare solo movimenti contabilizzati"
                )
            importo = _importo(e, f"movimento del {giorno:%d/%m/%Y}")
            data_contabile = _data(_testo(e, "{*}BookgDt/{*}Dt"))
            if data_contabile != giorno:
                raise ErroreImportTesoreria(
                    f"Movimento con data contabile {data_contabile} nel giorno {giorno:%d/%m/%Y}"
                )
            data_valuta = _data(_testo(e, "{*}ValDt/{*}Dt"))
            descrizione = re.sub(r"\s+", " ", _testo(e, ".//{*}AddtlTxInf") or "").strip()
            riferimento = _testo(e, "{*}AcctSvcrRef") or None
            chiave = (data_contabile, data_valuta, importo, normalizza(descrizione))
            occorrenza = occorrenze[chiave]
            occorrenze[chiave] += 1
            movimenti.append(MovimentoBanca(
                data_contabile=data_contabile,
                data_valuta=data_valuta,
                importo=importo,
                descrizione=descrizione,
                controparte=estrai_controparte(descrizione, importo),
                causale_abi=_testo(e, "{*}BkTxCd/{*}Prtry/{*}Cd"),
                riferimento=riferimento,
                impronta=impronta_movimento(riferimento, data_contabile, data_valuta, importo,
                                            descrizione, occorrenza),
            ))
            somma += importo

        if apertura + somma != chiusura:
            raise ErroreImportTesoreria(
                f"Il {giorno:%d/%m/%Y} non quadra: apertura {apertura} + movimenti {somma} "
                f"≠ chiusura {chiusura}"
            )
        if i > 0 and giorni[i - 1][2] != apertura:
            raise ErroreImportTesoreria(
                f"Saldo non continuo: chiusura del {giorni[i - 1][0]:%d/%m/%Y} ({giorni[i - 1][2]}) "
                f"≠ apertura del {giorno:%d/%m/%Y} ({apertura})"
            )
        if i == 0:
            saldi_finali[giorno - timedelta(days=1)] = apertura
        saldi_finali[giorno] = chiusura

    impronte = Counter(m.impronta for m in movimenti)
    doppie = [k for k, n in impronte.items() if n > 1]
    if doppie:
        raise ErroreImportTesoreria(f"Riferimenti bancari ripetuti nel file: {', '.join(doppie[:5])}")

    avvisi = []
    senza_rif = sum(1 for m in movimenti if not m.riferimento)
    if senza_rif:
        avvisi.append(f"{senza_rif} movimenti senza riferimento bancario: antiduplicato sui dati del movimento")

    movimenti.sort(key=lambda m: m.data_contabile)
    return RisultatoEstratto(
        iban=iban,
        movimenti=movimenti,
        saldi=saldi_finali,
        data_da=date_giorni[0] if date_giorni else None,
        data_a=date_giorni[-1] if date_giorni else None,
        avvisi=avvisi,
    )
