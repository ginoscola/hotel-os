"""Corrispettivi v4 — tabella analitica unificata corrispettivi_documenti.

Sostituisce corrispettivi_scontrini, corrispettivi_fatture e
corrispettivi_daily_summary con una tabella unica più una vista PostgreSQL.
corrispettivi_manuali rimane invariata.

Revision ID: corrv4_2026
Revises: corrv3_2026
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'corrv4_2026'
down_revision = 'corrv3_2026'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Rimuove le tabelle v3 (ordine rispetta le FK)
    op.drop_table('corrispettivi_daily_summary')
    op.drop_table('corrispettivi_scontrini')
    op.drop_table('corrispettivi_fatture')

    # Rimuove le relazioni FK dalla tabella import che non esistono più
    # (i relationship ORM gestiscono la nuova FK da corrispettivi_documenti)

    # Crea tabella analitica unificata
    op.create_table(
        'corrispettivi_documenti',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('import_id', sa.Integer(),
                  sa.ForeignKey('corrispettivi_imports.id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('data_documento', sa.Date(), nullable=False),
        sa.Column('numero', sa.Integer(), nullable=True),
        sa.Column('suffisso', sa.String(20), nullable=False, server_default=''),
        sa.Column('tipo', sa.String(20), nullable=False),
        sa.Column('struttura_code', sa.String(20), nullable=False),
        sa.Column('intestazione', sa.Text(), nullable=True),
        sa.Column('camera', sa.String(50), nullable=True),
        sa.Column('totale_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('incassato', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('deposito', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('sospeso', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('abbuono', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('imponibile', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('iva', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('aliquota_pct', sa.Numeric(5, 2), nullable=False, server_default='0'),
        sa.Column('categoria', sa.String(30), nullable=True),
        sa.Column('codice_prenotazione', sa.String(50), nullable=True),
        sa.Column('tipo_pagamento', sa.Text(), nullable=True),
        sa.Column('conto_anticipato', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('acconto', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('annullato', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('ospiti', sa.Text(), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('motivo_esclusione', sa.Text(), nullable=True),
        # Campi audit modifica manuale
        sa.Column('modificato_manualmente', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('totale_lordo_originale', sa.Numeric(12, 2), nullable=True),
        sa.Column('imponibile_originale', sa.Numeric(12, 2), nullable=True),
        sa.Column('iva_originale', sa.Numeric(12, 2), nullable=True),
        sa.Column('categoria_originale', sa.String(30), nullable=True),
        sa.Column('modifica_note', sa.Text(), nullable=True),
        sa.Column('modificato_da', sa.Integer(),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('modificato_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_test', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('struttura_code', 'data_documento', 'numero', 'suffisso',
                            name='uq_documento'),
    )

    # Indici per performance sui filtri più comuni
    op.create_index('ix_corr_doc_data', 'corrispettivi_documenti', ['data_documento'])
    op.create_index('ix_corr_doc_struttura', 'corrispettivi_documenti', ['struttura_code'])
    op.create_index('ix_corr_doc_tipo', 'corrispettivi_documenti', ['tipo'])
    op.create_index('ix_corr_doc_import', 'corrispettivi_documenti', ['import_id'])

    # Vista analitica per aggregazione giornaliera (SC + FT, non esclusi)
    op.execute("""
        CREATE OR REPLACE VIEW v_corrispettivi_daily AS
        SELECT
            data_documento,
            struttura_code,
            tipo,
            categoria,
            SUM(CASE WHEN NOT annullato THEN totale_lordo ELSE 0 END)  AS totale_lordo,
            SUM(CASE WHEN NOT annullato THEN imponibile   ELSE 0 END)  AS totale_imponibile,
            SUM(CASE WHEN NOT annullato THEN iva          ELSE 0 END)  AS totale_iva,
            COUNT(*) FILTER (WHERE NOT annullato) AS n_documenti,
            COUNT(*) FILTER (WHERE annullato)     AS n_annullati
        FROM corrispettivi_documenti
        WHERE tipo IN ('scontrino', 'fattura')
        GROUP BY data_documento, struttura_code, tipo, categoria
    """)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS v_corrispettivi_daily")

    op.drop_index('ix_corr_doc_import', table_name='corrispettivi_documenti')
    op.drop_index('ix_corr_doc_tipo', table_name='corrispettivi_documenti')
    op.drop_index('ix_corr_doc_struttura', table_name='corrispettivi_documenti')
    op.drop_index('ix_corr_doc_data', table_name='corrispettivi_documenti')
    op.drop_table('corrispettivi_documenti')

    # Ricrea le tabelle v3
    op.create_table(
        'corrispettivi_scontrini',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('import_id', sa.Integer(),
                  sa.ForeignKey('corrispettivi_imports.id', ondelete='SET NULL'), nullable=True),
        sa.Column('data_documento', sa.Date(), nullable=False),
        sa.Column('numero', sa.Integer(), nullable=True),
        sa.Column('suffisso', sa.String(20), nullable=True),
        sa.Column('struttura_code', sa.String(20), nullable=False),
        sa.Column('intestazione', sa.Text(), nullable=True),
        sa.Column('camera', sa.String(50), nullable=True),
        sa.Column('totale_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('incassato', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('deposito', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('sospeso', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('imponibile', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('iva', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('aliquota_pct', sa.Numeric(5, 2), nullable=False, server_default='0'),
        sa.Column('categoria', sa.String(30), nullable=True),
        sa.Column('codice_prenotazione', sa.String(50), nullable=True),
        sa.Column('annullato', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('modificato_manualmente', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('ospiti', sa.Text(), nullable=True),
        sa.Column('is_test', sa.Boolean(), nullable=False, server_default='false'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('numero', 'suffisso', 'struttura_code', 'data_documento',
                            name='uq_scontrino_doc'),
    )

    op.create_table(
        'corrispettivi_fatture',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('import_id', sa.Integer(),
                  sa.ForeignKey('corrispettivi_imports.id', ondelete='SET NULL'), nullable=True),
        sa.Column('data_documento', sa.Date(), nullable=False),
        sa.Column('numero', sa.Integer(), nullable=True),
        sa.Column('suffisso', sa.String(20), nullable=True),
        sa.Column('struttura_code', sa.String(20), nullable=False),
        sa.Column('intestazione', sa.Text(), nullable=True),
        sa.Column('camera', sa.String(50), nullable=True),
        sa.Column('totale_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('incassato', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('deposito', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('sospeso', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('imponibile', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('iva', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('aliquota_pct', sa.Numeric(5, 2), nullable=False, server_default='0'),
        sa.Column('categoria', sa.String(30), nullable=True),
        sa.Column('codice_prenotazione', sa.String(50), nullable=True),
        sa.Column('annullato', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('modificato_manualmente', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('ospiti', sa.Text(), nullable=True),
        sa.Column('is_test', sa.Boolean(), nullable=False, server_default='false'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('numero', 'suffisso', 'struttura_code', 'data_documento',
                            name='uq_fattura_doc'),
    )

    op.create_table(
        'corrispettivi_daily_summary',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('data_giorno', sa.Date(), nullable=False),
        sa.Column('struttura_code', sa.String(20), nullable=False),
        sa.Column('sc_arrangiamenti_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('sc_tassa_soggiorno_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('sc_penali_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('sc_shop_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('sc_altro_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('sc_totale_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('f_arrangiamenti_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('f_tassa_soggiorno_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('f_penali_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('f_shop_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('f_altro_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('f_totale_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('manuale_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('n_scontrini', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('n_fatture', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('n_annullati', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('import_id', sa.Integer(),
                  sa.ForeignKey('corrispettivi_imports.id', ondelete='SET NULL'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('data_giorno', 'struttura_code', name='uq_daily_summary'),
    )
