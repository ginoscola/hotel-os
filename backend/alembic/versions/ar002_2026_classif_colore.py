"""Aggiunge colonna colore a trattamenti_classificazione.

Revision ID: ar002_2026
Revises: ar001_2026
Create Date: 2026-06-20
"""
from alembic import op
import sqlalchemy as sa

revision = 'ar002_2026'
down_revision = 'ar001_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'trattamenti_classificazione',
        sa.Column('colore', sa.String(7), nullable=True)
    )


def downgrade():
    op.drop_column('trattamenti_classificazione', 'colore')
