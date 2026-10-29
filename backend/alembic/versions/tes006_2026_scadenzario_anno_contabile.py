"""Tesoreria Fase 2: anno contabile della fotografia dello scadenzario Passcom.

Una fotografia (data) può essere composta da più file, uno per anno contabile (a cavallo d'anno lo
studio lavora su due anni). Un file con la stessa data e lo stesso anno contabile sostituisce il
precedente.

Revision ID: tes006_2026
Revises: tes005_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'tes006_2026'
down_revision = 'tes005_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('tesoreria_scad_import', sa.Column('anno_contabile', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('tesoreria_scad_import', 'anno_contabile')
