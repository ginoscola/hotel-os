"""Crea tabelle modules, module_permissions e data_connections per architettura modulare.

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
Create Date: 2026-05-14

"""
from alembic import op
import sqlalchemy as sa

revision = 'i9j0k1l2m3n4'
down_revision = ('a9b0c1d2e3f4', 'h8i9j0k1l2m3')  # merge dei due branch paralleli
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -----------------------------------------------------------------------
    # Tabella modules
    # -----------------------------------------------------------------------
    op.create_table(
        'modules',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(50), unique=True, nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('icon', sa.String(50), nullable=True),
        sa.Column('route', sa.String(100), nullable=True),
        sa.Column('ordine', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('attivo', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('colore', sa.String(20), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )

    # -----------------------------------------------------------------------
    # Tabella module_permissions
    # -----------------------------------------------------------------------
    op.create_table(
        'module_permissions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('module_code', sa.String(50), sa.ForeignKey('modules.code', ondelete='CASCADE'), nullable=False),
        sa.Column('ruolo', sa.String(20), nullable=False),
        sa.Column('puo_vedere', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('puo_modificare', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('puo_importare', sa.Boolean(), nullable=False, server_default='false'),
        sa.UniqueConstraint('module_code', 'ruolo', name='uq_module_ruolo'),
    )

    # -----------------------------------------------------------------------
    # Tabella data_connections (mappa interconnessioni future tra moduli)
    # -----------------------------------------------------------------------
    op.create_table(
        'data_connections',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('source_module', sa.String(50), sa.ForeignKey('modules.code', ondelete='CASCADE'), nullable=False),
        sa.Column('target_module', sa.String(50), sa.ForeignKey('modules.code', ondelete='CASCADE'), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('attivo', sa.Boolean(), nullable=False, server_default='true'),
    )

    # -----------------------------------------------------------------------
    # Dati iniziali — moduli
    # -----------------------------------------------------------------------
    op.execute("""
        INSERT INTO modules (code, name, description, icon, route, ordine, attivo, colore) VALUES
        ('revenue',       'Revenue & Statistiche', 'Reporting revenue e KPI alberghieri',         '📊', '/dashboard/gruppo', 1, true, '#2d6a9f'),
        ('budget',        'Budget',                'Pianificazione e controllo budget annuale',   '🎯', '/budget',           2, true, '#059669'),
        ('usali',         'USALI',                 'Uniform System of Accounts for the Lodging Industry', '📋', '/usali', 3, true, '#7c3aed'),
        ('dipendenti',    'Spese Dipendenti',      'Gestione costi del personale',                '👥', '/dipendenti',       4, true, '#d97706'),
        ('corrispettivi', 'Corrispettivi',         'Gestione corrispettivi fiscali',              '🧾', '/corrispettivi',    5, true, '#dc2626')
    """)

    # -----------------------------------------------------------------------
    # Dati iniziali — permessi
    # -----------------------------------------------------------------------
    op.execute("""
        INSERT INTO module_permissions (module_code, ruolo, puo_vedere, puo_modificare, puo_importare)
        SELECT code, 'admin', true, true, true FROM modules
    """)
    op.execute("""
        INSERT INTO module_permissions (module_code, ruolo, puo_vedere, puo_modificare, puo_importare)
        SELECT code, 'viewer', true, false, false FROM modules
    """)

    # -----------------------------------------------------------------------
    # Dati iniziali — connessioni tra moduli
    # -----------------------------------------------------------------------
    op.execute("""
        INSERT INTO data_connections (source_module, target_module, description, attivo) VALUES
        ('revenue',       'budget',  'Dati actual per confronto con budget',          true),
        ('revenue',       'usali',   'Ricavi per riclassificazione USALI',            true),
        ('dipendenti',    'usali',   'Costi personale per conto economico USALI',     true),
        ('corrispettivi', 'usali',   'Ricavi fiscali per riconciliazione USALI',      true)
    """)


def downgrade() -> None:
    op.drop_table('data_connections')
    op.drop_table('module_permissions')
    op.drop_table('modules')
