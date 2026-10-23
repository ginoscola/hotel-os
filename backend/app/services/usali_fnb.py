"""Analisi Food & Beverage per punto vendita (scheda USALI → Food & Beverage).

Fonti, scelte con l'utente (ottobre 2026):
- costi di materia prima e altri costi F&B → contabilità importata (`usali_riga`, Costi
  Operativi > Food & Beverage, sottoreparto Colazione / Ristorante / Bar), categorie KPI food/
  beverage di `usali_categoria_kpi`
- personale → cedolini (ripartizione per centro di costo), come il Conto Economico; il personale
  contabile è riportato solo come confronto
- ricavi → Produzione (Welcome) per gli ospiti hotel, corrispettivi manuali per i clienti esterni
  del Mare Mosso e per Buona Onda; i ricavi F&B contabili solo come confronto
- coperti → pasti di Produzione (solo voci `conta_come_pasto`), coperti MMS dal gestionale Menu e
  scontrini BON inseriti a mano per mese (`usali_fnb_coperti`)

La contabilità non separa pranzo e cena (né ospiti ed esterni del Mare Mosso): i costi di quelle
sotto-righe sono una STIMA, ripartita sui coperti pesati (una cena vale `peso_cena` pranzi).

Regola dei rapporti: mai medie di KPI mensili. Ogni rapporto di periodo somma numeratore e
denominatore sui soli mesi in cui entrambi esistono (es. costo per coperto: mesi con contabilità
importata E coperti noti).
"""

import json
from collections import defaultdict

from sqlalchemy import extract, func
from sqlalchemy.orm import Session

from app.models.corrispettivi import CorrispettiviDocumento, CorrispettiviManuale
from app.models.produzione import ProdCategoria, ProdDettaglioCategoria, ProdRiga
from app.models.revenue import (
    AppConfig, CostCenter, EmployeeCostCenterMonthly, EmployeeMonthly, PayrollImport,
)
from app.models.usali import UsaliFnbCoperti
from app.models.usali_contabile import UsaliRiga
from app.services.usali_contabile_kpi import carica_mappa_categorie, categoria_di, produzione_mensile

STRUTTURE = ['DPH', 'CLB', 'INT', 'BON']
NOME_STRUTTURA = {'DPH': 'Du Parc + Mare Mosso', 'CLB': 'Club Hotel', 'INT': 'International',
                  'BON': 'Buona Onda'}

PUNTI_HOTEL = ['colazione', 'ristorante', 'bar', 'altro']
NOME_PUNTO = {'colazione': 'Colazione', 'ristorante': 'Ristorante', 'bar': 'Bar',
              'altro': 'Altro F&B', 'unico': 'Buona Onda'}
NOME_SUB = {'pranzo': 'Pranzo', 'cena': 'Cena', 'ospiti': 'Ospiti Du Parc',
            'esterni': 'Clienti esterni'}
PUNTI_CEDOLINI = ('colazione', 'ristorante', 'bar')

CHIAVE_CONFIG = 'usali_fnb_parametri'
PESO_CENA_DEFAULT = 1.5

S_RICAVI = 'Ricavi Operativi'
S_COSTI_OP = 'Costi Operativi'
REP_FNB = 'Food & Beverage'
IVA_RISTORANTE = 1.10   # corrispettivi manuali MMS/BON: lordo / 1,10 (mai lordo − iva)


def punti_struttura(struttura: str) -> list[str]:
    return ['unico'] if struttura == 'BON' else PUNTI_HOTEL


def sub_struttura(struttura: str) -> list[str]:
    if struttura == 'DPH':
        return ['ospiti', 'esterni']
    if struttura in ('CLB', 'INT'):
        return ['pranzo', 'cena']
    return []


def nome_punto(struttura: str, punto: str) -> str:
    if struttura == 'DPH' and punto == 'ristorante':
        return 'Ristorante Mare Mosso'
    return NOME_PUNTO[punto]


# ── Parametri (app_config) ───────────────────────────────────────────────────

