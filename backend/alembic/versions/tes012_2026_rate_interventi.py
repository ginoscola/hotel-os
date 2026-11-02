"""Tesoreria: interventi pagati a rate (data + percentuale), al posto del mese previsto.

Revision ID: tes012_2026
Revises: tes011_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'tes012_2026'
down_revision = 'tes011_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'tesoreria_rate_intervento',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('intervento_id', sa.Integer, sa.ForeignKey('tesoreria_interventi.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('data_prevista', sa.Date, nullable=False),
        sa.Column('percentuale', sa.Numeric(9, 6), nullable=False),
    )
    op.execute("""INSERT INTO tesoreria_rate_intervento (intervento_id, data_prevista, percentuale)
                  SELECT id, (date_trunc('month', mese_previsto) + interval '1 month - 1 day')::date, 100
                  FROM tesoreria_interventi WHERE mese_previsto IS NOT NULL""")
    op.drop_column('tesoreria_interventi', 'mese_previsto')


def downgrade():
    op.add_column('tesoreria_interventi', sa.Column('mese_previsto', sa.Date, nullable=True))
    op.execute("""UPDATE tesoreria_interventi i SET mese_previsto = (
                      SELECT date_trunc('month', max(r.data_prevista))::date FROM tesoreria_rate_intervento r WHERE r.intervento_id = i.id)""")
    op.drop_table('tesoreria_rate_intervento')
