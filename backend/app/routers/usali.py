"""
Router USALI — Conto Economico per struttura (formato USALI).

  GET  /usali/report?anno=&mese=   → P&L completo per tutte le strutture (include kpi_config)
  PUT  /usali/voce                 → upsert voce manuale
  GET  /usali/kpi-config           → range KPI configurati (hotel + ristoranti)
  PUT  /usali/kpi-config           → salva range KPI in app_config
"""
import calendar
import json
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import richiedi_admin, richiedi_utente_attivo
from app.models.usali import UsaliVoceManuali
from app.models.revenue import (
    AppConfig, CostCenter, DailyRevenue,
    EmployeeCostCenterMonthly, EmployeeMonthly, PayrollImport,
)
from app.models.corrispettivi import CorrispettiviDocumento, CorrispettiviManuale

router = APIRouter(prefix="/usali", tags=["usali"])

# ── Strutture ──────────────────────────────────────────────────────────────────

# Hotel con camere (ricavi camere + F&B da daily_revenue)
STRUTTURE_HOTEL = ['DPH', 'CLB', 'INT']
# Ristoranti autonomi (solo F&B da corrispettivi)
STRUTTURE_RISTORANTI = ['MMS', 'BON']
TUTTE_STRUTTURE = STRUTTURE_HOTEL + STRUTTURE_RISTORANTI

NOME_STRUTTURA = {
    'DPH': 'Du Parc', 'CLB': 'Club Hotel', 'INT': 'International',
    'MMS': 'Maremosso', 'BON': 'Buona Onda',
}

# ── Voci manuali per struttura ─────────────────────────────────────────────────
# Hotel: tutte le voci; Ristoranti: solo voci F&B e costi indiretti
VOCI_HOTEL = [
    'ricavi_altri_operativi', 'ricavi_vari_operativi',
    'lavoro_camere', 'appalto_camere', 'lavanderia', 'altri_costi_camere',
    'lavoro_fnb', 'fdv_fnb', 'attrezzature_fnb', 'consulenze_fnb',
    'lavoro_altri_reparti', 'fdv_altri_reparti',
    'lavoro_non_suddiviso', 'altri_costi_admin', 'consulenze',
    'informatica', 'marketing', 'manutenzioni', 'utenze',
]
VOCI_RISTORANTI = [
    'ricavi_altri_operativi', 'ricavi_vari_operativi',
    'lavoro_fnb', 'fdv_fnb', 'attrezzature_fnb', 'consulenze_fnb',
    'lavoro_non_suddiviso', 'altri_costi_admin', 'consulenze',
    'informatica', 'marketing', 'manutenzioni', 'utenze',
]

APP_CONFIG_KEY_KPI = 'usali_kpi_ranges'
APP_CONFIG_KEY_CC_MAP = 'usali_cc_voce_mapping'

KPI_VOCI_LABELS = {
    'ebitdar_pct': 'EBITDAR su ricavi',
    'fnb_cost_pct': 'F&B cost su ricavi',
    'lavoro_pct': 'Costo del lavoro',
    'utenze_pct': 'Costo energetico su ricavi',
}

KPI_DEFAULT = {
    'hotel': {
        'ebitdar_pct': {'lo': 30, 'hi': 35},
        'fnb_cost_pct': {'lo': 18, 'hi': 22},
        'lavoro_pct':   {'lo': 28, 'hi': 30},
        'utenze_pct':   {'lo': 5,  'hi': 7},
    },
    'ristoranti': {
        'ebitdar_pct': {'lo': 20, 'hi': 30},
        'fnb_cost_pct': {'lo': 25, 'hi': 35},
        'lavoro_pct':   {'lo': 25, 'hi': 30},
        'utenze_pct':   {'lo': 2,  'hi': 5},
    },
}


def _leggi_kpi_config(db: Session) -> dict:
    row = db.query(AppConfig).filter(AppConfig.key == APP_CONFIG_KEY_KPI).first()
    if row:
        try:
            return json.loads(row.value)
        except Exception:
            pass
    return KPI_DEFAULT


def _salva_kpi_config(db: Session, config: dict):
    row = db.query(AppConfig).filter(AppConfig.key == APP_CONFIG_KEY_KPI).first()
    if row:
        row.value = json.dumps(config)
    else:
        db.add(AppConfig(key=APP_CONFIG_KEY_KPI, value=json.dumps(config)))
    db.commit()


