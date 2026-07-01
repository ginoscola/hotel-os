"""Crea tabella usali_voci_manuali per il modulo USALI.

Revision ID: usali001_2026
Revises: ar002_2026
Create Date: 2026-06-20
"""
from alembic import op
import sqlalchemy as sa

revision = 'usali001_2026'
down_revision = 'ar002_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'usali_voci_manuali',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('struttura_code', sa.String(10), nullable=False),
        sa.Column('anno', sa.Integer(), nullable=False),
        sa.Column('mese', sa.Integer(), nullable=False),
        sa.Column('voce_code', sa.String(50), nullable=False),
        sa.Column('valore', sa.Numeric(14, 2), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), onupdate=sa.text('now()')),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('struttura_code', 'anno', 'mese', 'voce_code',
                            name='uq_usali_struttura_anno_mese_voce'),
    )


def downgrade():
    op.drop_table('usali_voci_manuali')
