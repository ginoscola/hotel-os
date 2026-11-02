import { colors } from '../../styles/tokens.js'

// Colori serie grafici Budget vs Actual (uguali in tutti i grafici del modulo)
export const COLORE_BUDGET = colors.textSubtle
export const COLORE_ACTUAL = colors.info

// Verde se ≥ 0, rosso se < 0, testo normale se null
export const coloreSegno = (v) => v == null ? undefined : (v >= 0 ? colors.success : colors.danger)
export const conSegno = (v, fmt) => v == null ? '—' : `${v >= 0 ? '+' : ''}${fmt(v)}`

export const TREND = {
  sopra_budget: { label: 'SOPRA BUDGET', colore: colors.success, tono: 'ok' },
  sotto_budget: { label: 'SOTTO BUDGET', colore: colors.danger,  tono: 'err' },
  in_linea:     { label: 'IN LINEA',     colore: colors.info,    tono: 'info' },
}

export function labelSettimana(ws) {
  const d = new Date(ws + 'T00:00:00')
  const we = new Date(ws + 'T00:00:00')
  we.setDate(we.getDate() + 6)
  const fmt = (dt) => `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}`
  return `${fmt(d)}–${fmt(we)}`
}

export const NOTA_MESI = 'Ogni settimana è assegnata per intero al mese in cui cade la maggior parte dei suoi giorni.'

// Speculare a calcola_mese_contabile() in Python: {mese (1-12), anno} del mese con più giorni nella settimana.
export function calcolaMeseContabile(ws) {
  const conteggi = {}
  for (let i = 0; i < 7; i++) {
    const d = new Date(ws + 'T00:00:00')
    d.setDate(d.getDate() + i)
    const k = `${d.getFullYear()}-${d.getMonth() + 1}`
    conteggi[k] = (conteggi[k] || 0) + 1
  }
  const [best] = Object.entries(conteggi).sort((a, b) => b[1] - a[1])
  const [anno, mese] = best[0].split('-').map(Number)
  return { mese, anno }
}

// Righe settimanali raggruppate per mese contabile, in ordine di calendario
export function perMeseContabile(righe, settimanaDi) {
  const mesi = new Map()
  for (const r of righe) {
    const { mese, anno } = calcolaMeseContabile(settimanaDi(r))
    const chiave = anno * 100 + mese
    if (!mesi.has(chiave)) mesi.set(chiave, { chiave, mese, anno, settimane: [] })
    mesi.get(chiave).settimane.push(r)
  }
  return [...mesi.values()].sort((a, b) => a.chiave - b.chiave)
}
