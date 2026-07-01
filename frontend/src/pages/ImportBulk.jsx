import { useState } from 'react'
import api from '../api/client.js'
import { formatData, mostraErrore } from '../utils/format.js'

export default function ImportBulk() {
  const [cartella, setCartella] = useState('')
  const [anno, setAnno] = useState(new Date().getFullYear())
  const [isTest, setIsTest] = useState(false)
  const [loading, setLoading] = useState(false)
  const [risultato, setRisultato] = useState(null)
  const [errore, setErrore] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!cartella.trim()) { setErrore('Inserisci il percorso della cartella.'); return }

    setLoading(true)
    setRisultato(null)
    setErrore(null)

    try {
      const params = new URLSearchParams({ cartella: cartella.trim(), anno, is_test: isTest })
      const { data } = await api.post(`/upload/bulk?${params}`)
      setRisultato(data)
    } catch (err) {
      setErrore(mostraErrore(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h2>Import Massivo da Cartella</h2>

      <div className="card" style={{ maxWidth: 600, marginBottom: '1.5rem' }}>
        <p style={{ marginTop: 0, color: '#6b7280', fontSize: 13 }}>
          Scansiona una cartella sul server e importa automaticamente tutte le coppie
          di file CSV/Excel trovate. I file già importati vengono saltati.
        </p>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Percorso cartella (assoluto sul server)
            </label>
            <input
              type="text"
              value={cartella}
              onChange={e => setCartella(e.target.value)}
              placeholder="es. /Users/ginoscola/hotel-os/uploads"
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: '1.2rem' }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Anno stagionale</label>
            <input
              type="number"
              value={anno}
              onChange={e => setAnno(Number(e.target.value))}
              min={2020} max={2099}
              style={{ width: 120, padding: '6px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.2rem' }}>
            <input
              type="checkbox"
              id="isTest"
              checked={isTest}
              onChange={e => setIsTest(e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <label htmlFor="isTest" style={{ cursor: 'pointer', fontSize: 13, color: '#92400e', fontWeight: 600 }}>
              Dati di test (cancellabili dall'area Admin)
            </label>
          </div>

          <button type="submit" disabled={loading} style={{ background: '#3b82f6', color: '#fff' }}>
            {loading ? 'Importazione in corso…' : 'Avvia import massivo'}
          </button>
        </form>
      </div>

      {errore && (
        <div style={{ padding: '1rem', background: '#fee2e2', borderRadius: 8, color: '#991b1b', maxWidth: 600, marginBottom: '1rem' }}>
          {errore}
        </div>
      )}

      {risultato && <RisultatoBulk r={risultato} />}
    </div>
  )
}

function RisultatoBulk({ r }) {
  const coloreStato = {
    importato: '#065f46',
    saltato:   '#1d4ed8',
    errore:    '#991b1b',
  }
  const bgStato = {
    importato: '#d1fae5',
    saltato:   '#dbeafe',
    errore:    '#fee2e2',
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Riepilogo — {r.cartella}</h3>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <Stat label="File trovati"   value={r.file_trovati} />
          <Stat label="Coppie trovate" value={r.coppie_trovate} />
          <Stat label="Importate"      value={r.coppie_importate} color="#065f46" />
          <Stat label="Saltate"        value={r.coppie_saltate}   color="#1d4ed8" />
          <Stat label="Errori"         value={r.coppie_errore}    color="#991b1b" />
        </div>
      </div>

      {r.risultati.length > 0 && (
        <div className="card">
          <h3>Dettaglio per coppia</h3>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Hotel</th>
                  <th style={{ textAlign: 'left' }}>Snapshot</th>
                  <th style={{ textAlign: 'left' }}>File 1</th>
                  <th style={{ textAlign: 'left' }}>File 2</th>
                  <th>Stato</th>
                  <th>Inserite</th>
                  <th>Aggiornate</th>
                  <th>Scartate</th>
                  <th style={{ textAlign: 'left' }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {r.risultati.map((res, i) => (
                  <tr key={i}>
                    <td><strong>{res.hotel_code}</strong></td>
                    <td>{formatData(res.snapshot_date)}</td>
                    <td style={{ fontSize: 12, color: '#6b7280' }}>{res.file1_nome}</td>
                    <td style={{ fontSize: 12, color: '#6b7280' }}>{res.file2_nome}</td>
                    <td>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 600,
                        background: bgStato[res.stato] || '#f3f4f6',
                        color: coloreStato[res.stato] || '#374151',
                      }}>
                        {res.stato}
                      </span>
                    </td>
                    <td>{res.righe_inserite || '—'}</td>
                    <td>{res.righe_aggiornate || '—'}</td>
                    <td>{res.righe_scartate || '—'}</td>
                    <td style={{ fontSize: 12, color: '#6b7280' }}>{res.motivo || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || '#1a1a2e' }}>{value}</div>
    </div>
  )
}
