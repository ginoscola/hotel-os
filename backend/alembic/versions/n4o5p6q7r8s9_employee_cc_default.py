"""Sostituisce employee_cost_center con employee_cc_default (granularità mese).

Revision ID: n4o5p6q7r8s9
Revises: m3n4o5p6q7r8
Create Date: 2026-05-17

"""
from alembic import op
import sqlalchemy as sa

revision = 'n4o5p6q7r8s9'
down_revision = 'm3n4o5p6q7r8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Rimuove la vecchia tabella (svuota prima per sicurezza — nessun dato storico utile)
    op.drop_table('employee_cost_center')

    # Nuova tabella: default CC con decorrenza a livello di mese
    op.create_table(
        'employee_cc_default',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('employee_id', sa.Integer(),
                  sa.ForeignKey('employees.id'), nullable=False),
        sa.Column('cost_center_id', sa.Integer(),
                  sa.ForeignKey('cost_centers.id'), nullable=False),
        sa.Column('percentuale', sa.Numeric(5, 2), nullable=False),
        sa.Column('anno_inizio', sa.Integer(), nullable=False),
        sa.Column('mese_inizio', sa.Integer(), nullable=False),
        sa.Column('anno_fine', sa.Integer(), nullable=True),
        sa.Column('mese_fine', sa.Integer(), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()')),
        sa.UniqueConstraint(
            'employee_id', 'cost_center_id', 'anno_inizio', 'mese_inizio',
            name='uq_emp_cc_default_decorrenza',
        ),
    )


def downgrade() -> None:
    op.drop_table('employee_cc_default')

    op.create_table(
        'employee_cost_center',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('employee_id', sa.Integer(),
                  sa.ForeignKey('employees.id'), nullable=False),
        sa.Column('cost_center_id', sa.Integer(),
                  sa.ForeignKey('cost_centers.id'), nullable=False),
        sa.Column('percentuale', sa.Numeric(5, 2), nullable=False,
                  server_default='100.00'),
        sa.Column('data_inizio', sa.Date(), nullable=False),
        sa.Column('data_fine', sa.Date(), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.UniqueConstraint(
            'employee_id', 'cost_center_id', 'data_inizio',
            name='uq_emp_cc_data_inizio',
        ),
    )
