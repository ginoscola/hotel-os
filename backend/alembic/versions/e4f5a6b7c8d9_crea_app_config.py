"""Crea tabella app_config e popola con valori di default

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-05-08
"""

from alembic import op
import sqlalchemy as sa

revision = 'e4f5a6b7c8d9'
down_revision = 'd3e4f5a6b7c8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'app_config',
        sa.Column('key', sa.String(100), primary_key=True),
        sa.Column('value', sa.Text(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
    )

    op.execute("""
        INSERT INTO app_config (key, value, description) VALUES
        ('week_start_weekday', '5',
         'Giorno di inizio settimana commerciale (0=lunedì, 5=sabato)'),
        ('anno_confronto_giorni_offset', '364',
         'Offset in giorni per allineare settimane anno precedente'),
        ('anno_confronto_tolleranza_giorni', '30',
         'Tolleranza in giorni per trovare snapshot anno precedente'),
        ('cors_origins', 'http://localhost:5173',
         'URL frontend autorizzato per CORS')
        ON CONFLICT (key) DO NOTHING
    """)


def downgrade() -> None:
    op.drop_table('app_config')
