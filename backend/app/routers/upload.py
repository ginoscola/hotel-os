"""Router FastAPI — upload coppia CSV/Excel, salvataggio in PostgreSQL, report importazione."""

import os
import tempfile
from datetime import date
from typing import List, Optional, Set

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.auth import richiedi_admin
from app.database import get_db
from app.models.revenue import DailyRevenue, Hotel, ImportSession
from app.routers.hotels import get_stagione_per_anno

router = APIRouter(prefix="/upload", tags=["upload"], dependencies=[Depends(richiedi_admin)])
from app.schemas.revenue import (
    AnomaliaImport,
    BulkImportResponse,
    KPIPeriodo,
    RisultatoBulk,
    RisultatoUpload,
)
from app.services.file_parser import (
    ParserCSV,
    RigaRevenue,
    estrai_hotel_code_da_file,
    estrai_snapshot_date,
)
from app.services.kpi_calculator import aggrega_totali_righe, calcola_kpi


# ---------------------------------------------------------------------------
# Endpoint: upload coppia singola
# ---------------------------------------------------------------------------

@router.post("/coppia/{hotel_code}", response_model=RisultatoUpload)
async def upload_coppia_file(
    hotel_code: str,
    file1: UploadFile = File(..., description="CSV/Excel con RICAVI TRAT comprensivi di ristorante"),
    file2: UploadFile = File(..., description="CSV/Excel con RICAVI TRAT solo alloggio"),
    snapshot_date: Optional[date] = Query(default=None, alias="snapshot_date", description="Data snapshot (YYYY-MM-DD); se omessa viene estratta dal nome file"),
    anno: Optional[int] = Query(default=None, description="Anno stagionale (default: anno dalla snapshot_date)"),
    is_test: bool = Query(default=False, description="Segna i dati come test (cancellabili dall'area admin)"),
    db: Session = Depends(get_db),
):
    """
    Importa una coppia di file (CSV o Excel) per un hotel.

    1. Verifica che l'hotel esista nel database
    2. Parsing e applicazione filtro stagionale (se configurato nel DB)
    3. Upsert in daily_revenue (insert o update per (hotel_code, data))
    4. Registra la sessione in imports (idempotente per hotel_code+snapshot_date)
    5. Calcolo KPI aggregati sul periodo importato
    6. Rilevazione anomalie (revenue negativo, camere senza ricavi, ecc.)
    7. Risposta con contatori, KPI e lista anomalie
    """
    hotel_code = hotel_code.upper()

    # Valida che l'hotel esista nel database
    hotel = db.query(Hotel).filter(Hotel.code == hotel_code).first()
    if not hotel:
        raise HTTPException(
            status_code=400,
            detail=f"Hotel '{hotel_code}' non trovato nel database. Crearlo prima con POST /hotels/",
        )

    # snapshot_date: priorità al parametro esplicito, poi dal nome file, poi oggi come fallback
    snapshot_dt = snapshot_date or estrai_snapshot_date(file1.filename or "") or date.today()

    anno_ricerca = anno or snapshot_dt.year
    stagione = get_stagione_per_anno(hotel_code, anno_ricerca, db)
    open_date = stagione.open_date if stagione else None
    close_date = stagione.close_date if stagione else None

    # Salva i file caricati in temp e fai parsing
    path1, path2 = await _salva_temp(file1, file2)
    try:
        parser = ParserCSV(hotel_code=hotel_code)
        righe = parser.parse_coppia(
            path_file1=path1,
            path_file2=path2,
            open_date=open_date,
            close_date=close_date,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Errore nel parsing: {e}")
    finally:
        os.unlink(path1)
        os.unlink(path2)

    nome_file = f"{file1.filename} / {file2.filename}"
    righe_lette = len(righe) + parser.righe_scartate + parser.righe_fuori_stagione

    if not righe:
        return _risposta_vuota(
            hotel_code=hotel_code,
            righe_lette=righe_lette,
            righe_scartate=parser.righe_scartate,
            righe_fuori_stagione=parser.righe_fuori_stagione,
            warnings=parser.warnings,
            snapshot_date=snapshot_dt,
        )

    # Upsert nel database (include snapshot_date e is_test su ogni riga)
    n_inserite, n_aggiornate = _upsert_righe(db, righe, nome_file, snapshot_dt, is_test)

    # Registra/aggiorna la sessione di import
    anomalie = _rileva_anomalie(righe)
    _registra_import_session(
        db=db,
        hotel_code=hotel_code,
        snapshot_date=snapshot_dt,
        file1_nome=file1.filename,
        file2_nome=file2.filename,
        righe_lette=righe_lette,
        righe_inserite=n_inserite,
        righe_aggiornate=n_aggiornate,
        righe_scartate=parser.righe_scartate,
        anomalie=anomalie,
        stato="warning" if parser.warnings or anomalie else "success",
        is_test=is_test,
    )

    # KPI aggregati sul periodo importato (dai totali, non da medie)
    kpi_periodo = _calcola_kpi_periodo(righe)

    date_valide = [r.data for r in righe]
    stagione_info = (
        f" — stagione {anno_ricerca}: "
        f"{open_date.strftime('%d/%m/%Y')}–{close_date.strftime('%d/%m/%Y')}"
        if stagione else ""
    )

    return RisultatoUpload(
        hotel_code=hotel_code,
        righe_lette=righe_lette,
        righe_importate=n_inserite + n_aggiornate,
        righe_inserite=n_inserite,
        righe_aggiornate=n_aggiornate,
        righe_scartate=parser.righe_scartate,
        righe_fuori_stagione=parser.righe_fuori_stagione,
        periodo_da=min(date_valide),
        periodo_a=max(date_valide),
        snapshot_date=snapshot_dt,
        kpi_periodo=kpi_periodo,
        anomalie=anomalie,
        warnings=parser.warnings,
        messaggio=(
            f"{hotel_code}: {n_inserite} nuovi, {n_aggiornate} aggiornati"
            f"{stagione_info}"
        ),
    )


# ---------------------------------------------------------------------------
# Endpoint: bulk import da cartella
# ---------------------------------------------------------------------------

@router.post("/bulk", response_model=BulkImportResponse)
async def upload_bulk(
    cartella: str = Query(..., description="Percorso assoluto della cartella con i file"),
    anno: Optional[int] = Query(default=None, description="Anno stagionale (default: anno corrente)"),
    is_test: bool = Query(default=False, description="Segna i dati come test (cancellabili dall'area admin)"),
    db: Session = Depends(get_db),
):
    """
    Importa in blocco tutte le coppie di file CSV/Excel trovate in una cartella.

    - Raggruppa i file per (hotel_code, snapshot_date)
    - Salta le coppie già importate con successo (idempotente)
    - Riprova le coppie con stato "error"
    - Riporta un riepilogo completo con esito per ogni coppia
    """
    # Verifica esistenza cartella
    if not os.path.isdir(cartella):
        raise HTTPException(status_code=400, detail=f"Cartella non trovata: '{cartella}'")

    # Scansiona i file supportati (CSV e Excel)
    tutti_file = [
        f for f in os.listdir(cartella)
        if os.path.isfile(os.path.join(cartella, f))
        and f.lower().endswith((".csv", ".xlsx", ".xls"))
    ]

    # Raggruppa per (hotel_code, snapshot_date)
    gruppi: dict = {}
    for nome_file in tutti_file:
        hotel_code = estrai_hotel_code_da_file(nome_file)
        if hotel_code is None:
            continue  # file non riconosciuto come file hotel
        snap = estrai_snapshot_date(nome_file) or date.today()
        chiave = (hotel_code, snap)
        gruppi.setdefault(chiave, []).append(nome_file)

    risultati: List[RisultatoBulk] = []
    n_importate = 0
    n_saltate = 0
    n_errori = 0

    anno_ricerca = anno or date.today().year

    for (hotel_code, snap), file_gruppo in sorted(gruppi.items()):
        file1_nome = file_gruppo[0]
        file2_nome = file_gruppo[1] if len(file_gruppo) > 1 else file_gruppo[0]

        # Coppia incompleta
        if len(file_gruppo) != 2:
            n_errori += 1
            risultati.append(RisultatoBulk(
                hotel_code=hotel_code,
                snapshot_date=snap,
                file1_nome=file_gruppo[0],
                file2_nome=file_gruppo[-1],
                stato="errore",
                motivo=f"Coppia incompleta: trovati {len(file_gruppo)} file invece di 2",
            ))
            continue

        # Hotel non presente nel database
        hotel = db.query(Hotel).filter(Hotel.code == hotel_code).first()
        if not hotel:
            n_errori += 1
            risultati.append(RisultatoBulk(
                hotel_code=hotel_code,
                snapshot_date=snap,
                file1_nome=file1_nome,
                file2_nome=file2_nome,
                stato="errore",
                motivo=f"Hotel '{hotel_code}' non trovato nel database",
            ))
            continue

        # Controlla se già importato (record in imports)
        import_esistente = (
            db.query(ImportSession)
            .filter_by(hotel_code=hotel_code, snapshot_date=snap)
            .first()
        )
        if import_esistente:
            if import_esistente.stato in ("success", "warning"):
                # Già importato con successo → salta
                n_saltate += 1
                risultati.append(RisultatoBulk(
                    hotel_code=hotel_code,
                    snapshot_date=snap,
                    file1_nome=file1_nome,
                    file2_nome=file2_nome,
                    stato="saltato",
                    motivo=f"Già importato il {import_esistente.created_at.strftime('%d/%m/%Y') if import_esistente.created_at else snap}",
                    righe_inserite=import_esistente.righe_inserite,
                    righe_aggiornate=import_esistente.righe_aggiornate,
                    righe_scartate=import_esistente.righe_scartate,
                ))
                continue
            else:
                # Stato "error": elimina e riprocessa
                db.delete(import_esistente)
                db.commit()

        # Elabora la coppia di file
        path1 = os.path.join(cartella, file1_nome)
        path2 = os.path.join(cartella, file2_nome)

        stagione = get_stagione_per_anno(hotel_code, anno_ricerca, db)
        open_date = stagione.open_date if stagione else None
        close_date = stagione.close_date if stagione else None

        try:
            parser = ParserCSV(hotel_code=hotel_code)
            righe = parser.parse_coppia(
                path_file1=path1,
                path_file2=path2,
                open_date=open_date,
                close_date=close_date,
            )
        except ValueError as e:
            n_errori += 1
            # Registra l'errore in imports
            _registra_import_session(
                db=db,
                hotel_code=hotel_code,
                snapshot_date=snap,
                file1_nome=file1_nome,
                file2_nome=file2_nome,
                righe_lette=0,
                righe_inserite=0,
                righe_aggiornate=0,
                righe_scartate=0,
                anomalie=[],
                stato="error",
                is_test=is_test,
            )
            risultati.append(RisultatoBulk(
                hotel_code=hotel_code,
                snapshot_date=snap,
                file1_nome=file1_nome,
                file2_nome=file2_nome,
                stato="errore",
                motivo=f"Errore parsing: {e}",
            ))
            continue

        nome_file_str = f"{file1_nome} / {file2_nome}"
        righe_lette = len(righe) + parser.righe_scartate + parser.righe_fuori_stagione

        if not righe:
            n_errori += 1
            _registra_import_session(
                db=db,
                hotel_code=hotel_code,
                snapshot_date=snap,
                file1_nome=file1_nome,
                file2_nome=file2_nome,
                righe_lette=righe_lette,
                righe_inserite=0,
                righe_aggiornate=0,
                righe_scartate=parser.righe_scartate,
                anomalie=[],
                stato="error",
                is_test=is_test,
            )
            risultati.append(RisultatoBulk(
                hotel_code=hotel_code,
                snapshot_date=snap,
                file1_nome=file1_nome,
                file2_nome=file2_nome,
                stato="errore",
                motivo="Nessuna riga valida trovata nel file",
            ))
            continue

        n_inserite, n_aggiornate = _upsert_righe(db, righe, nome_file_str, snap, is_test)
        anomalie = _rileva_anomalie(righe)

        stato = "warning" if parser.warnings or anomalie else "success"
        _registra_import_session(
            db=db,
            hotel_code=hotel_code,
            snapshot_date=snap,
            file1_nome=file1_nome,
            file2_nome=file2_nome,
            righe_lette=righe_lette,
            righe_inserite=n_inserite,
            righe_aggiornate=n_aggiornate,
            righe_scartate=parser.righe_scartate,
            anomalie=anomalie,
            stato=stato,
            is_test=is_test,
        )

        n_importate += 1
        risultati.append(RisultatoBulk(
            hotel_code=hotel_code,
            snapshot_date=snap,
            file1_nome=file1_nome,
            file2_nome=file2_nome,
            stato="importato",
            righe_inserite=n_inserite,
            righe_aggiornate=n_aggiornate,
            righe_scartate=parser.righe_scartate,
            anomalie=anomalie,
        ))

    return BulkImportResponse(
        cartella=cartella,
        file_trovati=len(tutti_file),
        coppie_trovate=len(gruppi),
        coppie_importate=n_importate,
        coppie_saltate=n_saltate,
        coppie_errore=n_errori,
        risultati=risultati,
    )


# ---------------------------------------------------------------------------
# Funzioni di supporto (private al modulo)
# ---------------------------------------------------------------------------

async def _salva_temp(
    file1: UploadFile, file2: UploadFile
) -> tuple[str, str]:
    """Scrive i file caricati su disco temporaneo e restituisce i percorsi."""
    # Mantieni l'estensione originale per il dispatch CSV/Excel
    ext1 = os.path.splitext(file1.filename or "")[1] or ".csv"
    ext2 = os.path.splitext(file2.filename or "")[1] or ".csv"
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext1) as t1:
        t1.write(await file1.read())
        path1 = t1.name
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext2) as t2:
        t2.write(await file2.read())
        path2 = t2.name
    return path1, path2


