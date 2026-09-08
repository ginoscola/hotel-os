"""Cassa contante reale: saldo iniziale, versamenti in banca, rettifiche.

Il vero scopo della tab 'Tipo Incasso': sapere quanto contante fisico ha in mano
l'hotel = saldo iniziale + contante incassato (riga 'Contante' di _calcola_pagamenti,
DPH/CLB/INT + MMS/BON) - versamenti in banca ± rettifiche (spese in contanti, prelievi,
ammanchi, resti). Gestione a livello di gruppo (un unico saldo, nessuno scorporo per
struttura).

Tabella `cassa_movimenti`:
  - tipo='saldo_iniziale' : contante in cassa al 1° del mese indicato (baseline positiva).
                            `data` è sempre il 1° del mese (validato nell'endpoint).
  - tipo='versamento'      : importo versato in banca (positivo, SOTTRATTO dalla cassa).
  - tipo='rettifica'       : aggiustamento con segno (negativo = spesa/prelievo in
                            contanti, positivo = contante immesso in cassa).

Revision ID: corrfix005_2026
Revises: corrfix004_2026
Create Date: 2026-09-08
"""
import sqlalchemy as sa
from alembic import op

revision = 'corrfix005_2026'
down_revision = 'corrfix004_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'cassa_movimenti',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('tipo', sa.String(20), nullable=False),   # saldo_iniziale | versamento | rettifica
        sa.Column('data', sa.Date(), nullable=False),
        sa.Column('importo', sa.Numeric(12, 2), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('is_test', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('ix_cassa_movimenti_data', 'cassa_movimenti', ['data'])


def downgrade():
    op.drop_index('ix_cassa_movimenti_data', table_name='cassa_movimenti')
    op.drop_table('cassa_movimenti')
