"""usali004 — Sdoppia 'Ristorante Mare Mosso -> Alimenti -> Altri Alimenti' (DPH) in due righe:
'Hotel' (invariata, ospiti Du Parc via redirect Welcome) e 'Clienti Esterni' (nuova, clienti che
pagano direttamente al ristorante, tracciati come inserimento manuale in Corrispettivi per MMS —
struttura senza dati Welcome/PMS, come BON).

Revision ID: usali004_2026
Revises: usali003_2026
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa

revision = 'usali004_2026'
down_revision = 'usali003_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        UPDATE usali_movimenti_righe
        SET conto = 'Alimenti -> Altri Alimenti - Hotel'
        WHERE struttura_code = 'DPH' AND riga_code = 'mov_maremosso_alimenti'
    """)
    op.execute("""
        UPDATE usali_movimenti_righe
        SET ordine = ordine + 1
        WHERE struttura_code = 'DPH' AND ordine >= 14
    """)
    op.execute("""
        INSERT INTO usali_movimenti_righe
            (struttura_code, reparto, conto, riga_code, tipo, ordine, aliquota_iva)
        VALUES
            ('DPH', 'Ristorante Mare Mosso', 'Alimenti -> Altri Alimenti - Clienti Esterni',
             'mov_maremosso_alimenti_esterni', 'auto_maremosso_esterni', 14, 10.00)
    """)


def downgrade():
    op.execute("DELETE FROM usali_movimenti_righe WHERE riga_code = 'mov_maremosso_alimenti_esterni'")
    op.execute("""
        UPDATE usali_movimenti_righe
        SET ordine = ordine - 1
        WHERE struttura_code = 'DPH' AND ordine >= 15
    """)
    op.execute("""
        UPDATE usali_movimenti_righe
        SET conto = 'Alimenti -> Altri Alimenti'
        WHERE struttura_code = 'DPH' AND riga_code = 'mov_maremosso_alimenti'
    """)
