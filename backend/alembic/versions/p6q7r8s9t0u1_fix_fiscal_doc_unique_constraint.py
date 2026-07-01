"""Fix constraint univoco fiscal_documents: sostituisce (import_id, tipo_doc_id, numero, suffisso)
con (import_id, data_documento, tipo_doc_id, numero, suffisso, camera) — i CP con numero=0
hanno lo stesso suffisso per struttura ma camera diversa.

Revision ID: p6q7r8s9t0u1
Revises: o5p6q7r8s9t0
Create Date: 2026-05-21
"""
from alembic import op

revision = 'p6q7r8s9t0u1'
down_revision = 'o5p6q7r8s9t0'
branch_labels = None
depends_on = None


def upgrade():
    # Rimuove il constraint troppo restrittivo
    op.drop_constraint('uq_fiscal_doc_import_tipo_num_suf', 'fiscal_documents', type_='unique')

    # Aggiunge constraint corretto: include data e camera
    # Per SC/SCA/F i numeri sono già univoci per suffisso
    # Per CP con numero=0 la combinazione data+camera li distingue
    op.create_unique_constraint(
        'uq_fiscal_doc_import_data_tipo_num_suf_cam',
        'fiscal_documents',
        ['import_id', 'data_documento', 'tipo_doc_id', 'numero', 'suffisso', 'camera'],
    )


def downgrade():
    op.drop_constraint('uq_fiscal_doc_import_data_tipo_num_suf_cam', 'fiscal_documents', type_='unique')
    op.create_unique_constraint(
        'uq_fiscal_doc_import_tipo_num_suf',
        'fiscal_documents',
        ['import_id', 'tipo_doc_id', 'numero', 'suffisso'],
    )
