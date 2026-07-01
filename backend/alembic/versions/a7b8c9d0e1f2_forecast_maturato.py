"""forecast_maturato — rimuove forecast_snapshots, aggiunge inserimento manuale maturato

Revision ID: a7b8c9d0e1f2
Revises: z6a7b8c9d0e1
Create Date: 2026-06-10

Motivazione:
  La tabella forecast_snapshots era un duplicato del caricamento CSV già presente
  nel modulo Revenue. L'OTB viene ora calcolato direttamente da daily_revenue
  (ogni upload settimanale crea un'istantanea implicita con snapshot_date).

  forecast_maturato permette di inserire manualmente il maturato confermato
  al giorno X per un hotel/mese, come override del dato calcolato.
"""
from alembic import op
import sqlalchemy as sa


revision = 'a7b8c9d0e1f2'
down_revision = 'z6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade():
    # Rimuove la tabella forecast_snapshots (sostituita da daily_revenue)
    op.drop_table('forecast_snapshots')

    # Maturato manuale: revenue confermata al giorno X per hotel/mese
    op.create_table(
        'forecast_maturato',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('hotel_id', sa.Integer(),
                  sa.ForeignKey('hotels.id', ondelete='CASCADE'), nullable=False),
        sa.Column('anno', sa.Integer(), nullable=False),
        sa.Column('mese', sa.Integer(), nullable=False),            # 1-12
        sa.Column('data_riferimento', sa.Date(), nullable=False),   # "al giorno X"
        sa.Column('maturato_revenue', sa.Numeric(12, 2), nullable=False),
        sa.Column('maturato_room_nights', sa.Integer(), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    op.create_unique_constraint(
        'uq_forecast_maturato_hotel_anno_mese',
        'forecast_maturato',
        ['hotel_id', 'anno', 'mese'],
    )


def downgrade():
    op.drop_table('forecast_maturato')

    # Ricrea forecast_snapshots
    op.create_table(
        'forecast_snapshots',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('snapshot_date', sa.Date(), nullable=False),
        sa.Column('hotel_id', sa.Integer(),
                  sa.ForeignKey('hotels.id', ondelete='CASCADE'), nullable=False),
        sa.Column('source', sa.String(50), nullable=False, server_default=sa.text("'otb_csv'")),
        sa.Column('mese', sa.Date(), nullable=False),
        sa.Column('otb_revenue', sa.Numeric(12, 2), nullable=False, server_default=sa.text('0')),
        sa.Column('otb_room_nights', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('note', sa.Text(), nullable=True),
    )
    op.create_unique_constraint(
        'uq_forecast_snapshot_hotel_data_mese',
        'forecast_snapshots',
        ['hotel_id', 'snapshot_date', 'mese'],
    )
