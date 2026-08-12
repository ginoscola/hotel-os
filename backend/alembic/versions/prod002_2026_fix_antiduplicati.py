"""prod002 — fix chiave anti-duplicati prod_righe: da per-import a globale.

La chiave originale (import_id, struttura_code, data_riferimento, camera,
dettaglio_originale, ospite, prezzo_lordo) protegge solo dai duplicati DENTRO la
stessa sessione di import: due import diversi che coprono lo stesso giorno (es. un
import di un solo giorno seguito da un import del mese intero che lo include)
duplicano le righe, perché import_id è diverso tra le due sessioni — verificato
in campo (401 -> 802 righe reimportando lo stesso giorno con nome file diverso).

Fix: tolto import_id (la deduplica deve valere a prescindere dalla sessione),
aggiunto is_test — necessario perché altrimenti un import reale che si sovrappone
a un import di test verrebbe scartato come "duplicato" del dato di test, e quelle
righe non comparirebbero mai nei report reali (che filtrano is_test=false).

Revision ID: prod002_2026
Revises: prod001_2026
Create Date: 2026-07-12
"""
from alembic import op

revision = 'prod002_2026'
down_revision = 'prod001_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint('uq_prod_riga_antiduplicati', 'prod_righe', type_='unique')
    op.create_unique_constraint(
        'uq_prod_riga_antiduplicati', 'prod_righe',
        ['is_test', 'struttura_code', 'data_riferimento', 'camera',
         'dettaglio_originale', 'ospite', 'prezzo_lordo'],
    )


def downgrade():
    op.drop_constraint('uq_prod_riga_antiduplicati', 'prod_righe', type_='unique')
    op.create_unique_constraint(
        'uq_prod_riga_antiduplicati', 'prod_righe',
        ['import_id', 'struttura_code', 'data_riferimento', 'camera',
         'dettaglio_originale', 'ospite', 'prezzo_lordo'],
    )
