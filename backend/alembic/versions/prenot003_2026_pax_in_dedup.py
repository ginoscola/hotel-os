"""prenotazioni cancellate - aggiunge pax alla chiave di dedup

Due camere diverse della stessa prenotazione con stesso tipo camera e stesso
importo collidevano sulla vecchia chiave (bug reale, riscontrato al primo
import vero: prenotazione 127, due camere pax 2/1 identiche per il resto).

Revision ID: prenot003_2026
Revises: prenot002_2026
Create Date: 2026-09-19
"""
from alembic import op

revision = "prenot003_2026"
down_revision = "prenot002_2026"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("uq_prenotazione_cancellata_dedup", "prenotazioni_cancellate", type_="unique")
    op.create_unique_constraint(
        "uq_prenotazione_cancellata_dedup",
        "prenotazioni_cancellate",
        ["is_test", "hotel_code", "codice_ota", "data_prenotazione", "arrivo", "partenza",
         "tipo_camera", "importo", "cliente", "pax"],
    )


def downgrade():
    op.drop_constraint("uq_prenotazione_cancellata_dedup", "prenotazioni_cancellate", type_="unique")
    op.create_unique_constraint(
        "uq_prenotazione_cancellata_dedup",
        "prenotazioni_cancellate",
        ["is_test", "hotel_code", "codice_ota", "data_prenotazione", "arrivo", "partenza",
         "tipo_camera", "importo", "cliente"],
    )
