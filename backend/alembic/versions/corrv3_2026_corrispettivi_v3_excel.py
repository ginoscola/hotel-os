"""corrispettivi_v3 — riscrittura completa: import da Excel, scontrini + fatture + manuali

Revision ID: corrv3_2026
Revises: b3c4d5e6f7a8
Create Date: 2026-06-17

Motivazione:
  Il modulo Corrispettivi viene riscritto per leggere il file Excel listaConti.xlsx
  esportato da Welcome PMS invece del vecchio PDF. Le tabelle sono separate per tipo
  documento (scontrini vs fatture) e aggiunta la gestione manuale per MMS/BON.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'corrv3_2026'
down_revision = 'b3c4d5e6f7a8'
branch_labels = None
depends_on = None


def upgrade():
    # ── Rimuove le vecchie tabelle v2 ────────────────────────────────────────
    op.drop_index('ix_corr_doc_import', table_name='corrispettivi_documento')
    op.drop_index('ix_corr_doc_struttura', table_name='corrispettivi_documento')
    op.drop_index('ix_corr_doc_data', table_name='corrispettivi_documento')
    op.drop_table('corrispettivi_documento')
    op.drop_table('corrispettivi_import')

    # ── corrispettivi_imports — sessioni di import ────────────────────────────
    op.create_table(
        'corrispettivi_imports',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('nome_file', sa.String(255), nullable=True),
        sa.Column('data_da', sa.Date(), nullable=False),
        sa.Column('data_a', sa.Date(), nullable=False),
        sa.Column('tipo_import', sa.String(20), nullable=False),  # 'excel' | 'manuale'
        sa.Column('strutture_presenti', postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column('n_scontrini', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('n_fatture', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('n_esclusi', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_test', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('imported_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )

    # ── corrispettivi_scontrini ───────────────────────────────────────────────
    op.create_table(
        'corrispettivi_scontrini',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
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
        sa.UniqueConstraint('numero', 'suffisso', 'struttura_code', 'data_documento',
                            name='uq_scontrino_doc'),
    )
    op.create_index('ix_sc_data', 'corrispettivi_scontrini', ['data_documento'])
    op.create_index('ix_sc_struttura', 'corrispettivi_scontrini', ['struttura_code'])
    op.create_index('ix_sc_import', 'corrispettivi_scontrini', ['import_id'])

    # ── corrispettivi_fatture ─────────────────────────────────────────────────
    op.create_table(
        'corrispettivi_fatture',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
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
        sa.UniqueConstraint('numero', 'suffisso', 'struttura_code', 'data_documento',
                            name='uq_fattura_doc'),
    )
    op.create_index('ix_ft_data', 'corrispettivi_fatture', ['data_documento'])
    op.create_index('ix_ft_struttura', 'corrispettivi_fatture', ['struttura_code'])
    op.create_index('ix_ft_import', 'corrispettivi_fatture', ['import_id'])

    # ── corrispettivi_manuali — MMS e BON (inserimento manuale) ──────────────
    op.create_table(
        'corrispettivi_manuali',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('data_giorno', sa.Date(), nullable=False),
        sa.Column('struttura_code', sa.String(20), nullable=False),
        sa.Column('arrangiamenti_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('is_test', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.UniqueConstraint('data_giorno', 'struttura_code', name='uq_manuale_giorno_struttura'),
    )

    # ── corrispettivi_daily_summary ───────────────────────────────────────────
    op.create_table(
        'corrispettivi_daily_summary',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('data_giorno', sa.Date(), nullable=False),
        sa.Column('struttura_code', sa.String(20), nullable=False),
        # Scontrini per categoria (lordo)
        sa.Column('sc_arrangiamenti_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('sc_tassa_soggiorno_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('sc_penali_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('sc_shop_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('sc_altro_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('sc_totale_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        # Fatture per categoria (lordo)
        sa.Column('f_arrangiamenti_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('f_tassa_soggiorno_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('f_penali_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('f_shop_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('f_altro_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('f_totale_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        # Manuali (MMS/BON)
        sa.Column('manuale_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        # Contatori
        sa.Column('n_scontrini', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('n_fatture', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('n_annullati', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('import_id', sa.Integer(),
                  sa.ForeignKey('corrispettivi_imports.id', ondelete='SET NULL'), nullable=True),
        sa.UniqueConstraint('data_giorno', 'struttura_code', name='uq_daily_summary'),
    )
    op.create_index('ix_ds_data', 'corrispettivi_daily_summary', ['data_giorno'])
    op.create_index('ix_ds_struttura', 'corrispettivi_daily_summary', ['struttura_code'])


def downgrade():
    op.drop_index('ix_ds_struttura', 'corrispettivi_daily_summary')
    op.drop_index('ix_ds_data', 'corrispettivi_daily_summary')
    op.drop_table('corrispettivi_daily_summary')
    op.drop_table('corrispettivi_manuali')
    op.drop_index('ix_ft_import', 'corrispettivi_fatture')
    op.drop_index('ix_ft_struttura', 'corrispettivi_fatture')
    op.drop_index('ix_ft_data', 'corrispettivi_fatture')
    op.drop_table('corrispettivi_fatture')
    op.drop_index('ix_sc_import', 'corrispettivi_scontrini')
    op.drop_index('ix_sc_struttura', 'corrispettivi_scontrini')
    op.drop_index('ix_sc_data', 'corrispettivi_scontrini')
    op.drop_table('corrispettivi_scontrini')
    op.drop_table('corrispettivi_imports')

    # Ricrea le tabelle v2 per compatibilità downgrade
    op.create_table(
        'corrispettivi_import',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('filename', sa.String(255), nullable=False),
        sa.Column('data_da', sa.Date(), nullable=True),
        sa.Column('data_a', sa.Date(), nullable=True),
        sa.Column('societa', sa.String(200), nullable=True),
        sa.Column('n_sc', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('n_sca', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('totale_incassato', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('is_test', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.create_table(
        'corrispettivi_documento',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('import_id', sa.Integer(),
                  sa.ForeignKey('corrispettivi_import.id', ondelete='CASCADE'), nullable=False),
        sa.Column('data', sa.Date(), nullable=False),
        sa.Column('tipo_doc', sa.String(10), nullable=False),
        sa.Column('numero', sa.Integer(), nullable=False),
        sa.Column('struttura_code', sa.String(10), nullable=True),
        sa.Column('camera', sa.String(50), nullable=True),
        sa.Column('intestazione', sa.String(200), nullable=True),
        sa.Column('incassato', sa.Numeric(12, 2), nullable=False),
        sa.Column('tipo_pagamento', sa.String(50), nullable=True),
        sa.Column('annullato', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('is_test', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.create_index('ix_corr_doc_data', 'corrispettivi_documento', ['data'])
    op.create_index('ix_corr_doc_struttura', 'corrispettivi_documento', ['struttura_code'])
    op.create_index('ix_corr_doc_import', 'corrispettivi_documento', ['import_id'])
