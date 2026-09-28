// Token grafici HotelOS — UNICA sorgente di colori, testi, spazi e arrotondamenti.
// Gli stessi valori sono esposti come variabili CSS in styles/ui.css (--color-*, --fs-*, ...):
// nei componenti usare le classi/variabili CSS; questo file serve dove serve un valore JS
// (grafici Recharts, stili inline calcolati, SVG). Se si cambia un valore qui, allinearlo in ui.css.

export const colors = {
  // Colore principale unico dell'app (tab, pulsanti principali, intestazioni tabelle)
  primary:       '#1e3a5f',
  primaryHover:  '#16304f',
  primaryStrong: '#152a45', // intestazioni colonne totali
  primarySoft:   '#e8eef6', // sfondi selezionati / evidenziati tenui

  // Scala di grigi unica (slate) — non usare la famiglia "gray" (#6b7280, #374151, ...)
  text:        '#1e293b', // testo principale
  textStrong:  '#0f172a',
  textSecond:  '#475569', // testo secondario (etichette, celle meno importanti)
  textMuted:   '#64748b', // note, didascalie
  textSubtle:  '#94a3b8', // segnaposto, "—", disattivati
  borderStrong:'#cbd5e1',
  border:      '#e2e8f0',
  surfaceAlt:  '#f1f5f9', // pulsanti secondari, righe totale sezione
  surfaceSoft: '#f8fafc', // righe alternate, sfondi tenui
  surface:     '#ffffff',
  pageBg:      '#f5f7fa',

  // Colori di significato (fg = testo/icona, bg = sfondo tenue, text = testo su bg)
  success: '#16a34a', successBg: '#dcfce7', successText: '#166534',
  danger:  '#dc2626', dangerBg:  '#fee2e2', dangerText:  '#991b1b',
  warning: '#d97706', warningBg: '#fef3c7', warningText: '#92400e',
  info:    '#2563eb', infoBg:    '#dbeafe', infoText:    '#1e40af',
  infoSoft: '#eff6ff', // celle con dato automatico (Usali)

  // Accento secondario con significato: valori derivati da un inserimento manuale che
  // sostituisce il dato automatico (es. Maturato in Forecast). Non usarlo come colore decorativo.
  accent: '#7c3aed', accentSoft: '#ede9fe',

  // Toggle IVA inclusa/esclusa — eccezione voluta al colore unico: segnala che si sta
  // cambiando la natura dei numeri mostrati, non un'azione qualunque.
  iva: '#ea580c', ivaBg: '#fff7ed', ivaBorder: '#fdba74', ivaText: '#9a3412',
}

// Colori strutture — uguali in TUTTA l'app (grafici, badge, legende).
// MMS e BON sono tonalità "sorelle" della struttura fisica dove operano (Maremosso → Du Parc,
// Buona Onda → International), vedi GRUPPI_FISICI in TabFatturati.
export const COLORI_STRUTTURA = {
  DPH: '#10b981',
  CLB: '#3b82f6',
  INT: '#f59e0b',
  MMS: '#0d9488',
  BON: '#b45309',
}

export function coloreStruttura(code, fallback = colors.textSubtle) {
  return COLORI_STRUTTURA[code] ?? fallback
}

// Palette per serie/categorie nei grafici (validata: banda di luminosità, croma minima,
// separazione per daltonismo, contrasto — vedi skill dataviz). Ordine fisso, mai riassegnata
// in base al filtro attivo. Gli slot sotto contrasto 3:1 (giallo, rosa, arancio) richiedono
// etichette/legenda visibili, non il solo colore.
export const PALETTE_CATEGORICA = [
  '#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834',
]

export function coloreSerie(idx) {
  return PALETTE_CATEGORICA[idx % PALETTE_CATEGORICA.length]
}

// Scala testi (px). Usare solo questi valori.
export const fontSize = {
  xs: 11,   // badge, note minime
  sm: 12,   // didascalie, intestazioni tabella
  base: 13, // testo tabelle e controlli
  md: 14,   // testo corrente
  lg: 16,   // titoli di card/sezione
  xl: 18,   // sottotitoli pagina
  xxl: 22,  // titolo pagina
}

export const radius = { sm: 4, md: 6, lg: 10, pill: 999 }

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 }