def _upsert_righe(
    db: Session,
    righe: List[RigaRevenue],
    nome_file: str,
    snapshot_date: date,
    is_test: bool = False,
) -> tuple[int, int]:
    """
    Esegue upsert in daily_revenue tramite ON CONFLICT DO UPDATE.
    Salva snapshot_date e is_test su ogni riga.
    Restituisce (n_inserite, n_aggiornate).
    """
    # Pre-fetch delle date già presenti per questo hotel+snapshot (per contare insert vs update)
    date_nel_file = {r.data for r in righe}
    esistenti: Set[date] = set(
        row[0]
        for row in db.execute(
            select(DailyRevenue.data).where(
                DailyRevenue.hotel_code == righe[0].hotel_code,
                DailyRevenue.data.in_(date_nel_file),
                DailyRevenue.snapshot_date == snapshot_date,
            )
        ).all()
    )

    n_inserite = 0
    n_aggiornate = 0

    for riga in righe:
        valori = {
            "hotel_code": riga.hotel_code,
            "data": riga.data,
            "rooms_sold": riga.rooms_sold,
            "rooms_available": riga.rooms_available,
            "pax": riga.pax,
            "revenue_rooms": riga.revenue_rooms,
            "revenue_fnb": riga.revenue_fnb,
            "revenue_extra": riga.revenue_extra,
            "revenue_total": riga.revenue_total,
            "nome_file": nome_file,
            "snapshot_date": snapshot_date,
            "is_test": is_test,
        }
        stmt = pg_insert(DailyRevenue).values(**valori)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_hotel_data_snapshot",
            set_={k: v for k, v in valori.items() if k not in ("hotel_code", "data")},
        )
        db.execute(stmt)

        if riga.data in esistenti:
            n_aggiornate += 1
        else:
            n_inserite += 1

    db.commit()
    return n_inserite, n_aggiornate


