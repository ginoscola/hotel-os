"""Rende snapshot_date NOT NULL in daily_revenue

Per le righe esistenti con snapshot_date NULL:
  - usa created_at dalla tabella imports (stessa hotel_code, più recente) se disponibile
  - altrimenti CURRENT_DATE
Nota: daily_revenue non ha una colonna created_at propria.

Revision ID: d3e4f5a6b7c8
Revises: c3d4e5f6a7b8
Create Date: 2026-05-07 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd3e4f5a6b7c8'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aggiorna le righe con snapshot_date NULL.
    # Tenta prima di ricavare la data dall'ultima sessione di import per lo stesso hotel;
    # se nessuna sessione esiste usa CURRENT_DATE come fallback.
    op.execute("""
        UPDATE daily_revenue dr
        SET snapshot_date = COALESCE(
            (
                SELECT DATE(i.created_at)
                FROM imports i
                WHERE i.hotel_code = dr.hotel_code
                  AND i.created_at IS NOT NULL
                ORDER BY i.created_at DESC
                LIMIT 1
            ),
            CURRENT_DATE
        )
        WHERE dr.snapshot_date IS NULL
    """)

    op.alter_column(
        'daily_revenue',
        'snapshot_date',
        existing_type=sa.Date(),
        nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        'daily_revenue',
        'snapshot_date',
        existing_type=sa.Date(),
        nullable=True,
    )