def punto_default_cc(code: str) -> str:
    """Punto vendita di default di un reparto F&B dei cedolini, dal suffisso del codice.
    I reparti MMS (Cucina/Sala/Bar) lavorano solo per il Mare Mosso, cioè il ristorante di DPH."""
    c = code.upper()
    if c.startswith('MMS_'):
        return 'ristorante'
    if c.endswith('_COLAZIONI') or c.endswith('_PASTICCERIA'):
        return 'colazione'
    if c.endswith('_BAR'):
        return 'bar'
    return 'ristorante'


def leggi_parametri(db: Session) -> dict:
    p = {'peso_cena': PESO_CENA_DEFAULT, 'cc_punto': {}}
    riga = db.query(AppConfig).filter(AppConfig.key == CHIAVE_CONFIG).first()
    if riga:
        try:
            salvati = json.loads(riga.value)
            p.update(valida_parametri(salvati))
        except (ValueError, TypeError):
            pass   # config corrotta: restano i default
    return p


def valida_parametri(body: dict) -> dict:
    out = {}
    if 'peso_cena' in body:
        peso = float(body['peso_cena'])
        if not 0.1 <= peso <= 10:
            raise ValueError('Il peso della cena deve essere tra 0,1 e 10')
        out['peso_cena'] = round(peso, 2)
    if 'cc_punto' in body:
        mappa = body['cc_punto'] or {}
        if not isinstance(mappa, dict):
            raise ValueError('cc_punto deve essere un oggetto codice → punto vendita')
        for code, punto in mappa.items():
            if punto not in PUNTI_CEDOLINI:
                raise ValueError(f'Punto vendita non valido per {code}: {punto}')
        out['cc_punto'] = {str(k): v for k, v in mappa.items()}
    return out


def salva_parametri(db: Session, body: dict) -> dict:
    nuovi = {**leggi_parametri(db), **valida_parametri(body)}
    riga = db.query(AppConfig).filter(AppConfig.key == CHIAVE_CONFIG).first()
    if riga:
        riga.value = json.dumps(nuovi)
    else:
        db.add(AppConfig(key=CHIAVE_CONFIG, value=json.dumps(nuovi)))
    db.commit()
    return nuovi


def centri_fnb(db: Session) -> list[dict]:
    """Reparti F&B dei cedolini (figli di una categoria *_FNB) con la struttura di appartenenza.
    MMS è il ristorante di Du Parc (stessa logica del Conto Economico)."""
    tutti = {c.id: c for c in db.query(CostCenter).all()}
    out = []
    for c in tutti.values():
        cat = tutti.get(c.parent_id)
        if not cat or not cat.code.upper().endswith('_FNB'):
            continue
        radice = tutti.get(cat.parent_id)
        codice_radice = radice.code if radice else cat.code.split('_')[0]
        struttura = 'DPH' if codice_radice == 'MMS' else codice_radice
        out.append({'id': c.id, 'code': c.code, 'name': c.name, 'struttura': struttura,
                    'gruppo': radice.name if radice else '', 'attivo': c.attivo})
    out.sort(key=lambda x: (STRUTTURE.index(x['struttura']) if x['struttura'] in STRUTTURE else 9,
                            x['code']))
    return out


# ── Lettura dati (un anno, una struttura) ────────────────────────────────────

def _euro(v: float) -> str:
    return f"{v:,.0f} €".replace(',', '.')


def _f(v) -> float:
    return float(v or 0)


def _vuoto_mese() -> dict:
    return {'ricavi': 0.0, 'ricavi_contabili': 0.0, 'food': 0.0, 'beverage': 0.0,
            'personale': 0.0, 'personale_contabile': 0.0, 'altri': 0.0}


def punto_contabile(struttura: str, sottoreparto: str) -> str:
    if struttura == 'BON':
        return 'unico'
    s = (sottoreparto or '').strip().lower()
    for p in ('colazione', 'ristorante', 'bar'):
        if s.startswith(p):
            return p
    return 'altro'


