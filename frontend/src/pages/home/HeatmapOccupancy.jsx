import { formatDataIt } from '../../utils/format.js'

function colore(v) {
  if (v == null) return '#e5e7eb'
  if (v >= 85) return '#065f46'
  if (v >= 70) return '#10b981'
  if (v >= 55) return '#f59e0b'
  return '#ef4444'
}

/** Un quadratino per giorno di stagione, colorato per occupancy — mostra a colpo d'occhio i
 * periodi deboli senza dover aprire "Dati giornalieri" hotel per hotel. Solo admin (Fascia 2). */
export default function HeatmapOccupancy({ giorni }) {
  if (!giorni?.length) return <p style={{ color: '#9ca3af', fontSize: 13 }}>Nessun dato disponibile.</p>
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
