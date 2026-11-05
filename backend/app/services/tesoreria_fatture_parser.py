"""Lettore degli ZIP di fatture elettroniche ricevute (modulo Tesoreria, Fase 5).

Fonte: scarico massivo dal portale AdE "Fatture e Corrispettivi" (fatture ricevute, data di ricezione).
Formato verificato su 4.707 file reali 2025–2026 (05/11/2026):
- ZIP piatto: per ogni fattura il file (`.xml`/`.XML` o firmato `.xml.p7m`) + `{file}_metaDato.xml`
  (namespace `urn:xml.fatturazione.sogei.it`, coppie nome/valore: `idfile`, `dataaccoglienza`,
  `nomefile`, `cedentepiva`, `cessionariopiva`, `hashfile`…).
- Il file della fattura si trova togliendo `_metaDato.xml` dal nome del metaDato: in 14 casi il file ha
  davanti l'`idfile` (`{idfile}_{nomefile}`, omonimi) mentre il metaDato riporta `nomefile` senza.
- `.p7m` = CMS in DER (2 su 2.355 in base64): contenuto estratto con `openssl cms -verify -noverify
  -nosigs` (molte firme sono scadute o non valide, il contenuto è comunque leggibile).
- Sempre un solo `FatturaElettronicaBody` per file, sempre EUR; ~240 file con BOM.
Sono accettati anche ZIP annidati e fatture senza metaDato (es. ZIP fatti a mano): in quel caso niente
`idfile` né data di ricezione, l'impronta è lo sha256 del contenuto XML.

Controlli bloccanti (`ErroreImportTesoreria`): non è uno ZIP, nessuna fattura dentro, fatture il cui
destinatario non è l'azienda (es. ZIP delle fatture **emesse**: lì il cedente è l'azienda). Un singolo
file illeggibile finisce in `errori` e non blocca lo ZIP. Lo stesso `idfile` due volte → tenuto il primo.

Il testo XML è conservato **senza** `Allegati` (PDF in base64, la parte più pesante): basta per rileggere.

Funzioni pure (nessun accesso DB): `parse_zip_fatture()`, `parse_fattura_xml()`, `estrai_p7m()`.
"""

import base64
import hashlib
import io
import subprocess
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Optional
from xml.etree import ElementTree as ET

from app.services.tesoreria_parser import ErroreImportTesoreria

PIVA_AZIENDA = "04569190400"            # KM di Mare S.r.l.
NS_META = "{urn:xml.fatturazione.sogei.it}"
SUFFISSO_META = "_metaDato.xml"
MAX_PROFONDITA_ZIP = 3
# Autofatture per l'IVA (reverse charge, acquisti dall'estero): non sono debiti verso il cedente.
TIPI_AUTOFATTURA = ("TD16", "TD17", "TD18", "TD19", "TD20", "TD21", "TD22", "TD23", "TD26", "TD27", "TD28")
TIPI_NOTA_CREDITO = ("TD04", "TD08")


@dataclass
class RiepilogoIva:
    aliquota: Decimal
    natura: Optional[str]
    imponibile: Decimal
    imposta: Decimal
    esigibilita: Optional[str]                  # I immediata, D differita, S scissione; None se assente
    riferimento_normativo: Optional[str]


@dataclass
class RataPagamento:
    numero: int
    condizioni: Optional[str]                   # TP01 a rate, TP02 completo, TP03 anticipo
    modalita: Optional[str]                     # MP05 bonifico, MP12 Ri.Ba., MP19/20/21 SDD, MP08 contanti…
    data_scadenza: Optional[date]
    importo: Optional[Decimal]
    iban: Optional[str]


@dataclass
class FatturaXml:
    impronta: str                               # 'SDI:{idfile}' o 'H:{sha256 xml}'
    id_sdi: Optional[str]
    nome_file: str                              # nome del file nello ZIP
    data_ricezione: Optional[datetime]          # dataaccoglienza (con fuso), None senza metaDato
    cedente_paese: Optional[str]
    cedente_piva: Optional[str]                 # solo il codice, senza paese
    cedente_cf: Optional[str]
    cedente_denominazione: str
    cessionario_piva: Optional[str]
    tipo_documento: str
    numero: str
    data_documento: date
    divisa: str
    totale: Decimal                             # ImportoTotaleDocumento, o Σ imponibile + imposta
    totale_calcolato: bool                      # True se ImportoTotaleDocumento mancava
    imponibile: Decimal
    imposta: Decimal
    ritenuta: Optional[Decimal]                 # Σ DatiRitenuta/ImportoRitenuta (parcelle): da pagare = totale − ritenuta
    causale: Optional[str]
    fatture_collegate: list = field(default_factory=list)   # [{'numero', 'data'}]
    n_ddt: int = 0
    ha_allegati: bool = False
    riepiloghi: list = field(default_factory=list)          # [RiepilogoIva]
    rate: list = field(default_factory=list)                # [RataPagamento]
    xml: str = ""                                           # XML senza Allegati

    @property
    def autofattura(self) -> bool:
        return self.tipo_documento in TIPI_AUTOFATTURA

    @property
    def nota_credito(self) -> bool:
        return self.tipo_documento in TIPI_NOTA_CREDITO


