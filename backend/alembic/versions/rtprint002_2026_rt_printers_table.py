"""crea tabella rt_printers, sostituisce hotels.rt_ip con rt_printer_id

Revision ID: rtprint002_2026
Revises: rtprint001_2026
Create Date: 2026-07-01

Normalizza la gestione delle stampanti fiscali: più hotel possono condividere
lo stesso registratore telematico (es. Du Parc + Club Hotel), quindi l'IP
va gestito su una tabella dedicata `rt_printers` e non più come stringa
duplicata su `hotels.rt_ip`.
"""
from alembic import op
import sqlalchemy as sa


revision = 'rtprint002_2026'
down_revision = 'rtprint001_2026'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'rt_printers',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('nome', sa.String(length=100), nullable=False),
        sa.Column('ip', sa.String(length=50), nullable=False, unique=True),
    )
    op.add_column('hotels', sa.Column('rt_printer_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_hotels_rt_printer_id', 'hotels', 'rt_printers',
        ['rt_printer_id'], ['id'], ondelete='SET NULL',
    )

    rt_printers = sa.table('rt_printers', sa.column('id', sa.Integer), sa.column('nome', sa.String), sa.column('ip', sa.String))
    hotels = sa.table('hotels', sa.column('code', sa.String), sa.column('rt_ip', sa.String), sa.column('rt_printer_id', sa.Integer))

    conn = op.get_bind()

    conn.execute(rt_printers.insert().values(nome='Du Parc / Club Hotel', ip='192.168.100.134'))
    conn.execute(rt_printers.insert().values(nome='Hotel International', ip='192.168.10.110'))

    id_duparc = conn.execute(sa.select(rt_printers.c.id).where(rt_printers.c.ip == '192.168.100.134')).scalar()
    id_int = conn.execute(sa.select(rt_printers.c.id).where(rt_printers.c.ip == '192.168.10.110')).scalar()

    conn.execute(hotels.update().where(hotels.c.code.in_(['DPH', 'CLB'])).values(rt_printer_id=id_duparc))
    conn.execute(hotels.update().where(hotels.c.code == 'INT').values(rt_printer_id=id_int))

    op.drop_column('hotels', 'rt_ip')


def downgrade():
    op.add_column('hotels', sa.Column('rt_ip', sa.String(length=50), nullable=True))

    rt_printers = sa.table('rt_printers', sa.column('id', sa.Integer), sa.column('ip', sa.String))
    hotels = sa.table('hotels', sa.column('rt_printer_id', sa.Integer), sa.column('rt_ip', sa.String))
    conn = op.get_bind()
    for printer_id, ip in conn.execute(sa.select(rt_printers.c.id, rt_printers.c.ip)):
        conn.execute(hotels.update().where(hotels.c.rt_printer_id == printer_id).values(rt_ip=ip))

    op.drop_constraint('fk_hotels_rt_printer_id', 'hotels', type_='foreignkey')
    op.drop_column('hotels', 'rt_printer_id')
    op.drop_table('rt_printers')
