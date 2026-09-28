// Tabelle standard. Le classi ui-table battono le regole globali th/td di index.css.
//
// Righe speciali: className sulla <tr>
//   ui-riga-attenuata (dati assenti) · ui-riga-avviso (da compilare) · ui-riga-ok (completata)
//   ui-riga-errore (differenza / da verificare)
//   ui-riga-evidenza (es. sabato) · ui-riga-dettaglio (riga espansa sotto una riga, con colSpan)
//   ui-riga-annullata (documento annullato, attenuato) · ui-riga-modificata (barra ambra: corretto a mano)
//   ui-riga-subtotale · ui-riga-sezione · ui-riga-risultato · ui-riga-totale
// Lo sfondo è applicato alle <td> dal CSS (non alla <tr>): niente più bug riga pari/dispari.
import { cx } from './classi.js'

/**
 * Contenitore con bordo arrotondato e scroll orizzontale + <table>.
 * maxHeight: altezza massima con scroll verticale e intestazione fissa in alto.
 */
export function Table({ children, compact, minWidth, maxHeight, className, style }) {
  return (
    <div className="ui-table-wrap" style={maxHeight ? { maxHeight, overflowY: 'auto', ...style } : style}>
      <table className={cx('ui-table', compact && 'ui-table-compact', maxHeight && 'ui-table-sticky', className)} style={minWidth ? { minWidth } : undefined}>
        {children}
      </table>
    </div>
  )
}

/**
 * Cella intestazione. num = allineata a destra; tot = colonna totale (più scura, bordo a sinistra);
 * gruppo = inizio di un gruppo di colonne (bordo a sinistra). Per la seconda riga di un'intestazione
 * a due livelli: <tr className="sub">.
 */
export function Th({ num, center, tot, gruppo, className, ...rest }) {
  return <th className={cx(num && 'num', center && 'center', tot && 'tot', gruppo && 'gruppo', className)} {...rest} />
}

/** Cella. num = importo/numero (destra, cifre allineate); muted = testo tenue; tot = colonna totale; gruppo = bordo di gruppo. */
export function Td({ num, center, muted, tot, gruppo, className, ...rest }) {
  return <td className={cx(num && 'num', center && 'center', muted && 'muted', tot && 'tot', gruppo && 'gruppo', className)} {...rest} />
}

/**
 * Intestazione cliccabile per ordinare (lato server o client).
 * campo: chiave di ordinamento di questa colonna; ordinaPer/direzione: stato corrente; onOrdina(campo).
 */
export function ThOrdinabile({ campo, ordinaPer, direzione, onOrdina, num, center, children, ...rest }) {
  const attiva = ordinaPer === campo
  return (
    <th
      className={cx('ordinabile', num && 'num', center && 'center')}
      onClick={() => onOrdina(campo)}
      title="Clicca per ordinare"
      aria-sort={attiva ? (direzione === 'asc' ? 'ascending' : 'descending') : undefined}
      {...rest}
    >
      {children}{attiva && (direzione === 'asc' ? ' ▲' : ' ▼')}
    </th>
  )
}

/**
 * ◀ Pagina N di M — X risultati ▶   (con estremi: anche « prima e » ultima pagina)
 */
export function Paginazione({ pagina, perPagina, totale, onChange, estremi = false }) {
  const pagine = Math.max(1, Math.ceil(totale / perPagina))
  const btn = 'ui-btn ui-btn-secondary ui-btn-sm'
  return (
    <div className="ui-paginazione">
      {estremi && <button type="button" className={btn} disabled={pagina <= 1} onClick={() => onChange(1)} aria-label="Prima pagina">«</button>}
      <button type="button" className={btn} disabled={pagina <= 1} onClick={() => onChange(pagina - 1)} aria-label="Pagina precedente">◀</button>
      <span className="ui-num">Pagina {pagina} di {pagine} — {totale} risultati</span>
      <button type="button" className={btn} disabled={pagina >= pagine} onClick={() => onChange(pagina + 1)} aria-label="Pagina successiva">▶</button>
      {estremi && <button type="button" className={btn} disabled={pagina >= pagine} onClick={() => onChange(pagine)} aria-label="Ultima pagina">»</button>}
    </div>
  )
}
