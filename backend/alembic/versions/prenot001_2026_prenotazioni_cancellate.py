"""prenotazioni cancellate - import export Welcome PrenotazioniWeb

Revision ID: prenot001_2026
Revises: usali005_2026
Create Date: 2026-09-18
"""
from alembic import op
import sqlalchemy as sa

revision = "prenot001_2026"
down_revision = "usali005_2026"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "prenotazioni_cancellate_imports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nome_file", sa.String(255), nullable=False),
        sa.Column("mese", sa.Integer(), nullable=False),
        sa.Column("anno", sa.Integer(), nullable=False),
        sa.Column("n_righe_totali", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("n_righe_valide", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("n_righe_fuori_mese", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_test", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("imported_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("mese", "anno", "nome_file", name="uq_prenotazioni_cancellate_import"),
    )

    op.create_table(
        "prenotazioni_cancellate",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("import_id", sa.Integer(), sa.ForeignKey("prenotazioni_cancellate_imports.id", ondelete="CASCADE"), nullable=False),
        sa.Column("hotel_code", sa.String(20), nullable=False),
        sa.Column("canale", sa.String(50), nullable=False),
        sa.Column("canale_vendita", sa.String(100), nullable=False, server_default=""),
        sa.Column("codice_ota", sa.String(50), nullable=False, server_default=""),
        sa.Column("data_prenotazione", sa.Date(), nullable=False),
        sa.Column("arrivo", sa.Date(), nullable=False),
        sa.Column("partenza", sa.Date(), nullable=False),
        sa.Column("notti", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pax", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cliente", sa.String(255), nullable=False, server_default=""),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("tipo_camera", sa.String(100), nullable=False, server_default=""),
        sa.Column("trattamento", sa.String(20), nullable=True),
        sa.Column("mercato", sa.String(50), nullable=True),
        sa.Column("importo", sa.Float(), nullable=False, server_default="0"),
        sa.Column("is_test", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint(
            "is_test", "hotel_code", "codice_ota", "data_prenotazione", "arrivo", "partenza",
            "tipo_camera", "importo", "cliente",
            name="uq_prenotazione_cancellata_dedup",
        ),
    )
    op.create_index("ix_prenotazioni_cancellate_hotel_code", "prenotazioni_cancellate", ["hotel_code"])
    op.create_index("ix_prenotazioni_cancellate_data_prenotazione", "prenotazioni_cancellate", ["data_prenotazione"])
    op.create_index("ix_prenotazioni_cancellate_arrivo", "prenotazioni_cancellate", ["arrivo"])


def downgrade():
    op.drop_table("prenotazioni_cancellate")
    op.drop_table("prenotazioni_cancellate_imports")
