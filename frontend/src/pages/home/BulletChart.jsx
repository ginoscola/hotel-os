import { formatEuroK } from '../../utils/format.js'

/** Barra actual (piena) + tacca budget — confronto rapido, alternativa al tachimetro
 * quando serve vedere anche i due valori assoluti, non solo la percentuale di realizzo. */
export default function BulletChart({ label, actual, budget, formatValue = formatEuroK }) {
  if (actual == null && budget == null) return null
  const max = Math.max(actual || 0, budget || 0, 1) * 1.15
  const wActual = Math.min(100, ((actual || 0) / max) * 100)
  const wBudget = Math.min(100, ((budget || 0) / max) * 100)

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
        <span>{label}</span>
        <span>{formatValue(actual)} <span style={{ color: '#9ca3af' }}>/ budget {formatValue(budget)}</span></span>
      </div>
      <div style={{ position: 'relative', height: 14, background: '#f1f5f9', borderRadius: 4 }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${wActual}%`, background: '#3b82f6', borderRadius: 4 }} />
        {budget != null && (
          <div style={{ position: 'absolute', left: `${wBudget}%`, top: -2, bottom: -2, width: 2, background: '#1f2937' }} />
        )}
      </div>
    </div>
  )
}
