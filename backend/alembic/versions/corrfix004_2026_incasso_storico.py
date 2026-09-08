"""Ripartizione una-tantum del pregresso MMS/BON per tipo di incasso.

I giorni MMS/BON già inseriti come totale giornaliero unico (arrangiamenti_lordo, senza
ripartizione — vedi corrfix003_2026) finiscono nella tab 'Tipo Incasso' nella riga
informativa 'MMS / BON (manuale)', fuori dalle 4 categorie. Rifarli giorno per giorno è
impraticabile: questa tabella tiene UNA riga per (struttura, anno) con la ripartizione
complessiva del pregresso fino a `data_a` ('ad oggi'). Da `data_a` in poi la ripartizione
si inserisce giorno per giorno come parte del normale inserimento corrispettivi.

`_calcola_pagamenti` (corrispettivi_report.py): se esiste una riga qui, i giorni MMS/BON
senza ripartizione propria e con data_giorno <= data_a NON alimentano più la riga mensile
'MMS / BON (manuale)' ma vengono sommati in un totale 'atteso'; le 4 colonne incasso_*
compaiono come righe dedicate 'Pregresso MMS/BON — <categoria>' valorizzate solo nel
totale annuo (nessuna distribuzione mensile). Eventuale residuo (atteso - somma dei 4)
confluisce in 'MMS / BON (manuale)' nel mese di data_a, così il TOTALE del report resta
identico a SUM(totale_lordo) reale.

Revision ID: corrfix004_2026
Revises: corrfix003_2026
Create Date: 2026-09-08
"""
import sqlalchemy as sa
from alembic import op

revision = 'corrfix004_2026'
down_revision = 'corrfix003_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'corrispettivi_incasso_storico',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('struttura_code', sa.String(20), nullable=False),   # 'MMS' o 'BON'
        sa.Column('anno', sa.Integer(), nullable=False),
        sa.Column('data_a', sa.Date(), nullable=False),               # taglio "ad oggi"
        sa.Column('incasso_contante', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('incasso_bonifico', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('incasso_assegno', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('incasso_elettronico', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('is_test', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.UniqueConstraint('struttura_code', 'anno', 'is_test', name='uq_incasso_storico_struttura_anno'),
    )


def downgrade():
    op.drop_table('corrispettivi_incasso_storico')
