"""usali006 — Conto Economico USALI contabile (import mensile dal gestionale).

Tabelle: usali_struttura_gestionale (id gestionale → struttura HotelOS), usali_import (log con
file originali), usali_riga (conto × mese, dato grezzo), usali_segmento + usali_regola_segmento
(separazione futura Hotel/Maremosso, applicata in lettura), usali_categoria_kpi (conto →
categoria KPI).

Seed: 128 → DPH; segmento unico 'Du Parc + Maremosso' con regola catch-all; categorie KPI
iniziali (personale/commissioni/beverage/food/utenze).

Revision ID: usali006_2026
Revises: prod006_2026
Create Date: 2026-10-15
"""
from alembic import op
import sqlalchemy as sa

revision = 'usali006_2026'
down_revision = 'prod006_2026'
branch_labels = None
depends_on = None


CATEGORIE_KPI = {
    'personale': [
        'Retribuzione netta', 'Imposte sui Salari', 'Benefici per i Dipendenti',
        'Salari e Stipendi - Non Management', 'TFR', 'Voucher',
        'Lavoro a Contratto, in Leasing ed Esternalizzato', 'Elaborazione Buste Paga',
    ],
    'commissioni': ['Commissioni'],
    'beverage': [
        'Vino', 'Vini Bianchi', 'Vini Rossi', 'Bollicine', 'Birra', 'Gin', 'Rum', 'Whisky',
        'Vermout', 'Altro Alcolici', 'Altro Analcolici', 'Bibite Analcoliche', 'Acqua', 'Succhi',
        'Caffetteria',
    ],
    'food': [
        'Altri Alimenti', 'Frutta', 'Frutta Secca', 'Cereali', 'Cibo in Scatola',
        'Drogheria, Prodotti Secchi e Spezie', 'Monodose', 'Pane e Similari', 'Prodotti da Forno',
        'Prodotti Lattiero Caseari', 'Prodotti per Pasticceria', 'Salumi', 'Uova',
        'Verdure e Ortaggi', 'Farina', 'Latte', 'Pasta', 'olio di Semi', 'olio Oliva',
        'patatine - snacks', 'Polpe di Frutta', 'Carne Bianca', 'Carne Rossa',
        'Ali di razza', 'Alici', 'altro pesce', 'Branzino', 'Calamari', 'Cefalo', 'cozze',
        'Filetto Gallinella', 'Gamberi', 'Granchio', 'Misto mare per zuppa', 'Ombrina', 'orata',
        'Polpo', 'Salmone', 'Seppia', 'Sgombro', 'Tonno', 'Triglie', 'vongole',
    ],
    'utenze': ['Acqua e Fognatura', 'Elettricità', 'Gas'],
}


