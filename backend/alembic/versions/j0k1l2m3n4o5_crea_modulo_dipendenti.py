"""Crea tabelle modulo Spese Dipendenti: employees, cost_centers,
employee_cost_center, payroll_imports, payroll_cost_types,
payroll_entries, employee_monthly.

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
Create Date: 2026-05-15

"""
from alembic import op
import sqlalchemy as sa

revision = 'j0k1l2m3n4o5'
down_revision = 'i9j0k1l2m3n4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -----------------------------------------------------------------------
    # employees — anagrafica dipendenti
    # -----------------------------------------------------------------------
    op.create_table(
        'employees',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('codice_fiscale', sa.String(20), unique=True, nullable=False),
        sa.Column('cognome', sa.String(100), nullable=False),
        sa.Column('nome', sa.String(100), nullable=False),
        sa.Column('indirizzo', sa.Text(), nullable=True),
        sa.Column('qualifica', sa.String(100), nullable=True),
        sa.Column('mansione', sa.String(100), nullable=True),
        sa.Column('livello', sa.String(20), nullable=True),
        sa.Column('attivo', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )

    # -----------------------------------------------------------------------
    # cost_centers — centri di costo (strutture e futuri reparti)
    # -----------------------------------------------------------------------
    op.create_table(
        'cost_centers',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(50), unique=True, nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('tipo', sa.String(50), nullable=False, server_default='struttura'),
        sa.Column('parent_id', sa.Integer(), sa.ForeignKey('cost_centers.id'), nullable=True),
        sa.Column('hotel_id', sa.Integer(), sa.ForeignKey('hotels.id'), nullable=True),
        sa.Column('attivo', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('ordine', sa.Integer(), nullable=False, server_default='0'),
    )

    # Centri di costo base
    op.execute("""
        INSERT INTO cost_centers (code, name, tipo, attivo, ordine) VALUES
        ('CLB',    'Club Hotel',           'struttura', true, 1),
        ('DPH',    'Hotel Du Parc',        'struttura', true, 2),
        ('INT',    'Hotel International',  'struttura', true, 3),
        ('KMDIMARE', 'KM Di Mare',          'struttura', true, 4)
    """)

    # Collega i centri di costo agli hotel dove possibile
    op.execute("""
        UPDATE cost_centers cc
        SET hotel_id = h.id
        FROM hotels h
        WHERE h.code = cc.code
    """)

    # -----------------------------------------------------------------------
    # employee_cost_center — assegnazione dipendente a centro di costo
    # -----------------------------------------------------------------------
    op.create_table(
        'employee_cost_center',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('employee_id', sa.Integer(), sa.ForeignKey('employees.id'), nullable=False),
        sa.Column('cost_center_id', sa.Integer(), sa.ForeignKey('cost_centers.id'), nullable=False),
        sa.Column('percentuale', sa.Numeric(5, 2), nullable=False, server_default='100.00'),
        sa.Column('data_inizio', sa.Date(), nullable=False),
        sa.Column('data_fine', sa.Date(), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.UniqueConstraint('employee_id', 'cost_center_id', 'data_inizio',
                            name='uq_emp_cc_data_inizio'),
    )

    # -----------------------------------------------------------------------
    # payroll_imports — registro caricamenti PDF
    # -----------------------------------------------------------------------
    op.create_table(
        'payroll_imports',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('nome_file', sa.String(255), nullable=False),
        sa.Column('mese', sa.Integer(), nullable=False),
        sa.Column('anno', sa.Integer(), nullable=False),
        sa.Column('societa', sa.String(200), nullable=True),
        sa.Column('n_dipendenti', sa.Integer(), nullable=True),
        sa.Column('totale_netto', sa.Numeric(12, 2), nullable=True),
        sa.Column('totale_lordo', sa.Numeric(12, 2), nullable=True),
        sa.Column('totale_costo_aziendale', sa.Numeric(12, 2), nullable=True),
        sa.Column('stato', sa.String(20), nullable=False, server_default='importato'),
        sa.Column('imported_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.UniqueConstraint('mese', 'anno', 'societa', name='uq_payroll_mese_anno_societa'),
    )

    # -----------------------------------------------------------------------
    # payroll_cost_types — tipi di voci di costo (NON hardcoded)
    # -----------------------------------------------------------------------
    op.create_table(
        'payroll_cost_types',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(50), unique=True, nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('categoria', sa.String(50), nullable=False),
        sa.Column('segno', sa.String(10), nullable=False, server_default='positivo'),
        sa.Column('ordine', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('attivo', sa.Boolean(), nullable=False, server_default='true'),
    )

    # Voci di costo — categoria dipendente
    op.execute("""
        INSERT INTO payroll_cost_types (code, name, categoria, segno, ordine) VALUES
        ('ret_netta',      'Retribuzione Netta',                       'dipendente', 'positivo', 1),
        ('contr_prev_dip', 'Contributi Previdenziali',                 'dipendente', 'positivo', 2),
        ('contr_san_dip',  'Contributo Servizio Sanitario Nazionale',  'dipendente', 'positivo', 3),
        ('irpef',          'Tassazione IRPEF',                         'dipendente', 'positivo', 4),
        ('altre_trattenute','Altre Trattenute',                        'dipendente', 'positivo', 5),
        ('anticipi_inps',  'Anticipi Azienda c/o INPS',               'dipendente', 'negativo', 6),
        ('tot_lordo',      'Totale Retribuzione Lorda',                'dipendente', 'positivo', 7)
    """)

    # Voci di costo — categoria azienda
    op.execute("""
        INSERT INTO payroll_cost_types (code, name, categoria, segno, ordine) VALUES
        ('contr_prev_az',  'Contribuzione Previdenziale Azienda',          'azienda', 'positivo', 8),
        ('contr_san_az',   'Contribuzione Serv. Sanitario Azienda',        'azienda', 'positivo', 9),
        ('inail',          'Contribuzione INAIL (Infortuni) Azienda',      'azienda', 'positivo', 10),
        ('altri_enti',     'Contribuzione Altri Enti',                     'azienda', 'positivo', 11),
        ('tfr',            'Accantonamento TFR',                           'azienda', 'positivo', 12),
        ('tot_costo_az',   'Totale Costo Aziendale Effettivo',             'azienda', 'positivo', 13)
    """)

    # -----------------------------------------------------------------------
    # payroll_entries — voci di costo per dipendente per mese
    # -----------------------------------------------------------------------
    op.create_table(
        'payroll_entries',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('import_id', sa.Integer(), sa.ForeignKey('payroll_imports.id', ondelete='CASCADE'), nullable=False),
        sa.Column('employee_id', sa.Integer(), sa.ForeignKey('employees.id'), nullable=False),
        sa.Column('cost_type_id', sa.Integer(), sa.ForeignKey('payroll_cost_types.id'), nullable=False),
        sa.Column('importo', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.UniqueConstraint('import_id', 'employee_id', 'cost_type_id',
                            name='uq_entry_import_emp_type'),
    )

    # -----------------------------------------------------------------------
    # employee_monthly — riepilogo mensile per dipendente
    # -----------------------------------------------------------------------
    op.create_table(
        'employee_monthly',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('import_id', sa.Integer(), sa.ForeignKey('payroll_imports.id', ondelete='CASCADE'), nullable=False),
        sa.Column('employee_id', sa.Integer(), sa.ForeignKey('employees.id'), nullable=False),
        sa.Column('cost_center_id', sa.Integer(), sa.ForeignKey('cost_centers.id'), nullable=True),
        sa.Column('percentuale_cc', sa.Numeric(5, 2), nullable=False, server_default='100.00'),
        sa.Column('retribuzione_netta', sa.Numeric(12, 2), nullable=True),
        sa.Column('totale_lordo', sa.Numeric(12, 2), nullable=True),
        sa.Column('costo_aziendale', sa.Numeric(12, 2), nullable=True),
        sa.Column('incidenza_percentuale', sa.Numeric(6, 2), nullable=True),
        sa.Column('override_manuale', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('note', sa.Text(), nullable=True),
        sa.UniqueConstraint('import_id', 'employee_id', name='uq_monthly_import_emp'),
    )


def downgrade() -> None:
    op.drop_table('employee_monthly')
    op.drop_table('payroll_entries')
    op.drop_table('payroll_cost_types')
    op.drop_table('payroll_imports')
    op.drop_table('employee_cost_center')
    op.drop_table('cost_centers')
    op.drop_table('employees')
