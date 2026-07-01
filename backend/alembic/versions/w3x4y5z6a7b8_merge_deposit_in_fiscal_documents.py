"""Merge Deposit in FiscalDocument: aggiungi is_deposit e stato_deposito,
drop deposit_usages e deposits.

Revision ID: w3x4y5z6a7b8
Revises: v2w3x4y5z6a7
Create Date: 2026-05-24
"""
import sqlalchemy as sa
from alembic import op

revision = 'w3x4y5z6a7b8'
down_revision = 'v2w3x4y5z6a7'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Aggiungi is_deposit e stato_deposito a fiscal_documents
    op.add_column(
        'fiscal_documents',
        sa.Column('is_deposit', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.add_column(
        'fiscal_documents',
        sa.Column('stato_deposito', sa.String(20), nullable=True),
    )

    # 2. Popola is_deposit=true per i documenti CP già in DB
    op.execute("""
        UPDATE fiscal_documents fd
        SET is_deposit = true,
            stato_deposito = 'attivo'
        FROM fiscal_doc_types fdt
        WHERE fd.tipo_doc_id = fdt.id
          AND fdt.code = 'CP'
    """)

    # 3. Dove caparra_usata > 0 → stato_deposito = 'utilizzato'
    op.execute("""
        UPDATE fiscal_documents
        SET stato_deposito = 'utilizzato'
        WHERE is_deposit = true
          AND caparra_usata IS NOT NULL AND caparra_usata > 0
    """)

    # 4. Drop deposit_usages (nessun uso attivo, 0 righe)
    op.drop_table('deposit_usages')

    # 5. Drop deposits (dati già coperti da FiscalDocument CP)
    op.drop_table('deposits')


def downgrade():
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
    op.create_table(
        'deposit_usages',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('deposit_id', sa.Integer(), sa.ForeignKey('deposits.id'), nullable=False),
        sa.Column('document_id', sa.Integer(), sa.ForeignKey('fiscal_documents.id'), nullable=False),
        sa.Column('importo_usato', sa.Numeric(12, 2), nullable=True),
        sa.Column('data_utilizzo', sa.Date(), nullable=False),
        sa.Column('note_utilizzo', sa.Text(), nullable=True),
    )
    op.drop_column('fiscal_documents', 'stato_deposito')
    op.drop_column('fiscal_documents', 'is_deposit')
