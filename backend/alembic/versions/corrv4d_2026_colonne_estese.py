"""Corrispettivi v4d — aggiunge colonne formato esteso Welcome PMS a corrispettivi_documenti.

Tutte le colonne sono nullable: nessun impatto sui dati esistenti.
I valori vengono popolati solo dai nuovi import con file in formato esteso (36 colonne).

Revision ID: corrv4d_2026
Revises: corrv4c_2026
"""

from alembic import op

revision = 'corrv4d_2026'
down_revision = 'corrv4c_2026'
branch_labels = None
depends_on = None

NUOVE_COLONNE = [
    ("sigla",                 "VARCHAR(10)"),
    ("numero_scontrino",      "TEXT"),
    ("arrivo",                "DATE"),
    ("partenza",              "DATE"),
    ("ubicazione_istat",      "TEXT"),
    ("voucher",               "TEXT"),
    ("nome_file_pms",         "TEXT"),
    ("stato_fe",              "TEXT"),
    ("modalita",              "TEXT"),
    ("importo_bollo",         "NUMERIC(12, 2)"),
    ("tipo_documento_fe",     "TEXT"),
    ("numero_documento_fe",   "TEXT"),
    ("nazione",               "VARCHAR(10)"),
    ("ora_stampa",            "TEXT"),
    ("contabilizzato_mexal",  "TEXT"),
    ("causale_cancellazione", "TEXT"),
    ("maschera_conto",        "TEXT"),
    ("data_creazione_doc",    "DATE"),
    ("utente_creazione",      "TEXT"),
]


def upgrade() -> None:
    for col, tipo in NUOVE_COLONNE:
        op.execute(
            f"ALTER TABLE corrispettivi_documenti "
            f"ADD COLUMN IF NOT EXISTS {col} {tipo} NULL"
        )


def downgrade() -> None:
    for col, _ in NUOVE_COLONNE:
        op.execute(
            f"ALTER TABLE corrispettivi_documenti DROP COLUMN IF EXISTS {col}"
        )
