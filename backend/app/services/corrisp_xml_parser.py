"""Parser per il file CORRISP.xml prodotto dal registratore telematico (RT) dopo la chiusura Z.

Formula totale giorno:
  Σ Ammontare (righe con AliquotaIVA, solo se Ammontare > 0)
  + Σ ImportoParziale (righe con Natura, solo se ImportoParziale > 0)

Il namespace AdE (r:DatiCorrispettivi) viene ignorato confrontando i soli
local-name dei tag: nei file reali solo la radice porta il prefisso, i figli no.
La firma digitale (<Signature>) non viene letta né validata.
"""
from datetime import datetime, date
from decimal import Decimal, InvalidOperation
from xml.etree import ElementTree as ET

ALIQUOTA_10 = Decimal('10.00')
ALIQUOTA_22 = Decimal('22.00')


def _local(tag: str) -> str:
    return tag.rsplit('}', 1)[-1]


def _find_child(elem: ET.Element, name: str):
    for child in elem:
        if _local(child.tag) == name:
            return child
    return None


def _child_text(elem: ET.Element, name: str):
    child = _find_child(elem, name)
    return child.text.strip() if child is not None and child.text else None


def _dec(text) -> Decimal:
    if text is None:
        return Decimal('0')
    try:
        return Decimal(text.replace(',', '.'))
    except InvalidOperation:
        return Decimal('0')


def _iva_info(riepilogo: ET.Element):
    """Legge AliquotaIVA e Imposta di una riga IVA.

    Nei file reali dell'RT entrambi i campi sono annidati dentro <IVA>
    (<IVA><AliquotaIVA/><Imposta/></IVA>), non fratelli diretti di <IVA> sotto
    <Riepilogo>: senza questo fallback annidato <Imposta> risulterebbe sempre 0.
    """
    aliquota_testo = _child_text(riepilogo, 'AliquotaIVA')
    imposta_testo = _child_text(riepilogo, 'Imposta')
    iva = _find_child(riepilogo, 'IVA')
    if iva is not None:
        if aliquota_testo is None:
            aliquota_testo = _child_text(iva, 'AliquotaIVA')
        if imposta_testo is None:
            imposta_testo = _child_text(iva, 'Imposta')
    aliquota = _dec(aliquota_testo) if aliquota_testo is not None else None
    return aliquota, _dec(imposta_testo)


def parse_corrisp_xml(xml_content: bytes) -> dict:
    """Estrae dati aggregati da un file CORRISP.xml per popolare rt_chiusure."""
    root = ET.fromstring(xml_content)

    data_ora = None
    progressivo = None
    riepiloghi = []
    totali = None

    for elem in root.iter():
        name = _local(elem.tag)
        if name == 'DataOraRilevazione' and data_ora is None:
            data_ora = elem.text.strip() if elem.text else None
        elif name == 'Progressivo' and progressivo is None:
            progressivo = elem.text.strip() if elem.text else None
        elif name == 'Riepilogo':
            riepiloghi.append(elem)
        elif name == 'Totali' and totali is None:
            totali = elem

    if not data_ora:
        raise ValueError("Campo DataOraRilevazione mancante nel file XML")
    data_chiusura: date = datetime.fromisoformat(data_ora).date()

    totale_giorno = Decimal('0')
    imponibile_10 = Decimal('0')
    imposta_10 = Decimal('0')
    ammontare_10 = Decimal('0')
    imponibile_22 = Decimal('0')
    imposta_22 = Decimal('0')
    ammontare_22 = Decimal('0')
    esente_n1 = Decimal('0')
    tassa_soggiorno_nrs = Decimal('0')

    for r in riepiloghi:
        importo_parziale = _dec(_child_text(r, 'ImportoParziale'))
        ammontare = _dec(_child_text(r, 'Ammontare'))
        nrs_testo = _child_text(r, 'NonRiscossoServizi')
        if nrs_testo is not None:
            tassa_soggiorno_nrs += _dec(nrs_testo)

        aliquota, imposta = _iva_info(r)
        natura = _child_text(r, 'Natura')

        if aliquota is not None:
            if ammontare > 0:
                totale_giorno += ammontare
            if aliquota == ALIQUOTA_10:
                imponibile_10 += importo_parziale
                imposta_10 += imposta
                ammontare_10 += ammontare
            elif aliquota == ALIQUOTA_22:
                imponibile_22 += importo_parziale
                imposta_22 += imposta
                ammontare_22 += ammontare
        elif natura is not None:
            if importo_parziale > 0:
                totale_giorno += importo_parziale
            if natura == 'N1':
                esente_n1 += importo_parziale

    num_documenti = None
    pagato_contanti = Decimal('0')
    pagato_elettronico = Decimal('0')
    if totali is not None:
        nd = _child_text(totali, 'NumeroDocCommerciali')
        num_documenti = int(nd) if nd is not None else None
        pagato_contanti = _dec(_child_text(totali, 'PagatoContanti'))
        pagato_elettronico = _dec(_child_text(totali, 'PagatoElettronico'))

    return {
        'data_chiusura': data_chiusura,
        'progressivo': int(progressivo) if progressivo is not None else None,
        'totale_giorno': totale_giorno,
        'imponibile_10': imponibile_10,
        'imposta_10': imposta_10,
        'imponibile_22': imponibile_22,
        'imposta_22': imposta_22,
        'esente_n1': esente_n1,
        'tassa_soggiorno_nrs': tassa_soggiorno_nrs,
        'num_documenti': num_documenti,
        'pagato_contanti': pagato_contanti,
        'pagato_elettronico': pagato_elettronico,
        # Mappatura sui campi legacy usati dal confronto per categoria vs PMS
        # (GET /rt-chiusure): totale_10/22 = lordo (Ammontare), totale_ts = NRS,
        # totale_penali = 0 (l'XML non riporta una Natura dedicata alle penali,
        # che lato PMS sono comunque quasi sempre a valore zero).
        'totale_10': ammontare_10,
        'totale_22': ammontare_22,
        'totale_ts': tassa_soggiorno_nrs,
        'totale_penali': Decimal('0'),
    }
