"""Estende budget_entries con campi input/KPI calcolati; crea budget_config.

Revision ID: x4y5z6a7b8c9
Revises: w3x4y5z6a7b8
Create Date: 2026-05-25
"""

from alembic import op
import sqlalchemy as sa

revision = 'x4y5z6a7b8c9'
down_revision = 'w3x4y5z6a7b8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Estende budget_entries: 4 input manuali + KPI calcolati + metadati
    # ------------------------------------------------------------------

    # 4 input manuali (camere_vendute_budget = rooms_sold_budget già esiste)
    op.add_column('budget_entries', sa.Column('adr_budget', sa.Numeric(10, 2), nullable=True))
    op.add_column('budget_entries', sa.Column('pct_fnb_budget', sa.Numeric(5, 2), nullable=True, server_default='0'))
    op.add_column('budget_entries', sa.Column('pct_extra_budget', sa.Numeric(5, 2), nullable=True, server_default='0'))

    # Camere disponibili nella settimana (da hotel_seasons.total_rooms × 7)
    op.add_column('budget_entries', sa.Column('rooms_available_budget', sa.Integer(), nullable=True))

    # KPI calcolati automaticamente al salvataggio
    op.add_column('budget_entries', sa.Column('occupancy_budget', sa.Numeric(5, 4), nullable=True))
    op.add_column('budget_entries', sa.Column('revpar_budget', sa.Numeric(10, 2), nullable=True))
    op.add_column('budget_entries', sa.Column('trevpar_budget', sa.Numeric(10, 2), nullable=True))
    op.add_column('budget_entries', sa.Column('rmc_budget', sa.Numeric(10, 2), nullable=True))
    op.add_column('budget_entries', sa.Column('inc_rooms_budget', sa.Numeric(5, 4), nullable=True))
    op.add_column('budget_entries', sa.Column('inc_fnb_budget', sa.Numeric(5, 4), nullable=True))
    op.add_column('budget_entries', sa.Column('inc_extra_budget', sa.Numeric(5, 4), nullable=True))

    # Mese contabile (mese con più giorni nella settimana commerciale)
    op.add_column('budget_entries', sa.Column('mese_contabile', sa.Integer(), nullable=True))
    op.add_column('budget_entries', sa.Column('anno_contabile', sa.Integer(), nullable=True))

    # Metadati audit
    op.add_column('budget_entries', sa.Column(
        'updated_by', sa.Integer(),
        sa.ForeignKey('users.id', ondelete='SET NULL'),
        nullable=True,
    ))
    op.add_column('budget_entries', sa.Column(
        'updated_at', sa.DateTime(timezone=True),
        server_default=sa.text('now()'),
        nullable=True,
    ))

    # ------------------------------------------------------------------
    # Nuova tabella budget_config — parametri per hotel/anno/versione
    # ------------------------------------------------------------------
    op.create_table(
        'budget_config',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('hotel_id', sa.Integer(), sa.ForeignKey('hotels.id'), nullable=True),
        sa.Column('season_year', sa.Integer(), nullable=False),
        sa.Column('version', sa.String(20), nullable=False, server_default='v1'),
        sa.Column('costo_pasto', sa.Numeric(8, 2), nullable=True),
        sa.Column('costo_colazione', sa.Numeric(8, 2), nullable=True),
        sa.Column('altro_rev_presenza', sa.Numeric(8, 2), nullable=True),
        sa.Column('notti_medie_soggiorno', sa.Numeric(4, 2), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.UniqueConstraint('hotel_id', 'season_year', 'version', name='uq_budget_config'),
    )
    op.create_index('ix_budget_config_hotel_id', 'budget_config', ['hotel_id'])


def downgrade() -> None:
    op.drop_index('ix_budget_config_hotel_id', table_name='budget_config')
    op.drop_table('budget_config')

    for col in [
        'adr_budget', 'pct_fnb_budget', 'pct_extra_budget',
        'rooms_available_budget',
        'occupancy_budget', 'revpar_budget', 'trevpar_budget', 'rmc_budget',
        'inc_rooms_budget', 'inc_fnb_budget', 'inc_extra_budget',
        'mese_contabile', 'anno_contabile',
        'updated_by', 'updated_at',
    ]:
        op.drop_column('budget_entries', col)
