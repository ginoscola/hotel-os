"""Schema cleanup Giorno 1: aliquota_code + hotel_id su fiscal_documents,
drop fiscal_doc_vat e daily_cash_summary.

Revision ID: v2w3x4y5z6a7
Revises: u1v2w3x4y5z6
Create Date: 2026-05-24
"""
import sqlalchemy as sa
from alembic import op

revision = 'v2w3x4y5z6a7'
down_revision = 'u1v2w3x4y5z6'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Aggiungi aliquota_code a fiscal_documents
    op.add_column(
        'fiscal_documents',
        sa.Column('aliquota_code', sa.String(20), nullable=True),
    )

    # 2. Aggiungi hotel_id FK a fiscal_documents (nullable: alcune strutture potrebbero
    #    non corrispondere a un hotel nel DB, es. "SCONOSCIUTA")
    op.add_column(
        'fiscal_documents',
        sa.Column('hotel_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_fiscal_documents_hotel_id',
        'fiscal_documents', 'hotels',
        ['hotel_id'], ['id'],
        ondelete='SET NULL',
    )

    # 3. Popola hotel_id per le righe già in DB: mappa struttura_code → hotels.id
    op.execute("""
        UPDATE fiscal_documents fd
        SET hotel_id = h.id
        FROM hotels h
        WHERE fd.struttura_code = h.code
          AND fd.hotel_id IS NULL
    """)

    # 4. Drop fiscal_doc_vat (sempre vuota — IVA ora su aliquota_code)
    op.drop_table('fiscal_doc_vat')

    # 5. Drop daily_cash_summary (mai usata nei report — ricalcolata on-the-fly)
    op.drop_table('daily_cash_summary')


def downgrade():
    # Ricrea daily_cash_summary
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

    # Ricrea fiscal_doc_vat
    op.create_table(
        'fiscal_doc_vat',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('document_id', sa.Integer(), sa.ForeignKey('fiscal_documents.id'), nullable=False),
        sa.Column('vat_rate_id', sa.Integer(), sa.ForeignKey('vat_rates.id'), nullable=False),
        sa.Column('lordo', sa.Numeric(12, 2), nullable=True),
        sa.Column('imponibile', sa.Numeric(12, 2), nullable=True),
        sa.Column('iva', sa.Numeric(12, 2), nullable=True),
    )

    op.drop_constraint('fk_fiscal_documents_hotel_id', 'fiscal_documents', type_='foreignkey')
    op.drop_column('fiscal_documents', 'hotel_id')
    op.drop_column('fiscal_documents', 'aliquota_code')
