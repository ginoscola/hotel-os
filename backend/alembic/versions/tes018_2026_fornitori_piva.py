"""Tesoreria Fase 5: partita IVA del cedente ↔ codice fornitore Passcom.

Revision ID: tes018_2026
Revises: tes017_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'tes018_2026'
down_revision = 'tes017_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'tesoreria_fornitori_piva',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('piva', sa.String(30), nullable=False, unique=True),
        sa.Column('codice_fornitore', sa.String(20), nullable=False, index=True),
        sa.Column('fornitore', sa.String(200), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table('tesoreria_fornitori_piva')
