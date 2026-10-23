"""usalifnb001 — tabella usali_fnb_coperti: coperti mensili inseriti a mano per la scheda
USALI → Food & Beverage (MMS = coperti totali dal gestionale Menu, BON = numero scontrini).
Peso cena/pranzo e abbinamento centro di costo → punto vendita stanno in app_config
(chiave usali_fnb_parametri, creata al primo salvataggio da Admin).

Revision ID: usalifnb001_2026
Revises: budgetprev001_2026
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa

revision = 'usalifnb001_2026'
down_revision = 'budgetprev001_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'usali_fnb_coperti',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('struttura_code', sa.String(10), nullable=False),
        sa.Column('anno', sa.Integer(), nullable=False),
        sa.Column('mese', sa.Integer(), nullable=False),
        sa.Column('valore', sa.Integer(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('struttura_code', 'anno', 'mese', name='uq_usali_fnb_coperti'),
    )


def downgrade():
    op.drop_table('usali_fnb_coperti')
