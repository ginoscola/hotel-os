"""housekeeping_bar_cc

Revision ID: hkbar001cc2026
Revises: z6a7b8c9d0e1
Create Date: 2026-06-12

Aggiunge i centri di costo Housekeeping e Bar per ogni struttura (CLB, DPH, INT).
"""
from alembic import op
import sqlalchemy as sa

revision = 'hkbar001cc2026'
down_revision = 'b8c9d0e1f2g3'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    # Recupera gli ID delle strutture per non dipendere da valori fissi
    strutture = {
        row[0]: row[1]
        for row in conn.execute(
            sa.text("SELECT code, id FROM cost_centers WHERE parent_id IS NULL AND code IN ('CLB','DPH','INT')")
        )
    }

    nuovi = [
        ('CLB_HOUSEKEEPING', 'Housekeeping', strutture.get('CLB')),
        ('CLB_BAR',          'Bar',          strutture.get('CLB')),
        ('DPH_HOUSEKEEPING', 'Housekeeping', strutture.get('DPH')),
        ('DPH_BAR',          'Bar',          strutture.get('DPH')),
        ('INT_HOUSEKEEPING', 'Housekeeping', strutture.get('INT')),
        ('INT_BAR',          'Bar',          strutture.get('INT')),
    ]

    for code, name, parent_id in nuovi:
        if parent_id is None:
            continue
        esiste = conn.execute(
            sa.text("SELECT 1 FROM cost_centers WHERE code = :code"),
            {'code': code}
        ).fetchone()
        if not esiste:
            conn.execute(
                sa.text("INSERT INTO cost_centers (code, name, parent_id) VALUES (:code, :name, :parent_id)"),
                {'code': code, 'name': name, 'parent_id': parent_id}
            )


def downgrade():
    op.execute("""
        DELETE FROM cost_centers
        WHERE code IN (
            'CLB_HOUSEKEEPING', 'CLB_BAR',
            'DPH_HOUSEKEEPING', 'DPH_BAR',
            'INT_HOUSEKEEPING', 'INT_BAR'
        )
    """)
