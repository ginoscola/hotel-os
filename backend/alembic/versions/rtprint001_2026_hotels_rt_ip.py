"""aggiunge rt_ip a hotels

Revision ID: rtprint001_2026
Revises: usali001_2026
Create Date: 2026-07-01

Aggiunge la colonna hotels.rt_ip (IP del registratore telematico Epson
FP-81 II per l'invio comandi X/Z/STATUS dalla sezione "Stampante RT" di
Corrispettivi). NULL = nessun RT configurato per quell'hotel.
"""
from alembic import op
import sqlalchemy as sa


revision = 'rtprint001_2026'
down_revision = 'usali001_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('hotels', sa.Column('rt_ip', sa.String(length=50), nullable=True))

    hotels = sa.table('hotels', sa.column('code', sa.String), sa.column('rt_ip', sa.String))
    op.execute(hotels.update().where(hotels.c.code.in_(['DPH', 'CLB'])).values(rt_ip='192.168.100.134'))
    op.execute(hotels.update().where(hotels.c.code == 'INT').values(rt_ip='192.168.10.110'))


def downgrade():
    op.drop_column('hotels', 'rt_ip')
