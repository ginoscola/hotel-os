"""Tesoreria — fattura leggibile e PDF del fornitore (v4.30.0). Funzioni pure, nessun accesso DB.

- `documento_leggibile(xml)`: dati per mostrare la fattura come documento (anagrafiche, righe dei beni e servizi,
  riepilogo IVA, pagamento, DDT, ordini, causale), dal testo XML conservato (senza `Allegati`).
- `trova_nel_zip(zip, nome_file)`: il file originale della fattura dentro lo ZIP dell'AdE conservato su disco (anche
  in ZIP annidati); si apre solo quel file, non tutto lo ZIP.
- `allegati(xml_originale)`: allegati incorporati dal fornitore (quasi sempre il PDF della fattura), letti dall'XML
  originale: nel database l'XML è salvato senza, per non appesantirlo.
"""

import base64
import io
import zipfile
from typing import Optional
from xml.etree import ElementTree as ET

from app.services.tesoreria_fatture_parser import (
    MAX_PROFONDITA_ZIP, SUFFISSO_META, _figli, _figlio, _testo, estrai_p7m,
)

NOMI_TIPO = {
    "TD01": "Fattura", "TD02": "Acconto/anticipo su fattura", "TD03": "Acconto/anticipo su parcella",
    "TD04": "Nota di credito", "TD05": "Nota di debito", "TD06": "Parcella", "TD16": "Integrazione reverse charge interno",
    "TD17": "Integrazione/autofattura servizi dall'estero", "TD18": "Integrazione beni intracomunitari",
    "TD19": "Integrazione/autofattura beni ex art. 17", "TD20": "Autofattura", "TD24": "Fattura differita",
    "TD25": "Fattura differita (triangolare)", "TD26": "Cessione beni ammortizzabili", "TD27": "Autoconsumo",
}
NOMI_MODALITA = {
    "MP01": "Contanti", "MP02": "Assegno", "MP03": "Assegno circolare", "MP05": "Bonifico", "MP08": "Carta di pagamento",
    "MP09": "RID", "MP10": "RID utenze", "MP11": "RID veloce", "MP12": "Ri.Ba.", "MP13": "MAV", "MP15": "Giroconto",
    "MP16": "Domiciliazione bancaria", "MP17": "Domiciliazione postale", "MP19": "SEPA Direct Debit",
    "MP20": "SEPA Direct Debit CORE", "MP21": "SEPA Direct Debit B2B", "MP22": "Trattenuta su somme già riscosse",
    "MP23": "PagoPA",
}
NOMI_CONDIZIONI = {"TP01": "A rate", "TP02": "Pagamento completo", "TP03": "Anticipo"}
TIPI_MIME = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}


def _num(testo: Optional[str]) -> Optional[float]:
    try:
        return float(testo) if testo is not None else None
    except ValueError:
        return None


def _soggetto(el) -> Optional[dict]:
    if el is None:
        return None
    anag = _figlio(el, "DatiAnagrafici")
    sede = _figlio(el, "Sede")
    nome = _testo(anag, "Anagrafica", "Denominazione") or " ".join(
        x for x in (_testo(anag, "Anagrafica", "Nome"), _testo(anag, "Anagrafica", "Cognome")) if x)
    indirizzo = None
    if sede is not None:
        via = " ".join(x for x in (_testo(sede, "Indirizzo"), _testo(sede, "NumeroCivico")) if x)
        citta = " ".join(x for x in (_testo(sede, "CAP"), _testo(sede, "Comune"),
                                     f"({_testo(sede, 'Provincia')})" if _testo(sede, "Provincia") else None) if x)
        indirizzo = ", ".join(x for x in (via, citta, _testo(sede, "Nazione")) if x) or None
    contatti = _figlio(el, "Contatti")
    return {
        "denominazione": nome or None,
        "piva": " ".join(x for x in (_testo(anag, "IdFiscaleIVA", "IdPaese"), _testo(anag, "IdFiscaleIVA", "IdCodice")) if x) or None,
        "codice_fiscale": _testo(anag, "CodiceFiscale"),
        "regime_fiscale": _testo(anag, "RegimeFiscale"),
        "indirizzo": indirizzo,
        "email": _testo(contatti, "Email") if contatti is not None else None,
        "telefono": _testo(contatti, "Telefono") if contatti is not None else None,
    }


