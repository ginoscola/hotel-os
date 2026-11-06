"""Tesoreria: pagamenti in banca collegati alle spese straordinarie.

Revision ID: tes019_2026
Revises: tes018_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'tes019_2026'
down_revision = 'tes018_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'tesoreria_intervento_movimenti',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('intervento_id', sa.Integer, sa.ForeignKey('tesoreria_interventi.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('movimento_id', sa.Integer, sa.ForeignKey('tesoreria_movimenti.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('importo', sa.Numeric(14, 2), nullable=False),
        sa.Column('era_straordinario', sa.Boolean, nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_table('tesoreria_intervento_movimenti')
