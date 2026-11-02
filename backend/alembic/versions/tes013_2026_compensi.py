"""Tesoreria: piani annuali dei compensi dei soci (marchio, amministratori), categoria e regola per gli amministratori.

Revision ID: tes013_2026
Revises: tes012_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'tes013_2026'
down_revision = 'tes012_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'tesoreria_compensi',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('voce', sa.String(20), nullable=False),
        sa.Column('anno_competenza', sa.Integer, nullable=False),
        sa.Column('importo', sa.Numeric(14, 2), nullable=False),
        sa.Column('nota', sa.String(255), nullable=True),
        sa.UniqueConstraint('voce', 'anno_competenza', name='uq_tesoreria_compenso_voce_anno'),
    )
    op.create_table(
        'tesoreria_rate_compenso',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('compenso_id', sa.Integer, sa.ForeignKey('tesoreria_compensi.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('data_prevista', sa.Date, nullable=False),
        sa.Column('percentuale', sa.Numeric(9, 6), nullable=False),
    )
    op.execute("""INSERT INTO tesoreria_categorie (codice, nome, tipo, ordine)
                  VALUES ('soci_amministratori', 'Soci – compensi amministratori', 'uscita', 11)""")
    op.execute("""INSERT INTO tesoreria_regole (categoria_id, priorita, campo, operatore, valori, segno, attiva, note)
                  SELECT id, 9, 'descrizione', 'contiene', '["AMMINISTRATOR", "COMPENSO AMM", "COMPENSI AMM"]'::json, 'uscita', true,
                         'Compensi degli amministratori, prima della regola sul nome dei soci'
                  FROM tesoreria_categorie WHERE codice = 'soci_amministratori'""")


def downgrade():
    op.execute("""UPDATE tesoreria_movimenti SET categoria_id = NULL WHERE categoria_id =
                  (SELECT id FROM tesoreria_categorie WHERE codice = 'soci_amministratori')""")
    op.execute("DELETE FROM tesoreria_regole WHERE categoria_id = (SELECT id FROM tesoreria_categorie WHERE codice = 'soci_amministratori')")
    op.execute("DELETE FROM tesoreria_categorie WHERE codice = 'soci_amministratori'")
    op.drop_table('tesoreria_rate_compenso')
    op.drop_table('tesoreria_compensi')
