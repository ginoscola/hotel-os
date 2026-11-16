"""Corrispettivi — data di competenza: acconto incassato prima dell'arrivo conta nel giorno di arrivo (v4.37.0).

Ricalcola una volta i documenti già caricati con la stessa regola dell'import
(services/corrispettivi_competenza.py: scontrino/fattura, tipo conto 'Acconto', arrivo > data documento).

Revision ID: corrcomp001_2026
Revises: tes021_2026
"""
from alembic import op
import sqlalchemy as sa

revision = 'corrcomp001_2026'
down_revision = 'tes021_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('corrispettivi_documenti', sa.Column('data_competenza', sa.Date(), nullable=True))
    op.execute("""
        UPDATE corrispettivi_documenti
           SET data_competenza = arrivo
         WHERE tipo IN ('scontrino', 'fattura')
           AND trim(coalesce(maschera_conto, '')) = 'Acconto'
           AND arrivo IS NOT NULL
           AND arrivo > data_documento
    """)


def downgrade():
    op.drop_column('corrispettivi_documenti', 'data_competenza')