def _leggi_cc_mapping(db: Session) -> dict:
    """Legge cc_code → 'camere'|'fnb' da app_config. Assente = 'altri'."""
    row = db.query(AppConfig).filter(AppConfig.key == APP_CONFIG_KEY_CC_MAP).first()
    if row:
        try:
            return json.loads(row.value)
        except Exception:
            pass
    return {}


def _salva_cc_mapping(db: Session, mapping: dict):
    row = db.query(AppConfig).filter(AppConfig.key == APP_CONFIG_KEY_CC_MAP).first()
    if row:
        row.value = json.dumps(mapping)
    else:
        db.add(AppConfig(key=APP_CONFIG_KEY_CC_MAP, value=json.dumps(mapping)))
    db.commit()


def _trova_voce_cc(cc_id: int, mapping: dict, tutti_cc_by_id: dict) -> str:
    """
    Risale la gerarchia CC per trovare la voce USALI.
    Ordine: reparto → categoria → struttura. Primo mapping trovato vince.
    Nessun mapping trovato → 'altri'.
    """
    cc = tutti_cc_by_id.get(cc_id)
    visited: set = set()
    while cc and cc.id not in visited:
        voce = mapping.get(cc.code)
        if voce in ('camere', 'fnb'):
            return voce
        visited.add(cc.id)
        cc = tutti_cc_by_id.get(cc.parent_id) if cc.parent_id else None
    return 'altri'


def _struttura_di(cc_id: int, tutti_cc_by_id: dict) -> Optional[str]:
    """Risale la gerarchia fino al nodo tipo='struttura', ritorna il suo code."""
    cc = tutti_cc_by_id.get(cc_id)
    visited: set = set()
    while cc and cc.id not in visited:
        if cc.tipo == 'struttura':
            return cc.code
        visited.add(cc.id)
        cc = tutti_cc_by_id.get(cc.parent_id) if cc.parent_id else None
    return None


def _lavoro_da_dipendenti(
    db: Session,
    struttura_code: str,
    anno: int,
    mese_ini: int,
    mese_fine: int,
    mapping: dict,
) -> Optional[dict]:
    """
    Calcola costo del lavoro da dipendenti per struttura, suddiviso in:
    lavoro_camere / lavoro_fnb / lavoro_altri_reparti.
    Usa EmployeeCostCenterMonthly (split % mensile) × EmployeeMonthly.costo_aziendale.
    Ritorna None se mapping vuoto o nessun dato payroll trovato.
    """
    if not mapping:
        return None

    tutti_cc_by_id = {cc.id: cc for cc in db.query(CostCenter).all()}

    # CC appartenenti a questa struttura
    cc_struttura = {
        cid for cid in tutti_cc_by_id
        if _struttura_di(cid, tutti_cc_by_id) == struttura_code
    }
    if not cc_struttura:
        return None

    rows = (
        db.query(
            EmployeeCostCenterMonthly.cost_center_id,
            EmployeeMonthly.costo_aziendale,
            EmployeeCostCenterMonthly.percentuale,
        )
        .join(
            EmployeeMonthly,
            (EmployeeCostCenterMonthly.employee_id == EmployeeMonthly.employee_id) &
            (EmployeeCostCenterMonthly.import_id == EmployeeMonthly.import_id),
        )
        .join(PayrollImport, PayrollImport.id == EmployeeCostCenterMonthly.import_id)
        .filter(
            PayrollImport.anno == anno,
            PayrollImport.mese.between(mese_ini, mese_fine),
            PayrollImport.is_test == False,
            EmployeeCostCenterMonthly.cost_center_id.in_(cc_struttura),
        )
        .all()
    )
    if not rows:
        return None

    totali = {'camere': 0.0, 'fnb': 0.0, 'altri': 0.0}
    for cc_id, costo_az, pct in rows:
        voce = _trova_voce_cc(cc_id, mapping, tutti_cc_by_id)
        totali[voce] += _fl(costo_az) * _fl(pct) / 100.0

    return {
        'lavoro_camere':       round(totali['camere'], 2) or None,
        'lavoro_fnb':          round(totali['fnb'],    2) or None,
        'lavoro_altri_reparti': round(totali['altri'],  2) or None,
    }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _fl(v) -> float:
    return float(v) if v is not None else 0.0


