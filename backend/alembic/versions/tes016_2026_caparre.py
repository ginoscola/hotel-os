"""Tesoreria: periodo di soggiorno letto dalla causale dei bonifici da clienti (caparre per mese di arrivo).

Revision ID: tes016_2026
Revises: tes015_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'tes016_2026'
down_revision = 'tes015_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('tesoreria_movimenti', sa.Column('arrivo', sa.Date, nullable=True))
    op.add_column('tesoreria_movimenti', sa.Column('arrivo_struttura', sa.String(3), nullable=True))
    # regola che ha letto la data, 'manuale', 'escluso' (non è un incasso per un soggiorno) o NULL (non letto)
    op.add_column('tesoreria_movimenti', sa.Column('arrivo_regola', sa.String(20), nullable=True))
    op.add_column('tesoreria_movimenti', sa.Column('arrivo_manuale', sa.Boolean, nullable=False, server_default='false'))
    op.create_index('ix_tesoreria_movimenti_arrivo', 'tesoreria_movimenti', ['arrivo'])


def downgrade():
    op.drop_index('ix_tesoreria_movimenti_arrivo', 'tesoreria_movimenti')
    for c in ('arrivo_manuale', 'arrivo_regola', 'arrivo_struttura', 'arrivo'):
        op.drop_column('tesoreria_movimenti', c)
