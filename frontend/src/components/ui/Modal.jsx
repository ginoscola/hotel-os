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
