"""Crea tabella rooms con anagrafica completa camere del gruppo.
Dati pre-caricati da 'CONFIGURAZIONE INIZIALE WELCOME.xlsx'.

Convenzione codici camera (come appaiono nel PMS/PDF):
  DPH: D101…D506, FUEGO, AIRE, AGUA, TIERRA, SOL, LUNA
  CLB: C048…C280 (C + numero Excel zero-paddato a 3 cifre)
  INT: I104…I526 (I + numero Excel)

Revision ID: s9t0u1v2w3x4
Revises: r8s9t0u1v2w3
Create Date: 2026-05-22
"""
import sqlalchemy as sa
from alembic import op

revision = 's9t0u1v2w3x4'
down_revision = 'r8s9t0u1v2w3'
branch_labels = None
depends_on = None

# ---------------------------------------------------------------------------
# Dati camere: (code, struttura_code, tipo_risorsa, nome_tipo, posti_letto, letti_aggiunti, piano)
# ---------------------------------------------------------------------------

# Nomi tipo risorsa (dalla scheda "Tipo camere")
_NOMI_TIPO = {
    'D-SIN': 'singola',               'D-SMA': 'smart',
    'D-CLA': 'classic',               'D-COM': 'comfort',
    'D-SUI': 'junior suite',          'D-MAN': 'mansardata',
    'C-DOP': 'doppia comfort',        'C-VML': 'doppia comfort vista mare laterale',
    'C-SFM': 'superior fronte mare',  'C-TRI': 'tripla comfort',
    'C-BILO': 'bilocale premium',
    'I-SIN': 'singola classic',       'I-ECO': 'doppia economy',
    'I-DOP': 'doppia classic',        'I-TRI': 'tripla classic',
    'I-BILO': 'bilocale',             'I-SUP': 'doppia superior',
    'I-DFM': 'doppia fronte mare',    'I-TFM': 'tripla fronte mare',
    'I-BFM': 'bilocale fronte mare',
    'OVER': 'over',
}

_DPH = [
    # Piano 1
    ('D101','D-COM',2,2,1), ('D102','D-CLA',2,0,1), ('D103','D-CLA',2,0,1),
    ('D104','D-SMA',2,0,1), ('D105','D-SMA',1,1,1), ('D106','D-CLA',2,1,1),
    ('D107','D-CLA',2,1,1), ('D108','D-CLA',2,1,1), ('D109','D-COM',2,2,1),
    # Piano 2
    ('D201','D-COM',2,2,2), ('D202','D-CLA',2,0,2), ('D203','D-CLA',2,0,2),
    ('D204','D-SMA',2,0,2), ('D205','D-CLA',2,1,2), ('D206','D-CLA',2,1,2),
    ('D207','D-CLA',2,1,2), ('D208','D-CLA',2,1,2), ('D209','D-COM',2,2,2),
    # Piano 3
    ('D301','D-CLA',2,1,3), ('D302','D-CLA',2,0,3), ('D303','D-CLA',2,0,3),
    ('D304','D-COM',2,2,3), ('D305','D-CLA',2,0,3), ('D306','D-CLA',2,1,3),
    ('D307','D-CLA',2,1,3), ('D308','D-CLA',2,1,3), ('D309','D-CLA',2,1,3),
    # Piano 4
    ('D401','D-SIN',1,0,4), ('D402','D-SUI',2,2,4), ('D403','D-COM',2,2,4),
    ('D404','D-COM',2,2,4), ('D405','D-SMA',2,0,4), ('D406','D-SMA',1,1,4),
    # Piano 5
    ('D501','D-SIN',1,0,5), ('D502','D-SUI',2,0,5), ('D503','D-COM',2,2,5),
    ('D504','D-COM',2,2,5), ('D505','D-CLA',2,0,5), ('D506','D-CLA',1,1,5),
    # Piano 6 — suite tematiche e over
    ('AIRE',  'D-MAN',2,0,6), ('AGUA',  'D-MAN',2,0,6),
    ('TIERRA','D-MAN',2,0,6), ('FUEGO', 'D-MAN',2,0,6),
    ('SOL',   'OVER', 2,2,6), ('LUNA',  'OVER', 2,2,6),
]

