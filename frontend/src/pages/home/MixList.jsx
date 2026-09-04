import { formatEuroK } from '../../utils/format.js'

/** Lista a barre orizzontali proporzionali al lordo — riusata per mix canali, categorie,
 * trattamento e tipo ospite (stessa forma {[campo]: label, lordo, colore?} per tutte e
 * quattro le fonti, solo il nome del campo dimensione cambia). */
export default function MixList({ titolo, items, campo, coloreDefault = '#3b82f6', vuoto = 'Nessun dato per il periodo selezionato.' }) {
  const lista = (items || []).filter(it => (it.lordo || 0) !== 0).slice(0, 8)
  const max = Math.max(...lista.map(i => i.lordo || 0), 1)

  return (
    <div className="card">
      <h3 style={{ marginTop: 0, marginBottom: 12 }}>{titolo}</h3>
      {lista.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>{vuoto}</p>
      ) : lista.map((it, i) => {
        const label = it[campo] ?? it.name ?? '—'
        const val = it.lordo || 0
        const larghezza = Math.max(2, (val / max) * 100)
        return (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#374151', marginBottom: 2 }}>
              <span>{label}</span>
              <span>{formatEuroK(val)}</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: '#f1f5f9' }}>
              <div style={{ width: `${larghezza}%`, height: '100%', borderRadius: 4, background: it.colore || coloreDefault }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
