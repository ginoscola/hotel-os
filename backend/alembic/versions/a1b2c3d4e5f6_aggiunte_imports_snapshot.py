"""Aggiunte tabella imports e snapshot_date a daily_revenue

Revision ID: a1b2c3d4e5f6
Revises: 7f8d4d1d7212
Create Date: 2026-05-05 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '7f8d4d1d7212'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Aggiorna schema: allarga campi codice hotel, aggiunge snapshot_date e tabella imports."""

    # Allarga la colonna code di hotels da String(3) a String(20)
    op.alter_column(
        'hotels', 'code',
        existing_type=sa.String(length=3),
        type_=sa.String(length=20),
        existing_nullable=False,
    )

    # Allarga la colonna hotel_code di daily_revenue da String(3) a String(20)
    op.alter_column(
        'daily_revenue', 'hotel_code',
        existing_type=sa.String(length=3),
        type_=sa.String(length=20),
        existing_nullable=False,
    )

    # Aggiunge la colonna snapshot_date a daily_revenue (nullable per compatibilità dati esistenti)
    op.add_column(
        'daily_revenue',
        sa.Column('snapshot_date', sa.Date(), nullable=True),
    )

    # Crea la tabella imports per il registro delle sessioni di importazione
    op.create_table(
        'imports',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('hotel_code', sa.String(length=20), nullable=False),
        sa.Column('snapshot_date', sa.Date(), nullable=False),
        sa.Column('file1_nome', sa.String(length=255), nullable=True),
        sa.Column('file2_nome', sa.String(length=255), nullable=True),
        sa.Column('righe_lette', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('righe_inserite', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('righe_aggiornate', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('righe_scartate', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('anomalie', sa.JSON(), nullable=True),
        sa.Column('stato', sa.String(length=20), nullable=True, server_default='success'),
        sa.Column(
            'created_at',
            sa.DateTime(),
            server_default=sa.text('now()'),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('hotel_code', 'snapshot_date', name='uq_import_hotel_snapshot'),
    )


def downgrade() -> None:
    """Ripristina schema precedente: rimuove imports, snapshot_date e riduce lunghezza campi."""

    # Rimuove la tabella imports
    op.drop_table('imports')

    # Rimuove snapshot_date da daily_revenue
    op.drop_column('daily_revenue', 'snapshot_date')

    # Riduce hotel_code di daily_revenue a String(3)
    op.alter_column(
        'daily_revenue', 'hotel_code',
        existing_type=sa.String(length=20),
        type_=sa.String(length=3),
        existing_nullable=False,
    )

    # Riduce code di hotels a String(3)
    op.alter_column(
        'hotels', 'code',
        existing_type=sa.String(length=20),
        type_=sa.String(length=3),
        existing_nullable=False,
    )
