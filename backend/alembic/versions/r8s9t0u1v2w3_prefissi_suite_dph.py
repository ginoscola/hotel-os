"""Aggiunge prefissi per le suite tematiche del Du Parc: Fuego, Aire, Agua, Tierra.
Queste camere non hanno il prefisso lettera 'D' ma appartengono a DPH.
Usano il tipo 'contiene' per catturare anche varianti troncate (es. 'FUEG').

Revision ID: r8s9t0u1v2w3
Revises: q7r8s9t0u1v2
Create Date: 2026-05-22
"""
from alembic import op

revision = 'r8s9t0u1v2w3'
down_revision = 'q7r8s9t0u1v2'
branch_labels = None
depends_on = None

SUITE_DPH = ['fuego', 'aire', 'agua', 'tierra']


def upgrade():
    for nome in SUITE_DPH:
        op.execute(f"""
            INSERT INTO struttura_prefissi (prefisso, struttura_code, tipo)
            VALUES ('{nome}', 'DPH', 'contiene')
            ON CONFLICT (prefisso) DO NOTHING
        """)


def downgrade():
    for nome in SUITE_DPH:
        op.execute(f"DELETE FROM struttura_prefissi WHERE prefisso = '{nome}'")