def _riferimenti(dg, nome: str) -> list:
    out = []
    for r in _figli(dg, nome):
        out.append({"numero": _testo(r, "IdDocumento") or _testo(r, "NumeroDDT"),
                    "data": _testo(r, "Data") or _testo(r, "DataDDT")})
    return out


def documento_leggibile(xml: str) -> dict:
    root = ET.fromstring(xml.encode() if isinstance(xml, str) else xml)
    header = _figlio(root, "FatturaElettronicaHeader")
    body = _figli(root, "FatturaElettronicaBody")[0]
    generali = _figlio(body, "DatiGenerali")
    dg = _figlio(generali, "DatiGeneraliDocumento")
    tipo = _testo(dg, "TipoDocumento")

    righe = []
    for linea in _figli(_figlio(body, "DatiBeniServizi"), "DettaglioLinee"):
        codici = [f"{_testo(c, 'CodiceTipo') or ''} {_testo(c, 'CodiceValore') or ''}".strip()
                  for c in _figli(linea, "CodiceArticolo")]
        sconti = []
        for s in _figli(linea, "ScontoMaggiorazione"):
            segno = "-" if _testo(s, "Tipo") == "SC" else "+"
            if _testo(s, "Percentuale"):
                sconti.append(f"{segno}{_testo(s, 'Percentuale')}%")
            elif _testo(s, "Importo"):
                sconti.append(f"{segno}{_testo(s, 'Importo')} €")
        righe.append({
            "numero": _testo(linea, "NumeroLinea"),
            "codice": ", ".join(c for c in codici if c) or None,
            "descrizione": _testo(linea, "Descrizione"),
            "quantita": _num(_testo(linea, "Quantita")),
            "unita": _testo(linea, "UnitaMisura"),
            "prezzo_unitario": _num(_testo(linea, "PrezzoUnitario")),
            "sconti": " ".join(sconti) or None,
            "prezzo_totale": _num(_testo(linea, "PrezzoTotale")),
            "aliquota": _num(_testo(linea, "AliquotaIVA")),
            "natura": _testo(linea, "Natura"),
        })

    riepilogo = [{
        "aliquota": _num(_testo(r, "AliquotaIVA")), "natura": _testo(r, "Natura"),
        "imponibile": _num(_testo(r, "ImponibileImporto")), "imposta": _num(_testo(r, "Imposta")),
        "esigibilita": _testo(r, "EsigibilitaIVA"), "riferimento_normativo": _testo(r, "RiferimentoNormativo"),
    } for r in _figli(_figlio(body, "DatiBeniServizi"), "DatiRiepilogo")]

    pagamenti = []
    for dp in _figli(body, "DatiPagamento"):
        cond = _testo(dp, "CondizioniPagamento")
        for d in _figli(dp, "DettaglioPagamento"):
            mod = _testo(d, "ModalitaPagamento")
            pagamenti.append({
                "condizioni": NOMI_CONDIZIONI.get(cond, cond), "modalita": NOMI_MODALITA.get(mod, mod),
                "scadenza": _testo(d, "DataScadenzaPagamento"), "importo": _num(_testo(d, "ImportoPagamento")),
                "iban": _testo(d, "IBAN"), "istituto": _testo(d, "IstitutoFinanziario"),
                "beneficiario": _testo(d, "Beneficiario"),
            })

    ddt = [{"numero": _testo(d, "NumeroDDT"), "data": _testo(d, "DataDDT")} for d in _figli(generali, "DatiDDT")]
    ritenute = [{"tipo": _testo(r, "TipoRitenuta"), "importo": _num(_testo(r, "ImportoRitenuta")),
                 "aliquota": _num(_testo(r, "AliquotaRitenuta"))} for r in _figli(dg, "DatiRitenuta")]
    cassa = [{"tipo": _testo(c, "TipoCassa"), "importo": _num(_testo(c, "ImportoContributoCassa")),
              "aliquota": _num(_testo(c, "AlCassa"))} for c in _figli(dg, "DatiCassaPrevidenziale")]
    bollo = _num(_testo(dg, "DatiBollo", "ImportoBollo"))
    return {
        "tipo_documento": tipo, "tipo_nome": NOMI_TIPO.get(tipo, tipo),
        "numero": _testo(dg, "Numero"), "data": _testo(dg, "Data"), "divisa": _testo(dg, "Divisa") or "EUR",
        "totale": _num(_testo(dg, "ImportoTotaleDocumento")), "arrotondamento": _num(_testo(dg, "Arrotondamento")),
        "causale": [c.text.strip() for c in _figli(dg, "Causale") if c.text and c.text.strip()],
        "cedente": _soggetto(_figlio(header, "CedentePrestatore")),
        "cessionario": _soggetto(_figlio(header, "CessionarioCommittente")),
        "righe": righe, "riepilogo": riepilogo, "pagamenti": pagamenti, "ddt": ddt,
        "ordini": _riferimenti(generali, "DatiOrdineAcquisto"), "contratti": _riferimenti(generali, "DatiContratto"),
        "fatture_collegate": _riferimenti(generali, "DatiFattureCollegate"),
        "ritenute": ritenute, "cassa_previdenziale": cassa, "bollo": bollo,
    }


