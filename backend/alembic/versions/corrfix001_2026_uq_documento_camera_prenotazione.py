"""Estende uq_documento con camera + codice_prenotazione: Welcome PMS assegna
numero=0 a TUTTE le righe di storno/annullo non numerate emesse in un giorno per
una struttura. Con più annullamenti nello stesso giorno (es. 27/06/2026, CLB:
storni di Mendes e Boldrini, entrambi numero=0/suffisso=C-SC) la vecchia chiave
(struttura_code, data_documento, numero, suffisso) li considerava lo stesso
documento: solo il primo veniva inserito, il secondo scartato in silenzio da
ON CONFLICT DO NOTHING nello stesso import — causa di un delta RT-PMS reale
riscontrato in Controllo RT. camera + codice_prenotazione distinguono storni
diversi nello stesso giorno; per i documenti numerati (numero != 0) il numero è
già univoco quindi l'estensione della chiave non ha effetto.

Revision ID: corrfix001_2026
Revises: corrxml001_2026
Create Date: 2026-07-03
"""
from alembic import op

revision = 'corrfix001_2026'
down_revision = 'corrxml001_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint('uq_documento', 'corrispettivi_documenti', type_='unique')
    op.create_unique_constraint(
        'uq_documento',
        'corrispettivi_documenti',
        ['struttura_code', 'data_documento', 'numero', 'suffisso', 'camera', 'codice_prenotazione'],
    )


def downgrade():
    op.drop_constraint('uq_documento', 'corrispettivi_documenti', type_='unique')
    op.create_unique_constraint(
        'uq_documento',
        'corrispettivi_documenti',
        ['struttura_code', 'data_documento', 'numero', 'suffisso'],
    )
