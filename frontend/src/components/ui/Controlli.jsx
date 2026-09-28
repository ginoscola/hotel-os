// Controlli di selezione e input: tab, controllo segmentato, toggle IVA, campi, navigazione mese.
import { cx } from './classi.js'

const MESI = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

/**
 * Barra tab di pagina/modulo.
 * tabs: [{ id, label }]   value: id attivo   onChange(id)
 * size 'sm' per sotto-tab dentro una sezione.
 */
export function Tabs({ tabs, value, onChange, size = 'md' }) {
  return (
    <div className={cx('ui-tabs', size === 'sm' && 'ui-tabs-sm')} role="tablist">
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          className={cx('ui-tab', value === t.id && 'attivo')}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Scelta esclusiva tra poche opzioni (struttura, Mese/YTD, Mensile/Giornaliero...).
 * options: [{ value, label }]   value   onChange(value)
 */
export function SegmentedControl({ options, value, onChange, label, className }) {
  return (
    <div className={cx('ui-seg', className)} role="radiogroup">
      {label && <span className="ui-seg-label">{label}</span>}
      {options.map(o => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={cx('ui-seg-btn', value === o.value && 'attivo')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Toggle "IVA inclusa / IVA esclusa" — pillola arancione, uguale in tutta l'app. */
export function ToggleIva({ lordo, onChange }) {
  return (
    <SegmentedControl
      className="ui-seg-iva"
      label="Valori:"
      value={lordo}
      onChange={onChange}
      options={[{ value: true, label: 'IVA inclusa' }, { value: false, label: 'IVA esclusa' }]}
    />
  )
}

export function Input({ className, modificato, ...rest }) {
  return <input className={cx('ui-input', modificato && 'modificato', className)} {...rest} />
}

export function Select({ className, children, ...rest }) {
  return <select className={cx('ui-input', className)} {...rest}>{children}</select>
}

export function Textarea({ className, style, ...rest }) {
  return <textarea className={cx('ui-input', className)} style={{ resize: 'vertical', ...style }} {...rest} />
}

/** Casella di spunta con testo accanto. */
export function Checkbox({ label, checked, onChange, style }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-base)', color: 'var(--color-text-second)', cursor: 'pointer', ...style }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

/** Campo con etichetta sopra. */
export function Field({ label, children, style }) {
  return (
    <label className="ui-field" style={style}>
      <span className="ui-field-label">{label}</span>
      {children}
    </label>
  )
}

/**
 * Navigazione ◀ Mese Anno ▶.
 * onChange({ anno, mese }) — gestisce da sé il passaggio d'anno.
 * etichetta: testo alternativo al posto di "Mese Anno" (es. "Gen – Giugno 2026").
 */
export function NavMese({ anno, mese, onChange, etichetta }) {
  const sposta = (delta) => {
    let m = mese + delta, a = anno
    if (m > 12) { m = 1; a++ }
    if (m < 1) { m = 12; a-- }
    onChange({ anno: a, mese: m })
  }
  return (
    <div className="ui-navmese">
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => sposta(-1)} aria-label="Mese precedente">◀</button>
      <span className="ui-navmese-label">{etichetta ?? `${MESI[mese]} ${anno}`}</span>
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => sposta(1)} aria-label="Mese successivo">▶</button>
    </div>
  )
}

/** Navigazione ◀ Anno ▶. onChange(anno). */
export function NavAnno({ anno, onChange }) {
  return (
    <div className="ui-navmese">
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => onChange(anno - 1)} aria-label="Anno precedente">◀</button>
      <span className="ui-navmese-label" style={{ minWidth: 60 }}>{anno}</span>
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => onChange(anno + 1)} aria-label="Anno successivo">▶</button>
    </div>
  )
}
