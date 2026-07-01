"""rt001 — crea tabella rt_chiusure per Controllo RT.

Revision ID: rt001_2026
Revises: corrv4e_2026
Create Date: 2026-06-19
"""
from alembic import op
import sqlalchemy as sa

revision = 'rt001_2026'
down_revision = 'corrv4e_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'rt_chiusure',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('data_chiusura', sa.Date(), nullable=False),
        # RT1 = DPH+CLB (un'unica RT fisica), RT2 = INT
        sa.Column('rt_code', sa.String(10), nullable=False),
        # Totale giornaliero obbligatorio
        sa.Column('totale_giorno', sa.Numeric(12, 2), nullable=False),
        # Breakdown per natura IVA (opzionali — se non inseriti il confronto analitico non compare)
        sa.Column('totale_10', sa.Numeric(12, 2), nullable=True),      # arrangiamenti 10%
        sa.Column('totale_22', sa.Numeric(12, 2), nullable=True),      # shop 22%
        sa.Column('totale_ts', sa.Numeric(12, 2), nullable=True),      # tassa soggiorno esente
        sa.Column('totale_penali', sa.Numeric(12, 2), nullable=True),  # penali esente
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_by', sa.Integer(),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.Column('updated_by', sa.Integer(),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.UniqueConstraint('data_chiusura', 'rt_code', name='uq_rt_chiusura_data_codice'),
    )
    op.create_index('ix_rt_chiusure_data', 'rt_chiusure', ['data_chiusura'])


def downgrade():
    op.drop_index('ix_rt_chiusure_data', table_name='rt_chiusure')
    op.drop_table('rt_chiusure')