def _revenue_mensile_hotel(db: Session, hotel_code: str, da: date, a: date) -> dict:
    """
    Legge ricavi camere e F&B da daily_revenue nel range da..a.
    YTD: da=01/01, a=ultimo giorno del mese selezionato.
    Per evitare duplicati da snapshot multipli, usa per ogni giorno la snapshot più recente.
    """
    # Subquery: per ogni giorno nel range, prendi la snapshot più recente
    sub = (
        db.query(
            DailyRevenue.data,
            func.max(DailyRevenue.snapshot_date).label('max_snap'),
        )
        .filter(
            DailyRevenue.hotel_code == hotel_code,
            DailyRevenue.data.between(da, a),
            DailyRevenue.is_test == False,
        )
        .group_by(DailyRevenue.data)
        .subquery()
    )

    rows = (
        db.query(DailyRevenue)
        .join(sub, (DailyRevenue.data == sub.c.data) &
                   (DailyRevenue.snapshot_date == sub.c.max_snap))
        .filter(
            DailyRevenue.hotel_code == hotel_code,
            DailyRevenue.is_test == False,
        )
        .all()
    )
    if not rows:
        return {'ricavi_camere': None, 'ricavi_fnb': None}
    return {
        'ricavi_camere': round(sum(_fl(r.revenue_rooms) for r in rows), 2) or None,
        'ricavi_fnb': round(sum(_fl(r.revenue_fnb) for r in rows), 2) or None,
    }


def _ricavi_ristorante(db: Session, struttura_code: str, da: date, a: date) -> Optional[float]:
    """
    Ricavi F&B netti da corrispettivi per MMS/BON nel range da..a.
    Usa imponibile (netto IVA) delle sole categorie arrangiamenti.
    """
    imp_doc = (
        db.query(func.sum(CorrispettiviDocumento.imponibile))
        .filter(
            CorrispettiviDocumento.struttura_code == struttura_code,
            CorrispettiviDocumento.data_documento.between(da, a),
            CorrispettiviDocumento.tipo.in_(['scontrino', 'fattura']),
            CorrispettiviDocumento.categoria == 'arrangiamenti',
            CorrispettiviDocumento.annullato == False,
            CorrispettiviDocumento.is_test == False,
        )
        .scalar()
    ) or 0

    lordo_man = (
        db.query(func.sum(CorrispettiviManuale.arrangiamenti_lordo))
        .filter(
            CorrispettiviManuale.struttura_code == struttura_code,
            CorrispettiviManuale.data_giorno.between(da, a),
            CorrispettiviManuale.is_test == False,
        )
        .scalar()
    ) or 0

    totale = round(_fl(imp_doc) + round(_fl(lordo_man) / 1.10, 2), 2)
    return totale if totale > 0 else None


def _voci_manuali(
    db: Session, struttura_code: str, anno: int, mese_fine: int, mese_ini: int = 1
) -> tuple[dict, dict]:
    """
    I valori in DB sono CUMULATIVI da gennaio (stored[mese] = totale gen→mese).
    Ritorna (delta, cum):
      - delta = stored[mese_fine] - stored[mese_ini-1]  (per display nel periodo)
      - cum   = stored[mese_fine]                        (valore grezzo per editing)
    mese_ini=1 → YTD: delta = stored[mese_fine].
    mese_ini=mese_fine → mese singolo: delta = stored[mese_fine] - stored[mese_fine-1].
    """
    mesi_needed = {mese_fine}
    if mese_ini > 1:
        mesi_needed.add(mese_ini - 1)

    rows = db.query(UsaliVoceManuali).filter(
        UsaliVoceManuali.struttura_code == struttura_code,
        UsaliVoceManuali.anno == anno,
        UsaliVoceManuali.mese.in_(mesi_needed),
    ).all()

    per_mese: dict = {}
    for r in rows:
        per_mese.setdefault(r.mese, {})[r.voce_code] = _fl(r.valore)

    cum = per_mese.get(mese_fine, {})
    prev = per_mese.get(mese_ini - 1, {}) if mese_ini > 1 else {}

    all_voci = set(cum) | set(prev)
    delta = {v: cum.get(v, 0.0) - prev.get(v, 0.0) for v in all_voci}
    return delta, cum


