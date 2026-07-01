"""Test unitari per il parser CORRISP.xml (registratore telematico).

Usa tests/fixtures/corrisp_20260630_mock.xml come file di test (sintetico,
anonimizzato — non è il file reale dell'RT). Tutti i test sono unitari
(nessun endpoint HTTP, nessun DB).
"""
import os
from datetime import date
from decimal import Decimal

from app.services.corrisp_xml_parser import parse_corrisp_xml

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), 'fixtures', 'corrisp_20260630_mock.xml')


def _carica_fixture() -> bytes:
    with open(FIXTURE_PATH, 'rb') as f:
        return f.read()


class TestParseCorrispXml:
    """Fixture = file CORRISP.xml reale del 30/06/2026 (RT1, Du Parc/Club Hotel),
    firma digitale sostituita con placeholder. Nel file reale <Imposta> è annidato
    dentro <IVA> insieme a <AliquotaIVA> — non un fratello diretto di <IVA> sotto
    <Riepilogo> come da esempio iniziale del prompt.
    """

    def test_totale_corretto(self):
        dati = parse_corrisp_xml(_carica_fixture())
        # 1909.27 (IVA 10%, Ammontare) + 46.01 (N1, ImportoParziale) = 1955.28
        # Le righe con Ammontare/ImportoParziale = 0 (IVA 22/4/5%, N4) sono escluse.
        assert dati['totale_giorno'] == Decimal('1955.28')

    def test_imponibile_e_imposta_10(self):
        dati = parse_corrisp_xml(_carica_fixture())
        assert dati['imponibile_10'] == Decimal('1735.54')
        assert dati['imposta_10'] == Decimal('173.55')  # annidato dentro <IVA>

    def test_esente_n1(self):
        dati = parse_corrisp_xml(_carica_fixture())
        assert dati['esente_n1'] == Decimal('46.01')

    def test_iva_22_a_zero(self):
        dati = parse_corrisp_xml(_carica_fixture())
        assert dati['imponibile_22'] == Decimal('0')
        assert dati['imposta_22'] == Decimal('0')

    def test_num_documenti(self):
        dati = parse_corrisp_xml(_carica_fixture())
        assert dati['num_documenti'] == 13

    def test_data_chiusura(self):
        dati = parse_corrisp_xml(_carica_fixture())
        assert dati['data_chiusura'] == date(2026, 6, 30)

    def test_progressivo(self):
        dati = parse_corrisp_xml(_carica_fixture())
        assert dati['progressivo'] == 944

    def test_pagato_contanti_ed_elettronico(self):
        dati = parse_corrisp_xml(_carica_fixture())
        assert dati['pagato_contanti'] == Decimal('199.00')
        assert dati['pagato_elettronico'] == Decimal('1756.10')

    def test_tassa_soggiorno_nrs(self):
        """Somma di TUTTI i NonRiscossoServizi presenti, indipendentemente dalla riga:
        173.74 (sulla riga IVA 10%) + 7.99 (sulla riga N1) = 181.73."""
        dati = parse_corrisp_xml(_carica_fixture())
        assert dati['tassa_soggiorno_nrs'] == Decimal('181.73')

    def test_campi_legacy_breakdown(self):
        """totale_10/22/ts/penali alimentano il confronto per categoria esistente in GET /rt-chiusure."""
        dati = parse_corrisp_xml(_carica_fixture())
        assert dati['totale_10'] == Decimal('1909.27')    # Ammontare lordo IVA 10%
        assert dati['totale_22'] == Decimal('0')
        assert dati['totale_ts'] == Decimal('181.73')     # = tassa_soggiorno_nrs
        assert dati['totale_penali'] == Decimal('0')      # nessuna Natura dedicata nell'XML

    def test_campi_zero_esclusi_dal_totale(self):
        """Una riga con Ammontare o ImportoParziale = 0 non deve alterare il totale."""
        xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<r:DatiCorrispettivi xmlns:r="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/corrispettivi/dati/v1.0">
  <DataOraRilevazione>2026-07-01T20:00:00</DataOraRilevazione>
  <Trasmissione><Progressivo>1</Progressivo></Trasmissione>
  <DatiRT>
    <Riepilogo>
      <IVA><AliquotaIVA>10.00</AliquotaIVA></IVA>
      <ImportoParziale>0.00</ImportoParziale>
      <Imposta>0.00</Imposta>
      <Ammontare>0.00</Ammontare>
    </Riepilogo>
    <Riepilogo>
      <Natura>N1</Natura>
      <ImportoParziale>0.00</ImportoParziale>
    </Riepilogo>
    <Totali>
      <NumeroDocCommerciali>0</NumeroDocCommerciali>
      <PagatoContanti>0.00</PagatoContanti>
      <PagatoElettronico>0.00</PagatoElettronico>
    </Totali>
  </DatiRT>
</r:DatiCorrispettivi>"""
        dati = parse_corrisp_xml(xml)
        assert dati['totale_giorno'] == Decimal('0')

    def test_imposta_come_fratello_diretto_di_iva(self):
        """Variante con <Imposta> fratello diretto di <IVA> sotto <Riepilogo> (non annidato):
        il parser deve gestire entrambe le forme, non solo quella annidata del file reale."""
        xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<r:DatiCorrispettivi xmlns:r="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/corrispettivi/dati/v1.0">
  <DataOraRilevazione>2026-07-02T21:00:00</DataOraRilevazione>
  <Trasmissione><Progressivo>2</Progressivo></Trasmissione>
  <DatiRT>
    <Riepilogo>
      <IVA><AliquotaIVA>10.00</AliquotaIVA></IVA>
      <ImportoParziale>100.00</ImportoParziale>
      <Imposta>10.00</Imposta>
      <Ammontare>110.00</Ammontare>
    </Riepilogo>
    <Totali>
      <NumeroDocCommerciali>1</NumeroDocCommerciali>
      <PagatoContanti>110.00</PagatoContanti>
      <PagatoElettronico>0.00</PagatoElettronico>
    </Totali>
  </DatiRT>
</r:DatiCorrispettivi>"""
        dati = parse_corrisp_xml(xml)
        assert dati['imposta_10'] == Decimal('10.00')
        assert dati['totale_giorno'] == Decimal('110.00')
