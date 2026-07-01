"""ar001 — crea tabelle analisi_ricavi (trattamenti, reparti, classificazione).

Revision ID: ar001_2026
Revises: rt001_2026
Create Date: 2026-06-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY

revision = 'ar001_2026'
down_revision = 'rt001_2026'
branch_labels = None
depends_on = None


def upgrade():
    # Mapping globale codici trattamento → nome display + categoria
    op.create_table(
        'trattamenti_classificazione',
        sa.Column('codice', sa.String(50), primary_key=True),
        sa.Column('nome_display', sa.String(100), nullable=False),
        sa.Column('categoria', sa.String(50), nullable=True),
        sa.Column('escludi', sa.Boolean(), nullable=False, default=False,
                  server_default='false'),
        sa.Column('ordine', sa.Integer(), nullable=False, default=0,
                  server_default='0'),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # Sessioni di import (una per hotel/mese)
    op.create_table(
        'analisi_ricavi_imports',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('hotel_id', sa.Integer(),
                  sa.ForeignKey('hotels.id', ondelete='CASCADE'), nullable=False),
        sa.Column('anno', sa.Integer(), nullable=False),
        sa.Column('mese', sa.Integer(), nullable=False),
        # Campo per futura espansione a granularità settimanale
        sa.Column('granularita', sa.String(20), nullable=False,
                  server_default='mensile'),
        sa.Column('settimana_inizio', sa.Date(), nullable=True),
        sa.Column('filename_trattamenti', sa.String(255), nullable=True),
        sa.Column('filename_reparti', sa.String(255), nullable=True),
        sa.Column('n_trattamenti', sa.Integer(), nullable=False, default=0),
        sa.Column('n_reparti', sa.Integer(), nullable=False, default=0),
        sa.Column('is_test', sa.Boolean(), nullable=False, default=False,
                  server_default='false'),
        sa.Column('created_by', sa.Integer(),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.UniqueConstraint('hotel_id', 'anno', 'mese', 'granularita',
                            name='uq_analisi_ricavi_hotel_mese'),
    )

    # Ricavi per trattamento (listino)
    op.create_table(
        'analisi_ricavi_trattamenti',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('import_id', sa.Integer(),
                  sa.ForeignKey('analisi_ricavi_imports.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('hotel_id', sa.Integer(),
                  sa.ForeignKey('hotels.id', ondelete='CASCADE'), nullable=False),
        sa.Column('anno', sa.Integer(), nullable=False),
        sa.Column('mese', sa.Integer(), nullable=False),
        sa.Column('codice', sa.String(50), nullable=False),
        sa.Column('valore', sa.Numeric(12, 2), nullable=False),
        sa.Column('modificato_manualmente', sa.Boolean(), nullable=False,
                  default=False, server_default='false'),
        sa.Column('valore_originale', sa.Numeric(12, 2), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.UniqueConstraint('hotel_id', 'anno', 'mese', 'codice',
                            name='uq_analisi_trattamento_hotel_mese_codice'),
    )

    # Ricavi per reparto
    op.create_table(
        'analisi_ricavi_reparti',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('import_id', sa.Integer(),
                  sa.ForeignKey('analisi_ricavi_imports.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('hotel_id', sa.Integer(),
                  sa.ForeignKey('hotels.id', ondelete='CASCADE'), nullable=False),
        sa.Column('anno', sa.Integer(), nullable=False),
        sa.Column('mese', sa.Integer(), nullable=False),
        sa.Column('reparto', sa.String(100), nullable=False),
        sa.Column('valore', sa.Numeric(12, 2), nullable=False),
        sa.Column('modificato_manualmente', sa.Boolean(), nullable=False,
                  default=False, server_default='false'),
        sa.Column('valore_originale', sa.Numeric(12, 2), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.UniqueConstraint('hotel_id', 'anno', 'mese', 'reparto',
                            name='uq_analisi_reparto_hotel_mese_reparto'),
    )

    op.create_index('ix_analisi_trattamenti_hotel_mese', 'analisi_ricavi_trattamenti',
                    ['hotel_id', 'anno', 'mese'])
    op.create_index('ix_analisi_reparti_hotel_mese', 'analisi_ricavi_reparti',
                    ['hotel_id', 'anno', 'mese'])

    # Dati di default per le classificazioni più comuni
    op.execute("""
        INSERT INTO trattamenti_classificazione (codice, nome_display, categoria, escludi, ordine) VALUES
        ('RO',      'Solo Camera',         'RO',  false, 1),
        ('BB',      'B&B',                 'BB',  false, 2),
        ('OTA-BB',  'B&B (OTA)',           'BB',  false, 3),
        ('HB',      'Mezza Pensione',      'HB',  false, 4),
        ('HB+',     'Mezza Pensione Plus', 'HB',  false, 5),
        ('FB',      'Pensione Completa',   'FB',  false, 6),
        ('AI',      'All Inclusive',       'AI',  false, 7),
        ('Non Def', 'Non Definito',        NULL,  true,  99)
        ON CONFLICT (codice) DO NOTHING
    """)


def downgrade():
    op.drop_index('ix_analisi_reparti_hotel_mese', table_name='analisi_ricavi_reparti')
    op.drop_index('ix_analisi_trattamenti_hotel_mese', table_name='analisi_ricavi_trattamenti')
    op.drop_table('analisi_ricavi_reparti')
    op.drop_table('analisi_ricavi_trattamenti')
    op.drop_table('analisi_ricavi_imports')
    op.drop_table('trattamenti_classificazione')