# CLB: Excel usa numeri, PDF usa C + zero-pad 3 cifre (es. 48 → C048)
_CLB_RAW = [
    # Piano 1
    (48,'C-SFM',2,0,1),(50,'C-VML',2,0,1),(52,'C-TRI',3,1,1),(54,'C-TRI',3,1,1),
    (56,'C-TRI',3,2,1),(58,'C-BILO',3,1,1),(62,'C-DOP',2,0,1),(64,'C-DOP',2,0,1),
    (68,'C-DOP',2,0,1),(70,'C-DOP',2,0,1),(72,'C-TRI',3,2,1),(74,'C-TRI',3,1,1),
    (76,'C-TRI',3,1,1),(78,'C-VML',2,0,1),(80,'C-SFM',2,0,1),
    # Piano 2
    (148,'C-SFM',2,0,2),(150,'C-VML',2,0,2),(152,'C-TRI',3,1,2),(154,'C-TRI',3,1,2),
    (156,'C-TRI',3,2,2),(158,'C-BILO',3,1,2),(162,'C-DOP',2,0,2),(164,'C-DOP',2,0,2),
    (168,'C-DOP',2,0,2),(170,'C-DOP',2,0,2),(172,'C-TRI',3,2,2),(174,'C-TRI',3,1,2),
    (176,'C-TRI',3,1,2),(178,'C-VML',2,0,2),(180,'C-SFM',2,0,2),
    # Piano 3
    (248,'C-SFM',2,0,3),(250,'C-VML',2,0,3),(252,'C-TRI',3,1,3),(254,'C-TRI',3,1,3),
    (256,'C-TRI',3,2,3),(258,'C-BILO',3,1,3),(262,'C-DOP',2,0,3),(264,'C-DOP',2,0,3),
    (268,'C-DOP',2,0,3),(270,'C-DOP',2,0,3),(272,'C-TRI',3,2,3),(274,'C-TRI',3,1,3),
    (276,'C-TRI',3,1,3),(278,'C-VML',2,0,3),(280,'C-SFM',2,0,3),
]
_CLB = [(f'C{n:03d}', t, p, la, pi) for n, t, p, la, pi in _CLB_RAW]

# INT: Excel usa numeri, PDF usa I + numero (es. 418 → I418)
_INT_RAW = [
    # Piano 1
    (104,'I-ECO',1,1,1),(106,'I-TRI',2,2,1),(108,'I-BFM',2,2,1),(110,'I-DFM',2,0,1),
    (112,'I-DOP',1,1,1),(114,'I-BILO',2,2,1),(116,'I-ECO',1,1,1),
    # Piano 3
    (302,'I-TRI',2,2,3),(304,'I-DOP',2,0,3),(306,'I-DOP',2,0,3),(308,'I-TFM',2,2,3),
    (310,'I-DFM',2,0,3),(312,'I-SIN',1,0,3),(314,'I-TRI',2,2,3),(316,'I-TRI',2,2,3),
    (318,'I-TRI',2,2,3),(320,'I-TRI',2,2,3),(322,'I-DOP',2,0,3),(324,'I-DOP',2,0,3),
    # Piano 4
    (402,'I-TRI',2,2,4),(404,'I-DOP',2,0,4),(406,'I-TRI',2,2,4),(408,'I-TFM',2,2,4),
    (410,'I-DFM',2,0,4),(414,'I-TRI',2,2,4),(416,'I-SUP',1,1,4),(418,'I-TRI',2,2,4),
    (420,'I-TRI',2,2,4),(422,'I-SUP',1,1,4),(424,'I-DOP',2,0,4),(426,'I-SIN',1,0,4),
    (428,'I-SIN',1,0,4),
    # Piano 5
    (502,'I-DOP',2,0,5),(504,'I-DOP',2,0,5),(506,'I-TRI',2,2,5),(508,'I-TFM',2,2,5),
    (510,'I-DFM',2,0,5),(512,'I-SIN',1,0,5),(514,'I-SIN',1,0,5),(516,'I-DOP',2,0,5),
    (518,'I-TRI',2,2,5),(520,'I-TRI',2,2,5),(522,'I-TRI',2,2,5),(524,'I-DOP',2,0,5),
    (526,'I-DOP',2,0,5),
]
_INT = [(f'I{n}', t, p, la, pi) for n, t, p, la, pi in _INT_RAW]


def upgrade():
    op.create_table(
        'rooms',
        sa.Column('id',             sa.Integer(),     primary_key=True),
        sa.Column('code',           sa.String(30),    unique=True, nullable=False, index=True),
        sa.Column('hotel_id',       sa.Integer(),     sa.ForeignKey('hotels.id'), nullable=False, index=True),
        sa.Column('struttura_code', sa.String(10),    nullable=False, index=True),
        sa.Column('tipo_risorsa',   sa.String(20),    nullable=True),
        sa.Column('nome_tipo',      sa.String(100),   nullable=True),
        sa.Column('posti_letto',    sa.Integer(),     nullable=True),
        sa.Column('letti_aggiunti', sa.Integer(),     nullable=True),
        sa.Column('piano',          sa.Integer(),     nullable=True),
        sa.Column('attiva',         sa.Boolean(),     nullable=False, server_default='true'),
        sa.Column('note',           sa.String(255),   nullable=True),
    )

    # Pre-carica tutte le camere usando il hotel_id dal DB
    for struttura_code, camere in [('DPH', _DPH), ('CLB', _CLB), ('INT', _INT)]:
        for code, tipo, posti, extra, piano in camere:
            nome = _NOMI_TIPO.get(tipo)
            op.execute(f"""
                INSERT INTO rooms
                    (code, hotel_id, struttura_code, tipo_risorsa, nome_tipo,
                     posti_letto, letti_aggiunti, piano, attiva)
                SELECT
                    '{code}',
                    (SELECT id FROM hotels WHERE code = '{struttura_code}'),
                    '{struttura_code}',
                    '{tipo}',
                    {f"'{nome}'" if nome else 'NULL'},
                    {posti}, {extra}, {piano}, true
            """)


def downgrade():
    op.drop_table('rooms')
