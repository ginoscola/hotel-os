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
