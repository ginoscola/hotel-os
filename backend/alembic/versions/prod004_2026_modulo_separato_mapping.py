"""prod004 — modulo 'Statistiche Produzione' separato da USALI + mapping dettaglio->categoria
non hardcoded (sostituisce il dizionario Python fisso) + split parcheggio Hotel/Esterno.

Revision ID: prod004_2026
Revises: prod003_2026
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = 'prod004_2026'
down_revision = 'prod003_2026'
branch_labels = None
depends_on = None


def upgrade():
    # ── Mapping testo Welcome -> categoria, editabile da admin (sostituisce
    # ARTICOLO_A_CATEGORIA hardcoded in prod_parser.py) ────────────────────────
    op.create_table(
        'prod_dettaglio_categoria',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('dettaglio_originale', sa.String(200), nullable=False),
        sa.Column('categoria_id', sa.Integer(),
                  sa.ForeignKey('prod_categorie.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    # Case-insensitive: "Parcheggio Area Hotel" e "Parcheggio area hotel" sono lo stesso mapping
    op.execute("""
        CREATE UNIQUE INDEX uq_prod_dettaglio_categoria_lower
        ON prod_dettaglio_categoria (lower(dettaglio_originale))
    """)

    # ── Split parcheggio: due categorie al posto di una con sotto-tipo interno ──
    op.execute("""
        INSERT INTO prod_categorie (code, name, descrizione, includi_report, ordine) VALUES
        ('parcheggio_hotel',   'Parcheggio Hotel',   'Parcheggio Area Hotel',       true, 6),
        ('parcheggio_esterno', 'Parcheggio Esterno', 'Parcheggio Area Campoquadro', true, 7)
        ON CONFLICT (code) DO NOTHING
    """)
    # La vecchia categoria generica 'parcheggio' non serve più: disattivata, non cancellata
    # (eventuali righe già importate che la referenziano restano leggibili).
    op.execute("UPDATE prod_categorie SET attivo = false WHERE code = 'parcheggio'")

    # Seed iniziale del mapping (stesse voci prima hardcoded in ARTICOLO_A_CATEGORIA).
    # Il match a parse-time è case-insensitive (indice su lower()), quindi "Parcheggio Area
    # Hotel" e "Parcheggio area hotel" (variante reale nel file) risolvono sulla stessa riga
    # senza bisogno di duplicarla.
    op.execute("""
        INSERT INTO prod_dettaglio_categoria (dettaglio_originale, categoria_id)
        SELECT v.dettaglio, c.id FROM (VALUES
            ('Quota Alloggio',               'alloggio'),
            ('Quota Colazione',              'colazione'),
            ('Quota Cena',                   'cena'),
            ('Quota Pranzo',                 'pranzo'),
            ('Colazione Extra',              'colazione_extra'),
            ('Riassetto',                    'altro'),
            ('Parcheggio Area Hotel',        'parcheggio_hotel'),
            ('Parcheggio Area Campoquadro',  'parcheggio_esterno')
        ) AS v(dettaglio, code)
        JOIN prod_categorie c ON c.code = v.code
    """)

    # ── Modulo separato in NavBar, tra Statistiche (revenue, ordine 1) e Budget ──
    op.execute("UPDATE modules SET ordine = ordine + 1 WHERE code IN ('budget', 'usali', 'dipendenti', 'corrispettivi')")
    op.execute("""
        INSERT INTO modules (code, name, description, icon, route, ordine, attivo, colore)
        VALUES ('produzione', 'STATISTICHE PRODUZIONE', 'Import analitico StatisticheProduzione.xlsx e report di produzione',
                '🏭', '/statistiche-produzione', 2, true, '#0891b2')
        ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
        INSERT INTO module_permissions (module_code, ruolo, puo_vedere, puo_modificare, puo_importare)
        VALUES
            ('produzione', 'admin',  true, true,  true),
            ('produzione', 'viewer', true, false, false)
        ON CONFLICT (module_code, ruolo) DO NOTHING
    """)


def downgrade():
    op.execute("DELETE FROM module_permissions WHERE module_code = 'produzione'")
    op.execute("DELETE FROM modules WHERE code = 'produzione'")
    op.execute("UPDATE modules SET ordine = ordine - 1 WHERE code IN ('budget', 'usali', 'dipendenti', 'corrispettivi')")

    op.execute("DELETE FROM prod_dettaglio_categoria")
    op.execute("UPDATE prod_categorie SET attivo = true WHERE code = 'parcheggio'")
    op.execute("DELETE FROM prod_categorie WHERE code IN ('parcheggio_hotel', 'parcheggio_esterno')")

    op.execute("DROP INDEX IF EXISTS uq_prod_dettaglio_categoria_lower")
    op.drop_table('prod_dettaglio_categoria')
