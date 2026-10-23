// Tooltip Recharts per grafici le cui serie si sommano (barre impilate o affiancate che
// compongono un totale): ogni voce nel colore della sua serie + riga "Totale" in grassetto.
// Uso: <Tooltip content={<TooltipConTotale />} />  (formatter di default: euro).
// Non usarlo dove la somma non ha senso (Budget vs Actual, Ricavi vs GOP, percentuali).
import { formatEuro } from '../utils/format.js'
import { colors } from '../styles/tokens.js'

const riga = { display: 'flex', justifyContent: 'space-between', gap: 16 }

export default function TooltipConTotale({
  active, payload, label, formatter = formatEuro, labelFormatter, etichettaTotale = 'Totale',
}) {
  if (!active || !payload?.length) return null
  const voci = payload.filter(p => p.value != null)
  const totale = voci.reduce((s, p) => s + (Number(p.value) || 0), 0)
  return (
    <div style={{
      background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6,
      padding: '8px 10px', fontSize: 12, boxShadow: '0 2px 8px rgba(15,23,42,.12)',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: colors.text }}>
        {labelFormatter ? labelFormatter(label) : label}
      </div>
      {voci.map(p => (
        <div key={p.dataKey} style={{ ...riga, color: p.color || p.fill || colors.text }}>
          <span>{p.name}</span><span className="ui-num">{formatter(p.value)}</span>
        </div>
      ))}
      <div style={{
        ...riga, marginTop: 4, paddingTop: 4, borderTop: `1px solid ${colors.border}`,
        fontWeight: 600, color: colors.text,
      }}>
        <span>{etichettaTotale}</span><span className="ui-num">{formatter(totale)}</span>
      </div>
    </div>
  )
}
