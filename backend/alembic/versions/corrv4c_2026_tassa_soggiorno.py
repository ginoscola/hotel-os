"""Corrispettivi v4c — aggiunge colonna tassa_soggiorno a corrispettivi_documenti.

Il campo contiene il valore esatto della tassa di soggiorno per documento,
disponibile solo nel formato esteso Welcome PMS (36 colonne).
NULL = colonna non presente nel file sorgente (formato base).

Revision ID: corrv4c_2026
Revises: corrv4b_2026
"""

from alembic import op

revision = 'corrv4c_2026'
down_revision = 'corrv4b_2026'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE corrispettivi_documenti "
        "ADD COLUMN IF NOT EXISTS tassa_soggiorno NUMERIC(12, 2) NULL"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE corrispettivi_documenti DROP COLUMN IF EXISTS tassa_soggiorno"
    )
