"""Estende uq_documento con numero_scontrino: camera + codice_prenotazione non
bastano quando la STESSA prenotazione/camera ha più scontrini annullati nello
stesso giorno (es. 20/06/2026 INT, camera I418/prenotazione 4858: storni -476
e -28 per due scontrini diversi 177-18/177-19 con numero=0 identico). Questi
collidevano ancora sulla chiave introdotta in corrfix001_2026 e solo uno dei
due veniva importato. numero_scontrino (numero fiscale di stampa, es. "177-18")
distingue correttamente eventi di storno diversi anche a parità di
camera/prenotazione — assente nel formato Excel base (18 colonne), dove resta
la sola protezione camera+codice_prenotazione di corrfix001_2026.

Revision ID: corrfix002_2026
Revises: corrfix001_2026
Create Date: 2026-07-03
"""
from alembic import op

revision = 'corrfix002_2026'
down_revision = 'corrfix001_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint('uq_documento', 'corrispettivi_documenti', type_='unique')
    op.create_unique_constraint(
        'uq_documento',
        'corrispettivi_documenti',
        ['struttura_code', 'data_documento', 'numero', 'suffisso', 'camera', 'codice_prenotazione', 'numero_scontrino'],
    )


def downgrade():
    op.drop_constraint('uq_documento', 'corrispettivi_documenti', type_='unique')
    op.create_unique_constraint(
        'uq_documento',
        'corrispettivi_documenti',
        ['struttura_code', 'data_documento', 'numero', 'suffisso', 'camera', 'codice_prenotazione'],
    )
