"""tes001 — modulo Tesoreria, Fase 1: conti, saldi, import estratti conto, movimenti, categorie,
regole di classificazione.

Seed: 5 conti (095081 principale, 217746 POS con fido 130.000 € in scadenza 30/09/2027, carta BCC,
American Express, prepagata TASCA); categorie e regole iniziali della specifica, più le regole per
gli storni bancari (ognuno nella categoria del movimento che annulla) e per le spese di erogazione
del mutuo (in "Mutuo – rate e spese"). Nessun saldo: arrivano dal primo estratto conto XML.

Modulo `tesoreria` registrato **disattivato** (attivo=false) finché non esiste la pagina; permessi
admin tutto, viewer niente.

Le liste REGOLE/CATEGORIE sono lette anche da tests/test_tesoreria_classificatore.py, che verifica
le regole effettivamente seminate sui casi reali: tenerle come costanti di modulo.

Revision ID: tes001_2026
Revises: usalifnb001_2026
Create Date: 2026-10-28
"""
import json

from alembic import op
import sqlalchemy as sa

revision = 'tes001_2026'
down_revision = 'usalifnb001_2026'
branch_labels = None
depends_on = None


# codice, nome, tipo, banca, iban, fido, fido_scadenza, ha_import, colore, ordine
CONTI = [
    ('095081',    'Conto principale', 'conto',         'BCC', 'IT68B0899568320000000095081', 0,      None,         True,  '#2a78d6', 1),
    ('217746',    'Conto POS',        'conto',         'BCC', 'IT89D0899568320000000217746', 130000, '2027-09-30', True,  '#1baf7a', 2),
    ('CARTA_BCC', 'Carta BCC',        'carta_credito', 'BCC', None,                          0,      None,         False, '#eda100', 3),
    ('AMEX',      'American Express', 'carta_credito', 'American Express', None,             0,      None,         False, '#4a3aa7', 4),
    ('TASCA',     'Prepagata TASCA',  'prepagata',     'BCC', None,                          0,      None,         False, '#e87ba4', 5),
]

# codice, nome, tipo, escludi_da_operativo, colore
CATEGORIE = [
    ('incassi_pos',        'Incassi POS/online',                'entrata', False, '#1baf7a'),
    ('bonifici_clienti',   'Bonifici da clienti',               'entrata', False, '#008300'),
    ('versamenti',         'Versamenti contanti e assegni',     'entrata', False, '#2a78d6'),
    ('fornitori_riba',     'Fornitori – Ri.Ba.',                'uscita',  False, '#eb6834'),
    ('fornitori_bonifici', 'Fornitori – bonifici',              'uscita',  False, '#e34948'),
    ('fornitori_sdd',      'Fornitori – SDD',                   'uscita',  False, '#e87ba4'),
    ('assegni',            'Assegni emessi',                    'uscita',  False, '#94a3b8'),
    ('personale',          'Personale – stipendi',              'uscita',  False, '#eda100'),
    ('f24',                'F24 imposte e contributi',          'uscita',  False, '#4a3aa7'),
    ('affitti',            'Affitti e riaddebiti strutture',    'uscita',  False, '#1e3a5f'),
    ('soci_marchio',       'Soci – compensi marchio',           'uscita',  False, '#64748b'),
    ('ota_marketing',      'OTA, portali, marketing',           'uscita',  False, '#2a78d6'),
    ('utenze',             'Utenze ed energia',                 'uscita',  False, '#008300'),
    ('spiagge',            'Spiagge',                           'uscita',  False, '#1baf7a'),
    ('auto',               'Auto',                              'uscita',  False, '#eb6834'),
    ('carte',              'Carte di credito/prepagate',        'uscita',  False, '#e87ba4'),
    ('assicurazioni',      'Assicurazioni',                     'uscita',  False, '#4a3aa7'),
    ('banca',              'Banca: commissioni e interessi',    'uscita',  False, '#94a3b8'),
    ('tassa_soggiorno',    'Tassa di soggiorno',                'uscita',  False, '#eda100'),
    ('mutuo_rate',         'Mutuo – rate e spese',              'uscita',  False, '#64748b'),
    ('mutuo_erogazione',   'Mutuo – erogazione',                'entrata', True,  '#94a3b8'),
    ('giroconti',          'Giroconti interni',                 'neutra',  True,  '#cbd5e1'),
    ('da_classificare',    'Da classificare',                   'neutra',  False, '#e34948'),
]

