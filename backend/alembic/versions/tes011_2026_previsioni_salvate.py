"""Tesoreria Fase 3, blocco D: previsioni salvate, fatture collegate agli interventi. Solo tabelle.

Revision ID: tes011_2026
Revises: tes010_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'tes011_2026'
down_revision = 'tes010_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'tesoreria_previsioni_salvate',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('data_riferimento', sa.Date, nullable=False),
        sa.Column('nota', sa.String(255), nullable=True),
        sa.Column('dati', sa.JSON, nullable=False),
        sa.Column('utente_id', sa.Integer, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        'tesoreria_intervento_scadenze',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('intervento_id', sa.Integer, sa.ForeignKey('tesoreria_interventi.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('chiave', sa.String(160), nullable=False, unique=True),
        sa.Column('fornitore', sa.String(200), nullable=False),
        sa.Column('data_scadenza', sa.Date, nullable=False),
        sa.Column('numero_documento', sa.String(30), nullable=True),
        sa.Column('importo', sa.Numeric(14, 2), nullable=False),
    )


def downgrade():
    op.drop_table('tesoreria_intervento_scadenze')
    op.drop_table('tesoreria_previsioni_salvate')
