"""Aggiunge colonna is_test a payroll_imports per gestione dati di test.

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
Create Date: 2026-05-15

"""
from alembic import op
import sqlalchemy as sa

revision = 'k1l2m3n4o5p6'
down_revision = 'j0k1l2m3n4o5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'payroll_imports',
        sa.Column('is_test', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade() -> None:
    op.drop_column('payroll_imports', 'is_test')
