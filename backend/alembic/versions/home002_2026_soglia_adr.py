"""home002 — Aggiunge la soglia di default per 'adr' (assente da home001_2026: l'ADR non
aveva un target universale senza un riferimento di budget). Valori di partenza stimati sui
dati reali della stagione 2026 (ADR mensile 70-104€) — pensati per essere affinati da admin
in "Home / Cruscotto → Soglie tachimetri", non un giudizio definitivo sul business.

Revision ID: home002_2026
Revises: home001_2026
Create Date: 2026-09-04
"""
from alembic import op
import sqlalchemy as sa

revision = 'home002_2026'
down_revision = 'home001_2026'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text("""
        INSERT INTO dashboard_kpi_soglie
            (kpi_code, hotel_code, direzione, unita, target, soglia_rossa, soglia_arancione, ordine)
        VALUES
            ('adr', NULL, 'alto_meglio', 'euro', NULL, 60, 80, 45)
    """))


def downgrade():
    op.execute("DELETE FROM dashboard_kpi_soglie WHERE kpi_code = 'adr' AND hotel_code IS NULL")
