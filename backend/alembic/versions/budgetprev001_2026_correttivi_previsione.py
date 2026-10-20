"""budgetprev001 — tabella budget_previsione_correttivi: correttivo % sul pickup previsto della
proiezione fine stagione Budget, per hotel/stagione/mese (mese 0 = valore di stagione).
I parametri dell'algoritmo stanno in app_config (chiave budget_previsione_parametri, creata al
primo salvataggio da Admin: senza riga valgono i default di pickup_forecast.PARAMETRI_DEFAULT).

Revision ID: budgetprev001_2026
Revises: prod007_2026
Create Date: 2026-10-20
"""
from alembic import op
import sqlalchemy as sa

revision = 'budgetprev001_2026'
down_revision = 'prod007_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'budget_previsione_correttivi',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('hotel_code', sa.String(10), nullable=False),
        sa.Column('season_year', sa.Integer(), nullable=False),
        sa.Column('mese', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('correttivo_pct', sa.Numeric(6, 2), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('modificato_da', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('hotel_code', 'season_year', 'mese', name='uq_budget_previsione_correttivo'),
    )


def downgrade():
    op.drop_table('budget_previsione_correttivi')
