"""Permessi per modulo (vedere / modificare / importare) — unica implementazione.

Regole (le stesse con cui la NavBar decide cosa mostrare):
- admin: sempre tutto;
- altri ruoli: `module_permissions` del ruolo; l'override per utente (`user_module_permissions`)
  vale solo per `puo_vedere`; modulo disattivato → nessun permesso;
- nessuna riga → nessun permesso.

`lista_moduli()` (routers/modules.py) e la dipendenza `richiedi_permesso()` usano entrambe
`permessi_modulo()`: un utente che vede un modulo nella NavBar può chiamarne gli endpoint.
"""

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import richiedi_utente_attivo
from app.database import get_db
from app.models.revenue import Module, ModulePermission, UserModulePermission

AZIONI = ("vedere", "modificare", "importare")
NESSUNO = {"puo_vedere": False, "puo_modificare": False, "puo_importare": False}
TUTTO = {"puo_vedere": True, "puo_modificare": True, "puo_importare": True}
_DA_CARICARE = object()   # distingue "non passato" da "nessuna riga" (None)


def permessi_modulo(db: Session, utente, modulo: Module, override=_DA_CARICARE,
                    perm_ruolo=_DA_CARICARE) -> dict:
    """Permessi di `utente` su `modulo`. `override`/`perm_ruolo` già caricati si possono passare
    per evitare query ripetute (lista di tutti i moduli)."""
    if getattr(utente, "ruolo", None) == "admin":
        return dict(TUTTO)
    if not modulo.attivo:
        return dict(NESSUNO)
    if perm_ruolo is _DA_CARICARE:
        perm_ruolo = db.query(ModulePermission).filter(
            ModulePermission.module_code == modulo.code,
            ModulePermission.ruolo == utente.ruolo,
        ).first()
    if override is _DA_CARICARE:
        override = db.query(UserModulePermission).filter(
            UserModulePermission.user_id == utente.id,
            UserModulePermission.module_code == modulo.code,
        ).first() if getattr(utente, "id", None) is not None else None
    if override is not None:
        puo_vedere = override.puo_vedere
    else:
        puo_vedere = perm_ruolo.puo_vedere if perm_ruolo else False
    return {
        "puo_vedere": puo_vedere,
        "puo_modificare": perm_ruolo.puo_modificare if perm_ruolo else False,
        "puo_importare": perm_ruolo.puo_importare if perm_ruolo else False,
    }


def richiedi_permesso(module_code: str, azione: str):
    """Dipendenza FastAPI: 403 se l'utente non ha `azione` sul modulo. Restituisce l'utente.
    Modificare e importare richiedono anche il permesso di vedere."""
    if azione not in AZIONI:
        raise ValueError(f"Azione sconosciuta: {azione}")

    def _dipendenza(utente=Depends(richiedi_utente_attivo), db: Session = Depends(get_db)):
        modulo = db.query(Module).filter(Module.code == module_code).first()
        if modulo is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Modulo '{module_code}' non trovato")
        permessi = permessi_modulo(db, utente, modulo)
        if not permessi["puo_vedere"] or not permessi[f"puo_{azione}"]:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Permesso '{azione}' sul modulo {modulo.name} non concesso",
            )
        return utente

    return _dipendenza
