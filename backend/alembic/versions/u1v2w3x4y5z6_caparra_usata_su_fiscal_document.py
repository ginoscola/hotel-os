"""Aggiunge colonna caparra_usata a fiscal_documents.

Revision ID: u1v2w3x4y5z6
Revises: t0u1v2w3x4y5
Create Date: 2026-05-22
"""
import sqlalchemy as sa
from alembic import op

revision = 'u1v2w3x4y5z6'
down_revision = 't0u1v2w3x4y5'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'fiscal_documents',
        sa.Column('caparra_usata', sa.Numeric(12, 2), nullable=True),
    )


def downgrade():
    op.drop_column('fiscal_documents', 'caparra_usata')
