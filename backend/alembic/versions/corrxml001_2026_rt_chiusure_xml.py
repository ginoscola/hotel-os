"""aggiunge campi dettaglio CORRISP.xml e modificato_manualmente a rt_chiusure

Revision ID: corrxml001_2026
Revises: rtprint002_2026
Create Date: 2026-07-01

Prepara rt_chiusure per l'import automatico del file CORRISP.xml prodotto
dal registratore telematico dopo la chiusura Z, in aggiunta all'inserimento
manuale esistente (non sostituito). Le righe già presenti sono tutte
inserite a mano finora: vengono marcate modificato_manualmente=True così
un futuro import XML non le sovrascrive mai.
"""
from alembic import op
import sqlalchemy as sa


revision = 'corrxml001_2026'
down_revision = 'rtprint002_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('rt_chiusure', sa.Column('progressivo', sa.Integer(), nullable=True))
    op.add_column('rt_chiusure', sa.Column('imponibile_10', sa.Numeric(12, 2), nullable=True))
    op.add_column('rt_chiusure', sa.Column('imposta_10', sa.Numeric(12, 2), nullable=True))
    op.add_column('rt_chiusure', sa.Column('imponibile_22', sa.Numeric(12, 2), nullable=True))
    op.add_column('rt_chiusure', sa.Column('imposta_22', sa.Numeric(12, 2), nullable=True))
    op.add_column('rt_chiusure', sa.Column('esente_n1', sa.Numeric(12, 2), nullable=True))
    op.add_column('rt_chiusure', sa.Column('tassa_soggiorno_nrs', sa.Numeric(12, 2), nullable=True))
    op.add_column('rt_chiusure', sa.Column('num_documenti', sa.Integer(), nullable=True))
    op.add_column('rt_chiusure', sa.Column('pagato_contanti', sa.Numeric(12, 2), nullable=True))
    op.add_column('rt_chiusure', sa.Column('pagato_elettronico', sa.Numeric(12, 2), nullable=True))
    op.add_column(
        'rt_chiusure',
        sa.Column('modificato_manualmente', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )

    rt_chiusure = sa.table('rt_chiusure', sa.column('modificato_manualmente', sa.Boolean))
    op.execute(rt_chiusure.update().values(modificato_manualmente=True))


def downgrade():
    op.drop_column('rt_chiusure', 'modificato_manualmente')
    op.drop_column('rt_chiusure', 'pagato_elettronico')
    op.drop_column('rt_chiusure', 'pagato_contanti')
    op.drop_column('rt_chiusure', 'num_documenti')
    op.drop_column('rt_chiusure', 'tassa_soggiorno_nrs')
    op.drop_column('rt_chiusure', 'esente_n1')
    op.drop_column('rt_chiusure', 'imposta_22')
    op.drop_column('rt_chiusure', 'imponibile_22')
    op.drop_column('rt_chiusure', 'imposta_10')
    op.drop_column('rt_chiusure', 'imponibile_10')
    op.drop_column('rt_chiusure', 'progressivo')
