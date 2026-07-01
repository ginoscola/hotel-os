import { useState, useEffect } from 'react'
import api from '../api/client.js'
import { formatEuro, formatPerc, formatData, mostraErrore } from '../utils/format.js'

// Replica della logica backend: estrae snapshot_date dai primi 8 caratteri del basename
function estraiSnapshotDate(nomeFile) {
  const base = (nomeFile || '').split('/').pop()
  if (base.length >= 8 && /^\d{8}/.test(base)) {
    const y = parseInt(base.slice(0, 4), 10)
    const m = parseInt(base.slice(4, 6), 10)
    const d = parseInt(base.slice(6, 8), 10)
    const dt = new Date(y, m - 1, d)
    if (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }
  return null
}

// Replica della logica backend: codice hotel dagli ultimi 4 caratteri dello stem
function estraiHotelCode(nomeFile) {
  const base = (nomeFile || '').split('/').pop()
  const stem = base.replace(/\.[^.]+$/, '')
  if (!stem || !['1', '2'].includes(stem[stem.length - 1])) return null
  const candidate = stem.slice(Math.max(0, stem.length - 4), stem.length - 1)
  const alpha = candidate.replace(/[^A-Za-z]/g, '').toUpperCase()
  if (alpha.length >= 2 && alpha.length <= 5) return alpha
  return null
}

function formatDataIT(isoStr) {
  if (!isoStr) return '—'
  const [y, m, d] = isoStr.split('-')
  return `${d}/${m}/${y}`
}

export default function Import() {
  const [hotels, setHotels] = useState([])
  const [hotelsLoading, setHotelsLoading] = useState(true)
  const [hotelsErrore, setHotelsErrore] = useState(null)

  const [hotel, setHotel] = useState('')
  const [file1, setFile1] = useState(null)
  const [file2, setFile2] = useState(null)
  const [snapshotDate, setSnapshotDate] = useState('')
  const [dateRilevata, setDateRilevata] = useState(false)
  const [isTest, setIsTest] = useState(false)
  const [loading, setLoading] = useState(false)
  const [risultato, setRisultato] = useState(null)
  const [errore, setErrore] = useState(null)

  // Carica lista hotel dal backend al mount
  useEffect(() => {
    api.get('/hotels/')
      .then(({ data }) => {
        setHotels(data)
        if (data.length > 0) setHotel(data[0].code)
      })
      .catch(() => setHotelsErrore('Impossibile caricare la lista hotel. Verificare la connessione al server.'))
      .finally(() => setHotelsLoading(false))
  }, [])

  // Quando cambiano i file: aggiorna snapshot_date e hotel rilevati dal nome
  useEffect(() => {
    const primoFile = file1 || file2
    if (!primoFile) return

    const snap = estraiSnapshotDate(primoFile.name)
    setSnapshotDate(snap || '')
    setDateRilevata(!!snap)

    const codici = hotels.map(h => h.code)
    const code = estraiHotelCode(primoFile.name) || estraiHotelCode((file2 || file1)?.name || '')
    if (code && codici.includes(code)) {
      setHotel(code)
    }
  }, [file1, file2, hotels])

  const snapshotValida = /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file1 || !file2) { setErrore('Seleziona entrambi i file.'); return }
    if (!snapshotValida) { setErrore('Inserisci una data snapshot valida.'); return }

    setLoading(true)
    setRisultato(null)
    setErrore(null)

    const form = new FormData()
    form.append('file1', file1)
    form.append('file2', file2)

    try {
      const { data } = await api.post(
        `/upload/coppia/${hotel}?snapshot_date=${snapshotDate}&is_test=${isTest}`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      setRisultato(data)
    } catch (err) {
      setErrore(mostraErrore(err))
    } finally {
      setLoading(false)
    }
  }

  if (hotelsLoading) {
    return (
      <div>
        <h2>Importazione dati CSV / Excel</h2>
        <div className="card" style={{ maxWidth: 620, color: '#6b7280' }}>
          Caricamento lista hotel in corso…
        </div>
      </div>
    )
  }

  if (hotelsErrore) {
    return (
      <div>
        <h2>Importazione dati CSV / Excel</h2>
        <div className="card" style={{ maxWidth: 620, background: '#fee2e2', color: '#991b1b', padding: '1rem' }}>
          {hotelsErrore}
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2>Importazione dati CSV / Excel</h2>

      <div className="card" style={{ maxWidth: 620, marginBottom: '1.5rem' }}>
        <form onSubmit={handleSubmit}>

          {/* Hotel selector */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Hotel</label>
            <select value={hotel} onChange={e => setHotel(e.target.value)} style={{ width: '100%' }}>
              {hotels.map(h => (
                <option key={h.code} value={h.code}>{h.name} ({h.code})</option>
              ))}
            </select>
          </div>

          {/* File selectors */}
          <div style={{ marginBottom: '0.5rem', fontSize: 13, color: '#6b7280' }}>
            Carica i due file in qualsiasi ordine — il sistema riconosce automaticamente quale contiene il ristorante.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.2rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>File 1 di 2</label>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={e => setFile1(e.target.files[0] || null)}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>File 2 di 2</label>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={e => setFile2(e.target.files[0] || null)}
              />
            </div>
          </div>

          {/* Snapshot date */}
          <div style={{ marginBottom: '1.2rem' }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Data snapshot (data del forecast)
            </label>
            {!dateRilevata && (file1 || file2) && (
              <div style={{ fontSize: 13, color: '#92400e', marginBottom: 6 }}>
                Data non rilevata dal nome file — inserisci manualmente
              </div>
            )}
            <input
              type="date"
              value={snapshotDate}
              onChange={e => { setSnapshotDate(e.target.value); setDateRilevata(false) }}
              style={{
                padding: '6px 10px',
                border: `1px solid ${!snapshotValida && (file1 || file2) ? '#f97316' : '#ccc'}`,
                borderRadius: 6,
                fontSize: 14,
                outline: !snapshotValida && (file1 || file2) ? '2px solid #fed7aa' : 'none',
              }}
            />
          </div>

          {/* Riepilogo */}
          {(file1 || file2) && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', marginBottom: '1.2rem', fontSize: 13 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Riepilogo importazione</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px' }}>
                <span style={{ color: '#6b7280' }}>File 1:</span>
                <span>{file1?.name || '—'}</span>
                <span style={{ color: '#6b7280' }}>File 2:</span>
                <span>{file2?.name || '—'}</span>
                <span style={{ color: '#6b7280' }}>Hotel:</span>
                <span>{hotels.find(h => h.code === hotel)?.name ?? hotel} ({hotel})</span>
                <span style={{ color: '#6b7280' }}>Snapshot:</span>
                <span style={{ color: snapshotValida ? '#065f46' : '#92400e', fontWeight: snapshotValida ? 600 : 400 }}>
                  {snapshotValida ? formatDataIT(snapshotDate) : 'non impostata'}
                </span>
              </div>
            </div>
          )}

          {/* Test flag */}
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

          <button
            type="submit"
            disabled={loading || !snapshotValida || !file1 || !file2}
            style={{
              background: snapshotValida && file1 && file2 ? '#3b82f6' : '#93c5fd',
              color: '#fff',
              cursor: snapshotValida && file1 && file2 ? 'pointer' : 'not-allowed',
            }}
          >
            {loading ? 'Importazione in corso…' : 'Importa'}
          </button>
        </form>
      </div>

      {errore && (
        <div className="card" style={{ maxWidth: 620, padding: '1rem', marginBottom: '1rem', background: '#fee2e2', color: '#991b1b' }}>
          Errore: {errore}
        </div>
      )}

      {risultato && <RisultatoImport r={risultato} />}
    </div>
  )
}

