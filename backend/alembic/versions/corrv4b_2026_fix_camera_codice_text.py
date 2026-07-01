"""Corrispettivi v4b — camera e codice_prenotazione da VARCHAR(50) a TEXT.

Revision ID: corrv4b_2026
Revises: corrv4_2026
"""

from alembic import op

revision = 'corrv4b_2026'
down_revision = 'corrv4_2026'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE corrispettivi_documenti ALTER COLUMN camera TYPE TEXT")
    op.execute("ALTER TABLE corrispettivi_documenti ALTER COLUMN codice_prenotazione TYPE TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE corrispettivi_documenti ALTER COLUMN camera TYPE VARCHAR(50)")
    op.execute("ALTER TABLE corrispettivi_documenti ALTER COLUMN codice_prenotazione TYPE VARCHAR(50)")
