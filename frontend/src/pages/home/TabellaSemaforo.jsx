import { formatPerc, formatDataIt } from '../../utils/format.js'

const NOMI_HOTEL = { DPH: 'Hotel Du Parc', CLB: 'Club Hotel', INT: 'Hotel International' }

function coloreOccupancy(v) {
  if (v == null) return '#9ca3af'
  return v >= 70 ? '#10b981' : v >= 55 ? '#f59e0b' : '#ef4444'
}

/** Tabella "a colpo d'occhio" per hotel: occupancy, scostamento vs budget, freschezza dato —
 * sempre i 3 hotel (indipendentemente dal filtro hotel selezionato altrove in pagina). */
export default function TabellaSemaforo({ righe }) {
  if (!righe?.length) return null
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ textAlign: 'left', color: '#6b7280', fontSize: 11, textTransform: 'uppercase' }}>
          <th style={{ padding: '4px 8px' }}>Hotel</th>
          <th style={{ padding: '4px 8px' }}>Occupancy</th>
          <th style={{ padding: '4px 8px' }}>Scost. budget</th>
          <th style={{ padding: '4px 8px' }}>Ultimo dato</th>
        </tr>
      </thead>
      <tbody>
        {righe.map(r => (
          <tr key={r.hotel_code} style={{ borderTop: '1px solid #f1f5f9' }}>
            <td style={{ padding: '6px 8px', fontWeight: 600 }}>{NOMI_HOTEL[r.hotel_code] || r.hotel_code}</td>
            <td style={{ padding: '6px 8px' }}>
              <span style={{
                display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
                background: coloreOccupancy(r.occupancy), marginRight: 6,
              }} />
              {formatPerc(r.occupancy)}
            </td>
            <td style={{ padding: '6px 8px' }}>
              {r.scostamento_budget_pct == null ? '—' : (
                <span style={{ color: r.scostamento_budget_pct >= 0 ? '#065f46' : '#991b1b', fontWeight: 600 }}>
                  {r.scostamento_budget_pct >= 0 ? '+' : ''}{r.scostamento_budget_pct.toFixed(1)}%
                </span>
              )}
            </td>
            <td style={{ padding: '6px 8px', color: '#6b7280' }}>{r.ultimo_snapshot ? formatDataIt(r.ultimo_snapshot) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
