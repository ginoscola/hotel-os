"""prenotazioni cancellate - flag cancellata + tipo import (disdetta/non_disdetta)

La tabella prenotazioni_cancellate può ora contenere anche prenotazioni MAI cancellate,
per calcolare il tasso di cancellazione per mese di prenotazione (serve il denominatore:
totale prenotato, non solo il numeratore delle cancellazioni). Vedi models/prenotazioni.py.

Revision ID: prenot008_2026
Revises: prenot007_2026
Create Date: 2026-09-20
"""
from alembic import op
import sqlalchemy as sa

revision = "prenot008_2026"
down_revision = "prenot007_2026"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "prenotazioni_cancellate",
        sa.Column("cancellata", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.add_column(
        "prenotazioni_cancellate_imports",
        sa.Column("tipo", sa.String(20), nullable=False, server_default="disdetta"),
    )
    op.drop_constraint(
        "uq_prenotazioni_cancellate_import", "prenotazioni_cancellate_imports", type_="unique"
    )
    op.create_unique_constraint(
        "uq_prenotazioni_cancellate_import",
        "prenotazioni_cancellate_imports",
        ["mese", "anno", "nome_file", "tipo"],
    )


def downgrade():
    op.drop_constraint(
        "uq_prenotazioni_cancellate_import", "prenotazioni_cancellate_imports", type_="unique"
    )
    op.create_unique_constraint(
        "uq_prenotazioni_cancellate_import",
        "prenotazioni_cancellate_imports",
        ["mese", "anno", "nome_file"],
    )
    op.drop_column("prenotazioni_cancellate_imports", "tipo")
    op.drop_column("prenotazioni_cancellate", "cancellata")
