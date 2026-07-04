"""Aggiunge menu_diretto a rt_chiusure: incassi a pagamento diretto dal software
del ristorante (non collegato a Welcome), che possono transitare sulla stessa
cassa fiscale RT1 (Du Parc + Club Hotel). Valore lordo (incl. IVA), aliquota 10%.
Nullable, non tocca righe esistenti.

Revision ID: corrmenu001_2026
Revises: corrfix002_2026
Create Date: 2026-07-04
"""
from alembic import op
import sqlalchemy as sa

revision = 'corrmenu001_2026'
down_revision = 'corrfix002_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('rt_chiusure', sa.Column('menu_diretto', sa.Numeric(12, 2), nullable=True))


def downgrade():
    op.drop_column('rt_chiusure', 'menu_diretto')