def trova_nel_zip(contenuto: bytes, nome_file: str, profondita: int = 0) -> Optional[bytes]:
    """XML originale (firma tolta) della fattura chiamata `nome_file` nello ZIP o negli ZIP annidati."""
    try:
        z = zipfile.ZipFile(io.BytesIO(contenuto))
    except zipfile.BadZipFile:
        return None
    annidati = []
    for info in z.infolist():
        if info.is_dir():
            continue
        base = info.filename.rsplit("/", 1)[-1]
        if base == nome_file and not base.endswith(SUFFISSO_META):
            dati = z.read(info)
            return estrai_p7m(dati) if base.lower().endswith(".p7m") else dati
        if base.lower().endswith(".zip"):
            annidati.append(info)
    if profondita + 1 <= MAX_PROFONDITA_ZIP:
        for info in annidati:
            trovato = trova_nel_zip(z.read(info), nome_file, profondita + 1)
            if trovato is not None:
                return trovato
    return None


def allegati(xml_originale: bytes) -> list:
    """[{nome, formato, descrizione, dati}] degli allegati incorporati nella fattura."""
    if xml_originale.startswith(b"\xef\xbb\xbf"):
        xml_originale = xml_originale[3:]
    root = ET.fromstring(xml_originale)
    out = []
    for body in _figli(root, "FatturaElettronicaBody"):
        for a in _figli(body, "Allegati"):
            testo = _figlio(a, "Attachment")
            if testo is None or not testo.text:
                continue
            try:
                dati = base64.b64decode("".join(testo.text.split()))
            except (ValueError, base64.binascii.Error):
                continue
            nome = _testo(a, "NomeAttachment") or f"allegato_{len(out) + 1}"
            formato = (_testo(a, "FormatoAttachment") or (nome.rsplit(".", 1)[-1] if "." in nome else "")).lower()
            if dati.startswith(b"%PDF"):
                formato = "pdf"
            out.append({"nome": nome, "formato": formato, "descrizione": _testo(a, "DescrizioneAttachment"), "dati": dati})
    return out


def tipo_mime(formato: str) -> str:
    return TIPI_MIME.get((formato or "").lower().lstrip("."), "application/octet-stream")

