"""Tesoreria — impegni: F24 pagato senza usare il credito IVA, scelta dell'utente (v4.35.0).

Revision ID: tes021_2026
Revises: tes020_2026
"""
from alembic import op
import sqlalchemy as sa

revision = 'tes021_2026'
down_revision = 'tes020_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('tesoreria_impegni', sa.Column('senza_credito', sa.Boolean(), nullable=False, server_default='false'))


def downgrade():
    op.drop_column('tesoreria_impegni', 'senza_credito')
