"""Tesoreria Fase 3, blocco C: quota degli F24 coperta dagli altri crediti (1701, 1704, 1631, 1627...).

Revision ID: tes010_2026
Revises: tes009_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'tes010_2026'
down_revision = 'tes009_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('tesoreria_impegni', sa.Column('coperto_altri', sa.Numeric(14, 2), nullable=False, server_default='0'))


def downgrade():
    op.drop_column('tesoreria_impegni', 'coperto_altri')
