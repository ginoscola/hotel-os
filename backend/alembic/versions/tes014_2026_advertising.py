"""Tesoreria: piano annuale dell'advertising pagato con carta (Google, Meta), spesa per mese.

Revision ID: tes014_2026
Revises: tes013_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'tes014_2026'
down_revision = 'tes013_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'tesoreria_advertising',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('anno', sa.Integer, nullable=False, unique=True),
        sa.Column('conto_id', sa.Integer, sa.ForeignKey('tesoreria_conti.id'), nullable=False),
        sa.Column('totale', sa.Numeric(14, 2), nullable=False),
        sa.Column('nota', sa.String(255), nullable=True),
    )
    op.create_table(
        'tesoreria_advertising_mesi',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('advertising_id', sa.Integer, sa.ForeignKey('tesoreria_advertising.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('mese', sa.Integer, nullable=False),
        sa.Column('importo', sa.Numeric(14, 2), nullable=False),
        sa.UniqueConstraint('advertising_id', 'mese', name='uq_tesoreria_advertising_mese'),
    )


def downgrade():
    op.execute("DELETE FROM tesoreria_impegni WHERE tipo = 'advertising'")
    op.drop_table('tesoreria_advertising_mesi')
    op.drop_table('tesoreria_advertising')
