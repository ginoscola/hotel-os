"""Ripartizione per tipo di incasso su corrispettivi_manuali (MMS/BON).

La tab 'Tipo Incasso' (Contante/Bonifico/Assegno/Pagamento elettronico) per DPH/CLB/INT
è estratta interamente da corrispettivi_documenti (colonna tipo_pagamento). Per MMS
(Maremosso) e BON (Buona Onda), che non hanno dati Welcome/PMS, l'utente inserisce oggi
un unico totale lordo (arrangiamenti_lordo) senza indicazione del metodo di incasso —
finiva quindi in una riga informativa a parte ('MMS / BON manuale'), fuori dalle 4
categorie, impedendo al totale del report di coincidere con quello reale dei corrispettivi.

4 nuove colonne opzionali (NULL = nessuna ripartizione inserita, comportamento invariato
per le righe storiche) permettono di inserire manualmente la ripartizione per le nuove
righe: arrangiamenti_lordo resta il campo autoritativo (letto da report/fatturati,
report/giornaliero, USALI Movimenti Attivi) e viene ricalcolato come somma dei 4 quando
la ripartizione è presente — mai calcolato al contrario per non introdurre disallineamenti.

Revision ID: corrfix003_2026
Revises: home003_2026
Create Date: 2026-09-08
"""
import sqlalchemy as sa
from alembic import op

revision = 'corrfix003_2026'
down_revision = 'home003_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('corrispettivi_manuali', sa.Column('incasso_contante', sa.Numeric(12, 2), nullable=True))
    op.add_column('corrispettivi_manuali', sa.Column('incasso_bonifico', sa.Numeric(12, 2), nullable=True))
    op.add_column('corrispettivi_manuali', sa.Column('incasso_assegno', sa.Numeric(12, 2), nullable=True))
    op.add_column('corrispettivi_manuali', sa.Column('incasso_elettronico', sa.Numeric(12, 2), nullable=True))


def downgrade():
    op.drop_column('corrispettivi_manuali', 'incasso_elettronico')
    op.drop_column('corrispettivi_manuali', 'incasso_assegno')
    op.drop_column('corrispettivi_manuali', 'incasso_bonifico')
    op.drop_column('corrispettivi_manuali', 'incasso_contante')
