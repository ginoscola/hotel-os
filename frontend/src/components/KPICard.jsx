/**
 * Card KPI con supporto opzionale per confronto periodico.
 *
 * Props:
 *   label       – etichetta superiore
 *   value       – valore principale (stringa già formattata)
 *   sub         – riga secondaria opzionale (es. "315 camere")
 *   compValue   – valore di confronto (stringa già formattata)
 *   compLabel   – descrizione periodo confronto (es. "sett. prec.")
 *   delta       – variazione percentuale (number); verde se > 0, rosso se < 0
 */
export default function KPICard({ label, value, sub, compValue, compLabel, delta }) {
  const hasDelta = delta != null
  const deltaPos = hasDelta && delta > 0
  const deltaNeg = hasDelta && delta < 0

  return (
    <div className="card" style={{ textAlign: 'center', minWidth: '140px' }}>
      <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
        {label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a2e' }}>
        {value ?? '—'}
      </div>
      {sub && (
        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>{sub}</div>
      )}
      {compValue != null && (
        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
          {compLabel && <span style={{ marginRight: 3 }}>{compLabel}:</span>}
          {compValue}
        </div>
      )}
      {hasDelta && (
        <div style={{
          display: 'inline-block',
          marginTop: '4px',
          padding: '1px 7px',
          borderRadius: 4,
          fontSize: '11px',
          fontWeight: 700,
          background: deltaPos ? '#d1fae5' : deltaNeg ? '#fee2e2' : '#f3f4f6',
          color: deltaPos ? '#065f46' : deltaNeg ? '#991b1b' : '#6b7280',
        }}>
          {deltaPos ? '+' : ''}{delta.toFixed(1)}%
        </div>
      )}
    </div>
  )
}
