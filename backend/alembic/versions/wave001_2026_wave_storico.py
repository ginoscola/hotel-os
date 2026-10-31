"""Storico del fatturato 2022–2025 per l'indice WAVE.

Revision ID: wave001_2026
Revises: budgetrist001_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'wave001_2026'
down_revision = 'budgetrist001_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'wave_storico',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('struttura_code', sa.String(10), nullable=False),
        sa.Column('anno', sa.Integer, nullable=False),
        sa.Column('mese', sa.Integer, nullable=False),
        sa.Column('netto', sa.Numeric(14, 4), nullable=False),
        sa.Column('lordo', sa.Numeric(14, 2), nullable=True),
        sa.Column('tassa_soggiorno', sa.Numeric(14, 2), nullable=True),
        sa.Column('metodo', sa.Text, nullable=True),
        sa.Column('fonte', sa.Text, nullable=True),
        sa.Column('note', sa.Text, nullable=True),
        sa.Column('modificato_manualmente', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('netto_originale', sa.Numeric(14, 4), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('struttura_code', 'anno', 'mese', name='uq_wave_storico'),
    )


def downgrade():
    op.drop_table('wave_storico')
