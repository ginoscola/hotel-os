// Finestra modale generica. Chiusura con Esc e click sullo sfondo (disattivabile).
import { useEffect } from 'react'

export function Modal({ titolo, onChiudi, children, footer, larghezza = 480, chiudiSuSfondo = true }) {
  useEffect(() => {
    if (!onChiudi) return
    const onKey = (e) => { if (e.key === 'Escape') onChiudi() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onChiudi])

  return (
    <div
      className="ui-modal-overlay"
      onMouseDown={e => { if (chiudiSuSfondo && onChiudi && e.target === e.currentTarget) onChiudi() }}
    >
      <div className="ui-modal" style={{ maxWidth: larghezza }} role="dialog" aria-modal="true">
        {titolo && (
          <div className="ui-modal-header">
            <h3>{titolo}</h3>
            {onChiudi && <button className="ui-btn ui-btn-ghost ui-btn-sm" onClick={onChiudi} aria-label="Chiudi">×</button>}
          </div>
        )}
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

/**
 * Pannello laterale da destra (dettaglio di una cella/riga). Chiude con Esc o click fuori.
 * titolo: testo in grassetto; sottotitolo: riga sotto (es. data).
 */
export function Drawer({ titolo, sottotitolo, onChiudi, larghezza = 480, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onChiudi() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onChiudi])

  return (
    <>
      <div className="ui-drawer-overlay" onClick={onChiudi} />
      <aside className="ui-drawer" style={{ width: larghezza }} role="dialog" aria-modal="true">
        <div className="ui-drawer-header">
          <div>
            <strong>{titolo}</strong>
            {sottotitolo && <div className="ui-text-muted" style={{ marginTop: 2 }}>{sottotitolo}</div>}
          </div>
          <button className="ui-btn ui-btn-ghost ui-btn-sm" onClick={onChiudi} aria-label="Chiudi">×</button>
        </div>
        <div className="ui-drawer-body">{children}</div>
      </aside>
    </>
  )
}
