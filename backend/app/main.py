"""Applicazione FastAPI principale per HotelOS."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter
from slowapi.middleware import SlowAPIMiddleware

from app.routers import admin, auth, budget, corrispettivi, dashboard, dipendenti, export, forecast, hotels, modules, rooms, settimane, snapshots, upload
from app.routers import config as config_router
from app.routers import lookup as lookup_router
from app.routers import analisi_ricavi as analisi_ricavi_router
from app.routers import usali as usali_router


def _leggi_cors_origini() -> list:
    """Legge cors_origins da app_config; fallback a localhost:5173 se non raggiungibile."""
    try:
        from app.database import SessionLocal
        from app.models.revenue import AppConfig
        db = SessionLocal()
        try:
            row = db.query(AppConfig).filter(AppConfig.key == 'cors_origins').first()
            if row:
                return [o.strip() for o in row.value.split(',')]
        finally:
            db.close()
    except Exception:
        pass
    return ["http://localhost:5173"]


limiter = Limiter(key_func=lambda request: request.client.host if request.client else 'unknown')

app = FastAPI(
    title="HotelOS",
    description="API per la gestione alberghiera - Club Hotel, Hotel Du Parc, Hotel International",
    version="1.0.0",
)

app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_leggi_cors_origini(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(modules.router)
app.include_router(hotels.router)
app.include_router(budget.router)
app.include_router(upload.router)
app.include_router(dashboard.router)
app.include_router(settimane.router)
app.include_router(snapshots.router)
app.include_router(export.router)
app.include_router(admin.router)
app.include_router(config_router.router)
app.include_router(dipendenti.router)
app.include_router(corrispettivi.router)
app.include_router(forecast.router)
app.include_router(rooms.router)
app.include_router(lookup_router.router)
app.include_router(analisi_ricavi_router.router)
app.include_router(usali_router.router)


@app.get("/")
def root():
    return {"messaggio": "HotelOS API attiva", "versione": "1.0.0"}


@app.get("/health")
def health_check():
    return {"stato": "ok"}
