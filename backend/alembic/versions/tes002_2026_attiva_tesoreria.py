"""Modulo Tesoreria: attivazione (Fase 1 completa, v4.0.0).

Il modulo era stato registrato disattivato da tes001_2026 finché non esisteva la pagina. I permessi
restano quelli di tes001_2026: admin tutto, viewer niente (si estendono da Admin → Gestione moduli).

Revision ID: tes002_2026
Revises: tes001_2026
"""
from alembic import op

revision = 'tes002_2026'
down_revision = 'tes001_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("UPDATE modules SET attivo = true WHERE code = 'tesoreria'")


def downgrade():
    op.execute("UPDATE modules SET attivo = false WHERE code = 'tesoreria'")
