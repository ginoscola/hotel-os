"""Aggiunge chiave app_name in app_config

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-05-13
"""

from alembic import op

revision = 'h8i9j0k1l2m3'
down_revision = 'g7h8i9j0k1l2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO app_config (key, value, description) VALUES
        ('app_name', 'KM Di Mare Revenue',
         'Nome applicazione mostrato nella navbar')
        ON CONFLICT (key) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM app_config WHERE key = 'app_name'")
