"""Aggiunge colonna is_fiscale a fiscal_doc_types.
Le caparre (CP) non sono documenti fiscali; tutti gli altri tipi lo sono.

Revision ID: t0u1v2w3x4y5
Revises: s9t0u1v2w3x4
Create Date: 2026-05-22
"""
import sqlalchemy as sa
from alembic import op

revision = 't0u1v2w3x4y5'
down_revision = 's9t0u1v2w3x4'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'fiscal_doc_types',
        sa.Column('is_fiscale', sa.Boolean(), nullable=False, server_default='true'),
    )
    # Solo CP non è documento fiscale
    op.execute("UPDATE fiscal_doc_types SET is_fiscale = false WHERE code = 'CP'")


def downgrade():
    op.drop_column('fiscal_doc_types', 'is_fiscale')
