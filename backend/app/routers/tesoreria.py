"""Modulo Tesoreria (prefix /tesoreria): aggregatore sottile dei sotto-router per dominio.

- tesoreria_import.py     → import estratti conto XML CBI (anteprima/conferma/storico/file/elimina)
- tesoreria_movimenti.py  → elenco, correzione categoria, straordinario, proposta di regola
- tesoreria_config.py     → conti, saldi manuali, categorie, regole, prova regola, ricalcolo
- tesoreria_report.py     → posizione attuale con avvisi, consuntivo, soglie degli avvisi
- tesoreria_kpi.py        → scheda KPI
- tesoreria_scadenzario.py → import a fotografie dello scadenzario fornitori Passcom (Fase 2)
- tesoreria_abbinamenti.py → abbinamento scadenze ↔ banca, conferme, pagate a mano (Fase 2)
- tesoreria_scadenzario_report.py → stato delle scadenze, dettaglio fornitore, export per lo studio
Costanti e helper comuni in tesoreria_shared.py (permessi per modulo, classificazione).
"""

from fastapi import APIRouter

from app.routers import (
    tesoreria_config, tesoreria_import, tesoreria_kpi, tesoreria_movimenti, tesoreria_report, tesoreria_scadenzario,
    tesoreria_abbinamenti, tesoreria_scadenzario_report,
)

router = APIRouter(prefix="/tesoreria", tags=["tesoreria"])
router.include_router(tesoreria_import.router)
router.include_router(tesoreria_movimenti.router)
router.include_router(tesoreria_config.router)
router.include_router(tesoreria_report.router)
router.include_router(tesoreria_kpi.router)
router.include_router(tesoreria_scadenzario.router)
router.include_router(tesoreria_abbinamenti.router)
router.include_router(tesoreria_scadenzario_report.router)