def _carica_contabile(db: Session, struttura: str, anno: int):
    """Costi e ricavi F&B contabili per mese e punto vendita + dettaglio conti."""
    righe = db.query(UsaliRiga).filter(UsaliRiga.struttura_code == struttura,
                                       UsaliRiga.anno == anno).all()
    mesi_importati = {r.mese for r in righe}
    mappa = carica_mappa_categorie(db)
    per_mese = defaultdict(lambda: defaultdict(_vuoto_mese))
    conti = defaultdict(lambda: defaultdict(float))   # (punto, categoria, conto) → {mese: costo}
    for r in righe:
        if r.reparto != REP_FNB or r.sezione not in (S_RICAVI, S_COSTI_OP):
            continue
        punto = punto_contabile(struttura, r.sottoreparto)
        acc = per_mese[r.mese][punto]
        imp = _f(r.importo)
        if r.sezione == S_RICAVI:
            acc['ricavi_contabili'] += imp
            continue
        cat = categoria_di(r, mappa)
        costo = -imp   # costi in positivo, una rettifica li riduce
        if cat == 'food':
            acc['food'] += costo
        elif cat == 'beverage':
            acc['beverage'] += costo
        elif cat == 'personale':
            acc['personale_contabile'] += costo
        else:
            acc['altri'] += costo
        conti[(punto, cat or '', r.conto_nome)][r.mese] += costo
    return mesi_importati, per_mese, conti


def _punto_produzione(struttura: str, descrizione: str, cat: str):
    """(punto, sotto-riga) di una riga di Produzione, None se non è F&B. Sotto-riga None su un
    ristorante = voce non smistata tra pranzo e cena (conta solo nel totale del ristorante)."""
    dph = struttura == 'DPH'
    if descrizione == 'Maremosso':
        return ('ristorante', 'ospiti') if dph else None
    if cat in ('colazione', 'colazione_extra'):
        return ('colazione', None)
    if cat in ('pranzo', 'cena'):
        return ('ristorante', 'ospiti' if dph else cat)
    if cat.startswith('bar_'):
        return ('bar', None)
    if cat == 'altro' and descrizione == 'Ristorante':
        return ('ristorante', 'ospiti' if dph else None)
    return None


def _carica_produzione(db: Session, struttura: str, anno: int):
    """Ricavi (imponibile) e pasti da Produzione, aggregati in SQL per mese/reparto/categoria/voce.
    Per DPH comprende anche le righe di reparto 'Maremosso' di qualunque struttura (stessa regola
    di Movimenti Attivi)."""
    conta_pasto = {d.dettaglio_originale.strip().lower()
                   for d in db.query(ProdDettaglioCategoria)
                   .filter(ProdDettaglioCategoria.conta_come_pasto.is_(True)).all()}
    q = (
        db.query(
            extract('month', ProdRiga.data_riferimento).label('mese'),
            ProdRiga.descrizione, ProdCategoria.code,
            func.lower(func.trim(ProdRiga.dettaglio_originale)).label('det'),
            func.sum(ProdRiga.imponibile), func.count(ProdRiga.id),
        )
        .join(ProdCategoria, ProdCategoria.id == ProdRiga.categoria_id)
        .filter(ProdRiga.is_test.is_(False), ProdRiga.is_riassetto.is_(False),
                ProdCategoria.includi_report.is_(True),
                extract('year', ProdRiga.data_riferimento) == anno)
    )
    if struttura == 'DPH':
        q = q.filter((ProdRiga.struttura_code == 'DPH') | (ProdRiga.descrizione == 'Maremosso'))
    else:
        q = q.filter(ProdRiga.struttura_code == struttura,
                     func.coalesce(ProdRiga.descrizione, '') != 'Maremosso')
    ricavi = defaultdict(lambda: defaultdict(float))       # mese → (punto, sub) → €
    pasti = defaultdict(lambda: defaultdict(int))          # mese → categoria pasto → n
    for mese, desc, cat, det, imp, n in q.group_by('mese', ProdRiga.descrizione, ProdCategoria.code, 'det').all():
        dove = _punto_produzione(struttura, desc or '', cat)
        if dove is None:
            continue
        ricavi[int(mese)][dove] += _f(imp)
        if cat in ('colazione', 'colazione_extra', 'pranzo', 'cena') and (det or '') in conta_pasto:
            pasti[int(mese)][cat] += int(n)
    return ricavi, pasti