def _calcola_struttura(struttura_code: str, anno: int, mese: int,
                       auto: dict, manuali: dict, manuali_cum: dict = None) -> dict:
    """
    Assembla il P&L USALI per una struttura combinando dati auto e manuali.
    Tutti i valori sono netti IVA.
    """
    is_hotel = struttura_code in STRUTTURE_HOTEL

    # ── Ricavi ────────────────────────────────────────────────────────────────
    ricavi_camere = auto.get('ricavi_camere') or 0.0
    ricavi_fnb = auto.get('ricavi_fnb') or 0.0
    ricavi_altri = manuali.get('ricavi_altri_operativi', 0.0)
    ricavi_vari = manuali.get('ricavi_vari_operativi', 0.0)
    tot_ricavi = ricavi_camere + ricavi_fnb + ricavi_altri + ricavi_vari  # A

    # ── Costi diretti ─────────────────────────────────────────────────────────
    # Lavoro: priorità auto (dipendenti) > manuale
    _lav_cam_a = auto.get('lavoro_camere')
    _lav_fnb_a = auto.get('lavoro_fnb')
    _lav_alt_a = auto.get('lavoro_altri_reparti')

    lavoro_camere = (_fl(_lav_cam_a) if _lav_cam_a is not None else manuali.get('lavoro_camere', 0.0)) if is_hotel else 0.0
    appalto_camere = manuali.get('appalto_camere', 0.0) if is_hotel else 0.0
    lavanderia = manuali.get('lavanderia', 0.0) if is_hotel else 0.0
    altri_costi_camere = manuali.get('altri_costi_camere', 0.0) if is_hotel else 0.0
    lavoro_fnb = _fl(_lav_fnb_a) if _lav_fnb_a is not None else manuali.get('lavoro_fnb', 0.0)
    fdv_fnb = manuali.get('fdv_fnb', 0.0)
    attrezzature_fnb = manuali.get('attrezzature_fnb', 0.0)
    consulenze_fnb = manuali.get('consulenze_fnb', 0.0)
    lavoro_altri = (_fl(_lav_alt_a) if _lav_alt_a is not None else manuali.get('lavoro_altri_reparti', 0.0)) if is_hotel else 0.0
    fdv_altri = manuali.get('fdv_altri_reparti', 0.0) if is_hotel else 0.0
    tot_costi_diretti = (lavoro_camere + appalto_camere + lavanderia +
                         altri_costi_camere + lavoro_fnb +
                         fdv_fnb + attrezzature_fnb + consulenze_fnb + lavoro_altri + fdv_altri)  # B

    margine = tot_ricavi - tot_costi_diretti  # C

    # ── Costi indiretti ───────────────────────────────────────────────────────
    lavoro_ns = manuali.get('lavoro_non_suddiviso', 0.0)
    altri_admin = manuali.get('altri_costi_admin', 0.0)
    consulenze = manuali.get('consulenze', 0.0)
    informatica = manuali.get('informatica', 0.0)
    marketing = manuali.get('marketing', 0.0)
    manutenzioni = manuali.get('manutenzioni', 0.0)
    utenze = manuali.get('utenze', 0.0)
    tot_costi_indiretti = (lavoro_ns + altri_admin + consulenze +
                           informatica + marketing + manutenzioni + utenze)  # D

    ebitdar = margine - tot_costi_indiretti  # E

    # ── KPI (su tot_ricavi, None se ricavi=0) ─────────────────────────────────
    def pct(v): return round(v / tot_ricavi * 100, 1) if tot_ricavi else None

    tot_lavoro = lavoro_camere + lavoro_fnb + lavoro_altri + lavoro_ns
    fnb_cost = lavoro_fnb + fdv_fnb

    # Valori cumulativi (gen→mese) per editing nelle celle manuali
    _c = manuali_cum or {}

    return {
        'struttura_code': struttura_code,
        'nome': NOME_STRUTTURA.get(struttura_code, struttura_code),
        'is_hotel': is_hotel,
        # Ricavi
        'ricavi_camere': ricavi_camere,
        'ricavi_camere_auto': auto.get('ricavi_camere') is not None,
        'ricavi_fnb': ricavi_fnb,
        'ricavi_fnb_auto': auto.get('ricavi_fnb') is not None,
        'ricavi_altri_operativi': ricavi_altri,
        'ricavi_altri_operativi_cum': _c.get('ricavi_altri_operativi'),
        'ricavi_vari_operativi': ricavi_vari,
        'ricavi_vari_operativi_cum': _c.get('ricavi_vari_operativi'),
        'tot_ricavi': round(tot_ricavi, 2),           # A
        # Costi diretti
        'lavoro_camere': lavoro_camere,
        'lavoro_camere_auto': _lav_cam_a is not None and is_hotel,
        'appalto_camere': appalto_camere,
        'appalto_camere_cum': _c.get('appalto_camere'),
        'lavanderia': lavanderia,
        'lavanderia_cum': _c.get('lavanderia'),
        'altri_costi_camere': altri_costi_camere,
        'altri_costi_camere_cum': _c.get('altri_costi_camere'),
        'tot_costi_camere': round(lavoro_camere + appalto_camere + lavanderia + altri_costi_camere, 2),
        'lavoro_fnb': lavoro_fnb,
        'lavoro_fnb_auto': _lav_fnb_a is not None,
        'fdv_fnb': fdv_fnb,
        'fdv_fnb_cum': _c.get('fdv_fnb'),
        'attrezzature_fnb': attrezzature_fnb,
        'attrezzature_fnb_cum': _c.get('attrezzature_fnb'),
        'consulenze_fnb': consulenze_fnb,
        'consulenze_fnb_cum': _c.get('consulenze_fnb'),
        'tot_costi_fnb': round(lavoro_fnb + fdv_fnb + attrezzature_fnb + consulenze_fnb, 2),
        'lavoro_altri_reparti': lavoro_altri,
        'lavoro_altri_reparti_auto': _lav_alt_a is not None and is_hotel,
        'fdv_altri_reparti': fdv_altri,
        'fdv_altri_reparti_cum': _c.get('fdv_altri_reparti'),
        'tot_costi_diretti': round(tot_costi_diretti, 2),  # B
        'margine': round(margine, 2),                  # C
        # Costi indiretti
        'lavoro_non_suddiviso': lavoro_ns,
        'lavoro_non_suddiviso_cum': _c.get('lavoro_non_suddiviso'),
        'altri_costi_admin': altri_admin,
        'altri_costi_admin_cum': _c.get('altri_costi_admin'),
        'consulenze': consulenze,
        'consulenze_cum': _c.get('consulenze'),
        'informatica': informatica,
        'informatica_cum': _c.get('informatica'),
        'marketing': marketing,
        'marketing_cum': _c.get('marketing'),
        'manutenzioni': manutenzioni,
        'manutenzioni_cum': _c.get('manutenzioni'),
        'utenze': utenze,
        'utenze_cum': _c.get('utenze'),
        'tot_costi_indiretti': round(tot_costi_indiretti, 2),  # D
        'ebitdar': round(ebitdar, 2),                  # E
        # KPI
        'kpi': {
            'ebitdar_pct': pct(ebitdar),
            'fnb_cost_pct': pct(fnb_cost),
            'lavoro_pct': pct(tot_lavoro),
            'utenze_pct': pct(utenze),
        },
    }


