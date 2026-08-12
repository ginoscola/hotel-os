"""Router modulo Statistiche Produzione (dentro USALI) — aggregatore dei sotto-router.

Import analitico riga-per-riga da StatisticheProduzione.xlsx (Welcome PMS), distinto dal
registro fiscale di Corrispettivi (listaConti.xlsx) — nessun controllo incrociato tra i due.

  produzione_shared.py  → costanti e helper condivisi (query_report, aggrega)
  produzione_import.py  → upload Excel, storico, delete import (solo test)
  produzione_report.py  → report giornaliero/settimanale/mensile/canali/trattamenti/tipo-ospite
                          + liste valori distinti per i filtri UI
  produzione_export.py  → export xlsx/csv/pdf

Endpoint:
  POST   /produzione/import                    → upload StatisticheProduzione.xlsx (admin)
  GET    /produzione/import/storico             → storico sessioni import
  DELETE /produzione/import/{id}                → elimina import di test (admin)

  GET    /produzione/report/giornaliero          → aggregato per giorno e struttura
  GET    /produzione/report/settimanale          → aggregato per settimana commerciale sab-ven
  GET    /produzione/report/mensile              → aggregato per mese (+ confronto se `mese`)
  GET    /produzione/report/canali               → revenue per canale di vendita
  GET    /produzione/report/trattamenti          → revenue per tipo trattamento
  GET    /produzione/report/tipo-ospite          → revenue per tipo ospite

  GET    /produzione/categorie                   → categorie prod_categorie
  GET    /produzione/canali/lista                → valori distinti canale
  GET    /produzione/trattamenti/lista           → valori distinti trattamento
  GET    /produzione/tipi-ospite/lista           → valori distinti tipo_ospite

  GET    /produzione/export/{canali|trattamenti|tipo-ospite}  → export xlsx/csv/pdf
  GET    /produzione/export/mensile                            → export xlsx/csv/pdf
"""
from fastapi import APIRouter

from app.routers import produzione_export, produzione_import, produzione_report

router = APIRouter(prefix="/produzione", tags=["produzione"])

router.include_router(produzione_import.router)
router.include_router(produzione_report.router)
router.include_router(produzione_export.router)
