// Costanti e helper condivisi tra le tab del modulo Statistiche Produzione (modulo separato,
// tra Statistiche e Budget in NavBar — non più dentro USALI).
import { formatEuro } from './format'
import {
  isAdmin, fmtD, meseNome, primoGiorno, ultimoGiorno, giornoSettimana,
  thSt, tdSt, inpSt, STRUTTURE_HOTEL, NOMI,
} from './corrispettiviHelpers'

// Riesportate: stesse utility generiche già in uso in Corrispettivi, non duplicare.
export {
  isAdmin, fmtD, meseNome, primoGiorno, ultimoGiorno, giornoSettimana,
  thSt, tdSt, inpSt, STRUTTURE_HOTEL, NOMI,
}

export const LS_TAB = 'produzione_tab'
export const LS_LORDO = 'produzione_lordo'

// Palette categorica validata (skill dataviz: lightness band, chroma floor, CVD separation
// e contrasto — vedi validate_palette.js, tutti i check passano in light mode). Ordine fisso,
// mai riassegnata dinamicamente in base al filtro attivo. Gli slot sotto contrasto 3:1 (aqua,
// yellow, magenta) richiedono etichette dirette visibili, non il solo colore — rispettato nei
// grafici a torta/barre di questo modulo (legenda sempre presente + etichette valore).
export const PALETTE_CATEGORICA = [
  '#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834',
]

// Palette di fallback per categorie senza colore configurato in admin (priorità: DB → qui)
export const CATEGORIA_COLORI_FALLBACK = {
  alloggio: PALETTE_CATEGORICA[0], colazione: PALETTE_CATEGORICA[2], cena: PALETTE_CATEGORICA[4],
  pranzo: PALETTE_CATEGORICA[1], colazione_extra: PALETTE_CATEGORICA[7],
  parcheggio_hotel: PALETTE_CATEGORICA[3], parcheggio_esterno: PALETTE_CATEGORICA[5],
  altro: '#94a3b8',
}

// Stesso mapping già in uso in DashboardGruppo.jsx — riusato per coerenza visiva tra moduli
export const COLORI_HOTEL = { CLB: '#3b82f6', DPH: '#10b981', INT: '#f59e0b' }

/** Mese/anno di default all'apertura di una tab: il mese PRECEDENTE a quello corrente (mai il
 * mese in corso, ancora incompleto) — stessa convenzione di UsaliContoEconomico.jsx e
 * TabAnalisiRicavi.jsx nel resto dell'app. `new Date().getMonth()` è 0-indexed (Gen=0), quindi
 * coincide già col mese precedente in numerazione 1-indexed; a gennaio si torna a dicembre
 * dell'anno prima. */
export function meseAnnoPrecedente() {
  const oggi = new Date()
  const mese = oggi.getMonth() === 0 ? 12 : oggi.getMonth()
  const anno = oggi.getMonth() === 0 ? oggi.getFullYear() - 1 : oggi.getFullYear()
  return { mese, anno }
}

export function coloreCategoria(cat, idx = 0) {
  return cat?.colore || CATEGORIA_COLORI_FALLBACK[cat?.code] || PALETTE_CATEGORICA[idx % PALETTE_CATEGORICA.length]
}

/** Valore da mostrare secondo il toggle IVA — il backend restituisce sempre lordo + imponibile
 * già calcolati per ogni aggregato {lordo, imponibile, iva, n_righe}: qui si sceglie solo quale
 * campo mostrare, senza ricalcolare nulla client-side (a differenza di Corrispettivi, qui
 * l'imponibile è già la somma esatta per riga, non un'approssimazione via aliquota di categoria). */
export function campoValore(agg, lordo) {
  if (!agg) return 0
  return lordo ? agg.lordo : agg.imponibile
}

/** Stringa formattata o '—' se zero/assente — il caller applica lo stile del trattino. */
export function fmtAgg(agg, lordo) {
  const v = campoValore(agg, lordo)
  return !v ? '—' : formatEuro(v)
}
