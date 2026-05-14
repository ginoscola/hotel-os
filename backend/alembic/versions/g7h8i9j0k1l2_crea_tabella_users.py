"""Crea la tabella users e inserisce l'admin di default."""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'g7h8i9j0k1l2'
down_revision = 'f5a6b7c8d9e0'
branch_labels = None
depend_on = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', sa.Integer, primary_key=True, index=True),
        sa.Column('username', sa.String(50), nullable=False, unique=True, index=True),
        sa.Column('email', sa.String(100), nullable=True, unique=True, index=True),
        sa.Column('password_hash', sa.String(255), nullable=False),
        sa.Column('ruolo', sa.String(20), nullable=False, server_default='viewer'),
        sa.Column('attivo', sa.Boolean, nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('last_login', sa.DateTime(timezone=True), nullable=True),
    )

    # Admin di default con password admin2024
    op.execute(
        "INSERT INTO users (username, email, password_hash, ruolo, attivo) VALUES ('admin', 'admin@revenue.local', '$2b$12$ksH5ZeddrbAVhnCv4fK9Fu2cJOMurTeM1bYB5YCf.wxT2fwaEzb/O', 'admin', true);"
    )


def downgrade() -> None:
    op.drop_table('users')