def _carica_corrispettivi(db: Session, codice: str, anno: int) -> dict:
    """Ricavi netti mensili di MMS/BON: incassi manuali (lordo / 1,10) + eventuali documenti
    arrangiamenti (stessa regola di `_ricavi_ristorante` del Conto Economico)."""
    out = defaultdict(float)
    for mese, lordo in (
        db.query(extract('month', CorrispettiviManuale.data_giorno),
                 func.sum(CorrispettiviManuale.arrangiamenti_lordo))
        .filter(CorrispettiviManuale.struttura_code == codice,
                CorrispettiviManuale.is_test.is_(False),
                extract('year', CorrispettiviManuale.data_giorno) == anno)
        .group_by(extract('month', CorrispettiviManuale.data_giorno)).all()
    ):
        out[int(mese)] += round(_f(lordo) / IVA_RISTORANTE, 2)
    for mese, imp in (
        db.query(extract('month', CorrispettiviDocumento.data_documento),
                 func.sum(CorrispettiviDocumento.imponibile))
        .filter(CorrispettiviDocumento.struttura_code == codice,
                CorrispettiviDocumento.tipo.in_(['scontrino', 'fattura']),
                CorrispettiviDocumento.categoria == 'arrangiamenti',
                CorrispettiviDocumento.annullato.is_(False),
                CorrispettiviDocumento.is_test.is_(False),
                extract('year', CorrispettiviDocumento.data_documento) == anno)
        .group_by(extract('month', CorrispettiviDocumento.data_documento)).all()
    ):
        out[int(mese)] += _f(imp)
    return out


def _carica_cedolini(db: Session, struttura: str, anno: int, cc_punto: dict) -> dict:
    """Costo aziendale dei reparti F&B per mese e punto vendita (ripartizione CC dei cedolini)."""
    centri = {c['id']: c for c in centri_fnb(db) if c['struttura'] == struttura}
    out = defaultdict(lambda: defaultdict(float))
    if not centri:
        return out
    righe = (
        db.query(PayrollImport.mese, EmployeeCostCenterMonthly.cost_center_id,
                 func.sum(EmployeeMonthly.costo_aziendale * EmployeeCostCenterMonthly.percentuale / 100))
        .join(EmployeeMonthly,
              (EmployeeCostCenterMonthly.employee_id == EmployeeMonthly.employee_id)
              & (EmployeeCostCenterMonthly.import_id == EmployeeMonthly.import_id))
        .join(PayrollImport, PayrollImport.id == EmployeeCostCenterMonthly.import_id)
        .filter(PayrollImport.anno == anno, PayrollImport.is_test.is_(False),
                EmployeeCostCenterMonthly.cost_center_id.in_(list(centri)))
        .group_by(PayrollImport.mese, EmployeeCostCenterMonthly.cost_center_id)
        .all()
    )
    for mese, cc_id, costo in righe:
        code = centri[cc_id]['code']
        punto = 'unico' if struttura == 'BON' else cc_punto.get(code) or punto_default_cc(code)
        out[int(mese)][punto] += _f(costo)
    return out


def carica_coperti_manuali(db: Session, anno: int) -> dict:
    """{(struttura MMS|BON, mese): valore}"""
    return {(r.struttura_code, r.mese): r.valore
            for r in db.query(UsaliFnbCoperti).filter(UsaliFnbCoperti.anno == anno).all()}


