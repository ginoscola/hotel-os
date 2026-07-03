import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { mostraErrore } from '../utils/format'

export default function TabTest({ onPulito }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cancellando, setCancellando] = useState(false)
  const [msg, setMsg] = useState(null)

  const carica = useCallback(async () => {
    try {
      const { data } = await api.get('/corrispettivi/admin/test-stats')
      setStats(data)
    } catch { /* ignora */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { carica() }, [carica])

  const cancella = async () => {
    if (!window.confirm(`Eliminare tutti i dati di test corrispettivi (${stats?.totale} record)?`)) return
    setCancellando(true)
    try {
      await api.delete('/corrispettivi/admin/test-data?conferma=true')
      setMsg('Dati di test eliminati.')
      carica()
      onPulito()
    } catch (e) {
      setMsg(mostraErrore(e, 'Errore'))
    } finally {
      setCancellando(false)
    }
  }

  return (
    <div style={{ maxWidth: 500 }}>
      <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#1e293b' }}>Gestione dati di test</h3>
      {loading ? <p style={{ color: '#94a3b8' }}>Caricamento…</p> : stats && (
        <div style={{ border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
          <p style={{ margin: 0, fontWeight: 600, color: '#92400e' }}>Dati di test presenti nel database:</p>
          <ul style={{ margin: '0.5rem 0 0 1rem', color: '#78350f', fontSize: '0.85rem' }}>
            <li>Import: {stats.imports}</li>
            <li>Documenti: {stats.documenti}</li>
            <li>Manuali: {stats.manuali}</li>
            <li><strong>Totale: {stats.totale}</strong></li>
          </ul>
        </div>
      )}
      {msg && <p style={{ color: msg.includes('eliminati') ? '#166534' : '#ef4444', fontSize: '0.88rem', marginBottom: '0.75rem' }}>{msg}</p>}
      <button
        onClick={cancella}
        disabled={cancellando || (stats?.totale === 0)}
        style={{
          padding: '8px 20px', borderRadius: 7, border: 'none', cursor: 'pointer',
          background: stats?.totale === 0 ? '#f1f5f9' : '#ef4444',
          color: stats?.totale === 0 ? '#94a3b8' : '#fff',
          fontWeight: 600, fontSize: '0.88rem',
        }}
      >
        {cancellando ? 'Eliminazione…' : 'Elimina tutti i dati di test'}
      </button>
    </div>
  )
}
