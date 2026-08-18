"""Parser per il file CORRISP.xml prodotto dal registratore telematico (RT) dopo la chiusura Z.

Formula totale giorno (imponibile NETTO degli annullamenti dello stesso giorno):
  imponibile_netto = ImportoParziale - TotaleAmmontareAnnulli
  Σ (imponibile_netto + imposta_netta) per le righe con AliquotaIVA, solo se ImportoParziale > 0
  + Σ imponibile_netto per le righe con Natura (N1, N2, ...), solo se ImportoParziale > 0

⚠️ <TotaleAmmontareAnnulli> (imponibile degli scontrini annullati lo stesso giorno fiscale, PRIMA
della chiusura Z) non era letto affatto fino ad agosto 2026: il totale importato era quindi il
lordo PRIMA degli annullamenti, non il netto stampato come "Totale giorno annullamenti" sullo
scontrino di chiusura — bug reale (verificato sul file del 14/08/2026, RT1: importava 7.806,18€
invece di 6.332,68€, esattamente 1.473,50€ in più = imponibile annullato lordizzato). Non è un
problema di cassa (storni non registrati): il dato è nel file, semplicemente non veniva letto.
L'imposta non è mai riportata separatamente per l'annullato: va ricalcolata da imponibile_netto
× aliquota (verificato sui file reali: <Imposta> corrisponde sempre esattamente a
ImportoParziale × aliquota/100, quindi ricalcolare dal netto dà lo stesso arrotondamento).

⚠️ <Ammontare> NON è imponibile+imposta come si potrebbe pensare dal nome: verificato sui file
reali che <Ammontare> = ImportoParziale + NonRiscossoServizi + TotaleAmmontareAnnulli (include
cioè la tassa di soggiorno "non riscossa" e l'annullato, non l'IVA). Va quindi ignorato per il
totale fiscale, che si ricava da imponibile_netto + imposta_netta.

Codici Natura noti: N1 = tassa di soggiorno (tracciato in esente_n1 e nel campo legacy totale_ts,
usato nel confronto vs PMS), N2 = penali (tracciato in totale_penali). Solo ImportoParziale per
entrambi: sono esenti, non generano Imposta.

<NonRiscossoServizi> sono importi sospesi non trasmessi all'Agenzia delle Entrate: tracciati in
tassa_soggiorno_nrs solo come dettaglio grezzo, non entrano in nessun totale né confronto.

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
    lordo_10 = Decimal('0')
    imponibile_22 = Decimal('0')
    imposta_22 = Decimal('0')
    lordo_22 = Decimal('0')
    esente_n1 = Decimal('0')
    penali = Decimal('0')
    tassa_soggiorno_nrs = Decimal('0')

    for r in riepiloghi:
        importo_parziale = _dec(_child_text(r, 'ImportoParziale'))
        annulli_testo = _child_text(r, 'TotaleAmmontareAnnulli')
        annulli = _dec(annulli_testo) if annulli_testo is not None else Decimal('0')
        imponibile_netto = importo_parziale - annulli
        nrs_testo = _child_text(r, 'NonRiscossoServizi')
        if nrs_testo is not None:
            tassa_soggiorno_nrs += _dec(nrs_testo)

        aliquota, _imposta_lorda = _iva_info(r)
        natura = _child_text(r, 'Natura')

        if aliquota is not None:
            if importo_parziale > 0:
                imposta_netta = (imponibile_netto * aliquota / Decimal('100')).quantize(Decimal('0.01'))
                lordo = imponibile_netto + imposta_netta
                totale_giorno += lordo
                if aliquota == ALIQUOTA_10:
                    imponibile_10 += imponibile_netto
                    imposta_10 += imposta_netta
                    lordo_10 += lordo
                elif aliquota == ALIQUOTA_22:
                    imponibile_22 += imponibile_netto
                    imposta_22 += imposta_netta
                    lordo_22 += lordo
        elif natura is not None:
            if importo_parziale > 0:
                totale_giorno += imponibile_netto
            if natura == 'N1':
                esente_n1 += imponibile_netto
            elif natura == 'N2':
                penali += imponibile_netto

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
        # (GET /rt-chiusure): totale_10/22 = lordo fiscale (ImportoParziale+Imposta, unica
        # componente trasmessa ad AdE); totale_ts = esente_n1 (Natura N1 = tassa di soggiorno,
        # solo ImportoParziale perché esente da imposta); totale_penali = Natura N2 (idem).
        # NonRiscossoServizi (tassa_soggiorno_nrs) sono sospesi non trasmessi ad AdE: tracciato
        # solo come dettaglio, non entra in nessun confronto/totale.
        'totale_10': lordo_10,
        'totale_22': lordo_22,
        'totale_ts': esente_n1,
        'totale_penali': penali,
    }


_CAMPI_DECIMAL_SOMMA = (
    'totale_giorno', 'imponibile_10', 'imposta_10', 'imponibile_22', 'imposta_22',
    'esente_n1', 'tassa_soggiorno_nrs', 'pagato_contanti', 'pagato_elettronico',
    'totale_10', 'totale_22', 'totale_ts', 'totale_penali',
)


def somma_dati_corrisp(lista_dati: list) -> dict:
    """Unisce più CORRISP.xml dello stesso giorno solare (più chiusure Z nello stesso giorno,
    es. per un problema che ha richiesto una riapertura e una seconda chiusura) in un unico
    dict pronto per l'upsert su rt_chiusure — stessa forma restituita da parse_corrisp_xml().

    Ogni file rappresenta UNA chiusura: sommare i totali (non prendere solo l'ultima) è
    l'unico modo per far quadrare il totale del giorno con gli scontrini PMS.
    """
    if not lista_dati:
        raise ValueError("Nessun dato da sommare")
    if len(lista_dati) == 1:
        return lista_dati[0]

    prima_data = lista_dati[0]['data_chiusura']
    for dati in lista_dati[1:]:
        if dati['data_chiusura'] != prima_data:
            raise ValueError(
                f"I file CORRISP.xml non appartengono allo stesso giorno "
                f"({prima_data.isoformat()} vs {dati['data_chiusura'].isoformat()})"
            )

    risultato = {
        'data_chiusura': prima_data,
        'progressivo': max(
            (d['progressivo'] for d in lista_dati if d['progressivo'] is not None),
            default=None,
        ),
    }
    for campo in _CAMPI_DECIMAL_SOMMA:
        risultato[campo] = sum((d[campo] for d in lista_dati), Decimal('0'))
    numeri_doc = [d['num_documenti'] for d in lista_dati if d['num_documenti'] is not None]
    risultato['num_documenti'] = sum(numeri_doc) if numeri_doc else None
    return risultato
