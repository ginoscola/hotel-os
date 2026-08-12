"""prod001 — crea tabelle Statistiche Produzione (prod_categorie, prod_imports, prod_righe) + view.

Revision ID: prod001_2026
Revises: budgetfix001_2026
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY

revision = 'prod001_2026'
down_revision = 'budgetfix001_2026'
branch_labels = None
depends_on = None


def upgrade():
    # Categorie di ricavo — NON hardcoded, configurabili da admin
    op.create_table(
        'prod_categorie',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('code', sa.String(50), unique=True, nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('descrizione', sa.Text(), nullable=True),
        sa.Column('includi_report', sa.Boolean(), nullable=False, default=True,
                  server_default='true'),
        sa.Column('ordine', sa.Integer(), nullable=False, default=0, server_default='0'),
        sa.Column('colore', sa.String(7), nullable=True),
        sa.Column('attivo', sa.Boolean(), nullable=False, default=True, server_default='true'),
    )

    # Sessioni di import
    op.create_table(
        'prod_imports',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('nome_file', sa.String(255), nullable=False),
        sa.Column('data_da', sa.Date(), nullable=False),
        sa.Column('data_a', sa.Date(), nullable=False),
        sa.Column('strutture_presenti', ARRAY(sa.String()), nullable=True),
        sa.Column('n_righe_totali', sa.Integer(), nullable=False, default=0, server_default='0'),
        sa.Column('n_righe_valide', sa.Integer(), nullable=False, default=0, server_default='0'),
        sa.Column('n_righe_riassetto', sa.Integer(), nullable=False, default=0, server_default='0'),
        sa.Column('n_righe_escluse', sa.Integer(), nullable=False, default=0, server_default='0'),
        sa.Column('is_test', sa.Boolean(), nullable=False, default=False, server_default='false'),
        sa.Column('imported_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('data_da', 'data_a', 'nome_file', name='uq_prod_import'),
    )

    # Righe analitiche — ogni singolo addebito
    op.create_table(
        'prod_righe',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('import_id', sa.Integer(), sa.ForeignKey('prod_imports.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('data_riferimento', sa.Date(), nullable=False),
        sa.Column('data_arrivo', sa.Date(), nullable=True),
        sa.Column('data_partenza', sa.Date(), nullable=True),
        sa.Column('struttura_code', sa.String(20), nullable=False),
        sa.Column('camera', sa.String(50), nullable=True),
        sa.Column('tipo_camera', sa.String(100), nullable=True),
        sa.Column('categoria_id', sa.Integer(), sa.ForeignKey('prod_categorie.id'), nullable=True),
        sa.Column('descrizione', sa.String(100), nullable=True),
        sa.Column('sotto_descrizione', sa.String(100), nullable=True),
        sa.Column('dettaglio_originale', sa.String(200), nullable=True),
        sa.Column('is_riassetto', sa.Boolean(), nullable=False, default=False, server_default='false'),
        sa.Column('prezzo_lordo', sa.Numeric(12, 2), nullable=False, default=0, server_default='0'),
        sa.Column('prezzo_netto', sa.Numeric(12, 2), nullable=False, default=0, server_default='0'),
        sa.Column('imponibile', sa.Numeric(12, 2), nullable=False, default=0, server_default='0'),
        sa.Column('iva', sa.Numeric(12, 2), nullable=False, default=0, server_default='0'),
        sa.Column('aliquota_pct', sa.Numeric(5, 2), nullable=False, default=0, server_default='0'),
        sa.Column('quantita', sa.Integer(), nullable=False, default=1, server_default='1'),
        sa.Column('codice_prenotazione', sa.String(100), nullable=True),
        sa.Column('ospite', sa.String(200), nullable=True),
        sa.Column('trattamento', sa.String(100), nullable=True),
        sa.Column('canale', sa.String(100), nullable=True),
        sa.Column('segmento', sa.String(100), nullable=True),
        sa.Column('tipo_ospite', sa.String(100), nullable=True),
        sa.Column('is_test', sa.Boolean(), nullable=False, default=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('import_id', 'struttura_code', 'data_riferimento', 'camera',
                            'dettaglio_originale', 'ospite', 'prezzo_lordo',
                            name='uq_prod_riga_antiduplicati'),
    )

    op.create_index('ix_prod_righe_data_struttura', 'prod_righe',
                    ['data_riferimento', 'struttura_code'])
    op.create_index('ix_prod_righe_import', 'prod_righe', ['import_id'])

    # View di sola lettura per report/BI: esclude riassetto e categorie non incluse nei report.
    # NOTA: i router interni usano un helper ORM equivalente (produzione_shared._query_report)
    # per poter comporre filtri dinamici — tenere le due logiche sincronizzate.
    op.execute("""
        CREATE OR REPLACE VIEW v_prod_report AS
        SELECT r.*
        FROM prod_righe r
        JOIN prod_categorie c ON c.id = r.categoria_id
        WHERE r.is_riassetto = false
          AND c.includi_report = true
    """)

    # Categorie iniziali
    op.execute("""
        INSERT INTO prod_categorie (code, name, descrizione, includi_report, ordine) VALUES
        ('alloggio',         'Alloggio',           'Quota Alloggio',    true, 1),
        ('colazione',        'Colazione',          'Quota Colazione',   true, 2),
        ('cena',             'Cena',               'Quota Cena',        true, 3),
        ('pranzo',           'Pranzo',             'Quota Pranzo',      true, 4),
        ('colazione_extra',  'Colazione Extra',    'Colazione Extra',   true, 5),
        ('parcheggio',       'Parcheggio',         'Tutte le voci parcheggio', true, 6),
        ('altro',            'Altro',              'Tutto il resto non mappato', true, 99)
        ON CONFLICT (code) DO NOTHING
    """)


def downgrade():
    op.execute("DROP VIEW IF EXISTS v_prod_report")
    op.drop_index('ix_prod_righe_import', table_name='prod_righe')
    op.drop_index('ix_prod_righe_data_struttura', table_name='prod_righe')
    op.drop_table('prod_righe')
    op.drop_table('prod_imports')
    op.drop_table('prod_categorie')
