"""crea_modulo_forecast

Revision ID: z6a7b8c9d0e1
Revises: y5z6a7b8c9d0
Create Date: 2026-06-09

Tabelle create:
  - forecast_snapshots   : OTB aggregato per mese, per ogni upload CSV
  - forecast_budget      : Budget mensile per hotel/anno/mese
  - forecast_pickup_config : Pickup rate mensile (% incremento OTB → forecast)

Inserisce anche il modulo 'forecast' nella tabella modules.
"""
from alembic import op
import sqlalchemy as sa


revision = 'z6a7b8c9d0e1'
down_revision = 'y5z6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade():
    # ----- forecast_snapshots -----
    op.create_table(
        'forecast_snapshots',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('snapshot_date', sa.Date(), nullable=False),
        sa.Column('hotel_id', sa.Integer(),
                  sa.ForeignKey('hotels.id', ondelete='CASCADE'), nullable=False),
        sa.Column('source', sa.String(50), nullable=False, server_default=sa.text("'otb_csv'")),
        sa.Column('mese', sa.Date(), nullable=False),          # primo giorno del mese
        sa.Column('otb_revenue', sa.Numeric(12, 2), nullable=False, server_default=sa.text('0')),
        sa.Column('otb_room_nights', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('note', sa.Text(), nullable=True),
    )
    op.create_unique_constraint(
        'uq_forecast_snapshot_hotel_data_mese',
        'forecast_snapshots',
        ['hotel_id', 'snapshot_date', 'mese'],
    )

    # ----- forecast_budget -----
    op.create_table(
        'forecast_budget',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('hotel_id', sa.Integer(),
                  sa.ForeignKey('hotels.id', ondelete='CASCADE'), nullable=False),
        sa.Column('anno', sa.Integer(), nullable=False),
        sa.Column('mese', sa.Integer(), nullable=False),       # 1-12
        sa.Column('budget_revenue', sa.Numeric(12, 2), nullable=False, server_default=sa.text('0')),
        sa.Column('budget_room_nights', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    op.create_unique_constraint(
        'uq_forecast_budget_hotel_anno_mese',
        'forecast_budget',
        ['hotel_id', 'anno', 'mese'],
    )

    # ----- forecast_pickup_config -----
    op.create_table(
        'forecast_pickup_config',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('hotel_id', sa.Integer(),
                  sa.ForeignKey('hotels.id', ondelete='CASCADE'), nullable=False),
        sa.Column('anno', sa.Integer(), nullable=False),
        sa.Column('mese', sa.Integer(), nullable=False),       # 1-12
        sa.Column('pickup_rate', sa.Numeric(6, 4), nullable=False),  # es. 0.15 = +15%
        sa.Column('note', sa.Text(), nullable=True),
    )
    op.create_unique_constraint(
        'uq_forecast_pickup_hotel_anno_mese',
        'forecast_pickup_config',
        ['hotel_id', 'anno', 'mese'],
    )

    # ----- Modulo forecast in modules + permissions -----
    op.execute(sa.text("""
        INSERT INTO modules (code, name, description, icon, route, ordine, attivo, colore)
        VALUES ('forecast', 'Forecast & OTB', 'On The Books e proiezioni revenue',
                '📈', '/forecast', 25, true, '#8B5CF6')
        ON CONFLICT (code) DO NOTHING
    """))
    op.execute(sa.text("""
        INSERT INTO module_permissions (module_code, ruolo, puo_vedere, puo_modificare, puo_importare)
        VALUES
            ('forecast', 'admin',  true, true,  true),
            ('forecast', 'viewer', true, false, false)
        ON CONFLICT (module_code, ruolo) DO NOTHING
    """))


def downgrade():
    op.execute(sa.text("DELETE FROM module_permissions WHERE module_code = 'forecast'"))
    op.execute(sa.text("DELETE FROM modules WHERE code = 'forecast'"))
    op.drop_table('forecast_pickup_config')
    op.drop_table('forecast_budget')
    op.drop_table('forecast_snapshots')
