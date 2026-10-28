"""Tesoreria: causale del movimento separata dalla controparte.

`descrizione` resta il testo completo della banca (regole, ricerca, dettaglio); `causale` è la sola
causale, `controparte` il solo nome. I movimenti già presenti si aggiornano rileggendo i file XML
originali con POST /tesoreria/import/riprocessa.

Revision ID: tes004_2026
Revises: tes003_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'tes004_2026'
down_revision = 'tes003_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('tesoreria_movimenti', sa.Column('causale', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('tesoreria_movimenti', 'causale')
