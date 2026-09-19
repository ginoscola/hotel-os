"""prenotazioni cancellate - trattamento varchar(20) troppo corto per valori reali

Revision ID: prenot005_2026
Revises: prenot004_2026
Create Date: 2026-09-19
"""
from alembic import op
import sqlalchemy as sa

revision = "prenot005_2026"
down_revision = "prenot004_2026"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "prenotazioni_cancellate", "trattamento",
        existing_type=sa.String(20), type_=sa.String(100), existing_nullable=True,
    )


def downgrade():
    op.alter_column(
        "prenotazioni_cancellate", "trattamento",
        existing_type=sa.String(100), type_=sa.String(20), existing_nullable=True,
    )
