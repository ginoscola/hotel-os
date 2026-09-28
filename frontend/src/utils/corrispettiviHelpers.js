// Costanti e helper condivisi tra i componenti tab del modulo Corrispettivi
// (TabImport, TabGiornalieri, TabDocumenti, TabFatturati, TabControlloRT, TabTest).
import { formatEuro } from './format'

export const STRUTTURE_HOTEL = ['DPH', 'CLB', 'INT']
export const STRUTTURE_MANUALI = ['MMS', 'BON']

export const NOMI = {
  DPH: 'Hotel Du Parc', CLB: 'Club Hotel', INT: 'Hotel International',
  MMS: 'Maremosso', BON: 'Buona Onda',
}

export const NOME_CAT = {
  arrangiamenti: 'Arrangiamenti (10%)', tassa_soggiorno: 'Tassa Soggiorno (0%)',
  penali: 'Penali (0%)', shop: 'Shop (22%)', altro: 'Altro',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// isAdmin vive in utils/auth.js (serve anche fuori da Corrispettivi, es. Home): re-esportata
// qui per compatibilità con gli import esistenti in questo modulo.
export { isAdmin } from './auth.js'

export function fmtD(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function meseNome(m) {
  return ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'][m]
}

export function primoGiorno(anno, mese) {
  return `${anno}-${String(mese).padStart(2, '0')}-01`
}
export function ultimoGiorno(anno, mese) {
  const d = new Date(anno, mese, 0)
  return `${anno}-${String(mese).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function giornoSettimana(iso) {
  const gg = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']
  const d = new Date(iso + 'T00:00:00')
  return gg[d.getDay()]
}

// Applica toggle IVA: se !lordo divide per (1 + aliquota/100)
export function applyToggle(val, lordo, aliquota = 10) {
  const v = val || 0
  if (lordo || aliquota === 0) return v
  return v / (1 + aliquota / 100)
}

export function fmtToggle(val, lordo, aliquota = 10) {
  const v = applyToggle(val, lordo, aliquota)
  return v === 0 ? '—' : formatEuro(v)
}
