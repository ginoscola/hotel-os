"""Tesoreria Fase 2: fotografie dello scadenzario fornitori Passcom e relative scadenze.

Solo tabelle, nessun dato. Vedi `app/models/tesoreria.py` (TesoreriaScadImport, TesoreriaScadenza).

Revision ID: tes005_2026
Revises: tes004_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'tes005_2026'
down_revision = 'tes004_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'tesoreria_scad_import',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('data_fotografia', sa.Date, nullable=False, index=True),
        sa.Column('data_stampa', sa.Date, nullable=True),
        sa.Column('nome_file', sa.String(255), nullable=False),
        sa.Column('sha256', sa.String(64), nullable=False, index=True),
        sa.Column('percorso', sa.String(500), nullable=True),
        sa.Column('n_righe', sa.Integer, nullable=False, server_default='0'),
        sa.Column('totale', sa.Numeric(14, 2), nullable=False, server_default='0'),
        sa.Column('scadenza_da', sa.Date, nullable=True),
        sa.Column('scadenza_a', sa.Date, nullable=True),
        sa.Column('avvisi', sa.JSON, nullable=True),
        sa.Column('note', sa.Text, nullable=True),
        sa.Column('utente_id', sa.Integer, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        'tesoreria_scadenze',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('import_id', sa.Integer, sa.ForeignKey('tesoreria_scad_import.id', ondelete='CASCADE'), nullable=False),
        sa.Column('chiave', sa.String(160), nullable=False),
        sa.Column('data_scadenza', sa.Date, nullable=False),
        sa.Column('tipo_pagamento', sa.String(20), nullable=False),
        sa.Column('pareggio', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('tipo_documento', sa.String(5), nullable=True),
        sa.Column('registro', sa.String(5), nullable=True),
        sa.Column('numero_documento', sa.String(30), nullable=True),
        sa.Column('data_documento', sa.Date, nullable=True),
        sa.Column('data_registrazione', sa.Date, nullable=True),
        sa.Column('protocollo', sa.String(40), nullable=True),
        sa.Column('codice_fornitore', sa.String(20), nullable=False),
        sa.Column('fornitore', sa.String(200), nullable=False),
        sa.Column('importo', sa.Numeric(14, 2), nullable=False),
        sa.Column('descrizione', sa.Text, nullable=True),
        sa.UniqueConstraint('import_id', 'chiave', name='uq_tesoreria_scadenza_import_chiave'),
    )
    op.create_index('ix_tesoreria_scadenze_chiave', 'tesoreria_scadenze', ['chiave'])
    op.create_index('ix_tesoreria_scadenze_fornitore', 'tesoreria_scadenze', ['codice_fornitore'])


def downgrade():
    op.drop_index('ix_tesoreria_scadenze_fornitore', table_name='tesoreria_scadenze')
    op.drop_index('ix_tesoreria_scadenze_chiave', table_name='tesoreria_scadenze')
    op.drop_table('tesoreria_scadenze')
    op.drop_table('tesoreria_scad_import')
