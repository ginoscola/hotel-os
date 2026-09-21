"""prod006 — flag conta_come_pasto su prod_dettaglio_categoria, per distinguere le righe che
rappresentano un pasto vero (una a persona/notte) dalle singole voci di menu (piatti/bevande/
coperti) mappate nella stessa categoria colazione/pranzo/cena per finalità di ricavo.

Nato da un bug reale (settembre 2026): la tab "Conteggio pasti" contava tutte le righe della
categoria 'cena'/'pranzo', ma per Du Parc quella categoria include anche ogni piatto/bevanda/
coperto ordinato al ristorante Maremosso (mappati lì apposta perché servono al calcolo del
ricavo in Movimenti Attivi — vedi _somma_maremosso() in usali.py) — una singola cena reale
generava così 4-6 righe, gonfiando il conteggio di ~3x. Colazione (solo "Quota Colazione") e
CLB/INT (dove "cena"/"pranzo" contengono quasi solo "Quota Cena"/"Quota Pranzo") non erano
affetti, ma il bug avrebbe potuto ripresentarsi silenziosamente su qualunque nuova voce di menu
mappata in futuro senza questo flag esplicito.

Revision ID: prod006_2026
Revises: prenot008_2026
Create Date: 2026-09-21
"""
from alembic import op
import sqlalchemy as sa

revision = 'prod006_2026'
down_revision = 'prenot008_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('prod_dettaglio_categoria', sa.Column(
        'conta_come_pasto', sa.Boolean(), nullable=False, server_default='false',
    ))

    # Backfill: solo le righe "quota" (una per persona/pasto) contano — non i singoli piatti/
    # bevande/coperti mappati nella stessa categoria per il calcolo del ricavo.
    op.execute("""
        UPDATE prod_dettaglio_categoria
        SET conta_come_pasto = true
        WHERE lower(trim(dettaglio_originale)) IN ('quota colazione', 'quota pranzo', 'quota cena', 'colazione extra')
    """)


def downgrade():
    op.drop_column('prod_dettaglio_categoria', 'conta_come_pasto')
