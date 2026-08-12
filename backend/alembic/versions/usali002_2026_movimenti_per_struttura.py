"""usali002 — Movimenti Attivi per struttura (non più a livello di gruppo): tabella
usali_movimenti_righe, admin-configurabile, sostituisce la lista Python fissa
RIGHE_MOVIMENTI_ATTIVI. DPH include il redirect Maremosso; CLB/INT hanno una sezione
Ristorante propria (pranzo/cena, nessun redirect); BON ha un set minimo, tutto manuale
(nessun dato Welcome/PMS per Buona Onda, come Maremosso).

Revision ID: usali002_2026
Revises: prod005_2026
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa

revision = 'usali002_2026'
down_revision = 'prod005_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'usali_movimenti_righe',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('struttura_code', sa.String(10), nullable=False),
        sa.Column('reparto', sa.String(100), nullable=False),
        sa.Column('conto', sa.String(150), nullable=False),
        sa.Column('riga_code', sa.String(80), nullable=False),
        # 'manuale' | 'auto_produzione' | 'auto_corrispettivi_penali' | 'auto_maremosso'
        sa.Column('tipo', sa.String(30), nullable=False, server_default='manuale'),
        # code di prod_categorie, usato solo quando tipo='auto_produzione'
        sa.Column('categoria_produzione', sa.String(50), nullable=True),
        sa.Column('ordine', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('attivo', sa.Boolean(), nullable=False, server_default='true'),
        sa.UniqueConstraint('struttura_code', 'riga_code', name='uq_usali_mov_riga_struttura'),
    )

    def riga(sc, reparto, conto, code, tipo, ordine, cat=None):
        cat_sql = f"'{cat}'" if cat else 'NULL'
        return (f"('{sc}', '{reparto}', '{conto}', '{code}', '{tipo}', {ordine}, {cat_sql})")

    righe = []

    # ── DPH: set completo, include Maremosso (redirect) ──────────────────────
    dph = [
        ('mov_shop_kmdimare',      'Altri Reparti Operativi', 'Ricavi -> Shop Km Di Mare',          'manuale',                   None),
        ('mov_spiaggia',           'Altri Reparti Operativi', 'Ricavi -> Spiaggia',                 'auto_produzione',           'spiaggia'),
        ('mov_bar_alcolici',       'Bar',                     'Bevande -> Altro Alcolici',          'auto_produzione',           'bar_alcolici'),
        ('mov_bar_analcolici',     'Bar',                     'Bevande -> Bar Hotel analcolici',    'auto_produzione',           'bar_analcolici'),
        ('mov_bar_caffetteria',    'Bar',                     'Bevande -> Bar Hotel Caffetteria',   'auto_produzione',           'bar_caffetteria'),
        ('mov_camere_individuali', 'Camere',                  'Camere Individuali',                 'auto_produzione',           'alloggio'),
        ('mov_camere_gruppi',      'Camere',                  'Camere Gruppi',                      'manuale',                   None),
        ('mov_colazione',          'Colazione',               'Alimenti -> Altri Alimenti',         'auto_produzione',           'colazione'),
        ('mov_parcheggio_hotel',   'Parcheggio',              'Servizio Parcheggio -> Area Hotel',  'auto_produzione',           'parcheggio_hotel'),
        ('mov_parcheggio_esterno', 'Parcheggio',              'Servizio Parcheggio -> Area Esterna', 'auto_produzione',          'parcheggio_esterno'),
        ('mov_pasticceria',        'Pasticceria',             'Ricavi -> Altri Ricavi',             'manuale',                   None),
        ('mov_penali',             'Ricavi Vari',             'Penali di Cancellazione Camere',     'auto_corrispettivi_penali', None),
        ('mov_maremosso_alimenti', 'Ristorante Mare Mosso',   'Alimenti -> Altri Alimenti',         'auto_maremosso',            None),
        ('mov_maremosso_vino',     'Ristorante Mare Mosso',   'Bevande -> Vino',                    'manuale',                   None),
        ('mov_maremosso_alcolici', 'Ristorante Mare Mosso',   'Bevande -> Altro Alcolici',           'manuale',                   None),
        ('mov_maremosso_analcolici', 'Ristorante Mare Mosso', 'Bevande -> Altro Analcolici',         'manuale',                  None),
    ]
    for ordine, (code, reparto, conto, tipo, cat) in enumerate(dph, start=1):
        righe.append(riga('DPH', reparto, conto, code, tipo, ordine, cat))

    # ── CLB/INT: come DPH ma senza Maremosso, con Ristorante proprio (no redirect) ──
    for sc in ('CLB', 'INT'):
        base = [
            ('mov_shop_kmdimare',      'Altri Reparti Operativi', 'Ricavi -> Shop Km Di Mare',          'manuale',         None),
            ('mov_spiaggia',           'Altri Reparti Operativi', 'Ricavi -> Spiaggia',                 'auto_produzione', 'spiaggia'),
            ('mov_bar_alcolici',       'Bar',                     'Bevande -> Altro Alcolici',          'auto_produzione', 'bar_alcolici'),
            ('mov_bar_analcolici',     'Bar',                     'Bevande -> Bar Hotel analcolici',    'auto_produzione', 'bar_analcolici'),
            ('mov_bar_caffetteria',    'Bar',                     'Bevande -> Bar Hotel Caffetteria',   'auto_produzione', 'bar_caffetteria'),
            ('mov_camere_individuali', 'Camere',                  'Camere Individuali',                 'auto_produzione', 'alloggio'),
            ('mov_camere_gruppi',      'Camere',                  'Camere Gruppi',                      'manuale',         None),
            ('mov_colazione',          'Colazione',               'Alimenti -> Altri Alimenti',         'auto_produzione', 'colazione'),
            ('mov_parcheggio_hotel',   'Parcheggio',              'Servizio Parcheggio -> Area Hotel',  'auto_produzione', 'parcheggio_hotel'),
            ('mov_parcheggio_esterno', 'Parcheggio',              'Servizio Parcheggio -> Area Esterna', 'auto_produzione', 'parcheggio_esterno'),
            ('mov_pasticceria',        'Pasticceria',             'Ricavi -> Altri Ricavi',             'manuale',         None),
            ('mov_penali',             'Ricavi Vari',             'Penali di Cancellazione Camere',     'auto_corrispettivi_penali', None),
            ('mov_ristorante_pranzo',  'Ristorante',              'Alimenti -> Pranzo',                 'auto_produzione', 'pranzo'),
            ('mov_ristorante_cena',    'Ristorante',              'Alimenti -> Cena',                   'auto_produzione', 'cena'),
        ]
        for ordine, (code, reparto, conto, tipo, cat) in enumerate(base, start=1):
            righe.append(riga(sc, reparto, conto, code, tipo, ordine, cat))

    # ── BON: set minimo, tutto manuale (nessun dato Welcome/PMS, come Maremosso) ──
    bon = [
        ('mov_alimenti',   'Ristorante', 'Alimenti -> Altri Alimenti',  'manuale', None),
        ('mov_vino',       'Ristorante', 'Bevande -> Vino',              'manuale', None),
        ('mov_alcolici',   'Ristorante', 'Bevande -> Altro Alcolici',    'manuale', None),
        ('mov_analcolici', 'Ristorante', 'Bevande -> Altro Analcolici',  'manuale', None),
    ]
    for ordine, (code, reparto, conto, tipo, cat) in enumerate(bon, start=1):
        righe.append(riga('BON', reparto, conto, code, tipo, ordine, cat))

    op.execute(
        "INSERT INTO usali_movimenti_righe "
        "(struttura_code, reparto, conto, riga_code, tipo, ordine, categoria_produzione) VALUES "
        + ",\n".join(righe)
    )


def downgrade():
    op.drop_table('usali_movimenti_righe')