# categoria, campo, operatore, valori, valori_anche, segno — in ordine di priorità (vince la prima)
REGOLE = [
    # Regole sul nome: 'inizia' sulla controparte (nome + causale libera attaccata, vedi
    # estrai_controparte): con 'contiene' una causale che nomina un hotel diventava un affitto.
    ('giroconti',          'controparte', 'inizia',   ['KM DI MARE'], None, 'entrambi'),
    ('giroconti',          'descrizione', 'inizia',   ['Giro conto *KM'], None, 'entrambi'),
    ('mutuo_erogazione',   'descrizione', 'inizia',   ['Erogazione mutuo'], None, 'entrambi'),
    ('mutuo_rate',         'descrizione', 'inizia',   ['Addebito rata mutuo', 'Spese erogazione mutuo'], None, 'entrambi'),
    # Storni: ognuno nella categoria del movimento che annulla (prima delle regole generiche).
    ('banca',              'descrizione', 'inizia',   ['Storno scritture'], ['Storno comm'], 'entrambi'),
    ('personale',          'descrizione', 'inizia',   ['Storno scritture'], ['EMOLUMENTI', 'STIPENDIO'], 'entrambi'),
    ('bonifici_clienti',   'descrizione', 'inizia',   ['Storno scritture'], ['CAPARRA'], 'entrambi'),
    ('incassi_pos',        'descrizione', 'inizia',   ['Storno scritture'], ['CLUB HOTEL', 'HOTEL DU PARC', 'HOTEL INTERNATIONAL', 'PAGOBANCOMAT', 'NUMIA'], 'entrambi'),
    ('tassa_soggiorno',    'descrizione', 'contiene', ['SOGGIORNO'], ['COMUNE', 'TESORERIA'], 'uscita'),
    ('affitti',            'controparte', 'inizia',   ['ERICE SNC', 'HOTEL INTERNATIONAL', 'HOTEL DU PARC'], None, 'uscita'),
    ('personale',          'descrizione', 'inizia',   ['Disposizione per emolumenti'], None, 'entrambi'),
    ('personale',          'descrizione', 'contiene', ['STIPENDIO', 'FIDEURAM'], None, 'entrambi'),
    ('f24',                'descrizione', 'inizia',   ['Imposte e tasse'], None, 'entrambi'),
    ('soci_marchio',       'descrizione', 'contiene', ['SCOLA'], ['MARCHI'], 'uscita'),
    ('ota_marketing',      'descrizione', 'contiene', ['BOOKING', 'THEFORK', 'LA FOURCHETTE', 'GOOGLE', 'META PLATFORMS', 'ALBERGHI.IT', 'INFO-ALBERGHI', 'HOTELPERFORMANCE', 'ALBERGATORE PRO'], None, 'uscita'),
    ('utenze',             'descrizione', 'contiene', ['MARCHE MULTISERVIZI', 'SGR', 'A2A', 'ENERGY LIGHT', 'SKY', 'RAI ABB', 'SIAE', 'CBILL', 'PAGOPA'], None, 'uscita'),
    ('spiagge',            'descrizione', 'contiene', ['BAGNI '], None, 'uscita'),
    ('auto',               'descrizione', 'contiene', ['ALD AUTOMOTIVE', 'LEASEPLAN', 'AYVENS'], None, 'entrambi'),
    ('carte',              'descrizione', 'inizia',   ['Carta del', 'Ricarica carta'], None, 'entrambi'),
    ('carte',              'descrizione', 'contiene', ['AMERICAN EXPRESS'], None, 'entrambi'),
    ('assicurazioni',      'descrizione', 'contiene', ['UNIPOL', 'MANCINI ASSIC', 'ARTURO MANCINI'], None, 'entrambi'),
    ('banca',              'descrizione', 'inizia',   ['Commissioni', 'Comm.', 'Imposta di bollo', 'Interessi', 'Pagamento interessi', 'Spese'], None, 'entrambi'),
    ('fornitori_riba',     'descrizione', 'inizia',   ['Addebito RIBA'], None, 'entrambi'),
    ('assegni',            'descrizione', 'inizia',   ['Vs assegno'], None, 'entrambi'),
    ('fornitori_sdd',      'descrizione', 'inizia',   ['SDD'], None, 'uscita'),
    ('fornitori_bonifici', 'descrizione', 'inizia',   ['Bonifico'], None, 'uscita'),
    ('incassi_pos',        'descrizione', 'contiene', ['NUMIA', 'NEXI', 'PAGOBANCOMAT', 'INTERNAZ', 'SATISPAY', 'STRIPE', 'PAYPAL'], None, 'entrata'),
    ('versamenti',         'descrizione', 'inizia',   ['Versamento', 'Vers.'], None, 'entrata'),
    ('bonifici_clienti',   'descrizione', 'inizia',   ['Bonifico'], None, 'entrata'),
]


