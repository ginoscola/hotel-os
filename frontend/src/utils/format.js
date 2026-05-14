const MESI_BREVI = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic']

export function formatEuro(v) {
  if (v == null) return '—'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(v)
}

export function formatPerc(v) {
  if (v == null) return '—'
  return `${v.toFixed(1)}%`
}

export function formatData(isoString) {
  if (!isoString) return '—'
  const [y, m, d] = isoString.split('-')
  return `${d}/${m}/${y}`
}

/** "2026-05-05" → "5 mag 2026" */
export function formatDataIt(isoString) {
  if (!isoString) return '—'
  const [y, m, d] = isoString.split('-').map(Number)
  return `${d} ${MESI_BREVI[m - 1]} ${y}`
}

export function formatN(v) {
  if (v == null) return '—'
  return new Intl.NumberFormat('it-IT').format(v)
}

/** Aggiunge `giorni` giorni a una data ISO, restituisce stringa ISO. */
export function addDays(isoDate, giorni) {
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(d.getDate() + giorni)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

/** Calcola delta % tra due numeri; null se non calcolabile. */
export function calcolaDelta(corrente, confronto) {
  if (corrente == null || confronto == null || confronto === 0) return null
  return ((corrente - confronto) / Math.abs(confronto)) * 100
}