def carica_dati(db: Session, struttura: str, anno: int, parametri: dict) -> dict:
    """Tutto ciò che serve al calcolo, in dizionari semplici (calcolo puro in `costruisci_report`)."""
    mesi_importati, contabile, conti = _carica_contabile(db, struttura, anno)
    ricavi_prod, pasti = ({}, {}) if struttura == 'BON' else _carica_produzione(db, struttura, anno)
    esterni = _carica_corrispettivi(db, 'MMS', anno) if struttura == 'DPH' else {}
    bon = _carica_corrispettivi(db, 'BON', anno) if struttura == 'BON' else {}
    cedolini = _carica_cedolini(db, struttura, anno, parametri.get('cc_punto') or {})
    manuali = carica_coperti_manuali(db, anno)
    prod_rev = produzione_mensile(db, struttura, anno) if struttura != 'BON' else {}

    mesi = {}
    for m in range(1, 13):
        stato = prod_rev.get(m, {})
        mesi[m] = {
            'importato': m in mesi_importati,
            'presenze': stato.get('presenze') if stato.get('stato') == 'ok' else None,
            'contabile': {p: dict(v) for p, v in contabile.get(m, {}).items()},
            'personale': dict(cedolini.get(m, {})),
            'ricavi_prod': dict(ricavi_prod.get(m, {})),
            'pasti': dict(pasti.get(m, {})),
            'ricavi_esterni': esterni.get(m, 0.0),
            'ricavi_bon': bon.get(m, 0.0),
            'coperti_menu': manuali.get(('MMS', m)) if struttura == 'DPH' else None,
            'scontrini_bon': manuali.get(('BON', m)) if struttura == 'BON' else None,
        }
    return {'struttura': struttura, 'anno': anno, 'mesi': mesi,
            'conti': {k: dict(v) for k, v in conti.items()}}


# ── Calcolo (puro) ───────────────────────────────────────────────────────────

def _mese_punti(struttura: str, md: dict, peso_cena: float):
    """Valori di un mese per ogni riga (punto o sotto-riga) + avvisi del mese.
    Ritorna {chiave: {ricavi, ricavi_contabili, food, beverage, personale, personale_contabile,
    altri, coperti, presenze, costi_ok, stima}} — chiave = punto o 'punto.sub'."""
    importato = md['importato']
    out = {}
    avvisi = []
    for p in punti_struttura(struttura):
        cont = md['contabile'].get(p, _vuoto_mese())
        rec = {
            'ricavi': 0.0,
            'ricavi_contabili': cont['ricavi_contabili'],
            'food': cont['food'], 'beverage': cont['beverage'], 'altri': cont['altri'],
            'personale_contabile': cont['personale_contabile'],
            'personale': md['personale'].get(p, 0.0),
            'coperti': None, 'presenze': None, 'costi_ok': importato, 'stima': False,
        }
        out[p] = rec

    if struttura == 'BON':
        out['unico']['ricavi'] = md['ricavi_bon']
        out['unico']['coperti'] = md['scontrini_bon']
        return out, avvisi

    rp, pasti = md['ricavi_prod'], md['pasti']
    out['colazione']['ricavi'] = rp.get(('colazione', None), 0.0)
    out['bar']['ricavi'] = rp.get(('bar', None), 0.0)
    out['colazione']['coperti'] = (pasti.get('colazione', 0) + pasti.get('colazione_extra', 0)) or None
    out['colazione']['presenze'] = md['presenze']

    rist = out['ristorante']
    sub = {}
    if struttura == 'DPH':
        pr, ce = pasti.get('pranzo', 0), pasti.get('cena', 0)
        ospiti_cop = pr + ce
        menu = md['coperti_menu']
        esterni_cop = None
        if menu is not None:
            esterni_cop = menu - ospiti_cop
            if esterni_cop < 0:
                avvisi.append(f"coperti Menu ({menu}) inferiori ai pasti degli ospiti Du Parc ({ospiti_cop})")
                esterni_cop = None
        sub['ospiti'] = {'ricavi': rp.get(('ristorante', 'ospiti'), 0.0), 'coperti': ospiti_cop or None,
                         'peso': pr + ce * peso_cena}
        sub['esterni'] = {'ricavi': md['ricavi_esterni'], 'coperti': esterni_cop,
                          'peso': None if esterni_cop is None else esterni_cop * peso_cena}
        rist['coperti'] = menu   # adesione solo sulla riga ospiti: il totale Menu comprende gli esterni
    else:
        pr, ce = pasti.get('pranzo', 0), pasti.get('cena', 0)
        sub['pranzo'] = {'ricavi': rp.get(('ristorante', 'pranzo'), 0.0), 'coperti': pr or None, 'peso': pr}
        sub['cena'] = {'ricavi': rp.get(('ristorante', 'cena'), 0.0), 'coperti': ce or None,
                       'peso': ce * peso_cena}
        rist['coperti'] = (pr + ce) or None
        rist['presenze'] = md['presenze']
    rist['ricavi'] = sum(s['ricavi'] for s in sub.values()) + rp.get(('ristorante', None), 0.0)

    # Ripartizione stimata dei costi del ristorante sulle sotto-righe (coperti pesati)
    pesi = [s['peso'] for s in sub.values()]
    ripartibile = importato and all(w is not None for w in pesi) and sum(pesi) > 0
    for nome, s in sub.items():
        quota = s['peso'] / sum(pesi) if ripartibile else None
        rec = {'ricavi': s['ricavi'], 'ricavi_contabili': None, 'coperti': s['coperti'],
               'presenze': md['presenze'] if nome in ('cena', 'pranzo', 'ospiti') else None,
               'costi_ok': ripartibile, 'stima': True}
        for k in ('food', 'beverage', 'altri', 'personale', 'personale_contabile'):
            rec[k] = rist[k] * quota if ripartibile else 0.0
        out[f'ristorante.{nome}'] = rec
    return out, avvisi


