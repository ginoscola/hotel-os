"""corrispettivi_v2 — redesign semplificato: solo SC e SCA, 2 tabelle

Revision ID: b8c9d0e1f2g3
Revises: a7b8c9d0e1f2
Create Date: 2026-06-10

Motivazione:
  Il modulo Corrispettivi originale era sovra-ingegnerizzato (12 tabelle).
  Il nuovo design si concentra su ciò che serve davvero per Fase 1:
  - Importa solo SC (ricevute fiscali) e SCA (ricevute di acconto)
  - Ignora CP (caparre) — sono movimenti trasparenti fino all'incasso
  - Tabella pivot per struttura × tipo_pagamento
  Fatture (F/FD) saranno aggiunte in Fase 2.
"""
from alembic import op
import sqlalchemy as sa


revision = 'b8c9d0e1f2g3'
down_revision = 'a7b8c9d0e1f2'
branch_labels = None
depends_on = None


def upgrade():
    # ── Rimuove le vecchie tabelle del modulo Corrispettivi ──────────────────
    op.drop_table('suspensions')
    op.drop_table('fiscal_documents')
    op.drop_table('fiscal_doc_imports')
    op.drop_table('stay_types')
    op.drop_table('struttura_prefissi')
    op.drop_table('vat_rates')
    op.drop_table('payment_types')
    op.drop_table('fiscal_doc_types')

    # ── Sessione di import (un record per PDF caricato) ──────────────────────
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

    # ── Singolo documento SC o SCA (un record per tipo_pagamento) ────────────
    # Pagamento doppio (split) genera due righe con lo stesso numero documento.
    op.create_table(
        'corrispettivi_documento',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('import_id', sa.Integer(),
                  sa.ForeignKey('corrispettivi_import.id', ondelete='CASCADE'), nullable=False),
        sa.Column('data', sa.Date(), nullable=False),
        sa.Column('tipo_doc', sa.String(10), nullable=False),   # SC o SCA
        sa.Column('numero', sa.Integer(), nullable=False),
        sa.Column('struttura_code', sa.String(10), nullable=True),  # DPH, CLB, INT
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


def downgrade():
    op.drop_index('ix_corr_doc_import', 'corrispettivi_documento')
    op.drop_index('ix_corr_doc_struttura', 'corrispettivi_documento')
    op.drop_index('ix_corr_doc_data', 'corrispettivi_documento')
    op.drop_table('corrispettivi_documento')
    op.drop_table('corrispettivi_import')

    # Ricrea le tabelle originali (schema minimale per compatibilità)
    op.create_table(
        'fiscal_doc_types',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(10), unique=True, nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('is_fiscale', sa.Boolean(), server_default='true'),
        sa.Column('attivo', sa.Boolean(), server_default='true'),
    )
    op.create_table(
        'payment_types',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(30), unique=True, nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
    )
    op.create_table(
        'vat_rates',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(10), unique=True, nullable=False),
        sa.Column('rate', sa.Numeric(5, 2), nullable=False),
    )
    op.create_table(
        'struttura_prefissi',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('prefisso', sa.String(20), nullable=False),
        sa.Column('struttura_code', sa.String(10), nullable=False),
        sa.Column('match_type', sa.String(20), nullable=False),
    )
    op.create_table(
        'stay_types',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(10), unique=True, nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
    )
    op.create_table(
        'fiscal_doc_imports',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('filename', sa.String(255), nullable=False),
        sa.Column('is_test', sa.Boolean(), server_default='false'),
    )
    op.create_table(
        'fiscal_documents',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('import_id', sa.Integer(),
                  sa.ForeignKey('fiscal_doc_imports.id', ondelete='CASCADE'), nullable=False),
        sa.Column('data', sa.Date(), nullable=False),
        sa.Column('tipo_doc', sa.String(10), nullable=False),
        sa.Column('numero', sa.Integer(), nullable=False),
        sa.Column('struttura_code', sa.String(10)),
    )
    op.create_table(
        'suspensions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('document_id', sa.Integer(),
                  sa.ForeignKey('fiscal_documents.id', ondelete='CASCADE'), nullable=False),
        sa.Column('importo', sa.Numeric(12, 2), nullable=False),
        sa.Column('stato', sa.String(20), nullable=False, server_default=sa.text("'da_incassare'")),
    )