function RisultatoImport({ r }) {
  const kpi = r.kpi_periodo

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="card sezione">
        <h3>
          {r.hotel_code} — {r.messaggio}
        </h3>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <Stat label="Righe lette" value={r.righe_lette} />
          <Stat label="Importate" value={r.righe_importate} />
          <Stat label="Inserite" value={r.righe_inserite} color="#065f46" />
          <Stat label="Aggiornate" value={r.righe_aggiornate} color="#1d4ed8" />
          <Stat label="Scartate" value={r.righe_scartate} color="#92400e" />
          <Stat label="Fuori stagione" value={r.righe_fuori_stagione} color="#6b7280" />
        </div>
        {r.periodo_da && (
          <p style={{ marginTop: '0.8rem', color: '#6b7280', fontSize: 13 }}>
            Periodo: {formatData(r.periodo_da)} – {formatData(r.periodo_a)}
            {r.snapshot_date && <> &nbsp;|&nbsp; Snapshot: {formatData(r.snapshot_date)}</>}
          </p>
        )}
      </div>

      {kpi && (
        <div className="card sezione">
          <h3>KPI del periodo importato</h3>
          <div className="grid-kpi">
            <KPIBox label="Camere vendute" value={kpi.rooms_sold} />
            <KPIBox label="Camere disponibili" value={kpi.rooms_available} />
            <KPIBox label="Occupazione" value={kpi.occupancy != null ? formatPerc(kpi.occupancy) : '—'} />
            <KPIBox label="ADR" value={kpi.adr != null ? formatEuro(kpi.adr) : '—'} />
            <KPIBox label="RevPAR" value={kpi.revpar != null ? formatEuro(kpi.revpar) : '—'} />
            <KPIBox label="TRevPAR" value={kpi.trevpar != null ? formatEuro(kpi.trevpar) : '—'} />
            <KPIBox label="RMC" value={kpi.rmc != null ? formatEuro(kpi.rmc) : '—'} />
            <KPIBox label="Inc. Rooms" value={kpi.inc_rooms != null ? formatPerc(kpi.inc_rooms) : '—'} />
            <KPIBox label="Inc. F&B" value={kpi.inc_fnb != null ? formatPerc(kpi.inc_fnb) : '—'} />
            <KPIBox label="Inc. Extra" value={kpi.inc_extra != null ? formatPerc(kpi.inc_extra) : '—'} />
          </div>
        </div>
      )}

      {r.anomalie?.length > 0 && (
        <div className="card sezione">
          <h3>Anomalie rilevate ({r.anomalie.length})</h3>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Tipo</th>
                <th style={{ textAlign: 'left' }}>Data</th>
                <th style={{ textAlign: 'left' }}>Descrizione</th>
              </tr>
            </thead>
            <tbody>
              {r.anomalie.map((a, i) => (
                <tr key={i}>
                  <td><span className="badge badge-warning">{a.tipo}</span></td>
                  <td>{formatData(a.data)}</td>
                  <td>{a.descrizione}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {r.warnings?.length > 0 && (
        <div className="card" style={{ background: '#fffbeb', border: '1px solid #fcd34d' }}>
          <h3 style={{ color: '#92400e' }}>Avvisi ({r.warnings.length})</h3>
          <ul style={{ margin: 0, paddingLeft: '1.2rem', color: '#92400e', fontSize: 13 }}>
            {r.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
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

function KPIBox({ label, value }) {
  return (
    <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value ?? '—'}</div>
    </div>
  )
}