def _somma(serie: list[dict]) -> dict:
    """KPI di periodo di una riga: numeratori e denominatori sommati sui soli mesi validi."""
    def S(chiave, cond=lambda r: True):
        return sum(r[chiave] or 0 for r in serie if cond(r))

    con_costi = lambda r: r['costi_ok']                                  # noqa: E731
    con_coperti = lambda r: r['coperti'] is not None and r['coperti'] > 0  # noqa: E731
    ricavi = S('ricavi')
    ric_c = S('ricavi', con_costi)
    food, bev = S('food', con_costi), S('beverage', con_costi)
    pers, altri = S('personale', con_costi), S('altri', con_costi)
    mp = food + bev
    costi = mp + pers + altri
    ha_costi = any(con_costi(r) for r in serie)

    cop = S('coperti', con_coperti)
    ric_cop = S('ricavi', con_coperti)
    entrambi = lambda r: con_costi(r) and con_coperti(r)  # noqa: E731
    cop_cc = S('coperti', entrambi)
    mp_cc = S('food', entrambi) + S('beverage', entrambi)
    pers_cc = S('personale', entrambi)
    costi_cc = mp_cc + pers_cc + S('altri', entrambi)
    ades = lambda r: con_coperti(r) and r['presenze']  # noqa: E731
    cop_p, pres_p = S('coperti', ades), S('presenze', ades)

    def div(a, b, f=1):
        return round(a / b * f, 2) if b else None

    def val(v):
        return round(v, 2) if ha_costi else None

    rc = [r.get('ricavi_contabili') for r in serie if r['costi_ok'] and r.get('ricavi_contabili') is not None]
    return {
        'ricavi': round(ricavi, 2),
        'ricavi_contabili': round(sum(rc), 2) if rc else None,
        'food': val(food), 'beverage': val(bev), 'materia_prima': val(mp),
        'food_perc': div(food, ric_c, 100) if ha_costi else None,
        'beverage_perc': div(bev, ric_c, 100) if ha_costi else None,
        'materia_prima_perc': div(mp, ric_c, 100) if ha_costi else None,
        'personale': val(pers),
        'personale_contabile': val(S('personale_contabile', con_costi)),
        'prime_cost': val(mp + pers),
        'prime_cost_perc': div(mp + pers, ric_c, 100) if ha_costi else None,
        'altri_costi': val(altri),
        'costi_totali': val(costi),
        'margine': val(ric_c - costi),
        'margine_perc': div(ric_c - costi, ric_c, 100) if ha_costi else None,
        'coperti': cop if any(con_coperti(r) for r in serie) else None,
        'ricavo_coperto': div(ric_cop, cop),
        'mp_coperto': div(mp_cc, cop_cc),
        'personale_coperto': div(pers_cc, cop_cc),
        'costo_coperto': div(costi_cc, cop_cc),
        'adesione_perc': div(cop_p, pres_p, 100),
    }


