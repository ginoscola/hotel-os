import { formatPerc, formatDataIt } from '../../utils/format.js'
import { colors, coloreStruttura } from '../../styles/tokens.js'
import { Dot, Table, Td, Th } from '../../components/ui'

const NOMI_HOTEL = { DPH: 'Hotel Du Parc', CLB: 'Club Hotel', INT: 'Hotel International' }

function coloreOccupancy(v) {
  if (v == null) return colors.textSubtle
  return v >= 70 ? colors.success : v >= 55 ? colors.warning : colors.danger
}

/** Tabella "a colpo d'occhio" per hotel: occupancy, scostamento vs budget, freschezza dato —
 * sempre i 3 hotel (indipendentemente dal filtro hotel selezionato altrove in pagina). */
export default function TabellaSemaforo({ righe }) {
  if (!righe?.length) return null
  return (
    <Table compact>
      <thead>
        <tr><Th>Hotel</Th><Th num>Occupancy</Th><Th num>Scost. budget</Th><Th center>Ultimo dato</Th></tr>
      </thead>
      <tbody>
        {righe.map(r => (
          <tr key={r.hotel_code}>
            <Td style={{ fontWeight: 600 }}>
              <Dot colore={coloreStruttura(r.hotel_code)} /> <span style={{ marginLeft: 4 }}>{NOMI_HOTEL[r.hotel_code] || r.hotel_code}</span>
            </Td>
            <Td num>
              <Dot colore={coloreOccupancy(r.occupancy)} /> <span style={{ marginLeft: 4 }}>{formatPerc(r.occupancy)}</span>
            </Td>
            <Td num>
              {r.scostamento_budget_pct == null ? '—' : (
                <span style={{ color: r.scostamento_budget_pct >= 0 ? colors.successText : colors.dangerText, fontWeight: 600 }}>
                  {r.scostamento_budget_pct >= 0 ? '+' : ''}{r.scostamento_budget_pct.toFixed(1)}%
                </span>
              )}
            </Td>
            <Td center muted>{r.ultimo_snapshot ? formatDataIt(r.ultimo_snapshot) : '—'}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
