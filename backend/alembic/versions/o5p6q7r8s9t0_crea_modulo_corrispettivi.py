"""Crea tabelle modulo Corrispettivi: fiscal_doc_types, payment_types,
vat_rates, struttura_prefissi, stay_types, fiscal_doc_imports,
fiscal_documents, fiscal_doc_vat, deposits, deposit_usages,
suspensions, daily_cash_summary.

Revision ID: o5p6q7r8s9t0
Revises: n4o5p6q7r8s9
Create Date: 2026-05-21

"""
from alembic import op
import sqlalchemy as sa

revision = 'o5p6q7r8s9t0'
down_revision = 'n4o5p6q7r8s9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -----------------------------------------------------------------------
    # fiscal_doc_types — tipi documento fiscale (configurabili da admin)
    # -----------------------------------------------------------------------
    op.create_table(
        'fiscal_doc_types',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(20), unique=True, nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('descrizione', sa.Text(), nullable=True),
        sa.Column('attivo', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    op.execute("""
        INSERT INTO fiscal_doc_types (code, name, descrizione) VALUES
        ('SC',  'Scontrino',                    'Scontrino fiscale standard'),
        ('SCA', 'Scontrino Acconto',            'Scontrino per acconto/caparra'),
        ('CP',  'Caparra/Deposito',             'Caparra o deposito cauzionale'),
        ('F',   'Fattura',                      'Fattura fiscale'),
        ('FD',  'Da Addebitare ad Agenzia',     'Documento da addebitare ad agenzia')
    """)

    # -----------------------------------------------------------------------
    # payment_types — tipi pagamento (configurabili da admin)
    # -----------------------------------------------------------------------
    op.create_table(
        'payment_types',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(50), unique=True, nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('attivo', sa.Boolean(), nullable=False, server_default='true'),
    )
    op.execute("""
        INSERT INTO payment_types (code, name) VALUES
        ('CONTANTE',       'Contante'),
        ('BONIFICO',       'Bonifico/Vaglia'),
        ('ASSEGNO',        'Assegno'),
        ('BANCOMAT',       'Bancomat'),
        ('CARTA_CREDITO',  'Carta Credito'),
        ('XPAY_NEXI',      'XPAY-Nexi'),
        ('SATISPAY',       'Satispay'),
        ('ANNULLATO',      'ANNULLATO')
    """)

    # -----------------------------------------------------------------------
    # vat_rates — aliquote IVA (configurabili da admin)
    # -----------------------------------------------------------------------
    op.create_table(
        'vat_rates',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(20), unique=True, nullable=False),
        sa.Column('aliquota', sa.Numeric(5, 2), nullable=False),
        sa.Column('descrizione', sa.String(100), nullable=True),
        sa.Column('attivo', sa.Boolean(), nullable=False, server_default='true'),
    )
    op.execute("""
        INSERT INTO vat_rates (code, aliquota, descrizione) VALUES
        ('10',  10.00, 'Aliquota standard 10%'),
        ('A10', 10.00, 'Nota di credito/storno 10%'),
        ('E15',  0.00, 'Esente IVA')
    """)

    # -----------------------------------------------------------------------
    # struttura_prefissi — regole di riconoscimento struttura da campo camera
    # -----------------------------------------------------------------------
    op.create_table(
        'struttura_prefissi',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('prefisso', sa.String(20), unique=True, nullable=False),
        sa.Column('struttura_code', sa.String(20), nullable=False),
        sa.Column('tipo', sa.String(20), nullable=False, server_default='lettera_iniziale'),
        # tipo: 'lettera_iniziale', 'nome_esatto', 'contiene'
    )
    op.execute("""
        INSERT INTO struttura_prefissi (prefisso, struttura_code, tipo) VALUES
        ('D',        'DPH', 'lettera_iniziale'),
        ('C',        'CLB', 'lettera_iniziale'),
        ('I',        'INT', 'lettera_iniziale'),
        ('FUEGO',    'DPH', 'nome_esatto'),
        ('AGUA',     'DPH', 'nome_esatto'),
        ('TIERRA',   'DPH', 'nome_esatto'),
        ('AIRE',     'DPH', 'nome_esatto'),
        ('MMS',      'MMS', 'nome_esatto'),
        ('Ristorante','MMS','contiene'),
        ('BON',      'BON', 'nome_esatto')
    """)

    # -----------------------------------------------------------------------
    # stay_types — tipi soggiorno (vuota per ora, pronta per espansione futura)
    # -----------------------------------------------------------------------
    op.create_table(
        'stay_types',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(20), unique=True, nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('attivo', sa.Boolean(), nullable=False, server_default='true'),
    )

    # -----------------------------------------------------------------------
    # fiscal_doc_imports — registro caricamenti PDF
    # -----------------------------------------------------------------------
    op.create_table(
        'fiscal_doc_imports',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('nome_file', sa.String(255), nullable=False),
        sa.Column('data_da', sa.Date(), nullable=False),
        sa.Column('data_a', sa.Date(), nullable=False),
        sa.Column('societa', sa.String(200), nullable=True),
        sa.Column('data_stampa', sa.DateTime(timezone=True), nullable=True),
        sa.Column('utente_pms', sa.String(100), nullable=True),
        sa.Column('n_documenti', sa.Integer(), nullable=True),
        sa.Column('totale_lordo', sa.Numeric(12, 2), nullable=True),
        sa.Column('totale_incassato', sa.Numeric(12, 2), nullable=True),
        sa.Column('totale_sospeso', sa.Numeric(12, 2), nullable=True),
        sa.Column('checksum_ok', sa.Boolean(), nullable=True),
        sa.Column('note_verifica', sa.Text(), nullable=True),
        sa.Column('is_test', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('imported_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )

    # -----------------------------------------------------------------------
    # fiscal_documents — ogni documento fiscale emesso
    # -----------------------------------------------------------------------
    op.create_table(
        'fiscal_documents',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('import_id', sa.Integer(), sa.ForeignKey('fiscal_doc_imports.id'), nullable=False),
        sa.Column('data_documento', sa.Date(), nullable=False),
        sa.Column('tipo_doc_id', sa.Integer(), sa.ForeignKey('fiscal_doc_types.id'), nullable=False),
        sa.Column('numero', sa.Integer(), nullable=True),
        sa.Column('suffisso', sa.String(10), nullable=True),
        sa.Column('camera', sa.String(50), nullable=True),
        sa.Column('struttura_code', sa.String(20), nullable=True),
        sa.Column('intestazione', sa.String(500), nullable=True),
        sa.Column('indirizzo', sa.Text(), nullable=True),
        sa.Column('totale', sa.Numeric(12, 2), nullable=True),
        sa.Column('incassato', sa.Numeric(12, 2), nullable=True),
        sa.Column('sospeso', sa.Numeric(12, 2), nullable=True),
        sa.Column('payment_type_id', sa.Integer(), sa.ForeignKey('payment_types.id'), nullable=True),
        sa.Column('imponibile', sa.Numeric(12, 2), nullable=True),
        sa.Column('iva', sa.Numeric(12, 2), nullable=True),
        sa.Column('soggetto_acconto', sa.Numeric(12, 2), nullable=True),
        sa.Column('annullato', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('is_test', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('tipo_soggiorno', sa.String(50), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.UniqueConstraint('import_id', 'tipo_doc_id', 'numero', 'suffisso',
                            name='uq_fiscal_doc_import_tipo_num_suf'),
    )

    # -----------------------------------------------------------------------
    # fiscal_doc_vat — righe IVA per documento
    # -----------------------------------------------------------------------
    op.create_table(
        'fiscal_doc_vat',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('document_id', sa.Integer(), sa.ForeignKey('fiscal_documents.id'), nullable=False),
        sa.Column('vat_rate_id', sa.Integer(), sa.ForeignKey('vat_rates.id'), nullable=False),
        sa.Column('lordo', sa.Numeric(12, 2), nullable=True),
        sa.Column('imponibile', sa.Numeric(12, 2), nullable=True),
        sa.Column('iva', sa.Numeric(12, 2), nullable=True),
    )

    # -----------------------------------------------------------------------
    # deposits — caparre e depositi
    # -----------------------------------------------------------------------
    op.create_table(
        'deposits',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('import_id', sa.Integer(), sa.ForeignKey('fiscal_doc_imports.id'), nullable=False),
        sa.Column('data_versamento', sa.Date(), nullable=False),
        sa.Column('camera', sa.String(50), nullable=True),
        sa.Column('struttura_code', sa.String(20), nullable=True),
        sa.Column('numero', sa.Integer(), nullable=True),
        sa.Column('intestazione', sa.String(500), nullable=True),
        sa.Column('importo', sa.Numeric(12, 2), nullable=True),
        sa.Column('payment_type_id', sa.Integer(), sa.ForeignKey('payment_types.id'), nullable=True),
        sa.Column('document_id', sa.Integer(), sa.ForeignKey('fiscal_documents.id'), nullable=True),
        sa.Column('stato', sa.String(20), nullable=False, server_default='attivo'),
        sa.Column('is_test', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('note', sa.Text(), nullable=True),
    )

    # -----------------------------------------------------------------------
    # deposit_usages — utilizzo caparre
    # -----------------------------------------------------------------------
    op.create_table(
        'deposit_usages',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('deposit_id', sa.Integer(), sa.ForeignKey('deposits.id'), nullable=False),
        sa.Column('document_id', sa.Integer(), sa.ForeignKey('fiscal_documents.id'), nullable=False),
        sa.Column('importo_usato', sa.Numeric(12, 2), nullable=True),
        sa.Column('data_utilizzo', sa.Date(), nullable=False),
        sa.Column('note_utilizzo', sa.Text(), nullable=True),
    )

    # -----------------------------------------------------------------------
    # suspensions — sospesi da incassare
    # -----------------------------------------------------------------------
    op.create_table(
        'suspensions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('document_id', sa.Integer(), sa.ForeignKey('fiscal_documents.id'), nullable=False),
        sa.Column('intestazione', sa.String(500), nullable=True),
        sa.Column('importo_sospeso', sa.Numeric(12, 2), nullable=True),
        sa.Column('stato', sa.String(20), nullable=False, server_default='da_incassare'),
        sa.Column('data_incasso', sa.Date(), nullable=True),
        sa.Column('payment_type_id', sa.Integer(), sa.ForeignKey('payment_types.id'), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )

    # -----------------------------------------------------------------------
    # daily_cash_summary — riepilogo giornaliero per struttura
    # -----------------------------------------------------------------------
    op.create_table(
        'daily_cash_summary',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('import_id', sa.Integer(), sa.ForeignKey('fiscal_doc_imports.id'), nullable=False),
        sa.Column('data_giorno', sa.Date(), nullable=False),
        sa.Column('struttura_code', sa.String(20), nullable=False),
        sa.Column('totale_lordo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('totale_incassato', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('totale_sospeso', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('totale_iva', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('totale_imponibile', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('n_documenti', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('checksum_ok', sa.Boolean(), nullable=True),
        sa.UniqueConstraint('import_id', 'data_giorno', 'struttura_code',
                            name='uq_daily_cash_import_giorno_struttura'),
    )


def downgrade() -> None:
    op.drop_table('daily_cash_summary')
    op.drop_table('suspensions')
    op.drop_table('deposit_usages')
    op.drop_table('deposits')
    op.drop_table('fiscal_doc_vat')
    op.drop_table('fiscal_documents')
    op.drop_table('fiscal_doc_imports')
    op.drop_table('stay_types')
    op.drop_table('struttura_prefissi')
    op.drop_table('vat_rates')
    op.drop_table('payment_types')
    op.drop_table('fiscal_doc_types')
