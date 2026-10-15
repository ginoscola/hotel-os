// Helper condivisi delle viste "Conto Economico contabile" (USALI, import dal gestionale).
import api from '../../api/client.js'
import { formatEuroIntero } from '../../utils/format.js'
import { colors } from '../../styles/tokens.js'

export const MESI_LUNGHI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
export const MESI_BREVI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']

export const ETICHETTE_CATEGORIA = {
  personale: 'Personale',
  food: 'Food',
  beverage: 'Beverage',
  commissioni: 'Commissioni',
  utenze: 'Utenze',
  altro: 'Altro (fuori KPI)',
}

/** "2026-05" → "Mag 2026" */
export function periodoLabel(p) {
  const [a, m] = p.split('-').map(Number)
  return `${MESI_BREVI[m - 1]} ${a}`
}

/** Elenco periodi compatto: ["2026-01".."2026-09"] → "Gen–Set 2026" se consecutivi. */
export function periodiCompatti(periodi) {
  if (!periodi?.length) return '—'
  const perAnno = {}
  periodi.forEach(p => {
    const [a, m] = p.split('-').map(Number)
    ;(perAnno[a] ||= []).push(m)
  })
  return Object.entries(perAnno).map(([a, mesi]) => {
    mesi.sort((x, y) => x - y)
    const consecutivi = mesi.every((m, i) => i === 0 || m === mesi[i - 1] + 1)
    if (mesi.length === 1) return `${MESI_BREVI[mesi[0] - 1]} ${a}`
    if (consecutivi) return `${MESI_BREVI[mesi[0] - 1]}–${MESI_BREVI[mesi.at(-1) - 1]} ${a}`
    return `${mesi.map(m => MESI_BREVI[m - 1]).join(', ')} ${a}`
  }).join(' · ')
}

/** Importo in euro interi, rosso se negativo. `scuro`: su riga totale (sfondo blu notte). */
export function Euro({ v, scuro = false }) {
  if (v == null) return <span style={{ color: scuro ? colors.border : colors.textSubtle }}>—</span>
  const neg = v < -0.004
  return (
    <span style={neg ? { color: scuro ? colors.dangerBg : colors.danger } : undefined}>
      {formatEuroIntero(v)}
    </span>
  )
}

/** Scarica un file dall'API (blob) con il nome dato. */
export async function scarica(url, params, nomeFile) {
  const resp = await api.get(url, { params, responseType: 'blob' })
  const href = URL.createObjectURL(resp.data)
  const a = document.createElement('a')
  a.href = href
  a.download = nomeFile
  a.click()
  URL.revokeObjectURL(href)
}
