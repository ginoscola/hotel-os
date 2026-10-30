"""Budget settimanale dei ristoranti Mare Mosso (clienti esterni) e Buona Onda.

Revision ID: budgetrist001_2026
Revises: tes007_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'budgetrist001_2026'
down_revision = 'tes007_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'budget_ristoranti',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('struttura_code', sa.String(10), nullable=False),
        sa.Column('season_year', sa.Integer, nullable=False),
        sa.Column('week_start', sa.Date, nullable=False),
        sa.Column('version', sa.String(20), nullable=False, server_default='v1'),
        sa.Column('importo', sa.Numeric(12, 2), nullable=False),
        sa.Column('note', sa.Text, nullable=True),
        sa.Column('updated_by', sa.Integer, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('struttura_code', 'season_year', 'week_start', 'version',
                            name='uq_budget_ristorante_settimana'),
    )


def downgrade():
    op.drop_table('budget_ristoranti')
