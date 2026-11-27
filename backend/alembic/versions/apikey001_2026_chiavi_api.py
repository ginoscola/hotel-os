"""Chiavi API per agenti AI (bot Grok, in futuro Claude): tabella api_keys (v4.38.0).

Revision ID: apikey001_2026
Revises: corrcomp001_2026
"""
from alembic import op
import sqlalchemy as sa

revision = 'apikey001_2026'
down_revision = 'corrcomp001_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'api_keys',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('nome', sa.String(length=100), nullable=False),
        sa.Column('prefisso', sa.String(length=16), nullable=False),
        sa.Column('hash_chiave', sa.String(length=64), nullable=False, unique=True),
        sa.Column('attiva', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('scade_il', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('ultimo_uso', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_table('api_keys')
