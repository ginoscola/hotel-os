"""Tesoreria Fase 2: abbinamenti scadenze Passcom ↔ banca, scadenze pagate a mano, nomi dei fornitori
in banca imparati dalle conferme. Solo tabelle.

Revision ID: tes007_2026
Revises: tes006_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'tes007_2026'
down_revision = 'tes006_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'tesoreria_abbinamenti',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('stato', sa.String(12), nullable=False),
        sa.Column('regola', sa.String(20), nullable=False),
        sa.Column('nota', sa.String(255), nullable=True),
        sa.Column('codice_fornitore', sa.String(20), nullable=False, index=True),
        sa.Column('fornitore', sa.String(200), nullable=False),
        sa.Column('utente_id', sa.Integer, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('confermato_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        'tesoreria_abbinamento_scadenze',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('abbinamento_id', sa.Integer, sa.ForeignKey('tesoreria_abbinamenti.id', ondelete='CASCADE'), nullable=False),
        sa.Column('chiave', sa.String(160), nullable=False, index=True),
        sa.Column('data_scadenza', sa.Date, nullable=False),
        sa.Column('data_documento', sa.Date, nullable=True),
        sa.Column('numero_documento', sa.String(30), nullable=True),
        sa.Column('tipo_pagamento', sa.String(20), nullable=True),
        sa.Column('importo', sa.Numeric(14, 2), nullable=False),
        sa.UniqueConstraint('abbinamento_id', 'chiave', name='uq_tesoreria_abb_scadenza'),
    )
    op.create_table(
        'tesoreria_abbinamento_movimenti',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('abbinamento_id', sa.Integer, sa.ForeignKey('tesoreria_abbinamenti.id', ondelete='CASCADE'), nullable=False),
        sa.Column('movimento_id', sa.Integer, sa.ForeignKey('tesoreria_movimenti.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.UniqueConstraint('abbinamento_id', 'movimento_id', name='uq_tesoreria_abb_movimento'),
    )
    op.create_table(
        'tesoreria_pagate_manuali',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('chiave', sa.String(160), nullable=False, unique=True),
        sa.Column('data_pagamento', sa.Date, nullable=True),
        sa.Column('nota', sa.String(255), nullable=True),
        sa.Column('codice_fornitore', sa.String(20), nullable=False),
        sa.Column('fornitore', sa.String(200), nullable=False),
        sa.Column('data_scadenza', sa.Date, nullable=False),
        sa.Column('data_documento', sa.Date, nullable=True),
        sa.Column('numero_documento', sa.String(30), nullable=True),
        sa.Column('importo', sa.Numeric(14, 2), nullable=False),
        sa.Column('utente_id', sa.Integer, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        'tesoreria_fornitori_banca',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('codice_fornitore', sa.String(20), nullable=False),
        sa.Column('nome_banca', sa.String(200), nullable=False),
        sa.Column('nome_originale', sa.String(200), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('codice_fornitore', 'nome_banca', name='uq_tesoreria_fornitore_banca'),
    )


def downgrade():
    op.drop_table('tesoreria_fornitori_banca')
    op.drop_table('tesoreria_pagate_manuali')
    op.drop_table('tesoreria_abbinamento_movimenti')
    op.drop_table('tesoreria_abbinamento_scadenze')
    op.drop_table('tesoreria_abbinamenti')
