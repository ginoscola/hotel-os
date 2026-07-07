"""Corregge la precisione di occupancy_budget/inc_rooms_budget/inc_fnb_budget/
inc_extra_budget in budget_entries: erano Numeric(5,4) (max 9,9999) ma l'app vi
salva percentuali 0-100 (es. occupancy=70.0) — ogni salvataggio con un valore
realistico va in overflow (bug reale, budget_entries risultava sempre vuota).
Portate a Numeric(5,2), come le colonne gemelle pct_fnb_budget/pct_extra_budget
già corrette nella stessa migrazione originale (x4y5z6a7b8c9). Tabella vuota
al momento del fix: nessun dato da convertire.

Revision ID: budgetfix001_2026
Revises: corrmenu001_2026
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa

revision = 'budgetfix001_2026'
down_revision = 'corrmenu001_2026'
branch_labels = None
depends_on = None

COLONNE = ['occupancy_budget', 'inc_rooms_budget', 'inc_fnb_budget', 'inc_extra_budget']


def upgrade():
    for col in COLONNE:
        op.alter_column('budget_entries', col, type_=sa.Numeric(5, 2))


def downgrade():
    for col in COLONNE:
        op.alter_column('budget_entries', col, type_=sa.Numeric(5, 4))
