import { formatEuroK } from '../../utils/format.js'
import { colors, coloreSerie } from '../../styles/tokens.js'
import { Card } from '../../components/ui'

/** Lista a barre orizzontali proporzionali al lordo — riusata per mix canali, categorie,
 * trattamento e tipo ospite (stessa forma {[campo]: label, lordo, colore?} per tutte e
 * quattro le fonti, solo il nome del campo dimensione cambia). */
export default function MixList({ titolo, items, campo, coloreDefault = coloreSerie(0), vuoto = 'Nessun dato per il periodo selezionato.' }) {
  const lista = (items || []).filter(it => (it.lordo || 0) !== 0).slice(0, 8)
  const max = Math.max(...lista.map(i => i.lordo || 0), 1)

  return (
    <Card title={titolo}>
      {lista.length === 0 ? (
        <p className="ui-text-muted" style={{ margin: 0 }}>{vuoto}</p>
      ) : lista.map((it, i) => {
        const label = it[campo] ?? it.name ?? '—'
        const val = it.lordo || 0
        const larghezza = Math.max(2, (val / max) * 100)
        return (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)', color: colors.textSecond, marginBottom: 2 }}>
              <span>{label}</span>
              <span className="ui-num">{formatEuroK(val)}</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: colors.surfaceAlt }}>
              <div style={{ width: `${larghezza}%`, height: '100%', borderRadius: 4, background: it.colore || coloreDefault }} />
            </div>
          </div>
        )
      })}
    </Card>
  )
}
