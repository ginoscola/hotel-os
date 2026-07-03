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

// ── Stili base condivisi (tabelle e input) ────────────────────────────────────

export const thSt = {
  padding: '6px 8px', fontWeight: 600, fontSize: '0.75rem',
  whiteSpace: 'nowrap', textAlign: 'right',
}
export const tdSt = {
  padding: '5px 8px', fontSize: '0.8rem', borderBottom: '1px solid #f1f5f9',
  whiteSpace: 'nowrap', textAlign: 'right',
}
export const inpSt = {
  padding: '5px 8px', border: '1px solid #e2e8f0',
  borderRadius: 5, fontSize: '0.85rem', color: '#1e293b',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isAdmin() {
  try { return JSON.parse(localStorage.getItem('auth_user') || '{}').ruolo === 'admin' } catch { return false }
}

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
