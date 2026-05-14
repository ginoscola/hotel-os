"""Router FastAPI per i dashboard hotel e gruppo."""

from collections import defaultdict
from datetime import date, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.sql import func
from sqlalchemy.orm import Session

from app.auth import richiedi_utente_attivo

from app.database import get_db
from app.models.revenue import DailyRevenue
from app.schemas.dashboard import (
    ContributoHotel,
    DashboardGruppoResponse,
    DashboardHotelResponse,
    GiornoSchema,
    KPISchema,
    ListaSnapshotGruppo,
    SettimanaDashboard,
    SettimanGruppo,
    SnapshotGruppoItem,
)
from app.services.file_parser import RigaRevenue
from app.services.kpi_calculator import aggrega_totali_righe, calcola_kpi, kpi_da_riga
from app.services.weekly_aggregator import aggrega_settimane
from app.services.group_aggregator import aggrega_gruppo_settimanale
from app.utils.locale_it import GIORNI_IT, formatta_data_it

router = APIRouter(prefix="/dashboard", tags=["dashboard"], dependencies=[Depends(richiedi_utente_attivo)])


def _nome_hotel(hotel_code: str, db: Session) -> str:
    """Restituisce il nome dell'hotel dal DB, oppure il codice come fallback."""
    from app.models.revenue import Hotel
    h = db.query(Hotel).filter(Hotel.code == hotel_code).first()
    return h.name if h else hotel_code


# ---------------------------------------------------------------------------
# Dashboard singolo hotel
# ---------------------------------------------------------------------------