def costruisci_report(dati: dict, mese_da: int, mese_a: int, peso_cena: float) -> dict:
    """Righe del riepilogo (punti, sotto-righe, totale struttura) con KPI di periodo e mensili."""
    struttura = dati['struttura']
    mesi = list(range(mese_da, mese_a + 1))
    per_mese = {}
    avvisi = []
    for m in mesi:
        valori, avv = _mese_punti(struttura, dati['mesi'][m], peso_cena)
        per_mese[m] = valori
        avvisi += [f"{NOME_STRUTTURA[struttura]}, mese {m}: {a}" for a in avv]

    chiavi = []
    for p in punti_struttura(struttura):
        chiavi.append((p, None))
        if p == 'ristorante':
            chiavi += [(p, s) for s in sub_struttura(struttura)]

    righe = []
    for p, s in chiavi:
        k = p if s is None else f'{p}.{s}'
        serie = [per_mese[m][k] for m in mesi]
        periodo = _somma(serie)
        if p == 'altro' and not any(periodo[x] for x in ('ricavi', 'costi_totali', 'personale')):
            continue   # sottoreparto inatteso: compare solo se ha valori
        righe.append({
            'id': f'{struttura}.{k}', 'parent': f'{struttura}.{p}' if s else f'{struttura}.totale',
            'struttura': struttura, 'punto': p, 'sub': s, 'tipo': 'sub' if s else 'punto',
            'label': NOME_SUB[s] if s else nome_punto(struttura, p),
            'stima_costi': bool(s),
            'periodo': periodo,
            'mesi': [{'mese': m, **_somma([per_mese[m][k]])} for m in mesi],
        })

    # Totale struttura: somma dei punti (coperti non sommati: colazioni e cene non si sommano)
    def tot_mese(m):
        recs = [per_mese[m][p] for p in punti_struttura(struttura)]
        return {
            **{k: sum(r[k] for r in recs) for k in ('ricavi', 'food', 'beverage', 'personale',
                                                     'personale_contabile', 'altri')},
            'ricavi_contabili': sum(r['ricavi_contabili'] or 0 for r in recs),
            'coperti': None, 'presenze': None, 'costi_ok': dati['mesi'][m]['importato'], 'stima': False,
        }
    serie_tot = [tot_mese(m) for m in mesi]
    totale = {
        'id': f'{struttura}.totale', 'parent': None, 'struttura': struttura, 'punto': None, 'sub': None,
        'tipo': 'totale', 'label': f'Totale {NOME_STRUTTURA[struttura]}', 'stima_costi': False,
        'periodo': _somma(serie_tot),
        'mesi': [{'mese': m, **_somma([r])} for m, r in zip(mesi, serie_tot)],
    }

    # Avvisi di qualità dei dati
    mancanti = [m for m in mesi if not dati['mesi'][m]['importato']]
    for m, r in zip(mesi, serie_tot):
        if r['costi_ok'] and r['ricavi'] > 1000 and r['ricavi_contabili'] < r['ricavi'] * 0.5:
            avvisi.append(
                f"{NOME_STRUTTURA[struttura]}, mese {m}: ricavi F&B in contabilità "
                f"{_euro(r['ricavi_contabili'])} contro {_euro(r['ricavi'])} gestionali: "
                "contabilità probabilmente incompleta")
    if struttura == 'DPH':
        senza = [m for m in mesi if dati['mesi'][m]['coperti_menu'] is None
                 and per_mese[m]['ristorante.esterni']['ricavi'] > 0]
        if senza:
            avvisi.append(f"Mare Mosso: coperti Menu non inseriti per i mesi {', '.join(map(str, senza))}")
    if struttura == 'BON':
        senza = [m for m in mesi if dati['mesi'][m]['scontrini_bon'] is None
                 and per_mese[m]['unico']['ricavi'] > 0]
        if senza:
            avvisi.append(f"Buona Onda: scontrini non inseriti per i mesi {', '.join(map(str, senza))}")

    return {'struttura': struttura, 'righe': [totale] + righe, 'mesi_senza_contabilita': mancanti,
            'avvisi': avvisi}


