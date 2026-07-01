"""Sostituisce pct_fnb_budget/pct_extra_budget con adr_fnb_budget/adr_extra_budget.

Revision ID: y5z6a7b8c9d0
Revises: x4y5z6a7b8c9
Create Date: 2026-05-26
"""

from alembic import op
import sqlalchemy as sa

revision = 'y5z6a7b8c9d0'
down_revision = 'x4y5z6a7b8c9'
branch_labels = None
depends_on = None


def upgrade():
    # Aggiunge i nuovi input ADR F&B e ADR Extra (€ per camera venduta)
    op.add_column('budget_entries', sa.Column('adr_fnb_budget',   sa.Numeric(10, 2), nullable=True))
    op.add_column('budget_entries', sa.Column('adr_extra_budget', sa.Numeric(10, 2), nullable=True))

    # Rimuove i vecchi input percentuale (tabella vuota, nessun dato da migrare)
    op.drop_column('budget_entries', 'pct_fnb_budget')
    op.drop_column('budget_entries', 'pct_extra_budget')


def downgrade():
    op.add_column('budget_entries', sa.Column('pct_fnb_budget',   sa.Numeric(10, 4), nullable=True))
    op.add_column('budget_entries', sa.Column('pct_extra_budget', sa.Numeric(10, 4), nullable=True))
    op.drop_column('budget_entries', 'adr_fnb_budget')
    op.drop_column('budget_entries', 'adr_extra_budget')
