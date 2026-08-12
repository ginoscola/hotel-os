"""prod003 — usa Oid (Welcome) come vera chiave anti-duplicati al posto della tupla di campi.

La tupla (struttura_code, data_riferimento, camera, dettaglio_originale, ospite, prezzo_lordo)
è solo un'approssimazione: quando `ospite` è vuoto (prenotazioni di gruppo senza nome cliente
associato a ogni addebito — reale nel file, verificato: 34 righe su 487 nel file di test, 220
in un import reale di un mese intero) righe realmente distinte (es. 3 colazioni identiche per
3 persone diverse nella stessa camera) collidono sulla stessa chiave e vengono scartate come
falsi duplicati. Il file StatisticheProduzione.xlsx ha però una colonna `Oid`, l'identificativo
univoco reale di ogni singolo addebito lato Welcome (verificato: sempre intero, sempre distinto,
un valore per riga) — molto più robusto, lo usiamo al posto della tupla di campi.

Revision ID: prod003_2026
Revises: prod002_2026
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa

revision = 'prod003_2026'
down_revision = 'prod002_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('prod_righe', sa.Column('oid_welcome', sa.Integer(), nullable=True))
    op.drop_constraint('uq_prod_riga_antiduplicati', 'prod_righe', type_='unique')
    op.create_unique_constraint(
        'uq_prod_riga_antiduplicati', 'prod_righe', ['is_test', 'oid_welcome'],
    )


def downgrade():
    op.drop_constraint('uq_prod_riga_antiduplicati', 'prod_righe', type_='unique')
    op.create_unique_constraint(
        'uq_prod_riga_antiduplicati', 'prod_righe',
        ['is_test', 'struttura_code', 'data_riferimento', 'camera',
         'dettaglio_originale', 'ospite', 'prezzo_lordo'],
    )
    op.drop_column('prod_righe', 'oid_welcome')
