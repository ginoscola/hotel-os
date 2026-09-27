// Tabelle standard. Le classi ui-table battono le regole globali th/td di index.css.
//
// Righe speciali: className sulla <tr>
//   ui-riga-subtotale · ui-riga-sezione · ui-riga-risultato · ui-riga-totale
// Lo sfondo è applicato alle <td> dal CSS (non alla <tr>): niente più bug riga pari/dispari.
import { cx } from './classi.js'

/** Contenitore con bordo arrotondato e scroll orizzontale + <table>. */
export function Table({ children, compact, minWidth, className, style }) {
  return (
    <div className="ui-table-wrap" style={style}>
      <table className={cx('ui-table', compact && 'ui-table-compact', className)} style={minWidth ? { minWidth } : undefined}>
        {children}
      </table>
    </div>
  )
}

/** Cella intestazione. num = allineata a destra; tot = colonna totale (più scura, bordo a sinistra). */
export function Th({ num, center, tot, className, ...rest }) {
  return <th className={cx(num && 'num', center && 'center', tot && 'tot', className)} {...rest} />
}

/** Cella. num = importo/numero (destra, cifre allineate); muted = testo tenue; tot = colonna totale. */
export function Td({ num, center, muted, tot, className, ...rest }) {
  return <td className={cx(num && 'num', center && 'center', muted && 'muted', tot && 'tot', className)} {...rest} />
}