def _somma_strutture(strutture: list, nome: str, struttura_code: str) -> dict:
    """Aggregato (somma) di un gruppo di strutture."""
    def s(k): return round(sum(st[k] for st in strutture), 2)

    tot_ricavi = s('tot_ricavi')

    def pct(v): return round(v / tot_ricavi * 100, 1) if tot_ricavi else None

    tot_lavoro = s('lavoro_camere') + s('lavoro_fnb') + s('lavoro_altri_reparti') + s('lavoro_non_suddiviso')
    fnb_cost = s('lavoro_fnb') + s('fdv_fnb')
    ebitdar = s('ebitdar')
    utenze = s('utenze')

    return {
        'struttura_code': struttura_code,
        'nome': nome,
        'is_hotel': None,
        'ricavi_camere': s('ricavi_camere'),
        'ricavi_camere_auto': True,
        'ricavi_fnb': s('ricavi_fnb'),
        'ricavi_fnb_auto': True,
        'ricavi_altri_operativi': s('ricavi_altri_operativi'),
        'ricavi_vari_operativi': s('ricavi_vari_operativi'),
        'tot_ricavi': tot_ricavi,
        'lavoro_camere': s('lavoro_camere'),
        'appalto_camere': s('appalto_camere'),
        'lavanderia': s('lavanderia'),
        'altri_costi_camere': s('altri_costi_camere'),
        'tot_costi_camere': round(s('lavoro_camere') + s('appalto_camere') + s('lavanderia') + s('altri_costi_camere'), 2),
        'lavoro_fnb': s('lavoro_fnb'),
        'fdv_fnb': s('fdv_fnb'),
        'attrezzature_fnb': s('attrezzature_fnb'),
        'consulenze_fnb': s('consulenze_fnb'),
        'tot_costi_fnb': round(s('lavoro_fnb') + s('fdv_fnb') + s('attrezzature_fnb') + s('consulenze_fnb'), 2),
        'lavoro_altri_reparti': s('lavoro_altri_reparti'),
        'fdv_altri_reparti': s('fdv_altri_reparti'),
        'tot_costi_diretti': s('tot_costi_diretti'),
        'margine': s('margine'),
        'lavoro_non_suddiviso': s('lavoro_non_suddiviso'),
        'altri_costi_admin': s('altri_costi_admin'),
        'consulenze': s('consulenze'),
        'informatica': s('informatica'),
        'marketing': s('marketing'),
        'manutenzioni': s('manutenzioni'),
        'utenze': utenze,
        'tot_costi_indiretti': s('tot_costi_indiretti'),
        'ebitdar': ebitdar,
        'kpi': {
            'ebitdar_pct': pct(ebitdar),
            'fnb_cost_pct': pct(fnb_cost),
            'lavoro_pct': pct(tot_lavoro),
            'utenze_pct': pct(utenze),
        },
    }


