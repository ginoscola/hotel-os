"""Aggiunge BON, reparti a due livelli e tabella employee_cost_center_monthly.

Revision ID: m3n4o5p6q7r8
Revises: l2m3n4o5p6q7
Create Date: 2026-05-16

"""
from alembic import op
import sqlalchemy as sa

revision = 'm3n4o5p6q7r8'
down_revision = 'l2m3n4o5p6q7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -----------------------------------------------------------------------
    # Struttura Buona Onda (BON) — ristorante, senza hotel_id
    # -----------------------------------------------------------------------
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, attivo, ordine)
        VALUES ('BON', 'Buona Onda', 'struttura', true, 5)
        ON CONFLICT (code) DO NOTHING
    """)

    # -----------------------------------------------------------------------
    # Reparti per ogni struttura
    # CLB, DPH, INT: Cucina, Colazioni, Camere, Manutenzione, Amministrazione
    # BON:           Cucina, Colazioni, Manutenzione, Amministrazione (no Camere)
    # -----------------------------------------------------------------------
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'CLB_CUCINA', 'Cucina', 'reparto', id, true, 1 FROM cost_centers WHERE code='CLB'
        ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'CLB_COLAZIONI', 'Colazioni', 'reparto', id, true, 2 FROM cost_centers WHERE code='CLB'
        ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'CLB_CAMERE', 'Camere', 'reparto', id, true, 3 FROM cost_centers WHERE code='CLB'
        ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'CLB_MANUTENZIONE', 'Manutenzione', 'reparto', id, true, 4 FROM cost_centers WHERE code='CLB'
        ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'CLB_ADMIN', 'Amministrazione', 'reparto', id, true, 5 FROM cost_centers WHERE code='CLB'
        ON CONFLICT (code) DO NOTHING
    """)

    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'DPH_CUCINA', 'Cucina', 'reparto', id, true, 1 FROM cost_centers WHERE code='DPH'
        ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'DPH_COLAZIONI', 'Colazioni', 'reparto', id, true, 2 FROM cost_centers WHERE code='DPH'
        ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'DPH_CAMERE', 'Camere', 'reparto', id, true, 3 FROM cost_centers WHERE code='DPH'
        ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'DPH_MANUTENZIONE', 'Manutenzione', 'reparto', id, true, 4 FROM cost_centers WHERE code='DPH'
        ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'DPH_ADMIN', 'Amministrazione', 'reparto', id, true, 5 FROM cost_centers WHERE code='DPH'
        ON CONFLICT (code) DO NOTHING
    """)

    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'INT_CUCINA', 'Cucina', 'reparto', id, true, 1 FROM cost_centers WHERE code='INT'
        ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'INT_COLAZIONI', 'Colazioni', 'reparto', id, true, 2 FROM cost_centers WHERE code='INT'
        ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'INT_CAMERE', 'Camere', 'reparto', id, true, 3 FROM cost_centers WHERE code='INT'
        ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'INT_MANUTENZIONE', 'Manutenzione', 'reparto', id, true, 4 FROM cost_centers WHERE code='INT'
        ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'INT_ADMIN', 'Amministrazione', 'reparto', id, true, 5 FROM cost_centers WHERE code='INT'
        ON CONFLICT (code) DO NOTHING
    """)

    # BON — no Camere
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'BON_CUCINA', 'Cucina', 'reparto', id, true, 1 FROM cost_centers WHERE code='BON'
        ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'BON_COLAZIONI', 'Colazioni', 'reparto', id, true, 2 FROM cost_centers WHERE code='BON'
        ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'BON_MANUTENZIONE', 'Manutenzione', 'reparto', id, true, 3 FROM cost_centers WHERE code='BON'
        ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, attivo, ordine)
        SELECT 'BON_ADMIN', 'Amministrazione', 'reparto', id, true, 4 FROM cost_centers WHERE code='BON'
        ON CONFLICT (code) DO NOTHING
    """)

    # -----------------------------------------------------------------------
    # employee_cost_center_monthly — assegnazioni CC per singolo mese
    # -----------------------------------------------------------------------
    op.create_table(
        'employee_cost_center_monthly',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('employee_id', sa.Integer(), sa.ForeignKey('employees.id'), nullable=False),
        sa.Column('import_id', sa.Integer(), sa.ForeignKey('payroll_imports.id', ondelete='CASCADE'), nullable=False),
        sa.Column('cost_center_id', sa.Integer(), sa.ForeignKey('cost_centers.id'), nullable=False),
        sa.Column('percentuale', sa.Numeric(5, 2), nullable=False),
        sa.Column('override_manuale', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.UniqueConstraint('employee_id', 'import_id', 'cost_center_id',
                            name='uq_eccm_emp_import_cc'),
    )


def downgrade() -> None:
    op.drop_table('employee_cost_center_monthly')
    # Rimuovi reparti e BON (le strutture figlie prima)
    op.execute("""
        DELETE FROM cost_centers WHERE tipo = 'reparto'
        OR code = 'BON'
    """)
