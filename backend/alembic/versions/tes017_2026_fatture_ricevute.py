"""Tesoreria Fase 5: fatture elettroniche ricevute (ZIP del portale AdE).

Revision ID: tes017_2026
Revises: att001_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'tes017_2026'
down_revision = 'att001_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'tesoreria_fatture_import',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('nome_file', sa.String(255), nullable=False),
        sa.Column('sha256', sa.String(64), nullable=False, index=True),
        sa.Column('percorso', sa.String(500), nullable=True),
        sa.Column('n_file', sa.Integer, nullable=False, server_default='0'),
        sa.Column('n_nuove', sa.Integer, nullable=False, server_default='0'),
        sa.Column('n_presenti', sa.Integer, nullable=False, server_default='0'),
        sa.Column('n_errori', sa.Integer, nullable=False, server_default='0'),
        sa.Column('ricezione_da', sa.Date, nullable=True),
        sa.Column('ricezione_a', sa.Date, nullable=True),
        sa.Column('errori', sa.JSON, nullable=True),
        sa.Column('avvisi', sa.JSON, nullable=True),
        sa.Column('note', sa.Text, nullable=True),
        sa.Column('utente_id', sa.Integer, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        'tesoreria_fatture',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('import_id', sa.Integer, sa.ForeignKey('tesoreria_fatture_import.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('impronta', sa.String(80), nullable=False, unique=True),
        sa.Column('id_sdi', sa.String(30), nullable=True),
        sa.Column('nome_file', sa.String(255), nullable=False),
        sa.Column('data_ricezione', sa.DateTime(timezone=True), nullable=True, index=True),
        sa.Column('cedente_paese', sa.String(2), nullable=True),
        sa.Column('cedente_piva', sa.String(30), nullable=True, index=True),
        sa.Column('cedente_cf', sa.String(30), nullable=True),
        sa.Column('cedente_denominazione', sa.String(200), nullable=False),
        sa.Column('tipo_documento', sa.String(4), nullable=False),
        sa.Column('numero', sa.String(40), nullable=False),
        sa.Column('data_documento', sa.Date, nullable=False),
        sa.Column('divisa', sa.String(3), nullable=False, server_default='EUR'),
        sa.Column('totale', sa.Numeric(14, 2), nullable=False),
        sa.Column('totale_calcolato', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('imponibile', sa.Numeric(14, 2), nullable=False),
        sa.Column('imposta', sa.Numeric(14, 2), nullable=False),
        sa.Column('ritenuta', sa.Numeric(14, 2), nullable=True),
        sa.Column('causale', sa.Text, nullable=True),
        sa.Column('fatture_collegate', sa.JSON, nullable=True),
        sa.Column('n_ddt', sa.Integer, nullable=False, server_default='0'),
        sa.Column('ha_allegati', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('xml', sa.Text, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_tesoreria_fatture_doc', 'tesoreria_fatture', ['cedente_piva', 'numero', 'data_documento'])
    op.create_table(
        'tesoreria_fatture_iva',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('fattura_id', sa.Integer, sa.ForeignKey('tesoreria_fatture.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('aliquota', sa.Numeric(6, 2), nullable=False),
        sa.Column('natura', sa.String(10), nullable=True),
        sa.Column('imponibile', sa.Numeric(14, 2), nullable=False),
        sa.Column('imposta', sa.Numeric(14, 2), nullable=False),
        sa.Column('esigibilita', sa.String(1), nullable=True),
        sa.Column('riferimento_normativo', sa.String(100), nullable=True),
    )
    op.create_table(
        'tesoreria_fatture_scadenze',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('fattura_id', sa.Integer, sa.ForeignKey('tesoreria_fatture.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('numero_rata', sa.Integer, nullable=False),
        sa.Column('condizioni', sa.String(4), nullable=True),
        sa.Column('modalita', sa.String(4), nullable=True),
        sa.Column('data_scadenza', sa.Date, nullable=True, index=True),
        sa.Column('importo', sa.Numeric(14, 2), nullable=True),
        sa.Column('iban', sa.String(34), nullable=True),
    )


def downgrade():
    op.drop_table('tesoreria_fatture_scadenze')
    op.drop_table('tesoreria_fatture_iva')
    op.drop_index('ix_tesoreria_fatture_doc', 'tesoreria_fatture')
    op.drop_table('tesoreria_fatture')
    op.drop_table('tesoreria_fatture_import')
