"""Data di competenza dei documenti Corrispettivi (v4.37.0, 16/11/2026).

Lo scontrino resta fiscalmente nel giorno in cui è emesso (chiusura RT, IVA esigibile all'incasso), ma un
**acconto incassato prima dell'arrivo** — es. tariffa prepagata non rimborsabile pagata a novembre per un
soggiorno dell'estate dopo — è ricavo del soggiorno: conta nel giorno di arrivo, come se il cliente avesse
pagato al check-in (com'è per la maggior parte degli scontrini, emessi il giorno di arrivo).

Regola: scontrino/fattura con tipo conto Welcome (`maschera_conto`) = 'Acconto' e `arrivo` > `data_documento`
→ `data_competenza = arrivo`. In tutti gli altri casi `data_competenza` resta NULL = data del documento.
Il formato Excel base (18 colonne) non ha la colonna arrivo: lì la data si corregge a mano.

Usano la competenza: Riepilogo Fatturati (vista "Per competenza", default), Conto Economico USALI (penali,
ristoranti) e Food & Beverage. Restano sulla data del documento: giornalieri, Controllo RT, IVA e previsioni
di Tesoreria, WAVE, Analisi Ricavi.
"""

from datetime import date
from typing import Optional

from sqlalchemy import func

from app.models.corrispettivi import CorrispettiviDocumento

MASCHERA_ACCONTO = 'Acconto'


def calcola_data_competenza(tipo: Optional[str], maschera_conto: Optional[str],
                            arrivo: Optional[date], data_documento: Optional[date]) -> Optional[date]:
    """Data di arrivo se il documento è un acconto incassato prima dell'arrivo, altrimenti None."""
    if tipo not in ('scontrino', 'fattura') or (maschera_conto or '').strip() != MASCHERA_ACCONTO:
        return None
    if arrivo is None or data_documento is None or arrivo <= data_documento:
        return None
    return arrivo


def data_competenza_col():
    """Espressione SQL: data di competenza del documento (data del documento se non spostata)."""
    return func.coalesce(CorrispettiviDocumento.data_competenza, CorrispettiviDocumento.data_documento)
