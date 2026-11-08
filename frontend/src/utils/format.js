const MESI_BREVI = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic']

export function formatEuro(v) {
  if (v == null) return '—'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, useGrouping: true }).format(v)
}

/** Euro senza decimali (Conto Economico contabile): "1.234 €", "-1.294 €". */
export function formatEuroIntero(v) {
  if (v == null) return '—'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0, useGrouping: true }).format(v)
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

/** Formatta revenue grandi: valori ≥ 1000 in formato "X.XXX K €", altrimenti euro normale. */
export function formatEuroK(v) {
  if (v == null) return '—'
  if (Math.abs(v) >= 1000) {
    const k = v / 1000
    return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 1, useGrouping: true }).format(k) + 'K €'
  }
  return formatEuro(v)
}

/** Aggiunge `giorni` giorni a una data ISO, restituisce stringa ISO. */
export function addDays(isoDate, giorni) {
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(d.getDate() + giorni)
  return isoLocale(d)
}

/** Data locale in formato ISO YYYY-MM-DD. Mai `toISOString()`: lavora in UTC, quindi in Italia
 *  tra mezzanotte e l'1/le 2 di notte restituisce il giorno prima. */
export function isoLocale(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Oggi in formato ISO, in ora locale. */
export const oggiIso = () => isoLocale(new Date())

/** Calcola delta % tra due numeri; null se non calcolabile. */
export function calcolaDelta(corrente, confronto) {
  if (corrente == null || confronto == null || confronto === 0) return null
  return ((corrente - confronto) / Math.abs(confronto)) * 100
}

/** Percentuali di ripartizione che sommano sempre esattamente 100 una volta arrotondate
 *  (metodo del resto maggiore): si tronca ogni quota al decimale e i decimi mancanti vanno
 *  alle voci con il resto più alto. Restituisce numeri nello stesso ordine di `valori`;
 *  tutti 0 se il totale è 0. Usare con `toFixed(decimali)` per la visualizzazione. */
export function percentualiA100(valori, decimali = 1) {
  const totale = valori.reduce((acc, v) => acc + v, 0)
  if (!totale) return valori.map(() => 0)
  const scala = 10 ** decimali
  const esatte = valori.map(v => v / totale * 100 * scala)
  const base = esatte.map(Math.floor)
  let mancanti = 100 * scala - base.reduce((acc, v) => acc + v, 0)
  const ordine = esatte.map((v, i) => i).sort((a, b) => (esatte[b] - base[b]) - (esatte[a] - base[a]))
  for (const i of ordine) {
    if (mancanti <= 0) break
    base[i] += 1
    mancanti -= 1
  }
  return base.map(v => v / scala)
}

/** Restituisce il messaggio di errore da una risposta axios.
 *  Se debug_errori è attivo in localStorage, mostra il dettaglio completo del backend.
 *  Altrimenti mostra solo la prima riga (messaggio breve).
 */
export function mostraErrore(e, fallback = 'Errore nel caricamento') {
  const debug = localStorage.getItem('debug_errori') === 'true'
  let detail = e?.response?.data?.detail || e?.message || fallback
  if (debug) return typeof detail === 'string' ? detail : JSON.stringify(detail)
  // Errori di validazione del backend (422): elenco di { loc, msg } → "campo: messaggio | …"
  if (Array.isArray(detail)) {
    detail = detail.map(d => (d?.msg ? [d.loc?.slice(-1)[0], d.msg].filter(x => x != null && x !== '').join(': ') : ''))
      .filter(Boolean).join(' | ')
  }
  if (typeof detail !== 'string') return fallback
  return detail.split('\n')[0].split('[SQL:')[0].trim() || fallback
}

/** Come `mostraErrore`, ma `null` per il 404: molti endpoint rispondono 404 quando i dati non ci
 *  sono ancora (es. budget non inserito) e la pagina mostra già "nessun dato". Usarla per i
 *  caricamenti dei dati principali: `.catch(e => { const m = erroreDaSegnalare(e); if (m) avvisi.errore(m) })`. */
/** Download (`responseType: 'blob'`): anche la risposta d'errore arriva come file, quindi il motivo
 *  (JSON `{detail}`) va letto da lì prima di passarlo a `mostraErrore`. */
export async function leggiErroreBlob(err) {
  if (!(err?.response?.data instanceof Blob)) return err
  try {
    return { response: { status: err.response.status, data: JSON.parse(await err.response.data.text()) } }
  } catch {
    return {}   // non è JSON: mostraErrore userà il messaggio di ripiego
  }
}

export function erroreDaSegnalare(e, fallback) {
  return e?.response?.status === 404 ? null : mostraErrore(e, fallback)
}
