import { formatDataIt } from '../../utils/format.js'
import { colors } from '../../styles/tokens.js'
import { StatoVuoto } from '../../components/ui'

function colore(v) {
  if (v == null) return colors.border
  if (v >= 85) return colors.successText
  if (v >= 70) return colors.success
  if (v >= 55) return colors.warning
  return colors.danger
}

/** Un quadratino per giorno di stagione, colorato per occupancy — mostra a colpo d'occhio i
 * periodi deboli senza dover aprire "Dati giornalieri" hotel per hotel. Solo admin (Fascia 2). */
export default function HeatmapOccupancy({ giorni }) {
  if (!giorni?.length) return <StatoVuoto>Nessun dato disponibile.</StatoVuoto>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
      {giorni.map(g => (
        <div
          key={g.data}
          title={`${formatDataIt(g.data)}: ${g.occupancy != null ? g.occupancy + '%' : 'n.d.'}`}
          style={{ width: 13, height: 13, borderRadius: 3, background: colore(g.occupancy) }}
        />
      ))}
    </div>
  )
}
