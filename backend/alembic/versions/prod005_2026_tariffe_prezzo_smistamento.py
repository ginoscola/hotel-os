"""prod005 — categorizzazione per prezzo (tariffa_riferimento) + nuove categorie per lo
smistamento di "Altro" (Spiaggia, Bar per tipo, Ricarica Auto) + split "Parcheggio extra".

Revision ID: prod005_2026
Revises: prod004_2026
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa

revision = 'prod005_2026'
down_revision = 'prod004_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('prod_categorie', sa.Column('tariffa_riferimento', sa.Numeric(6, 2), nullable=True))
    op.add_column('prod_dettaglio_categoria', sa.Column(
        'categoria_da_prezzo', sa.Boolean(), nullable=False, server_default='false',
    ))

    # Tariffe di riferimento (20€/notte Area Hotel, 13€/notte Area Esterna) — editabili da admin,
    # usate per assegnare "Parcheggio extra" in base al prezzo (multiplo esatto della tariffa),
    # non al testo.
    op.execute("UPDATE prod_categorie SET tariffa_riferimento = 20.00 WHERE code = 'parcheggio_hotel'")
    op.execute("UPDATE prod_categorie SET tariffa_riferimento = 13.00 WHERE code = 'parcheggio_esterno'")

    op.execute("""
        INSERT INTO prod_categorie (code, name, descrizione, includi_report, ordine) VALUES
        ('spiaggia',        'Spiaggia',            'Servizio Spiaggia',            true, 8),
        ('bar_alcolici',    'Bar - Alcolici',       'Bevande alcoliche al bar',     true, 9),
        ('bar_analcolici',  'Bar - Analcolici',     'Bevande analcoliche al bar',   true, 10),
        ('bar_caffetteria', 'Bar - Caffetteria',    'Caffetteria al bar',           true, 11),
        ('ricarica_auto',   'Ricarica Auto',        'Ricarica veicoli elettrici',   true, 12)
        ON CONFLICT (code) DO NOTHING
    """)

    op.execute("""
        INSERT INTO prod_dettaglio_categoria (dettaglio_originale, categoria_id)
        SELECT 'Servizio Spiaggia', id FROM prod_categorie WHERE code = 'spiaggia'
        UNION ALL
        SELECT 'Ricarica Auto', id FROM prod_categorie WHERE code = 'ricarica_auto'
    """)

    # "Parcheggio extra": categoria assegnata in base al prezzo (multiplo di 13 -> esterno,
    # altrimenti -> hotel, tariffa di fallback). categoria_id qui è il fallback se nessuna
    # tariffa combacia esattamente.
    op.execute("""
        INSERT INTO prod_dettaglio_categoria (dettaglio_originale, categoria_id, categoria_da_prezzo)
        SELECT 'Parcheggio extra', id, true FROM prod_categorie WHERE code = 'parcheggio_hotel'
    """)


def downgrade():
    op.execute("DELETE FROM prod_dettaglio_categoria WHERE dettaglio_originale IN "
               "('Servizio Spiaggia', 'Ricarica Auto', 'Parcheggio extra')")
    op.execute("DELETE FROM prod_categorie WHERE code IN "
               "('spiaggia', 'bar_alcolici', 'bar_analcolici', 'bar_caffetteria', 'ricarica_auto')")
    op.drop_column('prod_dettaglio_categoria', 'categoria_da_prezzo')
    op.drop_column('prod_categorie', 'tariffa_riferimento')
