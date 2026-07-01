"""restructure_cc_3_levels

Revision ID: cc3livelli2026
Revises: hkbar001cc2026
Create Date: 2026-06-13

Ristruttura i centri di costo da 2 livelli (struttura→reparto) a 3 livelli
(struttura→categoria→reparto) seguendo schema USALI per CLB, DPH, INT.

Struttura finale:
  <HOTEL>
    CAMERE       → Ricevimento, Pulizie
    FNB          → Cucina, Sala, Bar, Colazioni
    STRUTTURA    → Manutenzione
    AMMINISTRAZIONE → Direzione, Marketing

Correzioni incluse:
  - *_BAR e *_HOUSEKEEPING avevano tipo='struttura' per errore → corretto a 'reparto'
  - *_CUCINA rinominato Ristorante → Cucina
  - *_ADMIN rinominato Amministrazione → Direzione
  - *_HOUSEKEEPING rinominato Housekeeping → Pulizie
"""
from alembic import op
import sqlalchemy as sa

revision = 'cc3livelli2026'
down_revision = 'hkbar001cc2026'
branch_labels = None
depends_on = None

STRUTTURE = ['CLB', 'DPH', 'INT']


def _get_id(conn, code):
    row = conn.execute(sa.text("SELECT id FROM cost_centers WHERE code = :c"), {'c': code}).fetchone()
    return row[0] if row else None


def _inserisci_se_assente(conn, code, name, parent_id, tipo, ordine):
    if not conn.execute(sa.text("SELECT 1 FROM cost_centers WHERE code = :c"), {'c': code}).fetchone():
        conn.execute(sa.text("""
            INSERT INTO cost_centers (code, name, parent_id, tipo, attivo, ordine)
            VALUES (:code, :name, :parent_id, :tipo, true, :ordine)
        """), {'code': code, 'name': name, 'parent_id': parent_id, 'tipo': tipo, 'ordine': ordine})


def upgrade():
    conn = op.get_bind()

    for s in STRUTTURE:
        struttura_id = _get_id(conn, s)
        if struttura_id is None:
            continue

        # ── 1. Promuovi *_CAMERE a categoria ──────────────────────────────────
        conn.execute(sa.text("""
            UPDATE cost_centers SET tipo = 'categoria', ordine = 1
            WHERE code = :c
        """), {'c': f'{s}_CAMERE'})
        cat_camere_id = _get_id(conn, f'{s}_CAMERE')

        # ── 2. Crea categoria Food & Beverage ─────────────────────────────────
        _inserisci_se_assente(conn, f'{s}_FNB', 'Food & Beverage', struttura_id, 'categoria', 2)
        cat_fnb_id = _get_id(conn, f'{s}_FNB')

        # ── 3. Crea categoria Struttura ───────────────────────────────────────
        _inserisci_se_assente(conn, f'{s}_STRUTTURA', 'Struttura', struttura_id, 'categoria', 3)
        cat_str_id = _get_id(conn, f'{s}_STRUTTURA')

        # ── 4. Crea categoria Amministrazione ─────────────────────────────────
        _inserisci_se_assente(conn, f'{s}_AMMINISTRAZIONE', 'Amministrazione', struttura_id, 'categoria', 4)
        cat_adm_id = _get_id(conn, f'{s}_AMMINISTRAZIONE')

        # ── 5. Reparti foglia nuovi sotto CAMERE ──────────────────────────────
        _inserisci_se_assente(conn, f'{s}_RICEVIMENTO', 'Ricevimento', cat_camere_id, 'reparto', 1)

        # Housekeeping → Pulizie (correzione tipo + rinomina + sposta)
        conn.execute(sa.text("""
            UPDATE cost_centers
            SET tipo = 'reparto', name = 'Pulizie', parent_id = :pid, ordine = 2
            WHERE code = :c
        """), {'pid': cat_camere_id, 'c': f'{s}_HOUSEKEEPING'})

        # ── 6. Reparti F&B: sposta e aggiusta tipo ───────────────────────────
        # Cucina (era Ristorante)
        conn.execute(sa.text("""
            UPDATE cost_centers
            SET tipo = 'reparto', name = 'Cucina', parent_id = :pid, ordine = 1
            WHERE code = :c
        """), {'pid': cat_fnb_id, 'c': f'{s}_CUCINA'})

        # Sala (nuovo)
        _inserisci_se_assente(conn, f'{s}_SALA', 'Sala', cat_fnb_id, 'reparto', 2)

        # Bar (correzione tipo + sposta)
        conn.execute(sa.text("""
            UPDATE cost_centers
            SET tipo = 'reparto', parent_id = :pid, ordine = 3
            WHERE code = :c
        """), {'pid': cat_fnb_id, 'c': f'{s}_BAR'})

        # Colazioni
        conn.execute(sa.text("""
            UPDATE cost_centers
            SET tipo = 'reparto', parent_id = :pid, ordine = 4
            WHERE code = :c
        """), {'pid': cat_fnb_id, 'c': f'{s}_COLAZIONI'})

        # ── 7. Struttura: sposta Manutenzione ────────────────────────────────
        conn.execute(sa.text("""
            UPDATE cost_centers
            SET tipo = 'reparto', parent_id = :pid, ordine = 1
            WHERE code = :c
        """), {'pid': cat_str_id, 'c': f'{s}_MANUTENZIONE'})

        # ── 8. Amministrazione: rinomina Admin → Direzione + crea Marketing ──
        conn.execute(sa.text("""
            UPDATE cost_centers
            SET tipo = 'reparto', name = 'Direzione', parent_id = :pid, ordine = 1
            WHERE code = :c
        """), {'pid': cat_adm_id, 'c': f'{s}_ADMIN'})

        _inserisci_se_assente(conn, f'{s}_MARKETING', 'Marketing', cat_adm_id, 'reparto', 2)

        # ── 9. Migra assegnazioni dipendenti da *_CAMERE (ora categoria) ──────
        # a *_RICEVIMENTO (nodo foglia più generico per "camere")
        ricevimento_id = _get_id(conn, f'{s}_RICEVIMENTO')
        if cat_camere_id and ricevimento_id:
            conn.execute(sa.text("""
                UPDATE employee_cc_default
                SET cost_center_id = :new_id
                WHERE cost_center_id = :old_id
            """), {'new_id': ricevimento_id, 'old_id': cat_camere_id})
            conn.execute(sa.text("""
                UPDATE employee_cost_center_monthly
                SET cost_center_id = :new_id
                WHERE cost_center_id = :old_id
            """), {'new_id': ricevimento_id, 'old_id': cat_camere_id})


def downgrade():
    # Downgrade non supportato per questa migrazione strutturale.
    # Usare un backup del database per rollback.
    pass
