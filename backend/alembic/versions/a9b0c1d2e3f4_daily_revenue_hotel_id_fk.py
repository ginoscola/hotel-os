"""Aggiunge hotel_id FK in daily_revenue e la popola da hotels.code

Revision ID: a9b0c1d2e3f4
Revises: f5a6b7c8d9e0
Create Date: 2026-05-08
"""

from alembic import op
import sqlalchemy as sa

revision = 'a9b0c1d2e3f4'
down_revision = 'f5a6b7c8d9e0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Aggiunge la colonna nullable
    op.add_column('daily_revenue',
        sa.Column('hotel_id', sa.Integer(), nullable=True))

    # 2. Popola hotel_id per tutte le righe esistenti
    op.execute("""
        UPDATE daily_revenue dr
        SET hotel_id = h.id
        FROM hotels h
        WHERE h.code = dr.hotel_code
    """)

    # 3. Aggiunge FK (resta nullable per compatibilità con righe prive di hotel valido)
    op.create_foreign_key(
        'fk_daily_revenue_hotel',
        'daily_revenue', 'hotels',
        ['hotel_id'], ['id'],
    )
    op.create_index('ix_daily_revenue_hotel_id', 'daily_revenue', ['hotel_id'])


def downgrade() -> None:
    op.drop_index('ix_daily_revenue_hotel_id', table_name='daily_revenue')
    op.drop_constraint('fk_daily_revenue_hotel', 'daily_revenue', type_='foreignkey')
    op.drop_column('daily_revenue', 'hotel_id')