@router.get("/hotel/{hotel_code}", response_model=DashboardHotelResponse)
def dashboard_hotel(
    hotel_code: str,
    da: Optional[date] = Query(None, description="Data inizio (YYYY-MM-DD)"),
    a: Optional[date] = Query(None, description="Data fine (YYYY-MM-DD)"),
    snapshot: Optional[date] = Query(None, description="Data snapshot (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
):
    """
    Restituisce KPI settimana di riferimento, aggregazioni settimanali e dati
    giornalieri per un singolo hotel.

    Modalità snapshot (consigliata): passare ?snapshot=YYYY-MM-DD per caricare
    l'intera stagione di quella snapshot. Il kpi_periodo sarà calcolato sulla
    settimana commerciale che contiene la snapshot_date.

    Modalità legacy: passare ?da=&a= per filtrare per intervallo di date.
    """
    hotel_code = hotel_code.upper()

    # Verifica che l'hotel esista nel database
    from app.models.revenue import Hotel
    if not db.query(Hotel).filter(Hotel.code == hotel_code).first():
        raise HTTPException(
            status_code=404,
            detail=f"Hotel '{hotel_code}' non trovato nel database",
        )

    if snapshot is not None:
        # Modalità snapshot: carica tutta la stagione per quella snapshot_date
        righe = _carica_righe(db, hotel_code=hotel_code, snapshot_date=snapshot)
        snap_date = snapshot
        ref_start = _settimana_di_data(snapshot)
        ref_end = ref_start + timedelta(days=6)
    else:
        # Modalità legacy: filtra per intervallo date
        righe = _carica_righe(db, hotel_code=hotel_code, da=da, a=a)
        snap_date = _max_snapshot(db, hotel_code=hotel_code, da=da, a=a)
        ref_start = None
        ref_end = None

    if not righe:
        raise HTTPException(
            status_code=404,
            detail=f"Nessun dato per {hotel_code} nel periodo selezionato. Importare prima i file CSV.",
        )

    # kpi_stagione = aggregato su TUTTA la stagione caricata nella snapshot
    kpi_stagione = _kpi_schema(righe)

    settimane = _settimane_dashboard(righe)
    giorni = _giorni_schema(righe)

    return DashboardHotelResponse(
        hotel_code=hotel_code,
        hotel_name=_nome_hotel(hotel_code, db),
        periodo_da=min(r.data for r in righe),
        periodo_a=max(r.data for r in righe),
        snapshot_date=snap_date,
        settimana_ref_start=ref_start,
        settimana_ref_end=ref_end,
        kpi_stagione=kpi_stagione,
        settimane=settimane,
        giorni=giorni,
    )


# ---------------------------------------------------------------------------
# Dashboard gruppo — lista snapshot disponibili
# (definito PRIMA di /gruppo per evitare ambiguità di routing)
# ---------------------------------------------------------------------------

@router.get("/gruppo/snapshots", response_model=ListaSnapshotGruppo)
def lista_snapshot_gruppo(db: Session = Depends(get_db)):
    """Lista delle snapshot disponibili per il gruppo (union di tutti gli hotel)."""
    rows = db.execute(
        select(DailyRevenue.snapshot_date)
        .where(DailyRevenue.snapshot_date.isnot(None))
        .distinct()
        .order_by(DailyRevenue.snapshot_date.desc())
    ).scalars().all()
    return ListaSnapshotGruppo(
        snapshots=[
            SnapshotGruppoItem(snapshot_date=sd, label=formatta_data_it(sd))
            for sd in rows
        ]
    )


# ---------------------------------------------------------------------------
# Dashboard gruppo
# ---------------------------------------------------------------------------

@router.get("/gruppo", response_model=DashboardGruppoResponse)
def dashboard_gruppo(
    modalita: Optional[str] = Query(None, description="'settimana' | 'stagione'"),
    settimana: Optional[date] = Query(None, description="week_start per modalita=settimana"),
    snapshot: Optional[date] = Query(None, description="snapshot_date"),
    da: Optional[date] = Query(None, description="Data inizio — legacy"),
    a: Optional[date] = Query(None, description="Data fine — legacy"),
    db: Session = Depends(get_db),
):
    """
    Restituisce KPI di gruppo aggregati, contributo per hotel e trend settimanale.

    Modalità stagione: ?modalita=stagione&snapshot=YYYY-MM-DD
      → carica tutta la stagione della snapshot per tutti gli hotel

    Modalità settimana: ?modalita=settimana&settimana=YYYY-MM-DD[&snapshot=YYYY-MM-DD]
      → carica i dati della settimana commerciale dalla snapshot indicata
        (se snapshot omessa, usa la più recente disponibile per quella settimana)

    Legacy: ?da=&a= (comportamento precedente, senza filtro snapshot)
    """
    from app.models.revenue import Hotel
    hotel_nomi = {h.code: h.name for h in db.query(Hotel).all()}

    ref_start: Optional[date] = None
    ref_end:   Optional[date] = None
    modo = modalita or 'settimana'

    if modalita == 'stagione' and snapshot:
        per_hotel = _raggruppa_per_hotel(_carica_righe(db, snapshot_date=snapshot))
        snap_date = snapshot

    elif modalita == 'settimana' and settimana:
        we = settimana + timedelta(days=6)
        snap = snapshot or _max_snapshot(db, da=settimana, a=we)
        if snap is None:
            raise HTTPException(
                status_code=404,
                detail="Nessun dato disponibile per la settimana selezionata.",
            )
        per_hotel = _raggruppa_per_hotel(
            _carica_righe(db, snapshot_date=snap, da=settimana, a=we)
        )
        snap_date = snap
        ref_start = settimana
        ref_end = we

    else:
        # Modalità legacy: filtra per intervallo date senza vincolo snapshot
        righe_legacy = _carica_righe(db, da=da, a=a)
        if not righe_legacy:
            raise HTTPException(
                status_code=404,
                detail="Nessun dato disponibile per il periodo selezionato. Importare prima i file CSV.",
            )
        per_hotel = _raggruppa_per_hotel(righe_legacy)
        snap_date = _max_snapshot(db, da=da, a=a)

    if not per_hotel:
        raise HTTPException(
            status_code=404,
            detail="Nessun dato disponibile per il periodo selezionato. Importare prima i file CSV.",
        )

    tutte: List[RigaRevenue] = [r for righe in per_hotel.values() for r in righe]
    hotel_attivi = sorted(per_hotel.keys())

    kpi_gruppo = _kpi_schema(tutte)
    tot_revenue = sum(r.revenue_total for r in tutte)
    contributi = [
        _contributo_hotel(codice, righe, tot_revenue, hotel_nomi)
        for codice, righe in sorted(per_hotel.items())
    ]
    settimane = _settimane_gruppo(per_hotel)
    date_tutte = [r.data for r in tutte]

    return DashboardGruppoResponse(
        periodo_da=min(date_tutte),
        periodo_a=max(date_tutte),
        snapshot_date=snap_date,
        hotel_attivi=hotel_attivi,
        kpi_gruppo=kpi_gruppo,
        contributi=contributi,
        settimane=settimane,
        modalita=modo,
        settimana_ref_start=ref_start,
        settimana_ref_end=ref_end,
    )


# ---------------------------------------------------------------------------
# Funzioni interne
# ---------------------------------------------------------------------------

def _settimana_di_data(d: date) -> date:
    """Sabato di inizio della settimana commerciale per la data d."""
    return d - timedelta(days=(d.weekday() - 5) % 7)


def _carica_righe(
    db: Session,
    hotel_code: Optional[str] = None,
    snapshot_date: Optional[date] = None,
    da: Optional[date] = None,
    a: Optional[date] = None,
) -> List[RigaRevenue]:
    """Carica righe da daily_revenue applicando i filtri forniti.

    Tutti i parametri sono opzionali e combinabili:
    - hotel_code: filtra per hotel (None = tutti gli hotel)
    - snapshot_date: filtra per snapshot
    - da / a: filtra per intervallo di date
    """
    query = select(DailyRevenue).order_by(DailyRevenue.hotel_code, DailyRevenue.data)
    if hotel_code:
        query = query.where(DailyRevenue.hotel_code == hotel_code)
    if snapshot_date:
        query = query.where(DailyRevenue.snapshot_date == snapshot_date)
    if da:
        query = query.where(DailyRevenue.data >= da)
    if a:
        query = query.where(DailyRevenue.data <= a)
    return [_db_a_riga(r) for r in db.execute(query).scalars().all()]


def _raggruppa_per_hotel(righe: List[RigaRevenue]) -> Dict[str, List[RigaRevenue]]:
    """Raggruppa una lista piatta di righe in un dict hotel_code → righe."""
    per_hotel: Dict[str, List[RigaRevenue]] = defaultdict(list)
    for r in righe:
        per_hotel[r.hotel_code].append(r)
    return dict(per_hotel)


def _db_a_riga(row: DailyRevenue) -> RigaRevenue:
    return RigaRevenue(
        hotel_code=row.hotel_code,
        data=row.data,
        rooms_sold=row.rooms_sold,
        rooms_available=row.rooms_available,
        pax=row.pax,
        revenue_rooms=row.revenue_rooms,
        revenue_fnb=row.revenue_fnb,
        revenue_extra=row.revenue_extra,
        revenue_total=row.revenue_total,
    )


def _kpi_schema(righe: List[RigaRevenue]) -> KPISchema:
    t = aggrega_totali_righe(righe)
    kpi = calcola_kpi(
        rooms_sold=t.rooms_sold,
        rooms_available=t.rooms_available,
        revenue_rooms=t.revenue_rooms,
        revenue_fnb=t.revenue_fnb,
        revenue_extra=t.revenue_extra,
        revenue_total=t.revenue_total,
    )
    return KPISchema(
        rooms_sold=t.rooms_sold,
        rooms_available=t.rooms_available,
        occupancy=_r(kpi.occupancy),
        adr=_r(kpi.adr),
        revpar=_r(kpi.revpar),
        trevpar=_r(kpi.trevpar),
        rmc=_r(kpi.rmc),
        inc_rooms=_r(kpi.inc_rooms),
        inc_fnb=_r(kpi.inc_fnb),
        inc_extra=_r(kpi.inc_extra),
        revenue_total=_r(t.revenue_total),
    )


def _giorni_schema(righe: List[RigaRevenue]) -> List[GiornoSchema]:
    risultato = []
    for r in righe:
        kpi = kpi_da_riga(r)
        risultato.append(
            GiornoSchema(
                data=r.data,
                label=f"{r.data.strftime('%d/%m')} {GIORNI_IT[r.data.weekday()]}",
                rooms_sold=r.rooms_sold,
                rooms_available=r.rooms_available,
                pax=r.pax,
                revenue_rooms=r.revenue_rooms,
                revenue_fnb=r.revenue_fnb,
                revenue_extra=r.revenue_extra,
                revenue_total=r.revenue_total,
                occupancy=_r(kpi.occupancy),
                adr=_r(kpi.adr),
                revpar=_r(kpi.revpar),
                trevpar=_r(kpi.trevpar),
                rmc=_r(kpi.rmc),
            )
        )
    return risultato


def _settimane_dashboard(righe: List[RigaRevenue]) -> List[SettimanaDashboard]:
    settimane = aggrega_settimane(righe)
    risultato = []
    for s in settimane:
        risultato.append(
            SettimanaDashboard(
                week_start=s.week_start,
                week_end=s.week_end,
                label=(
                    f"{s.week_start.strftime('%d/%m')}–{s.week_end.strftime('%d/%m')}"
                ),
                giorni=s.giorni,
                settimana_completa=s.settimana_completa,
                rooms_sold=s.rooms_sold,
                rooms_available=s.rooms_available,
                revenue_rooms=s.revenue_rooms,
                revenue_fnb=s.revenue_fnb,
                revenue_extra=s.revenue_extra,
                revenue_total=s.revenue_total,
                occupancy=_r(s.kpi.occupancy),
                adr=_r(s.kpi.adr),
                revpar=_r(s.kpi.revpar),
                trevpar=_r(s.kpi.trevpar),
                rmc=_r(s.kpi.rmc),
                inc_rooms=_r(s.kpi.inc_rooms),
                inc_fnb=_r(s.kpi.inc_fnb),
                inc_extra=_r(s.kpi.inc_extra),
            )
        )
    return risultato


def _contributo_hotel(
    codice: str,
    righe: List[RigaRevenue],
    tot_revenue_gruppo: float,
    hotel_nomi: Optional[Dict[str, str]] = None,
) -> ContributoHotel:
    rs = sum(r.rooms_sold for r in righe)
    ra = sum(r.rooms_available for r in righe)
    rr = sum(r.revenue_rooms for r in righe)
    rt = sum(r.revenue_total for r in righe)
    kpi = calcola_kpi(rs, ra, rr,
                      sum(r.revenue_fnb for r in righe),
                      sum(r.revenue_extra for r in righe), rt)
    perc = _r(rt / tot_revenue_gruppo * 100) if tot_revenue_gruppo else None
    # Usa il dizionario nomi passato dall'esterno; fallback al codice se non disponibile
    nome = (hotel_nomi or {}).get(codice, codice)
    return ContributoHotel(
        hotel_code=codice,
        hotel_name=nome,
        rooms_sold=rs,
        rooms_available=ra,
        revenue_rooms=round(rr, 2),
        revenue_fnb=round(sum(r.revenue_fnb for r in righe), 2),
        revenue_extra=round(sum(r.revenue_extra for r in righe), 2),
        revenue_total=round(rt, 2),
        perc_revenue=perc,
        occupancy=_r(kpi.occupancy),
        adr=_r(kpi.adr),
        revpar=_r(kpi.revpar),
    )


def _settimane_gruppo(per_hotel: Dict[str, List[RigaRevenue]]) -> List[SettimanGruppo]:
    settimane_agg = aggrega_gruppo_settimanale(per_hotel)
    risultato = []
    for sg in settimane_agg:
        risultato.append(
            SettimanGruppo(
                week_start=sg.week_start,
                week_end=sg.week_end,
                label=f"{sg.week_start.strftime('%d/%m')}–{sg.week_end.strftime('%d/%m')}",
                hotel_attivi=sg.hotel_codes,
                rooms_sold=sg.rooms_sold,
                rooms_available=sg.rooms_available,
                revenue_rooms=sg.revenue_rooms,
                revenue_fnb=sg.revenue_fnb,
                revenue_extra=sg.revenue_extra,
                revenue_total=sg.revenue_total,
                occupancy=_r(sg.kpi.occupancy),
                adr=_r(sg.kpi.adr),
                revpar=_r(sg.kpi.revpar),
                trevpar=_r(sg.kpi.trevpar),
            )
        )
    return risultato


def _max_snapshot(
    db: Session,
    hotel_code: Optional[str] = None,
    da: Optional[date] = None,
    a: Optional[date] = None,
) -> Optional[date]:
    """Restituisce la snapshot_date massima nel periodo/hotel indicato."""
    q = select(func.max(DailyRevenue.snapshot_date))
    if hotel_code:
        q = q.where(DailyRevenue.hotel_code == hotel_code)
    if da:
        q = q.where(DailyRevenue.data >= da)
    if a:
        q = q.where(DailyRevenue.data <= a)
    return db.execute(q).scalar()


def _r(v: Optional[float], d: int = 2) -> Optional[float]:
    return round(v, d) if v is not None else None