# ── Endpoint ───────────────────────────────────────────────────────────────────

@router.get("/report")
def get_report(
    anno: int = Query(..., ge=2020, le=2030),
    mese: int = Query(..., ge=1, le=12),
    ytd: bool = Query(False, description="True = cumulativo da gennaio al mese selezionato"),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_utente_attivo),
):
    """
    Conto Economico USALI per tutte le strutture.
    ytd=False → solo il mese selezionato.
    ytd=True  → cumulativo gennaio..mese (YTD).
    Valori sempre netti IVA.
    """
    da = date(anno, 1, 1) if ytd else date(anno, mese, 1)
    a = date(anno, mese, calendar.monthrange(anno, mese)[1])
    mese_ini = 1 if ytd else mese

    cc_mapping = _leggi_cc_mapping(db)
    strutture_result = []

    for codice in TUTTE_STRUTTURE:
        manuali_delta, manuali_cum = _voci_manuali(db, codice, anno, mese, mese_ini)

        if codice in STRUTTURE_HOTEL:
            auto = _revenue_mensile_hotel(db, codice, da, a)
        else:
            ricavi_ristr = _ricavi_ristorante(db, codice, da, a)
            auto = {'ricavi_camere': None, 'ricavi_fnb': ricavi_ristr}

        lavoro = _lavoro_da_dipendenti(db, codice, anno, mese_ini, mese, cc_mapping)
        if lavoro:
            auto.update(lavoro)

        strutture_result.append(_calcola_struttura(codice, anno, mese, auto, manuali_delta, manuali_cum))

    hotel_list = [s for s in strutture_result if s['struttura_code'] in STRUTTURE_HOTEL]
    ristr_list = [s for s in strutture_result if s['struttura_code'] in STRUTTURE_RISTORANTI]

    tot_hotel = _somma_strutture(hotel_list, 'Totale Hotel', 'HOTEL')
    tot_ristr = _somma_strutture(ristr_list, 'Totale Ristoranti', 'RISTR')
    tot_gruppo = _somma_strutture(strutture_result, 'Totale Gruppo', 'GRUPPO')

    kpi_config = _leggi_kpi_config(db)
    # Arricchisce la config con le label
    for tipo in kpi_config.values():
        for kpi_code, rng in tipo.items():
            rng['label'] = KPI_VOCI_LABELS.get(kpi_code, kpi_code)

    return {
        'anno': anno,
        'mese': mese,
        'ytd': ytd,
        'strutture': strutture_result,
        'tot_hotel': tot_hotel,
        'tot_ristoranti': tot_ristr,
        'tot_gruppo': tot_gruppo,
        'kpi_config': kpi_config,
    }


