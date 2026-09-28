import { useState } from 'react'
import api from '../api/client.js'
import { useAvvisi } from './ui'

/**
 * Pulsante di export con selezione formato (xlsx/csv/pdf).
 * Gestisce download blob; un errore compare come avviso temporaneo (useAvvisi).
 * `snapshot` (ISO YYYY-MM-DD, opzionale): se valorizzato viene appeso al nome
 * del file come `_YYYYMMDD` — così il download riporta a quale snapshot si
 * riferiscono i dati esportati.
 */
export function ExportMenu({ url, nome, onClick, snapshot }) {
  const [formato, setFormato] = useState('xlsx')
  const [loading, setLoading] = useState(false)
  const avvisi = useAvvisi()

  const nomeFile = snapshot ? `${nome}_${snapshot.replaceAll('-', '')}` : nome

  async function handleExport(e) {
    e.stopPropagation()
    setLoading(true)
    try {
      const sep = url.includes('?') ? '&' : '?'
      const resp = await api.get(`${url}${sep}formato=${formato}`, { responseType: 'blob' })
      const href = URL.createObjectURL(resp.data)
      const a = document.createElement('a')
      a.href = href
      a.download = `${nomeFile}.${formato}`
      a.click()
      URL.revokeObjectURL(href)
    } catch {
      avvisi.errore('Errore durante l\'export')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={onClick}>
      <select value={formato} onChange={e => setFormato(e.target.value)} className="ui-input"
        style={{ fontSize: 'var(--fs-sm)', padding: '4px 6px' }} aria-label="Formato export">
        <option value="xlsx">Excel (.xlsx)</option>
        <option value="csv">CSV (.csv)</option>
        <option value="pdf">PDF (.pdf)</option>
      </select>
      <button type="button" onClick={handleExport} disabled={loading} className="ui-btn ui-btn-secondary ui-btn-sm">
        {loading ? '…' : '⬇ Esporta'}
      </button>
    </div>
  )
}