def _registra_import_session(
    db: Session,
    hotel_code: str,
    snapshot_date: date,
    file1_nome: Optional[str],
    file2_nome: Optional[str],
    righe_lette: int,
    righe_inserite: int,
    righe_aggiornate: int,
    righe_scartate: int,
    anomalie: List[AnomaliaImport],
    stato: str,
    is_test: bool = False,
) -> None:
    """Crea o aggiorna il record in imports per la sessione corrente."""
    # Serializza le anomalie come lista di dict per il campo JSON
    anomalie_json = [a.model_dump(mode="json") for a in anomalie] if anomalie else []

    record = (
        db.query(ImportSession)
        .filter_by(hotel_code=hotel_code, snapshot_date=snapshot_date)
        .first()
    )
    if record is None:
        record = ImportSession(
            hotel_code=hotel_code,
            snapshot_date=snapshot_date,
        )
        db.add(record)

    record.file1_nome = file1_nome
    record.file2_nome = file2_nome
    record.righe_lette = righe_lette
    record.righe_inserite = righe_inserite
    record.righe_aggiornate = righe_aggiornate
    record.righe_scartate = righe_scartate
    record.anomalie = anomalie_json
    record.stato = stato
    record.is_test = is_test
    db.commit()


def _calcola_kpi_periodo(righe: List[RigaRevenue]) -> Optional[KPIPeriodo]:
    """Calcola i KPI aggregati del periodo importato dai totali (non da medie)."""
    if not righe:
        return None

    t = aggrega_totali_righe(righe)
    kpi = calcola_kpi(
        t.rooms_sold, t.rooms_available,
        t.revenue_rooms, t.revenue_fnb, t.revenue_extra, t.revenue_total,
    )

    return KPIPeriodo(
        rooms_sold=t.rooms_sold,
        rooms_available=t.rooms_available,
        occupancy=_arrotonda(kpi.occupancy),
        adr=_arrotonda(kpi.adr),
        revpar=_arrotonda(kpi.revpar),
        trevpar=_arrotonda(kpi.trevpar),
        rmc=_arrotonda(kpi.rmc),
        inc_rooms=_arrotonda(kpi.inc_rooms),
        inc_fnb=_arrotonda(kpi.inc_fnb),
        inc_extra=_arrotonda(kpi.inc_extra),
        fnb_per_camera=_arrotonda(kpi.fnb_per_camera),
        extra_per_camera=_arrotonda(kpi.extra_per_camera),
    )


