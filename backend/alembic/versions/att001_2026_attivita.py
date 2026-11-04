"""Attività ricorrenti: spunte fatte a mano.

Revision ID: att001_2026
Revises: tes016_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'att001_2026'
down_revision = 'tes016_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'attivita_fatte',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('codice', sa.String(40), nullable=False),
        sa.Column('scadenza', sa.Date, nullable=False),
        sa.Column('utente_id', sa.Integer, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('codice', 'scadenza', name='uq_attivita_fatta'),
    )


def downgrade():
    op.drop_table('attivita_fatte')
