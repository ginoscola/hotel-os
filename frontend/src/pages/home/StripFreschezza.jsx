import { formatDataIt } from '../../utils/format.js'
import { colors } from '../../styles/tokens.js'

const NOMI_HOTEL = { DPH: 'Du Parc', CLB: 'Club Hotel', INT: 'International' }

/** Striscia di data-quality: quando sono stati caricati per l'ultima volta i dati di ogni
 * fonte — un widget "a colpo d'occhio" utile a capire se un numero è aggiornato o vecchio. */
export default function StripFreschezza({ dati }) {
  if (!dati) return null
  const snapshot = Object.entries(dati.ultimo_snapshot_per_hotel || {})

  return (
    <div className="ui-text-muted" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', padding: '10px 4px' }}>
      {snapshot.map(([hc, d]) => (
        <span key={hc}>
          Snapshot {NOMI_HOTEL[hc] || hc}: <strong style={{ color: colors.text }}>{d ? formatDataIt(d) : '—'}</strong>
        </span>
      ))}
      <span>Produzione: <strong style={{ color: colors.text }}>{dati.ultimo_import_produzione ? formatDataIt(dati.ultimo_import_produzione.slice(0, 10)) : '—'}</strong></span>
      <span>Corrispettivi: <strong style={{ color: colors.text }}>{dati.ultimo_import_corrispettivi ? formatDataIt(dati.ultimo_import_corrispettivi.slice(0, 10)) : '—'}</strong></span>
      <span>Payroll: <strong style={{ color: colors.text }}>{dati.ultimo_mese_payroll || '—'}</strong></span>
    </div>
  )
}
