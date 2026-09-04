"""home003 — Soglie tachimetri per singolo mese solare, non più solo "piatte" per stagione.

Ogni mese ha aspettative diverse (maggio/settembre spalla vs luglio/agosto alta stagione): una
soglia unica su tutta la stagione per Occupancy/ADR appiattiva il confronto. Aggiunge la colonna
`mese` (NULL = soglia piatta di fallback, invariata; 1-12 = override per quel mese) e semina le
soglie mensili SOLO per maggio-settembre (unici mesi realmente operativi, vedi hotel_seasons) per
'occupancy' e 'adr' — gli altri kpi_code restano piatti, non hanno un gauge "per mese" oggi.

Valori di partenza: stimati sui dati reali della stagione 2026 (arancione ≈ il valore osservato
quel mese, rossa ≈ 85% del valore osservato) — un punto di riferimento per ripartire, non un
giudizio definitivo: da affinare in Admin → Home/Cruscotto → Soglie tachimetri.

Revision ID: home003_2026
Revises: home002_2026
Create Date: 2026-09-04
"""
from alembic import op
import sqlalchemy as sa

revision = 'home003_2026'
down_revision = 'home002_2026'
branch_labels = None
depends_on = None

# (kpi_code, mese, unita, soglia_rossa, soglia_arancione) — direzione sempre 'alto_meglio' qui
SOGLIE_MENSILI = [
    ('occupancy', 5, 'perc', 25, 30),
    ('occupancy', 6, 'perc', 45, 50),
    ('occupancy', 7, 'perc', 65, 75),
    ('occupancy', 8, 'perc', 75, 85),
    ('occupancy', 9, 'perc', 35, 40),
    ('adr',       5, 'euro', 75, 85),
    ('adr',       6, 'euro', 60, 70),
    ('adr',       7, 'euro', 70, 80),
    ('adr',       8, 'euro', 90, 100),
    ('adr',       9, 'euro', 60, 70),
]


def upgrade():
    op.add_column('dashboard_kpi_soglie', sa.Column('mese', sa.Integer(), nullable=True))
    op.drop_constraint('uq_dashboard_kpi_soglia', 'dashboard_kpi_soglie', type_='unique')
    op.create_unique_constraint(
        'uq_dashboard_kpi_soglia', 'dashboard_kpi_soglie', ['kpi_code', 'hotel_code', 'mese']
    )

    conn = op.get_bind()
    for kpi_code, mese, unita, rossa, arancione in SOGLIE_MENSILI:
        conn.execute(sa.text("""
            INSERT INTO dashboard_kpi_soglie
                (kpi_code, hotel_code, mese, direzione, unita, target, soglia_rossa, soglia_arancione, ordine)
            VALUES
                (:kpi_code, NULL, :mese, 'alto_meglio', :unita, NULL, :rossa, :arancione, :mese)
        """), {'kpi_code': kpi_code, 'mese': mese, 'unita': unita, 'rossa': rossa, 'arancione': arancione})


def downgrade():
    op.execute("DELETE FROM dashboard_kpi_soglie WHERE mese IS NOT NULL")
    op.drop_constraint('uq_dashboard_kpi_soglia', 'dashboard_kpi_soglie', type_='unique')
    op.create_unique_constraint(
        'uq_dashboard_kpi_soglia', 'dashboard_kpi_soglie', ['kpi_code', 'hotel_code']
    )
    op.drop_column('dashboard_kpi_soglie', 'mese')
