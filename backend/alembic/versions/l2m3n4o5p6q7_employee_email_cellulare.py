"""Aggiunge email e cellulare alla tabella employees.

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-05-15

"""
from alembic import op
import sqlalchemy as sa

revision = 'l2m3n4o5p6q7'
down_revision = 'k1l2m3n4o5p6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('employees', sa.Column('email', sa.String(200), nullable=True))
    op.add_column('employees', sa.Column('cellulare', sa.String(30), nullable=True))


def downgrade() -> None:
    op.drop_column('employees', 'cellulare')
    op.drop_column('employees', 'email')
