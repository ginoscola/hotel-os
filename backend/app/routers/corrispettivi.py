"""Router modulo Corrispettivi v4 — aggregatore dei sotto-router per dominio.

Il modulo è diviso per dominio in file separati, tutti montati sotto lo stesso
prefix /corrispettivi (nessun cambio per il resto dell'app, main.py invariato):
  corrispettivi_shared.py     → costanti e helper condivisi (_to_float, _d, ecc.)
  corrispettivi_import.py     → upload Excel, storico, delete import
  corrispettivi_documenti.py  → CRUD documenti (scontrini/fatture) e manuali (MMS/BON)
  corrispettivi_report.py     → report giornaliero/mensile/fatturati/pagamenti, check, export
  corrispettivi_rt.py         → Controllo RT (chiusure registratore telematico)

Endpoint:
  POST   /corrispettivi/import                → upload file Excel (on_conflict: salta|aggiorna)
  GET    /corrispettivi/import/storico        → storico sessioni import
  DELETE /corrispettivi/import/{id}           → elimina import e documenti collegati

  GET    /corrispettivi/documenti             → lista unificata con filtri e paginazione
  GET    /corrispettivi/scontrini             → alias documenti tipo=scontrino
  GET    /corrispettivi/fatture               → alias documenti tipo=fattura
  PUT    /corrispettivi/documenti/{id}        → correzione manuale unificata
  PUT    /corrispettivi/scontrini/{id}        → alias → PUT /documenti/{id}
  PUT    /corrispettivi/fatture/{id}          → alias → PUT /documenti/{id}

  POST   /corrispettivi/manuali               → inserimento MMS/BON
  PUT    /corrispettivi/manuali/{id}          → modifica MMS/BON
  GET    /corrispettivi/manuali               → lista con filtri

  GET    /corrispettivi/report/giornaliero    → aggregato per giorno e struttura
  GET    /corrispettivi/report/mensile        → aggregato per mese e struttura
  GET    /corrispettivi/check                 → totali per struttura
  GET    /corrispettivi/report/fatturati      → riepilogo fatturati per mese/struttura
  GET    /corrispettivi/report/pagamenti      → riepilogo per tipo di pagamento
  GET    /corrispettivi/export/fatturati      → export Excel riepilogo fatturati

  GET    /corrispettivi/admin/test-stats      → conteggio record is_test
  DELETE /corrispettivi/admin/test-data       → cancella tutti i record is_test

  POST   /corrispettivi/rt-chiusure           → upsert chiusura RT giornaliera (admin)
  POST   /corrispettivi/rt-chiusure/import-xml → import CORRISP.xml caricato dall'utente (admin)
  POST   /corrispettivi/rt-chiusure/import-da-stampante → legge CORRISP.xml dalla stampante (admin)
  GET    /corrispettivi/rt-chiusure           → lista mese con delta vs PMS
  GET    /corrispettivi/rt-chiusure/riepilogo-stagione → somma differenze RT vs PMS su tutta la stagione
  DELETE /corrispettivi/rt-chiusure/{id}      → elimina chiusura RT (admin)
"""
from fastapi import APIRouter

from app.routers import (
    corrispettivi_documenti,
    corrispettivi_import,
    corrispettivi_report,
    corrispettivi_rt,
)

router = APIRouter(prefix="/corrispettivi", tags=["corrispettivi"])

router.include_router(corrispettivi_import.router)
router.include_router(corrispettivi_documenti.router)
router.include_router(corrispettivi_report.router)
router.include_router(corrispettivi_rt.router)
