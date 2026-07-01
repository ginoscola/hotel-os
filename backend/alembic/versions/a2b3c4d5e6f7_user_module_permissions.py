"""user_module_permissions — permessi modulo per-utente

Revision ID: a2b3c4d5e6f7
Revises: z6a7b8c9d0e1
Create Date: 2026-06-15

Tabelle create:
  - user_module_permissions : override puo_vedere per singolo utente su singolo modulo
"""
from alembic import op
import sqlalchemy as sa


revision = 'a2b3c4d5e6f7'
down_revision = 'z6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'user_module_permissions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('module_code', sa.String(50), nullable=False),
        sa.Column('puo_vedere', sa.Boolean(), nullable=False, server_default='true'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['module_code'], ['modules.code'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'module_code', name='uq_user_module'),
    )


def downgrade():
    op.drop_table('user_module_permissions')
