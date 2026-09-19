"""prenotazioni cancellate - mese import nullable (import intera stagione)

Revision ID: prenot004_2026
Revises: prenot003_2026
Create Date: 2026-09-19
"""
from alembic import op
import sqlalchemy as sa

revision = "prenot004_2026"
down_revision = "prenot003_2026"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("prenotazioni_cancellate_imports", "mese", existing_type=sa.Integer(), nullable=True)


def downgrade():
    op.execute("UPDATE prenotazioni_cancellate_imports SET mese = 1 WHERE mese IS NULL")
    op.alter_column("prenotazioni_cancellate_imports", "mese", existing_type=sa.Integer(), nullable=False)
