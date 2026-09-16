"""usali005 — Maremosso come struttura CC propria per il costo del lavoro.

In Conto Economico USALI ricavi pranzo/cena erano già attribuiti a MMS (auto_maremosso), ma
il personale Cucina/Sala/Bar restava sotto Hotel Du Parc nell'albero centri di costo — nessun
nodo struttura 'MMS' esisteva, quindi _lavoro_da_dipendenti() risaliva sempre fino a DPH.
Risultato: costo del lavoro F&B tutto su DPH, ricavo pranzo/cena già su MMS (EBITDAR distorto
su entrambe le strutture). Confermato dall'utente: Cucina/Sala/Bar lavorano esclusivamente per
pranzo/cena al Maremosso (nessuna quota colazione), quindi spostamento pieno (non split %).
Colazioni e Pasticceria restano su DPH (colazione in hotel).

Nuovo nodo MMS (struttura) -> MMS_FNB (categoria, mirror di BON_FNB) -> MMS_CUCINA/MMS_SALA/
MMS_BAR (reparti, id invariati rispetto a DPH_CUCINA/DPH_SALA/DPH_BAR — solo parent_id/code/name
cambiano, nessun impatto sui collegamenti dipendenti già esistenti in employee_cc_default /
employee_cost_center_monthly). Aggiornata anche la mappatura usali_cc_voce_mapping in app_config
(chiavi per code, il rename dei 3 reparto CC altrimenti li farebbe cadere sul fallback 'altri').

Revision ID: usali005_2026
Revises: corrfix005_2026
Create Date: 2026-09-16
"""
from alembic import op
import sqlalchemy as sa
import json

revision = 'usali005_2026'
down_revision = 'corrfix005_2026'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    mms_id = conn.execute(sa.text("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, hotel_id, attivo, ordine)
        VALUES ('MMS', 'Maremosso', 'struttura', NULL, NULL, true, 6)
        RETURNING id
    """)).scalar()

    mms_fnb_id = conn.execute(sa.text("""
        INSERT INTO cost_centers (code, name, tipo, parent_id, hotel_id, attivo, ordine)
        VALUES ('MMS_FNB', 'Food & Beverage', 'categoria', :parent_id, NULL, true, 99)
        RETURNING id
    """), {'parent_id': mms_id}).scalar()

    op.execute(sa.text("""
        UPDATE cost_centers SET code = 'MMS_CUCINA', name = 'Cucina', parent_id = :parent_id
        WHERE code = 'DPH_CUCINA'
    """).bindparams(parent_id=mms_fnb_id))
    op.execute(sa.text("""
        UPDATE cost_centers SET code = 'MMS_SALA', name = 'Sala', parent_id = :parent_id
        WHERE code = 'DPH_SALA'
    """).bindparams(parent_id=mms_fnb_id))
    op.execute(sa.text("""
        UPDATE cost_centers SET code = 'MMS_BAR', name = 'Bar', parent_id = :parent_id
        WHERE code = 'DPH_BAR'
    """).bindparams(parent_id=mms_fnb_id))

    row = conn.execute(sa.text(
        "SELECT value FROM app_config WHERE key = 'usali_cc_voce_mapping'"
    )).fetchone()
    if row:
        mapping = json.loads(row[0])
        for k in ('DPH_CUCINA', 'DPH_SALA', 'DPH_BAR'):
            mapping.pop(k, None)
        for k in ('MMS_FNB', 'MMS_CUCINA', 'MMS_SALA', 'MMS_BAR'):
            mapping[k] = 'fnb'
        conn.execute(sa.text(
            "UPDATE app_config SET value = :v WHERE key = 'usali_cc_voce_mapping'"
        ), {'v': json.dumps(mapping)})


def downgrade():
    conn = op.get_bind()

    op.execute("""
        UPDATE cost_centers SET code = 'DPH_CUCINA', name = 'Cucina',
            parent_id = (SELECT id FROM cost_centers WHERE code = 'DPH_FNB')
        WHERE code = 'MMS_CUCINA'
    """)
    op.execute("""
        UPDATE cost_centers SET code = 'DPH_SALA', name = 'Sala',
            parent_id = (SELECT id FROM cost_centers WHERE code = 'DPH_FNB')
        WHERE code = 'MMS_SALA'
    """)
    op.execute("""
        UPDATE cost_centers SET code = 'DPH_BAR', name = 'Bar',
            parent_id = (SELECT id FROM cost_centers WHERE code = 'DPH_FNB')
        WHERE code = 'MMS_BAR'
    """)

    op.execute("DELETE FROM cost_centers WHERE code = 'MMS_FNB'")
    op.execute("DELETE FROM cost_centers WHERE code = 'MMS'")

    row = conn.execute(sa.text(
        "SELECT value FROM app_config WHERE key = 'usali_cc_voce_mapping'"
    )).fetchone()
    if row:
        mapping = json.loads(row[0])
        for k in ('MMS_FNB', 'MMS_CUCINA', 'MMS_SALA', 'MMS_BAR'):
            mapping.pop(k, None)
        for k in ('DPH_CUCINA', 'DPH_SALA', 'DPH_BAR'):
            mapping[k] = 'fnb'
        conn.execute(sa.text(
            "UPDATE app_config SET value = :v WHERE key = 'usali_cc_voce_mapping'"
        ), {'v': json.dumps(mapping)})