def report_gruppo(reports: list[dict], mese_da: int, mese_a: int) -> dict:
    """Vista Gruppo: una riga per struttura (il suo totale) + totale gruppo, sommando i valori
    di base mese per mese (mai i KPI)."""
    righe = []
    mesi = list(range(mese_da, mese_a + 1))
    basi = defaultdict(list)
    for rep in reports:
        tot = rep['righe'][0]
        righe.append({**tot, 'id': f"G.{rep['struttura']}", 'parent': 'G.totale', 'tipo': 'punto',
                      'label': NOME_STRUTTURA[rep['struttura']]})
        for m in tot['mesi']:
            basi[m['mese']].append(m)
    def base(x):
        costi_ok = x['costi_totali'] is not None
        return {'ricavi': x['ricavi'], 'ricavi_contabili': x['ricavi_contabili'],
                'food': x['food'] or 0, 'beverage': x['beverage'] or 0, 'personale': x['personale'] or 0,
                'personale_contabile': x['personale_contabile'] or 0, 'altri': x['altri_costi'] or 0,
                'coperti': None, 'presenze': None, 'costi_ok': costi_ok, 'stima': False}
    # Per sommare strutture con mesi contabili diversi si sommano le basi per struttura e mese
    serie = [base(x) for m in mesi for x in basi[m]]
    totale = {
        'id': 'G.totale', 'parent': None, 'struttura': 'GRUPPO', 'punto': None, 'sub': None,
        'tipo': 'totale', 'label': 'Totale gruppo', 'stima_costi': False,
        'periodo': _somma(serie),
        'mesi': [{'mese': m, **_somma([base(x) for x in basi[m]])} for m in mesi],
    }
    return {'struttura': 'GRUPPO', 'righe': [totale] + righe,
            'mesi_senza_contabilita': sorted({m for r in reports for m in r['mesi_senza_contabilita']}),
            'avvisi': [a for r in reports for a in r['avvisi']]}


def materia_prima(dati: dict, mese_da: int, mese_a: int) -> dict:
    """Conti di costo F&B del periodo per punto vendita: food/beverage + quelli senza categoria."""
    struttura = dati['struttura']
    mesi = range(mese_da, mese_a + 1)
    conti, non_cat = [], []
    for (punto, cat, conto), per_mese in dati['conti'].items():
        tot = round(sum(per_mese.get(m, 0.0) for m in mesi), 2)
        if not tot:
            continue
        riga = {'struttura': struttura, 'punto': punto, 'punto_label': nome_punto(struttura, punto),
                'conto': conto, 'categoria': cat or None, 'totale': tot}
        if cat in ('food', 'beverage'):
            conti.append(riga)
        elif not cat:
            non_cat.append(riga)
    conti.sort(key=lambda r: -r['totale'])
    non_cat.sort(key=lambda r: -r['totale'])
    return {'conti': conti, 'non_categorizzati': non_cat,
            'totale_non_categorizzati': round(sum(r['totale'] for r in non_cat), 2)}
