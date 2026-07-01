"""corrv4e — crea tabella tipi_pagamento (globale) e aggiunge categoria_pagamento
a corrispettivi_documenti.

Revision ID: corrv4e_2026
Revises: corrv4d_2026
"""

from alembic import op
import sqlalchemy as sa

revision = 'corrv4e_2026'
down_revision = 'corrv4d_2026'
branch_labels = None
depends_on = None

TIPI_PAGAMENTO = [
    ('Contante',     'Contante',     'Contanti',          1),
    ('Bonifico',     'Bonifico',     'Bonifico bancario', 2),
    ('Assegno',      'Assegno',      'Contanti',          3),
    ('Bancomat',     'Bancomat',     'Carta di credito',  4),
    ('Carta Credito','Carta Credito','Carta di credito',  5),
    ('XPAY-Nexi',    'XPAY-Nexi',    'Carta di credito',  6),
    ('Satispay',     'Satispay',     'Carta di credito',  7),
    ('xpay',         'xpay',         'Carta di credito',  8),
]


def upgrade() -> None:
    op.create_table(
        'tipi_pagamento',
        sa.Column('id',          sa.Integer,     primary_key=True, autoincrement=True),
        sa.Column('codice',      sa.String(100), nullable=False, unique=True),
        sa.Column('descrizione', sa.String(100), nullable=False),
        sa.Column('categoria',   sa.String(100), nullable=False),
        sa.Column('attivo',      sa.Boolean,     nullable=False, server_default='true'),
        sa.Column('ordine',      sa.Integer,     nullable=False, server_default='0'),
    )

    op.bulk_insert(
        sa.table('tipi_pagamento',
            sa.column('codice',      sa.String),
            sa.column('descrizione', sa.String),
            sa.column('categoria',   sa.String),
            sa.column('ordine',      sa.Integer),
        ),
        [{'codice': c, 'descrizione': d, 'categoria': k, 'ordine': o}
         for c, d, k, o in TIPI_PAGAMENTO],
    )

    op.execute(
        "ALTER TABLE corrispettivi_documenti "
        "ADD COLUMN IF NOT EXISTS categoria_pagamento VARCHAR(100) NULL"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE corrispettivi_documenti "
        "DROP COLUMN IF EXISTS categoria_pagamento"
    )
    op.drop_table('tipi_pagamento')