def upgrade():
    op.create_table(
        'usali_struttura_gestionale',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('id_gestionale', sa.Integer, nullable=False, unique=True),
        sa.Column('struttura_code', sa.String(10), nullable=False),
        sa.Column('note', sa.String(200), nullable=True),
    )
    op.create_table(
        'usali_import',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('struttura_code', sa.String(10), nullable=False),
        sa.Column('nome_file_xlsx', sa.String(255), nullable=False),
        sa.Column('nome_file_csv', sa.String(255), nullable=True),
        sa.Column('sha256', sa.String(64), nullable=False, index=True),
        sa.Column('sha256_csv', sa.String(64), nullable=True),
        sa.Column('percorso_xlsx', sa.String(500), nullable=True),
        sa.Column('percorso_csv', sa.String(500), nullable=True),
        sa.Column('utente_id', sa.Integer, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('periodi', sa.JSON, nullable=False),
        sa.Column('n_righe', sa.Integer, nullable=False, server_default='0'),
        sa.Column('quadratura_ok', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('csv_arricchito', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('avvisi', sa.JSON, nullable=True),
        sa.Column('note', sa.Text, nullable=True),
    )
    op.create_table(
        'usali_riga',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('import_id', sa.Integer, sa.ForeignKey('usali_import.id', ondelete='SET NULL'), nullable=True),
        sa.Column('struttura_code', sa.String(10), nullable=False),
        sa.Column('anno', sa.Integer, nullable=False),
        sa.Column('mese', sa.Integer, nullable=False),
        sa.Column('ordine', sa.Integer, nullable=False, server_default='0'),
        sa.Column('percorso', sa.JSON, nullable=False),
        sa.Column('percorso_testo', sa.String(1000), nullable=False, index=True),
        sa.Column('sezione', sa.String(50), nullable=True),
        sa.Column('reparto', sa.String(150), nullable=True),
        sa.Column('sottoreparto', sa.String(300), nullable=True),
        sa.Column('conto_nome', sa.String(200), nullable=False),
        sa.Column('id_conti', sa.Integer, nullable=True),
        sa.Column('id_reparto', sa.Integer, nullable=True),
        sa.Column('tipo', sa.String(10), nullable=False),
        sa.Column('ammortamento', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('importo', sa.Numeric(14, 4), nullable=False, server_default='0'),
    )
    op.create_index('ix_usali_riga_struttura_periodo', 'usali_riga', ['struttura_code', 'anno', 'mese'])

    op.create_table(
        'usali_segmento',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('struttura_code', sa.String(10), nullable=False),
        sa.Column('nome', sa.String(100), nullable=False),
        sa.UniqueConstraint('struttura_code', 'nome', name='uq_usali_segmento_struttura_nome'),
    )
    op.create_table(
        'usali_regola_segmento',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('struttura_code', sa.String(10), nullable=False),
        sa.Column('priorita', sa.Integer, nullable=False, server_default='0'),
        sa.Column('tipo_match', sa.String(30), nullable=False),
        sa.Column('pattern', sa.String(500), nullable=False, server_default=''),
        sa.Column('segmento_id', sa.Integer, sa.ForeignKey('usali_segmento.id', ondelete='CASCADE'), nullable=False),
        sa.Column('percentuale', sa.Numeric(5, 2), nullable=False, server_default='100'),
        sa.Column('valida_dal', sa.String(7), nullable=False, server_default='2000-01'),
        sa.Column('valida_al', sa.String(7), nullable=True),
    )
    op.create_table(
        'usali_categoria_kpi',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('conto_nome', sa.String(200), nullable=False),
        sa.Column('reparto', sa.String(150), nullable=False, server_default=''),
        sa.Column('categoria', sa.String(20), nullable=False),
        sa.UniqueConstraint('conto_nome', 'reparto', name='uq_usali_categoria_kpi_conto_reparto'),
    )

    conn = op.get_bind()
    conn.execute(sa.text(
        "INSERT INTO usali_struttura_gestionale (id_gestionale, struttura_code, note) "
        "VALUES (128, 'DPH', 'Hotel Du Parc')"
    ))
    seg_id = conn.execute(sa.text(
        "INSERT INTO usali_segmento (struttura_code, nome) VALUES ('DPH', 'Du Parc + Maremosso') RETURNING id"
    )).scalar()
    conn.execute(sa.text(
        "INSERT INTO usali_regola_segmento (struttura_code, priorita, tipo_match, pattern, segmento_id, percentuale) "
        "VALUES ('DPH', 0, 'percorso_prefisso', '', :seg, 100)"
    ), {"seg": seg_id})
    for categoria, conti in CATEGORIE_KPI.items():
        for conto in conti:
            conn.execute(sa.text(
                "INSERT INTO usali_categoria_kpi (conto_nome, reparto, categoria) VALUES (:c, '', :cat)"
            ), {"c": conto, "cat": categoria})


def downgrade():
    op.drop_table('usali_categoria_kpi')
    op.drop_table('usali_regola_segmento')
    op.drop_table('usali_segmento')
    op.drop_index('ix_usali_riga_struttura_periodo', table_name='usali_riga')
    op.drop_table('usali_riga')
    op.drop_table('usali_import')
    op.drop_table('usali_struttura_gestionale')
