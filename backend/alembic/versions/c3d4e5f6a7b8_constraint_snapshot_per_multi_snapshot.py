"""Cambia constraint unique daily_revenue da (hotel_code, data) a (hotel_code, data, snapshot_date)

Senza questo fix ogni nuova snapshot sovrascrive la precedente:
ON CONFLICT su (hotel_code, data) aggiorna sempre la stessa riga,
perdendo tutte le snapshot tranne l'ultima.

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-05-07 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Rimuove il vecchio constraint che causava la sovrascrittura delle snapshot
    op.drop_constraint('uq_hotel_data', 'daily_revenue', type_='unique')
    # Aggiunge il nuovo constraint che permette più snapshot per la stessa data
    op.create_unique_constraint(
        'uq_hotel_data_snapshot',
        'daily_revenue',
        ['hotel_code', 'data', 'snapshot_date'],
    )


def downgrade() -> None:
    op.drop_constraint('uq_hotel_data_snapshot', 'daily_revenue', type_='unique')
    op.create_unique_constraint(
        'uq_hotel_data',
        'daily_revenue',
        ['hotel_code', 'data'],
    )