def _rileva_anomalie(righe: List[RigaRevenue]) -> List[AnomaliaImport]:
    """
    Scansiona le righe importate e segnala anomalie nei dati.
    Le anomalie sono informative: non bloccano l'importazione.
    """
    anomalie: List[AnomaliaImport] = []

    for r in righe:
        d = r.data.strftime("%d/%m/%Y")

        if r.revenue_rooms < 0:
            anomalie.append(AnomaliaImport(
                tipo="revenue_rooms_negativo",
                data=r.data,
                descrizione=(
                    f"{d}: RICAVI TRAT = {r.revenue_rooms:.2f} € — "
                    "valore negativo, probabile correzione forecast"
                ),
            ))

        if r.revenue_total < 0:
            anomalie.append(AnomaliaImport(
                tipo="revenue_total_negativo",
                data=r.data,
                descrizione=(
                    f"{d}: revenue_total = {r.revenue_total:.2f} € — totale giornaliero negativo"
                ),
            ))

        if r.rooms_sold > 0 and r.revenue_rooms == 0:
            anomalie.append(AnomaliaImport(
                tipo="camere_senza_ricavi",
                data=r.data,
                descrizione=(
                    f"{d}: {r.rooms_sold} camere vendute ma revenue_rooms = 0 €"
                ),
            ))

        if r.rooms_sold > r.rooms_available:
            anomalie.append(AnomaliaImport(
                tipo="overbooking",
                data=r.data,
                descrizione=(
                    f"{d}: rooms_sold={r.rooms_sold} > rooms_available={r.rooms_available}"
                ),
            ))

    return anomalie


def _arrotonda(v: Optional[float], decimali: int = 4) -> Optional[float]:
    return round(v, decimali) if v is not None else None


def _risposta_vuota(
    hotel_code: str,
    righe_lette: int,
    righe_scartate: int,
    righe_fuori_stagione: int,
    warnings: List[str],
    snapshot_date: Optional[date] = None,
) -> RisultatoUpload:
    """Risposta quando il parser non produce righe valide."""
    return RisultatoUpload(
        hotel_code=hotel_code,
        righe_lette=righe_lette,
        righe_importate=0,
        righe_inserite=0,
        righe_aggiornate=0,
        righe_scartate=righe_scartate,
        righe_fuori_stagione=righe_fuori_stagione,
        periodo_da=None,
        periodo_a=None,
        snapshot_date=snapshot_date,
        kpi_periodo=None,
        anomalie=[],
        warnings=warnings,
        messaggio=f"{hotel_code}: nessuna riga valida da importare",
    )