def upgrade():
    op.create_table(
        'tesoreria_conti',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('codice', sa.String(20), nullable=False, unique=True),
        sa.Column('nome', sa.String(100), nullable=False),
        sa.Column('banca', sa.String(100), nullable=True),
        sa.Column('tipo', sa.String(20), nullable=False),
        sa.Column('iban', sa.String(34), nullable=True, unique=True),
        sa.Column('fido', sa.Numeric(14, 2), nullable=False, server_default='0'),
        sa.Column('fido_scadenza', sa.Date, nullable=True),
        sa.Column('ha_import', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('colore', sa.String(7), nullable=True),
        sa.Column('ordine', sa.Integer, nullable=False, server_default='0'),
        sa.Column('attivo', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('note', sa.Text, nullable=True),
    )
    op.create_table(
        'tesoreria_import',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('conto_id', sa.Integer, sa.ForeignKey('tesoreria_conti.id'), nullable=False),
        sa.Column('nome_file', sa.String(255), nullable=False),
        sa.Column('sha256', sa.String(64), nullable=False, index=True),
        sa.Column('percorso', sa.String(500), nullable=True),
        sa.Column('data_da', sa.Date, nullable=True),
        sa.Column('data_a', sa.Date, nullable=True),
        sa.Column('n_movimenti', sa.Integer, nullable=False, server_default='0'),
        sa.Column('n_nuovi', sa.Integer, nullable=False, server_default='0'),
        sa.Column('n_gia_presenti', sa.Integer, nullable=False, server_default='0'),
        sa.Column('n_saldi', sa.Integer, nullable=False, server_default='0'),
        sa.Column('avvisi', sa.JSON, nullable=True),
        sa.Column('note', sa.Text, nullable=True),
        sa.Column('utente_id', sa.Integer, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        'tesoreria_saldi',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('conto_id', sa.Integer, sa.ForeignKey('tesoreria_conti.id'), nullable=False),
        sa.Column('data', sa.Date, nullable=False),
        sa.Column('saldo', sa.Numeric(14, 2), nullable=False),
        sa.Column('origine', sa.String(10), nullable=False),
        sa.Column('import_id', sa.Integer, sa.ForeignKey('tesoreria_import.id', ondelete='SET NULL'), nullable=True),
        sa.Column('note', sa.Text, nullable=True),
        sa.Column('utente_id', sa.Integer, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('conto_id', 'data', name='uq_tesoreria_saldo_conto_data'),
    )
    op.create_table(
        'tesoreria_categorie',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('codice', sa.String(40), nullable=False, unique=True),
        sa.Column('nome', sa.String(100), nullable=False),
        sa.Column('tipo', sa.String(10), nullable=False),
        sa.Column('colore', sa.String(7), nullable=True),
        sa.Column('ordine', sa.Integer, nullable=False, server_default='0'),
        sa.Column('escludi_da_operativo', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('attivo', sa.Boolean, nullable=False, server_default='true'),
    )
    op.create_table(
        'tesoreria_regole',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('categoria_id', sa.Integer, sa.ForeignKey('tesoreria_categorie.id', ondelete='CASCADE'), nullable=False),
        sa.Column('priorita', sa.Integer, nullable=False),
        sa.Column('campo', sa.String(15), nullable=False),
        sa.Column('operatore', sa.String(10), nullable=False),
        sa.Column('valori', sa.JSON, nullable=False),
        sa.Column('valori_anche', sa.JSON, nullable=True),
        sa.Column('segno', sa.String(10), nullable=False, server_default='entrambi'),
        sa.Column('attiva', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('note', sa.String(255), nullable=True),
    )
    op.create_table(
        'tesoreria_movimenti',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('conto_id', sa.Integer, sa.ForeignKey('tesoreria_conti.id'), nullable=False),
        sa.Column('import_id', sa.Integer, sa.ForeignKey('tesoreria_import.id', ondelete='CASCADE'), nullable=True),
        sa.Column('data_contabile', sa.Date, nullable=False),
        sa.Column('data_valuta', sa.Date, nullable=True),
        sa.Column('importo', sa.Numeric(14, 2), nullable=False),
        sa.Column('descrizione', sa.Text, nullable=False),
        sa.Column('controparte', sa.String(200), nullable=True),
        sa.Column('causale_abi', sa.String(10), nullable=True),
        sa.Column('riferimento_banca', sa.String(50), nullable=True),
        sa.Column('impronta', sa.String(80), nullable=False),
        sa.Column('categoria_id', sa.Integer, sa.ForeignKey('tesoreria_categorie.id', ondelete='SET NULL'), nullable=True),
        sa.Column('categoria_manuale', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('straordinario', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('note', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('conto_id', 'impronta', name='uq_tesoreria_movimento_impronta'),
    )
    op.create_index('ix_tesoreria_movimenti_conto_data', 'tesoreria_movimenti', ['conto_id', 'data_contabile'])
    op.create_index('ix_tesoreria_movimenti_categoria', 'tesoreria_movimenti', ['categoria_id'])

    conn = op.get_bind()
    for codice, nome, tipo, banca, iban, fido, scad, ha_import, colore, ordine in CONTI:
        conn.execute(
            sa.text("""
                INSERT INTO tesoreria_conti (codice, nome, tipo, banca, iban, fido, fido_scadenza,
                                             ha_import, colore, ordine)
                VALUES (:codice, :nome, :tipo, :banca, :iban, :fido, CAST(:scad AS DATE),
                        :ha_import, :colore, :ordine)
            """),
            dict(codice=codice, nome=nome, tipo=tipo, banca=banca, iban=iban, fido=fido,
                 scad=scad, ha_import=ha_import, colore=colore, ordine=ordine),
        )
    for ordine, (codice, nome, tipo, escludi, colore) in enumerate(CATEGORIE, start=1):
        conn.execute(
            sa.text("""
                INSERT INTO tesoreria_categorie (codice, nome, tipo, escludi_da_operativo, colore, ordine)
                VALUES (:codice, :nome, :tipo, :escludi, :colore, :ordine)
            """),
            dict(codice=codice, nome=nome, tipo=tipo, escludi=escludi, colore=colore, ordine=ordine),
        )
    for i, (cat, campo, operatore, valori, anche, segno) in enumerate(REGOLE, start=1):
        conn.execute(
            sa.text("""
                INSERT INTO tesoreria_regole (categoria_id, priorita, campo, operatore, valori,
                                              valori_anche, segno)
                SELECT id, :priorita, :campo, :operatore, CAST(:valori AS JSON),
                       CAST(:anche AS JSON), :segno
                FROM tesoreria_categorie WHERE codice = :cat
            """),
            dict(cat=cat, priorita=i * 10, campo=campo, operatore=operatore,
                 valori=json.dumps(valori), anche=json.dumps(anche) if anche else None, segno=segno),
        )

    op.execute("""
        INSERT INTO modules (code, name, description, icon, route, ordine, attivo, colore)
        VALUES ('tesoreria', 'TESORERIA', 'Flusso di cassa: posizione, consuntivo e previsione',
                '💰', '/tesoreria', 30, false, '#0f766e')
        ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
        INSERT INTO module_permissions (module_code, ruolo, puo_vedere, puo_modificare, puo_importare)
        VALUES
            ('tesoreria', 'admin',  true,  true,  true),
            ('tesoreria', 'viewer', false, false, false)
        ON CONFLICT (module_code, ruolo) DO NOTHING
    """)


def downgrade():
    op.execute("DELETE FROM user_module_permissions WHERE module_code = 'tesoreria'")
    op.execute("DELETE FROM module_permissions WHERE module_code = 'tesoreria'")
    op.execute("DELETE FROM modules WHERE code = 'tesoreria'")
    op.drop_index('ix_tesoreria_movimenti_categoria', table_name='tesoreria_movimenti')
    op.drop_index('ix_tesoreria_movimenti_conto_data', table_name='tesoreria_movimenti')
    op.drop_table('tesoreria_movimenti')
    op.drop_table('tesoreria_regole')
    op.drop_table('tesoreria_categorie')
    op.drop_table('tesoreria_saldi')
    op.drop_table('tesoreria_import')
    op.drop_table('tesoreria_conti')
