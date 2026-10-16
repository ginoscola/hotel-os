"""prod007 — tabella prod_occupazione_consumi (tab "Occupazione e Consumo" di Statistiche
Produzione): valori mensili per struttura inseriti a mano (utenze, presenze reparti) o
correzioni manuali delle voci calcolate automaticamente (camere, arrivi, colazioni).

Revision ID: prod007_2026
Revises: usali006_2026
Create Date: 2026-10-16
"""
from alembic import op
import sqlalchemy as sa

revision = 'prod007_2026'
down_revision = 'usali006_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'prod_occupazione_consumi',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('struttura_code', sa.String(20), nullable=False),
        sa.Column('anno', sa.Integer(), nullable=False),
        sa.Column('mese', sa.Integer(), nullable=False),
        sa.Column('voce_code', sa.String(50), nullable=False),
        sa.Column('valore', sa.Numeric(14, 2), nullable=False),
        sa.Column('modificato_da', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('struttura_code', 'anno', 'mese', 'voce_code', name='uq_prod_occupazione_consumo'),
    )


def downgrade():
    op.drop_table('prod_occupazione_consumi')
