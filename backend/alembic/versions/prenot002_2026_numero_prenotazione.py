"""prenotazioni cancellate - aggiunge numero_prenotazione, data_cancellazione, data_rilevata

Revision ID: prenot002_2026
Revises: prenot001_2026
Create Date: 2026-09-19
"""
from alembic import op
import sqlalchemy as sa

revision = "prenot002_2026"
down_revision = "prenot001_2026"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("prenotazioni_cancellate", sa.Column("numero_prenotazione", sa.String(50), nullable=True))
    op.add_column("prenotazioni_cancellate", sa.Column("data_cancellazione", sa.Date(), nullable=True))
    # Le righe già importate non hanno una data di rilevamento reale: usiamo la data del loro
    # import come miglior approssimazione disponibile, poi la colonna diventa NOT NULL.
    op.add_column("prenotazioni_cancellate", sa.Column("data_rilevata", sa.Date(), nullable=True))
    op.execute("""
        UPDATE prenotazioni_cancellate pc
        SET data_rilevata = pci.created_at::date
        FROM prenotazioni_cancellate_imports pci
        WHERE pc.import_id = pci.id AND pc.data_rilevata IS NULL
    """)
    op.alter_column("prenotazioni_cancellate", "data_rilevata", nullable=False)


def downgrade():
    op.drop_column("prenotazioni_cancellate", "data_rilevata")
    op.drop_column("prenotazioni_cancellate", "data_cancellazione")
    op.drop_column("prenotazioni_cancellate", "numero_prenotazione")
