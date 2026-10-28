"""Tesoreria: testo con cui l'addebito di una carta di credito compare nell'estratto conto bancario.

Serve a riconoscere da soli il pagamento dell'estratto della carta (stesso importo, dopo la data di
chiusura): l'utente inserisce solo il totale di ogni estratto, la carta torna a zero quando la banca
lo addebita.

Revision ID: tes003_2026
Revises: tes002_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'tes003_2026'
down_revision = 'tes002_2026'
branch_labels = None
depends_on = None

# codice conto → testo dell'addebito nella descrizione del movimento bancario
TESTI_ADDEBITO = {
    'AMEX': 'AMERICAN EXPRESS',
    'CARTA_BCC': 'Carta del Credito Cooperativo',
}


def upgrade():
    op.add_column('tesoreria_conti', sa.Column('testo_addebito', sa.String(100), nullable=True))
    conn = op.get_bind()
    for codice, testo in TESTI_ADDEBITO.items():
        conn.execute(sa.text("UPDATE tesoreria_conti SET testo_addebito = :t WHERE codice = :c"),
                     {"t": testo, "c": codice})


def downgrade():
    op.drop_column('tesoreria_conti', 'testo_addebito')
