"""Crea tabella budget_entries per il budget settimanale hotel

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
Create Date: 2026-05-08
"""

from alembic import op
import sqlalchemy as sa

revision = 'f5a6b7c8d9e0'
down_revision = 'e4f5a6b7c8d9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'budget_entries',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('hotel_id', sa.Integer(), sa.ForeignKey('hotels.id'), nullable=True),
        sa.Column('season_year', sa.Integer(), nullable=False),
        sa.Column('week_start', sa.Date(), nullable=False),
        sa.Column('version', sa.String(20), nullable=False, server_default='v1'),
        sa.Column('rooms_sold_budget', sa.Integer(), nullable=True),
        sa.Column('revenue_rooms_budget', sa.Numeric(12, 2), nullable=True),
        sa.Column('revenue_fnb_budget', sa.Numeric(12, 2), nullable=True),
        sa.Column('revenue_extra_budget', sa.Numeric(12, 2), nullable=True),
        sa.Column('revenue_total_budget', sa.Numeric(12, 2), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.UniqueConstraint('hotel_id', 'season_year', 'week_start', 'version',
                            name='uq_budget_hotel_settimana'),
    )
    op.create_index('ix_budget_entries_hotel_id', 'budget_entries', ['hotel_id'])


def downgrade() -> None:
    op.drop_index('ix_budget_entries_hotel_id', table_name='budget_entries')
    op.drop_table('budget_entries')
