"""prenotazioni cancellate - modificato_manualmente per proteggere correzioni manuali

Revision ID: prenot006_2026
Revises: prenot005_2026
Create Date: 2026-09-19
"""
from alembic import op
import sqlalchemy as sa

revision = "prenot006_2026"
down_revision = "prenot005_2026"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "prenotazioni_cancellate",
        sa.Column("modificato_manualmente", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade():
    op.drop_column("prenotazioni_cancellate", "modificato_manualmente")
