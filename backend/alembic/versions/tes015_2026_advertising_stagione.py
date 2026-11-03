"""Tesoreria: piano advertising per anno alberghiero (ottobre–settembre, anno = anno di fine) invece che solare.

Converte i piani esistenti: ottobre–dicembre di un anno solare passano alla stagione dell'anno dopo. Totale di ogni
stagione = somma dei suoi mesi; carta e nota dal piano di provenienza.

Revision ID: tes015_2026
Revises: tes014_2026
"""
import sqlalchemy as sa
from alembic import op

revision = 'tes015_2026'
down_revision = 'tes014_2026'
branch_labels = None
depends_on = None


def _converti(nuovo_anno):
    """`nuovo_anno(anno, mese)` → anno del piano di destinazione. Ricrea i piani raggruppando i mesi."""
    conn = op.get_bind()
    piani = {r.id: r for r in conn.execute(sa.text("SELECT id, anno, conto_id, nota FROM tesoreria_advertising"))}
    mesi = conn.execute(sa.text("SELECT advertising_id, mese, importo FROM tesoreria_advertising_mesi")).fetchall()
    gruppi = {}
    for m in mesi:
        p = piani[m.advertising_id]
        g = gruppi.setdefault(nuovo_anno(p.anno, m.mese), {"conto_id": p.conto_id, "note": [], "mesi": {}})
        if p.nota and p.nota not in g["note"]:
            g["note"].append(p.nota)
        g["mesi"][m.mese] = m.importo
    conn.execute(sa.text("DELETE FROM tesoreria_advertising"))
    for anno, g in sorted(gruppi.items()):
        nuovo_id = conn.execute(sa.text(
            "INSERT INTO tesoreria_advertising (anno, conto_id, totale, nota) VALUES (:a, :c, :t, :n) RETURNING id"),
            {"a": anno, "c": g["conto_id"], "t": sum(g["mesi"].values()), "n": " · ".join(g["note"])[:255] or None}).scalar()
        for mese, importo in g["mesi"].items():
            conn.execute(sa.text("INSERT INTO tesoreria_advertising_mesi (advertising_id, mese, importo) VALUES (:p, :m, :i)"),
                         {"p": nuovo_id, "m": mese, "i": importo})


def upgrade():
    _converti(lambda anno, mese: anno + 1 if mese >= 10 else anno)


def downgrade():
    _converti(lambda anno, mese: anno - 1 if mese >= 10 else anno)
