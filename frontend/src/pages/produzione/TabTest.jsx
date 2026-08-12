import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { mostraErrore } from '../../utils/format'
import { fmtD } from '../../utils/produzioneHelpers'

export default function TabTest({ onPulito }) {
  const [imports, setImports] = useState([])
  const [loading, setLoading] = useState(true)
  const [cancellando, setCancellando] = useState(false)
  const [msg, setMsg] = useState(null)

  const carica = useCallback(async () => {
    try {
      const { data } = await api.get('/produzione/import/storico', { params: { is_test: true } })
      setImports(data)
    } catch { /* ignora */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { carica() }, [carica])

  const totaleRighe = imports.reduce((s, i) => s + i.n_righe_valide, 0)

  const cancella = async () => {
    if (!window.confirm(`Eliminare tutti gli import di test Produzione (${imports.length} import, ${totaleRighe} righe)?`)) return
    setCancellando(true)
    try {
      for (const imp of imports) {
        await api.delete(`/produzione/import/${imp.id}?conferma=true`)
      }
      setMsg('Dati di test eliminati.')
      carica()
      onPulito?.()
    } catch (e) {
      setMsg(mostraErrore(e, 'Errore'))
    } finally {
      setCancellando(false)
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#1e293b' }}>Gestione dati di test — Statistiche Produzione</h3>
      {loading ? <p style={{ color: '#94a3b8' }}>Caricamento…</p> : (
        <div style={{ border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
          <p style={{ margin: 0, fontWeight: 600, color: '#92400e' }}>Import di test presenti nel database:</p>
          {imports.length === 0 ? (
            <p style={{ margin: '0.5rem 0 0', color: '#78350f', fontSize: '0.85rem' }}>Nessuno.</p>
          ) : (
            <ul style={{ margin: '0.5rem 0 0 1rem', color: '#78350f', fontSize: '0.85rem' }}>
              {imports.map(i => (
                <li key={i.id}>{i.nome_file} — {fmtD(i.data_da)}–{fmtD(i.data_a)} ({i.n_righe_valide} righe)</li>
              ))}
              <li><strong>Totale: {imports.length} import, {totaleRighe} righe</strong></li>
            </ul>
          )}
        </div>
      )}
      {msg && <p style={{ color: msg.includes('eliminati') ? '#166534' : '#ef4444', fontSize: '0.88rem', marginBottom: '0.75rem' }}>{msg}</p>}
      <button
        onClick={cancella}
        disabled={cancellando || imports.length === 0}
        style={{
          padding: '8px 20px', borderRadius: 7, border: 'none', cursor: 'pointer',
          background: imports.length === 0 ? '#f1f5f9' : '#ef4444',
          color: imports.length === 0 ? '#94a3b8' : '#fff',
          fontWeight: 600, fontSize: '0.88rem',
        }}
      >
        {cancellando ? 'Eliminazione…' : 'Elimina tutti gli import di test'}
      </button>
    </div>
  )
}
