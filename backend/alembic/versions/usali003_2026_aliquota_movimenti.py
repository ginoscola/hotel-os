"""usali003 — Aliquota IVA per riga di Movimenti Attivi, usata solo dalle righe manuali
per calcolare il lordo (le righe auto hanno già l'IVA reale nei dati sorgente, sommata
direttamente da Produzione/Corrispettivi). Default 10% (arrangiamenti), eccetto
'mov_shop_kmdimare' (shop, 22%) — stesse aliquote già documentate per Corrispettivi.

Revision ID: usali003_2026
Revises: usali002_2026
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa

revision = 'usali003_2026'
down_revision = 'usali002_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'usali_movimenti_righe',
        sa.Column('aliquota_iva', sa.Numeric(5, 2), nullable=False, server_default='10.00'),
    )
    op.execute(
        "UPDATE usali_movimenti_righe SET aliquota_iva = 22.00 WHERE riga_code = 'mov_shop_kmdimare'"
    )


def downgrade():
    op.drop_column('usali_movimenti_righe', 'aliquota_iva')
