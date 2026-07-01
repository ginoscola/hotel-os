"""Rimuove il constraint univoco da fiscal_documents.
L'idempotenza dell'import è gestita a livello di sessione (fiscal_doc_imports),
non a livello di singolo documento. Lo stesso file non può essere importato due volte
perché la sessione import viene controllata prima.

Revision ID: q7r8s9t0u1v2
Revises: p6q7r8s9t0u1
Create Date: 2026-05-21
"""
from alembic import op

revision = 'q7r8s9t0u1v2'
down_revision = 'p6q7r8s9t0u1'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint('uq_fiscal_doc_import_data_tipo_num_suf_cam', 'fiscal_documents', type_='unique')


def downgrade():
    op.create_unique_constraint(
        'uq_fiscal_doc_import_data_tipo_num_suf_cam',
        'fiscal_documents',
        ['import_id', 'data_documento', 'tipo_doc_id', 'numero', 'suffisso', 'camera'],
    )
