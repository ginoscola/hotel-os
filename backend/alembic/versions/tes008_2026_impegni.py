"""Tesoreria Fase 3, blocco A: impegni futuri (calendario fiscale, poi affitti, mutuo, interventi). Solo tabella.

Revision ID: tes008_2026
Revises: wave001_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'tes008_2026'
down_revision = 'wave001_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'tesoreria_impegni',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('codice', sa.String(80), nullable=False, unique=True),
        sa.Column('tipo', sa.String(20), nullable=False, index=True),
        sa.Column('fonte', sa.String(12), nullable=False),
        sa.Column('descrizione', sa.String(200), nullable=False),
        sa.Column('competenza', sa.String(20), nullable=True),
        sa.Column('data_scadenza', sa.Date, nullable=False, index=True),
        sa.Column('data_manuale', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('importo_stimato', sa.Numeric(14, 2), nullable=False, server_default='0'),
        sa.Column('importo_confermato', sa.Numeric(14, 2), nullable=True),
        sa.Column('base_stima', sa.String(255), nullable=True),
        sa.Column('compensabile', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('coperto_credito', sa.Numeric(14, 2), nullable=False, server_default='0'),
        sa.Column('stato', sa.String(12), nullable=False, server_default='stimato'),
        sa.Column('movimento_id', sa.Integer, sa.ForeignKey('tesoreria_movimenti.id', ondelete='SET NULL'),
                  nullable=True, index=True),
        sa.Column('abbinamento', sa.String(12), nullable=True),
        sa.Column('nota', sa.String(255), nullable=True),
        sa.Column('utente_id', sa.Integer, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table('tesoreria_impegni')
