"""Tesoreria — spese straordinarie: anno alberghiero, modalità e data di pagamento delle fatture collegate (v4.29.0).

Revision ID: tes020_2026
Revises: tes019_2026
"""
from alembic import op
import sqlalchemy as sa

revision = 'tes020_2026'
down_revision = 'tes019_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('tesoreria_interventi', sa.Column('anno', sa.Integer(), nullable=True))
    op.add_column('tesoreria_intervento_scadenze', sa.Column('modalita_pagamento', sa.String(12), nullable=True))
    op.add_column('tesoreria_intervento_scadenze', sa.Column('data_pagamento', sa.Date(), nullable=True))
    # le spese inserite finora (piscina, parcheggio, cella frigorifera) sono lavori dell'inverno 2026/27
    op.execute("UPDATE tesoreria_interventi SET anno = 2027 WHERE anno IS NULL")


def downgrade():
    op.drop_column('tesoreria_intervento_scadenze', 'data_pagamento')
    op.drop_column('tesoreria_intervento_scadenze', 'modalita_pagamento')
    op.drop_column('tesoreria_interventi', 'anno')
