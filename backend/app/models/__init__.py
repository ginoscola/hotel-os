"""Importa tutti i moduli modello attivi così che SQLAlchemy possa risolvere le
relationship() che referenziano una classe per nome stringa (es. Hotel.rooms ->
"Room") indipendentemente da quale singolo modulo venga importato per primo.
Senza questo, uno script/test che importa solo app.models.revenue fallisce con
"expression 'Room' failed to locate a name" perché rooms.py non è mai stato
caricato. fiscal.py (precursore dismesso di corrispettivi.py, non più usato
da nessun router) è escluso di proposito.
"""
from app.models import revenue  # noqa: F401
from app.models import rooms  # noqa: F401
from app.models import corrispettivi  # noqa: F401
from app.models import analisi_ricavi  # noqa: F401
from app.models import usali  # noqa: F401
from app.models import shared  # noqa: F401
