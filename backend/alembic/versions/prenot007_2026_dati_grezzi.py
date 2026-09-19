"""prenotazioni cancellate - dati_grezzi (riga intera del file, per campi non ancora mappati)

Revision ID: prenot007_2026
Revises: prenot006_2026
Create Date: 2026-09-19
"""
from alembic import op
import sqlalchemy as sa

revision = "prenot007_2026"
down_revision = "prenot006_2026"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "prenotazioni_cancellate",
        sa.Column("dati_grezzi", sa.JSON(), nullable=True),
    )


def downgrade():
    op.drop_column("prenotazioni_cancellate", "dati_grezzi")
