// Componenti di base: pulsanti, titoli, card, badge, stati di caricamento.
import { useRef, useState } from 'react'
import { cx } from './classi.js'
import { coloreStruttura } from '../../styles/tokens.js'

/**
 * Pulsante.
 * variant: 'primary' (azione principale, max 1 per area) | 'secondary' | 'danger' (azione
 *          distruttiva confermata) | 'danger-soft' (elimina in riga di tabella) | 'ghost'
 * size: 'md' | 'sm'
 */
export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...rest }) {
  return (
    <button
      type={type}
      className={cx('ui-btn', `ui-btn-${variant}`, size === 'sm' && 'ui-btn-sm', className)}
      {...rest}
    />
  )
}

/** Intestazione pagina: titolo (h1) + sottotitolo opzionale + azioni allineate a destra. */
export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="ui-page-header">
      <h1>{title}</h1>
      {subtitle && <span className="ui-page-sub">{subtitle}</span>}
      {children && <div className="ui-page-actions">{children}</div>}
    </div>
  )
}

/** Titolo di sezione (h2 visivo, 16px). */
export function SectionTitle({ children, as: Tag = 'h2', style }) {
  return <Tag className="ui-section-title" style={style}>{children}</Tag>
}

/** Riquadro bianco con bordo. `title`/`actions` opzionali generano l'intestazione. */
export function Card({ title, actions, children, className, style }) {
  return (
    <div className={cx('ui-card', className)} style={style}>
      {(title || actions) && (
        <div className="ui-card-header">
          {title && <h2 className="ui-section-title">{title}</h2>}
          {actions && <div className="ui-card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

/** Etichetta colorata. tono: 'neutral' | 'info' | 'ok' | 'warn' | 'err' */
export function Badge({ tono = 'neutral', children, title, style }) {
  return <span className={cx('ui-badge', `ui-badge-${tono}`)} title={title} style={style}>{children}</span>
}

/** Pallino colorato (legende, semafori). */
export function Dot({ colore, title }) {
  return <span className="ui-dot" style={{ background: colore }} title={title} />
}

/** Codice struttura col suo colore ufficiale (DPH verde, CLB blu, INT ambra, ...). */
export function HotelTag({ code, label }) {
  const c = coloreStruttura(code)
  return (
    <span className="ui-badge" style={{ background: c + '1f', color: c, border: `1px solid ${c}55` }}>
      {label ?? code}
    </span>
  )
}

export function Loading({ testo = 'Caricamento…' }) {
  return <div className="ui-loading">{testo}</div>
}

export function StatoVuoto({ children = 'Nessun dato per il periodo selezionato.' }) {
  return <div className="ui-vuoto">{children}</div>
}

/**
 * Messaggio inline persistente (errore di caricamento, avviso di contesto).
 * Per esiti di un'azione (salvato, eliminato, errore export) preferire useAvvisi().
 * tipo: 'err' | 'ok' | 'warn' | 'info'
 */
export function Messaggio({ tipo = 'err', children, onChiudi }) {
  if (!children) return null
  return (
    <div className={cx('ui-msg', `ui-msg-${tipo}`)} role={tipo === 'err' ? 'alert' : 'status'}>
      <div className="ui-msg-testo">{children}</div>
      {onChiudi && <button className="ui-msg-chiudi" onClick={onChiudi} aria-label="Chiudi">×</button>}
    </div>
  )
}

/**
 * Riquadro KPI: etichetta piccola + valore grande (+ riga secondaria opzionale).
 * colore: colore del valore (es. colors.success per scostamento positivo).
 * size 'lg' per il KPI principale di una vista.
 */
export function KpiTile({ label, value, sub, colore, size = 'md', minWidth = 150 }) {
  return (
    <div className={cx('ui-kpi', size === 'lg' && 'ui-kpi-lg')} style={{ minWidth }}>
      <div className="ui-kpi-label">{label}</div>
      <div className="ui-kpi-valore ui-num" style={colore ? { color: colore } : undefined}>{value ?? '—'}</div>
      {sub != null && <div className="ui-kpi-sub ui-num">{sub}</div>}
    </div>
  )
}

/** Pulsante che apre la selezione file (input nascosto). onFile(File) — l'input viene azzerato dopo. */
export function FileButton({ children, accept, onFile, variant = 'secondary', size = 'md' }) {
  return (
    <label className={cx('ui-btn', `ui-btn-${variant}`, size === 'sm' && 'ui-btn-sm')}>
      {children}
      <input
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }}
      />
    </label>
  )
}

/**
 * Area per trascinare un file (o cliccare per sceglierlo).
 * onFile(File); accept come per <input type=file>; disabled durante il caricamento.
 */
export function DropZone({ onFile, accept, titolo, sottotitolo, disabled, icona }) {
  const [sopra, setSopra] = useState(false)
  const inputRef = useRef(null)
  const scegli = (f) => { if (f && !disabled) onFile(f) }
  return (
    <div
      className={cx('ui-dropzone', sopra && 'attiva', disabled && 'disattivata')}
      onDragOver={e => { e.preventDefault(); setSopra(true) }}
      onDragLeave={() => setSopra(false)}
      onDrop={e => { e.preventDefault(); setSopra(false); scegli(e.dataTransfer.files[0]) }}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
    >
      <input
        ref={inputRef} type="file" accept={accept} style={{ display: 'none' }}
        onChange={e => { scegli(e.target.files[0]); e.target.value = '' }}
      />
      {icona && <div style={{ fontSize: 28, marginBottom: 6 }}>{icona}</div>}
      <p className="ui-dropzone-titolo">{titolo}</p>
      {sottotitolo && <p className="ui-dropzone-sub">{sottotitolo}</p>}
    </div>
  )
}
