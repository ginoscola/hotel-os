import { useState } from 'react'
import api from '../api/client.js'

/**
 * Pulsante di export con selezione formato (xlsx/csv/pdf).
 * Gestisce download blob e mostra eventuali errori inline.
 */
export function ExportMenu({ url, nome, onClick }) {
  const [formato, setFormato] = useState('xlsx')
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)

  async function handleExport(e) {
    e.stopPropagation()
    setErrore(null)
    setLoading(true)
    try {
      const sep = url.includes('?') ? '&' : '?'
      const resp = await api.get(`${url}${sep}formato=${formato}`, { responseType: 'blob' })
      const href = URL.createObjectURL(resp.data)
      const a = document.createElement('a')
      a.href = href
      a.download = `${nome}.${formato}`
      a.click()
      URL.revokeObjectURL(href)
    } catch {
      setErrore('Errore durante l\'export')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }} onClick={onClick}>
      <select value={formato} onChange={e => setFormato(e.target.value)}
        style={{ fontSize: 12, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4 }}>
        <option value="xlsx">Excel (.xlsx)</option>
        <option value="csv">CSV (.csv)</option>
        <option value="pdf">PDF (.pdf)</option>
      </select>
      <button onClick={handleExport} disabled={loading}
        style={{
          fontSize: 12, padding: '3px 10px', background: '#3b82f6',
          color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer',
        }}>
        {loading ? '…' : 'Esporta'}
      </button>
      {errore && (
        <span style={{ fontSize: 11, color: '#dc2626' }}>{errore}</span>
      )}
    </div>
  )
}

export function SezioneHeader({ titolo, exportUrl, exportNome }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
      <h3 style={{ margin: 0 }}>{titolo}</h3>
      <ExportMenu url={exportUrl} nome={exportNome} />
    </div>
  )
}