@router.put("/voce")
def upsert_voce(
    body: dict,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """
    Upsert di una voce manuale USALI.
    Body: { struttura_code, anno, mese, voce_code, valore }
    valore=null → elimina la voce (reset a 0).
    """
    struttura = body.get('struttura_code', '').upper()
    anno = body.get('anno')
    mese = body.get('mese')
    voce_code = body.get('voce_code', '')
    valore = body.get('valore')

    if struttura not in TUTTE_STRUTTURE:
        raise HTTPException(400, f"Struttura '{struttura}' non valida")
    if voce_code not in (VOCI_HOTEL + VOCI_RISTORANTI):
        raise HTTPException(400, f"Voce '{voce_code}' non valida")
    if not anno or not mese:
        raise HTTPException(400, "anno e mese obbligatori")

    if valore is None:
        db.query(UsaliVoceManuali).filter(
            UsaliVoceManuali.struttura_code == struttura,
            UsaliVoceManuali.anno == anno,
            UsaliVoceManuali.mese == mese,
            UsaliVoceManuali.voce_code == voce_code,
        ).delete()
        db.commit()
        return {'ok': True, 'deleted': True}

    stmt = pg_insert(UsaliVoceManuali).values(
        struttura_code=struttura,
        anno=anno,
        mese=mese,
        voce_code=voce_code,
        valore=float(valore),
    ).on_conflict_do_update(
        constraint='uq_usali_struttura_anno_mese_voce',
        set_={'valore': float(valore), 'updated_at': func.now()},
    )
    db.execute(stmt)
    db.commit()
    return {'ok': True, 'struttura_code': struttura, 'voce_code': voce_code, 'valore': float(valore)}


@router.get("/kpi-config")
def get_kpi_config(
    db: Session = Depends(get_db),
    utente=Depends(richiedi_utente_attivo),
):
    """Range KPI USALI configurati per hotel e ristoranti."""
    config = _leggi_kpi_config(db)
    for tipo in config.values():
        for kpi_code, rng in tipo.items():
            rng['label'] = KPI_VOCI_LABELS.get(kpi_code, kpi_code)
    return config


@router.put("/kpi-config")
def put_kpi_config(
    body: dict,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """
    Salva range KPI USALI.
    Body: { hotel: { ebitdar_pct: {lo, hi}, ... }, ristoranti: { ... } }
    """
    for tipo in ('hotel', 'ristoranti'):
        if tipo not in body:
            raise HTTPException(400, f"Chiave '{tipo}' mancante")
        for kpi_code in KPI_VOCI_LABELS:
            if kpi_code not in body[tipo]:
                raise HTTPException(400, f"KPI '{kpi_code}' mancante in '{tipo}'")
            rng = body[tipo][kpi_code]
            if 'lo' not in rng or 'hi' not in rng:
                raise HTTPException(400, f"Range '{kpi_code}' deve avere lo e hi")
            if float(rng['lo']) >= float(rng['hi']):
                raise HTTPException(400, f"Range '{kpi_code}': lo deve essere < hi")

    # Salva solo lo/hi (senza label che è derivata)
    config_pulita = {
        tipo: {
            kpi_code: {'lo': float(body[tipo][kpi_code]['lo']), 'hi': float(body[tipo][kpi_code]['hi'])}
            for kpi_code in KPI_VOCI_LABELS
        }
        for tipo in ('hotel', 'ristoranti')
    }
    _salva_kpi_config(db, config_pulita)
    return {'ok': True}


@router.get("/cc-mapping")
def get_cc_mapping(
    db: Session = Depends(get_db),
    utente=Depends(richiedi_utente_attivo),
):
    """Mapping cc_code → 'camere'|'fnb'. Assente = 'altri (default)'."""
    return _leggi_cc_mapping(db)


@router.put("/cc-mapping")
def put_cc_mapping(
    body: dict,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """
    Salva mapping CC → voce lavoro USALI.
    Body: { cc_code: 'camere'|'fnb' }  — chiavi con valore null/assente = rimossi.
    """
    mapping = {k: v for k, v in body.items() if v in ('camere', 'fnb')}
    _salva_cc_mapping(db, mapping)
    return {'ok': True, 'n_mapping': len(mapping)}
