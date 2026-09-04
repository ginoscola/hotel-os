"""home001 — Crea dashboard_kpi_soglie (cutoff rosso/arancio/verde dei tachimetri della
Home / Cruscotto gruppo, editabili da admin) e semina le soglie di default (hotel_code NULL).

Revision ID: home001_2026
Revises: usali004_2026
Create Date: 2026-09-04
"""
from alembic import op
import sqlalchemy as sa

revision = 'home001_2026'
down_revision = 'usali004_2026'
branch_labels = None
depends_on = None


# (kpi_code, direzione, unita, target, soglia_rossa, soglia_arancione, ordine)
SOGLIE_DEFAULT = [
    ('occupancy',                  'alto_meglio', 'perc', None, 55,  70,  10),
    ('revenue_stagione_vs_budget', 'target',      'perc', 100,  15,   5,  20),
    ('revpar_vs_budget',           'target',      'perc', 100,  15,   5,  30),
    ('adr_vs_budget',              'target',      'perc', 100,  10,   3,  40),
    ('pickup_7gg',                 'alto_meglio', 'euro', None,  0, 1000, 50),
    ('delta_rt_pms',               'target',      'euro',   0, 200,  50,  60),
    ('labor_cost_ratio',           'basso_meglio','perc', None, 38,  30,  70),
    ('perc_ota',                   'basso_meglio','perc', None, 40,  25,  80),
    ('perc_contante',              'basso_meglio','perc', None, 35,  20,  90),
]


def upgrade():
    op.create_table(
        'dashboard_kpi_soglie',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('kpi_code', sa.String(50), nullable=False),
        sa.Column('hotel_code', sa.String(20), nullable=True),
        sa.Column('direzione', sa.String(20), nullable=False, server_default='alto_meglio'),
        sa.Column('unita', sa.String(10), nullable=False, server_default='perc'),
        sa.Column('target', sa.Numeric(12, 2), nullable=True),
        sa.Column('soglia_rossa', sa.Numeric(12, 2), nullable=False),
        sa.Column('soglia_arancione', sa.Numeric(12, 2), nullable=False),
        sa.Column('ordine', sa.Integer, nullable=False, server_default='0'),
        sa.Column('attivo', sa.Boolean, nullable=False, server_default='true'),
        sa.UniqueConstraint('kpi_code', 'hotel_code', name='uq_dashboard_kpi_soglia'),
    )

    conn = op.get_bind()
    for kpi_code, direzione, unita, target, rossa, arancione, ordine in SOGLIE_DEFAULT:
        conn.execute(
            sa.text("""
                INSERT INTO dashboard_kpi_soglie
                    (kpi_code, hotel_code, direzione, unita, target, soglia_rossa, soglia_arancione, ordine)
                VALUES
                    (:kpi_code, NULL, :direzione, :unita, :target, :rossa, :arancione, :ordine)
            """),
            {'kpi_code': kpi_code, 'direzione': direzione, 'unita': unita,
             'target': target, 'rossa': rossa, 'arancione': arancione, 'ordine': ordine},
        )


def downgrade():
    op.drop_table('dashboard_kpi_soglie')