@dataclass
class ErroreFile:
    file: str
    motivo: str


@dataclass
class RisultatoZip:
    fatture: list                               # [FatturaXml], in ordine di ricezione
    errori: list                                # [ErroreFile]
    avvisi: list
    n_file: int                                 # file fattura trovati (letti + errori)
    ricezione_da: Optional[date]
    ricezione_a: Optional[date]


class _ErroreFattura(ValueError):
    """Errore su un singolo file: finisce in `errori`, non blocca lo ZIP."""


# ── Firma digitale ─────────────────────────────────────────────────────────────

def _openssl_cms(dati: bytes) -> Optional[bytes]:
    try:
        p = subprocess.run(
            ["openssl", "cms", "-verify", "-noverify", "-nosigs", "-inform", "DER"],
            input=dati, capture_output=True, timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return p.stdout if p.returncode == 0 and p.stdout else None


def estrai_p7m(contenuto: bytes) -> bytes:
    """Contenuto firmato di un `.p7m` (DER, o DER codificato in base64). Errore se non estraibile."""
    xml = _openssl_cms(contenuto)
    if xml is None:
        try:
            der = base64.b64decode(b"".join(contenuto.split()), validate=True)
        except (ValueError, base64.binascii.Error):
            der = None
        if der:
            xml = _openssl_cms(der)
    if xml is None:
        raise _ErroreFattura("file firmato (.p7m) non leggibile")
    return xml


# ── Lettura della fattura ──────────────────────────────────────────────────────

def _locale(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _figlio(el, *nomi):
    """Primo discendente lungo il percorso di nomi locali (ignora i namespace, rari ma possibili)."""
    for nome in nomi:
        if el is None:
            return None
        el = next((c for c in el if _locale(c.tag) == nome), None)
    return el


def _figli(el, nome):
    return [c for c in el if _locale(c.tag) == nome] if el is not None else []


def _testo(el, *nomi) -> Optional[str]:
    trovato = _figlio(el, *nomi)
    if trovato is None or trovato.text is None:
        return None
    t = trovato.text.strip()
    return t or None


def _importo(testo: Optional[str], contesto: str) -> Optional[Decimal]:
    if testo is None:
        return None
    try:
        return Decimal(testo).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except InvalidOperation:
        raise _ErroreFattura(f"importo non valido in {contesto}: {testo!r}")


def _data(testo: Optional[str], contesto: str) -> Optional[date]:
    if testo is None:
        return None
    try:
        return date.fromisoformat(testo[:10])
    except ValueError:
        raise _ErroreFattura(f"data non valida in {contesto}: {testo!r}")


def _senza_allegati(root) -> str:
    for body in _figli(root, "FatturaElettronicaBody"):
        for allegato in _figli(body, "Allegati"):
            body.remove(allegato)
    return ET.tostring(root, encoding="unicode")


def parse_fattura_xml(contenuto: bytes) -> dict:
    """Dati di una fattura FatturaPA (FPR12/FPA12) dal suo XML. Errore se non è una fattura."""
    if contenuto.startswith(b"\xef\xbb\xbf"):
        contenuto = contenuto[3:]
    try:
        root = ET.fromstring(contenuto)
    except ET.ParseError as e:
        raise _ErroreFattura(f"XML non valido ({e})")
    if _locale(root.tag) != "FatturaElettronica":
        raise _ErroreFattura("il file non è una fattura elettronica")
    header = _figlio(root, "FatturaElettronicaHeader")
    bodies = _figli(root, "FatturaElettronicaBody")
    if header is None or not bodies:
        raise _ErroreFattura("fattura senza intestazione o senza corpo")
    if len(bodies) > 1:
        # mai visto nei file reali (sempre 1): meglio fermarsi che leggere solo il primo documento
        raise _ErroreFattura(f"lotto di {len(bodies)} fatture in un solo file, non gestito")
    body = bodies[0]

    anag = _figlio(header, "CedentePrestatore", "DatiAnagrafici")
    if anag is None:
        raise _ErroreFattura("cedente mancante")
    denominazione = _testo(anag, "Anagrafica", "Denominazione") or " ".join(
        x for x in (_testo(anag, "Anagrafica", "Nome"), _testo(anag, "Anagrafica", "Cognome")) if x)
    cess = _figlio(header, "CessionarioCommittente", "DatiAnagrafici")

    dg = _figlio(body, "DatiGenerali", "DatiGeneraliDocumento")
    if dg is None:
        raise _ErroreFattura("dati generali del documento mancanti")
    tipo = _testo(dg, "TipoDocumento")
    numero = _testo(dg, "Numero")
    data_doc = _data(_testo(dg, "Data"), "Data")
    if not tipo or not numero or data_doc is None:
        raise _ErroreFattura("tipo, numero o data del documento mancanti")

    riepiloghi = []
    for r in _figli(_figlio(body, "DatiBeniServizi"), "DatiRiepilogo"):
        riepiloghi.append(RiepilogoIva(
            aliquota=_importo(_testo(r, "AliquotaIVA"), "AliquotaIVA") or Decimal("0.00"),
            natura=_testo(r, "Natura"),
            imponibile=_importo(_testo(r, "ImponibileImporto"), "ImponibileImporto") or Decimal("0.00"),
            imposta=_importo(_testo(r, "Imposta"), "Imposta") or Decimal("0.00"),
            esigibilita=_testo(r, "EsigibilitaIVA"),
            riferimento_normativo=(_testo(r, "RiferimentoNormativo") or "")[:100] or None,
        ))
    imponibile = sum((r.imponibile for r in riepiloghi), Decimal("0.00"))
    imposta = sum((r.imposta for r in riepiloghi), Decimal("0.00"))
    totale = _importo(_testo(dg, "ImportoTotaleDocumento"), "ImportoTotaleDocumento")
    totale_calcolato = totale is None
    if totale is None:
        totale = imponibile + imposta

    rate = []
    for dp in _figli(body, "DatiPagamento"):
        condizioni = _testo(dp, "CondizioniPagamento")
        for d in _figli(dp, "DettaglioPagamento"):
            rate.append(RataPagamento(
                numero=len(rate) + 1,
                condizioni=condizioni,
                modalita=_testo(d, "ModalitaPagamento"),
                data_scadenza=_data(_testo(d, "DataScadenzaPagamento"), "DataScadenzaPagamento"),
                importo=_importo(_testo(d, "ImportoPagamento"), "ImportoPagamento"),
                iban=(_testo(d, "IBAN") or "").replace(" ", "")[:34] or None,
            ))

    collegate = []
    for fc in _figli(_figlio(body, "DatiGenerali"), "DatiFattureCollegate"):
        collegate.append({"numero": _testo(fc, "IdDocumento"), "data": _testo(fc, "Data")})
    ritenute = [_importo(_testo(r, "ImportoRitenuta"), "ImportoRitenuta") for r in _figli(dg, "DatiRitenuta")]
    ritenute = [r for r in ritenute if r is not None]
    ritenuta = sum(ritenute, Decimal("0.00")) if ritenute else None
    causale = " ".join(c.text.strip() for c in _figli(dg, "Causale") if c.text and c.text.strip()) or None

    ha_allegati = bool(_figli(body, "Allegati"))
    return {
        "cedente_paese": _testo(anag, "IdFiscaleIVA", "IdPaese"),
        "cedente_piva": _testo(anag, "IdFiscaleIVA", "IdCodice"),
        "cedente_cf": _testo(anag, "CodiceFiscale"),
        "cedente_denominazione": (denominazione or "?")[:200],
        "cessionario_piva": _testo(cess, "IdFiscaleIVA", "IdCodice") if cess is not None else None,
        "tipo_documento": tipo,
        "numero": numero[:40],
        "data_documento": data_doc,
        "divisa": _testo(dg, "Divisa") or "EUR",
        "totale": totale,
        "totale_calcolato": totale_calcolato,
        "imponibile": imponibile,
        "imposta": imposta,
        "ritenuta": ritenuta,
        "causale": causale,
        "fatture_collegate": collegate,
        "n_ddt": len(_figli(_figlio(body, "DatiGenerali"), "DatiDDT")),
        "ha_allegati": ha_allegati,
        "riepiloghi": riepiloghi,
        "rate": rate,
        "xml": _senza_allegati(root),
    }


# ── Lettura dello ZIP ──────────────────────────────────────────────────────────

def _leggi_meta(contenuto: bytes) -> dict:
    root = ET.fromstring(contenuto)
    return {
        (m.findtext(NS_META + "nome") or "").strip(): (m.findtext(NS_META + "valore") or "").strip()
        for m in root.findall(NS_META + "metadato")
    }


def _ricezione(valore: Optional[str]) -> Optional[datetime]:
    if not valore:
        return None
    try:
        return datetime.fromisoformat(valore)
    except ValueError:
        return None


def _voci_zip(contenuto: bytes, prefisso: str, profondita: int, errori: list):
    """(nome, bytes) di tutti i file dello ZIP, ZIP annidati compresi."""
    try:
        z = zipfile.ZipFile(io.BytesIO(contenuto))
    except zipfile.BadZipFile:
        if profondita == 0:
            raise ErroreImportTesoreria("Il file non è uno ZIP valido.")
        errori.append(ErroreFile(prefisso.rstrip("/"), "ZIP annidato non valido"))
        return
    for info in z.infolist():
        if info.is_dir():
            continue
        nome = prefisso + info.filename
        dati = z.read(info)
        if info.filename.lower().endswith(".zip"):
            if profondita + 1 > MAX_PROFONDITA_ZIP:
                errori.append(ErroreFile(nome, "troppi ZIP uno dentro l'altro"))
                continue
            yield from _voci_zip(dati, nome + "/", profondita + 1, errori)
        else:
            yield nome, dati


def _e_fattura(nome: str) -> bool:
    n = nome.lower()
    return (n.endswith(".xml") or n.endswith(".xml.p7m")) and not n.endswith(SUFFISSO_META.lower())


def parse_zip_fatture(contenuto: bytes, piva_azienda: str = PIVA_AZIENDA) -> RisultatoZip:
    errori: list = []
    avvisi: list = []
    file_zip = dict(_voci_zip(contenuto, "", 0, errori))

    meta_per_file: dict = {}
    for nome, dati in file_zip.items():
        if nome.endswith(SUFFISSO_META):
            try:
                meta_per_file[nome[: -len(SUFFISSO_META)]] = _leggi_meta(dati)
            except ET.ParseError:
                errori.append(ErroreFile(nome, "metaDato non leggibile"))

    nomi_fatture = [n for n in file_zip if _e_fattura(n)]
    ignorati = [n for n in file_zip if not _e_fattura(n) and not n.endswith(SUFFISSO_META)]
    if ignorati:
        avvisi.append(f"{len(ignorati)} file ignorati perché non sono fatture XML (es. {ignorati[0]}).")
    if not nomi_fatture:
        raise ErroreImportTesoreria("Nello ZIP non ci sono fatture elettroniche (.xml o .xml.p7m).")

    fatture: list = []
    viste: set = set()
    doppie = 0
    for nome in sorted(nomi_fatture):
        meta = meta_per_file.get(nome, {})
        try:
            dati = file_zip[nome]
            xml = estrai_p7m(dati) if nome.lower().endswith(".p7m") else dati
            d = parse_fattura_xml(xml)
        except _ErroreFattura as e:
            errori.append(ErroreFile(nome, str(e)))
            continue
        id_sdi = meta.get("idfile") or None
        impronta = f"SDI:{id_sdi}" if id_sdi else "H:" + hashlib.sha256(xml).hexdigest()
        if impronta in viste:
            doppie += 1
            continue
        viste.add(impronta)
        fatture.append(FatturaXml(
            impronta=impronta, id_sdi=id_sdi, nome_file=nome.rsplit("/", 1)[-1][:255],
            data_ricezione=_ricezione(meta.get("dataaccoglienza")), **d,
        ))

    if doppie:
        avvisi.append(f"{doppie} fatture presenti più volte nello ZIP: tenuta una sola copia.")
    senza_meta = sum(1 for f in fatture if f.id_sdi is None)
    if senza_meta:
        avvisi.append(f"{senza_meta} fatture senza metaDato SDI: niente data di ricezione, "
                      "riconosciute solo dal contenuto.")

    emesse = [f for f in fatture if f.cedente_piva == piva_azienda and f.cessionario_piva != piva_azienda]
    estranee = [f for f in fatture if f.cessionario_piva != piva_azienda]
    if emesse:
        raise ErroreImportTesoreria(
            f"Lo ZIP contiene {len(emesse)} fatture emesse dall'azienda: qui vanno solo le fatture "
            "ricevute (sul portale AdE scegliere «Ricevute»).")
    if estranee:
        raise ErroreImportTesoreria(
            f"{len(estranee)} fatture non sono intestate all'azienda (P.IVA {piva_azienda}), "
            f"es. destinatario {estranee[0].cessionario_piva or 'mancante'}: ZIP sbagliato?")
    if not fatture:
        raise ErroreImportTesoreria("Nessuna fattura leggibile nello ZIP.")

    fatture.sort(key=lambda f: (f.data_ricezione is None, f.data_ricezione or datetime.min, f.nome_file))
    date_ric = [f.data_ricezione.date() for f in fatture if f.data_ricezione]
    return RisultatoZip(
        fatture=fatture, errori=errori, avvisi=avvisi, n_file=len(nomi_fatture),
        ricezione_da=min(date_ric) if date_ric else None,
        ricezione_a=max(date_ric) if date_ric else None,
    )
