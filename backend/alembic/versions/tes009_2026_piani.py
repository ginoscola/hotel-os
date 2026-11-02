"""Tesoreria Fase 3, blocco B: contratti e rate d'affitto, piano del mutuo, ricorrenti, interventi, giorno di
addebito delle carte. Solo struttura: i dati reali si caricano dagli endpoint.

Revision ID: tes009_2026
Revises: tes008_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'tes009_2026'
down_revision = 'tes008_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('tesoreria_conti', sa.Column('giorno_addebito', sa.Integer, nullable=True))
    op.create_table(
        'tesoreria_contratti_affitto',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('codice', sa.String(10), nullable=False, unique=True),
        sa.Column('controparte', sa.String(200), nullable=False),
        sa.Column('nomi_banca', sa.JSON, nullable=False),
        sa.Column('canone_annuo', sa.Numeric(14, 2), nullable=False),
        sa.Column('note', sa.String(255), nullable=True),
        sa.Column('attivo', sa.Boolean, nullable=False, server_default='true'),
    )
    op.create_table(
        'tesoreria_rate_affitto',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('contratto_id', sa.Integer, sa.ForeignKey('tesoreria_contratti_affitto.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('anno_competenza', sa.Integer, nullable=False),
        sa.Column('data_prevista', sa.Date, nullable=False),
        sa.Column('percentuale', sa.Numeric(9, 6), nullable=False),
        sa.Column('nota', sa.String(255), nullable=True),
    )
    op.create_table(
        'tesoreria_rate_mutuo',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('finanziamento', sa.String(30), nullable=False),
        sa.Column('numero', sa.Integer, nullable=False),
        sa.Column('data_scadenza', sa.Date, nullable=False),
        sa.Column('capitale', sa.Numeric(14, 2), nullable=False),
        sa.Column('interessi', sa.Numeric(14, 2), nullable=False),
        sa.Column('importo', sa.Numeric(14, 2), nullable=False),
        sa.Column('spese', sa.Numeric(14, 2), nullable=False, server_default='0'),
        sa.Column('residuo', sa.Numeric(14, 2), nullable=True),
        sa.Column('pagata_il', sa.Date, nullable=True),
        sa.UniqueConstraint('finanziamento', 'numero', name='uq_tesoreria_rata_mutuo'),
    )
    op.create_table(
        'tesoreria_ricorrenti',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('descrizione', sa.String(200), nullable=False),
        sa.Column('categoria_id', sa.Integer, sa.ForeignKey('tesoreria_categorie.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('importo', sa.Numeric(14, 2), nullable=False),
        sa.Column('giorno', sa.Integer, nullable=False, server_default='1'),
        sa.Column('mesi', sa.JSON, nullable=False),
        sa.Column('data_da', sa.Date, nullable=True),
        sa.Column('data_a', sa.Date, nullable=True),
        sa.Column('nota', sa.String(255), nullable=True),
        sa.Column('attivo', sa.Boolean, nullable=False, server_default='true'),
    )
    op.create_table(
        'tesoreria_interventi',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('descrizione', sa.String(200), nullable=False),
        sa.Column('struttura_code', sa.String(10), nullable=True),
        sa.Column('fornitore', sa.String(200), nullable=True),
        sa.Column('importo_stimato', sa.Numeric(14, 2), nullable=True),
        sa.Column('mese_previsto', sa.Date, nullable=True),
        sa.Column('stato', sa.String(12), nullable=False, server_default='idea'),
        sa.Column('inclusa_in_previsione', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('nota', sa.String(255), nullable=True),
    )


def downgrade():
    op.drop_table('tesoreria_interventi')
    op.drop_table('tesoreria_ricorrenti')
    op.drop_table('tesoreria_rate_mutuo')
    op.drop_table('tesoreria_rate_affitto')
    op.drop_table('tesoreria_contratti_affitto')
    op.drop_column('tesoreria_conti', 'giorno_addebito')
