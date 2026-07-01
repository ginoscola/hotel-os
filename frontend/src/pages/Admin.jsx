import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/client.js'

export default function Admin() {
  return (
    <div>
      <h2>Area Admin</h2>
      <GestioneUtenti />
      <GestioneStagioni />
      <GestioneModuli />
      <GestioneCentriDiCosto />
      <GestioneCorrispettivi />
      <ImportMassivo />
      <GestioneDatiTest />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sezione: gestione utenti
// ---------------------------------------------------------------------------

function GestioneUtenti() {
  return (
    <div className="card" style={{ marginBottom: '1.5rem', border: '1px solid #bfdbfe', background: '#eff6ff' }}>
      <h3 style={{ marginTop: 0, color: '#1e40af' }}>Gestione Utenti</h3>
      <p style={{ color: '#3b82f6', fontSize: 13, marginBottom: '1rem' }}>
        Crea e gestisci gli utenti del sistema, assegna ruoli e reimposta le password.
      </p>
      <Link
        to="/admin/utenti"
        style={{
          display: 'inline-block',
          padding: '8px 18px',
          background: '#1d4ed8',
          color: '#fff',
          borderRadius: 6,
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        Gestisci utenti
      </Link>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sezione: stagioni operative
// ---------------------------------------------------------------------------

function GestioneStagioni() {
  const ANNO_CORRENTE = 2026
  const [anno, setAnno] = useState(ANNO_CORRENTE)
  const [hotels, setHotels] = useState([])
  const [stagioni, setStagioni] = useState({})   // code → HotelSeasonRead | null
  const [form, setForm] = useState({})           // code → {open_date, close_date, total_rooms, notes}
  const [salvando, setSalvando] = useState({})   // code → bool
  const [esiti, setEsiti] = useState({})         // code → {ok, msg}
  const [loadingAnno, setLoadingAnno] = useState(false)

  // Carica lista hotel una volta sola
  useEffect(() => {
    api.get('/hotels/').then(({ data }) => setHotels(data)).catch(() => {})
  }, [])

  // Carica stagioni per tutti gli hotel quando cambia anno o lista hotel
  useEffect(() => {
    if (!hotels.length) return
    setLoadingAnno(true)
    Promise.all(
      hotels.map(h =>
        api.get(`/hotels/${h.code}/seasons/${anno}`)
          .then(({ data }) => ({ code: h.code, stagione: data }))
          .catch(() => ({ code: h.code, stagione: null }))
      )
    ).then(results => {
      const newStagioni = {}
      const newForm = {}
      results.forEach(({ code, stagione }) => {
        const hotel = hotels.find(h => h.code === code)
        newStagioni[code] = stagione
        newForm[code] = stagione
          ? {
              open_date:   stagione.open_date,
              close_date:  stagione.close_date,
              total_rooms: String(stagione.total_rooms),
              notes:       stagione.notes || '',
            }
          : {
              open_date:   '',
              close_date:  '',
              total_rooms: String(hotel?.default_rooms || ''),
              notes:       '',
            }
      })
      setStagioni(newStagioni)
      setForm(newForm)
      setEsiti({})
      setLoadingAnno(false)
    })
  }, [anno, hotels])

  function aggiornaForm(code, campo, valore) {
    setForm(prev => ({ ...prev, [code]: { ...prev[code], [campo]: valore } }))
  }

  async function salva(code) {
    const f = form[code]
    if (!f.open_date || !f.close_date || !f.total_rooms) return
    setSalvando(prev => ({ ...prev, [code]: true }))
    setEsiti(prev => ({ ...prev, [code]: null }))
    try {
      await api.post(`/hotels/${code}/seasons`, {
        season_year: anno,
        open_date:   f.open_date,
        close_date:  f.close_date,
        total_rooms: Number(f.total_rooms),
        notes:       f.notes || null,
      })
      // Ricarica il record aggiornato
      const { data } = await api.get(`/hotels/${code}/seasons/${anno}`)
      setStagioni(prev => ({ ...prev, [code]: data }))
      setEsiti(prev => ({ ...prev, [code]: { ok: true, msg: 'Salvato' } }))
    } catch (err) {
      const msg = err.response?.data?.detail || err.message
      setEsiti(prev => ({
        ...prev,
        [code]: { ok: false, msg: typeof msg === 'string' ? msg : JSON.stringify(msg) },
      }))
    } finally {
      setSalvando(prev => ({ ...prev, [code]: false }))
    }
  }

  const anni = [2024, 2025, 2026, 2027]

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginTop: 0 }}>Stagioni operative</h3>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
        <label style={{ fontWeight: 600, fontSize: 13 }}>Anno:</label>
        <select
          value={anno}
          onChange={e => setAnno(Number(e.target.value))}
          style={{ padding: '4px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
        >
          {anni.map(y => <option key={y}>{y}</option>)}
        </select>
        {loadingAnno && (
          <span style={{ color: '#9ca3af', fontSize: 12 }}>Caricamento…</span>
        )}
      </div>

      {hotels.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600 }}>Hotel</th>
                <th style={{ padding: '8px 10px', fontWeight: 600 }}>Apertura</th>
                <th style={{ padding: '8px 10px', fontWeight: 600 }}>Chiusura</th>
                <th style={{ padding: '8px 10px', fontWeight: 600 }}>Camere</th>
                <th style={{ padding: '8px 10px', fontWeight: 600 }}>Note</th>
                <th style={{ padding: '8px 10px' }}></th>
              </tr>
            </thead>
            <tbody>
              {hotels.map(h => {
                const f = form[h.code] || {}
                const esito = esiti[h.code]
                const nonConfigurata = stagioni[h.code] === null || stagioni[h.code] === undefined
                return (
                  <tr key={h.code} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                      {h.name}
                      {nonConfigurata && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: '#f59e0b', fontWeight: 400 }}>
                          non configurata
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <input
                        type="date"
                        value={f.open_date || ''}
                        onChange={e => aggiornaForm(h.code, 'open_date', e.target.value)}
                        style={{ fontSize: 12, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4 }}
                      />
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <input
                        type="date"
                        value={f.close_date || ''}
                        onChange={e => aggiornaForm(h.code, 'close_date', e.target.value)}
                        style={{ fontSize: 12, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4 }}
                      />
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <input
                        type="number"
                        value={f.total_rooms || ''}
                        onChange={e => aggiornaForm(h.code, 'total_rooms', e.target.value)}
                        min="1" max="999"
                        style={{ fontSize: 12, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4, width: 64 }}
                      />
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <input
                        type="text"
                        value={f.notes || ''}
                        onChange={e => aggiornaForm(h.code, 'notes', e.target.value)}
                        placeholder="facoltativo"
                        style={{ fontSize: 12, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4, width: '100%', minWidth: 100 }}
                      />
                    </td>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => salva(h.code)}
                        disabled={salvando[h.code] || !f.open_date || !f.close_date}
                        style={{
                          fontSize: 12, padding: '4px 14px',
                          background: (!f.open_date || !f.close_date) ? '#9ca3af' : '#3b82f6',
                          color: '#fff', border: 'none', borderRadius: 4,
                          cursor: (!f.open_date || !f.close_date) ? 'not-allowed' : 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        {salvando[h.code] ? '…' : 'Salva'}
                      </button>
                      {esito && (
                        <span style={{
                          marginLeft: 8, fontSize: 11, fontWeight: 600,
                          color: esito.ok ? '#059669' : '#dc2626',
                        }}>
                          {esito.msg}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sezione: import massivo
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sezione: centri di costo (modulo Dipendenti)
// ---------------------------------------------------------------------------

function GestioneCentriDiCosto() {
  return (
    <div className="card" style={{ marginBottom: '1.5rem', border: '1px solid #c7d2fe', background: '#eef2ff' }}>
      <h3 style={{ marginTop: 0, color: '#3730a3' }}>Centri di Costo — Dipendenti</h3>
      <p style={{ color: '#6366f1', fontSize: 13, marginBottom: '1rem' }}>
        Gestisci la gerarchia a 3 livelli (Struttura → Categoria → Reparto): rinomina, aggiungi categorie e reparti, attiva/disattiva nodi.
      </p>
      <Link
        to="/admin/centri-di-costo"
        style={{
          display: 'inline-block',
          padding: '8px 18px',
          background: '#4338ca',
          color: '#fff',
          borderRadius: 6,
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        Gestisci centri di costo →
      </Link>
    </div>
  )
}

function ImportMassivo() {
  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginTop: 0 }}>Import Massivo</h3>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: '1rem' }}>
        Importa in blocco tutte le coppie di file CSV/Excel da una cartella del server.
      </p>
      <Link
        to="/import/bulk"
        style={{
          display: 'inline-block',
          padding: '8px 18px',
          background: '#3b82f6',
          color: '#fff',
          borderRadius: 6,
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        Vai all'Import Massivo
      </Link>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sezione: dati di test
// ---------------------------------------------------------------------------

function GestioneDatiTest() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)
  const [conferma, setConferma] = useState(false)
  const [esitoCancellazione, setEsitoCancellazione] = useState(null)

  const caricaStats = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/test-stats')
      setStats(data)
    } catch {
      setStats(null)
    }
  }, [])

  useEffect(() => { caricaStats() }, [caricaStats])

  async function handleCancella() {
    if (!conferma) { setConferma(true); return }
    setLoading(true)
    setErrore(null)
    setEsitoCancellazione(null)
    setConferma(false)
    try {
      const { data } = await api.delete('/admin/test-data')
      setEsitoCancellazione(data)
      await caricaStats()
    } catch (err) {
      const msg = err.response?.data?.detail || err.message
      setErrore(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card" style={{ border: '1px solid #fcd34d', background: '#fffbeb' }}>
      <h3 style={{ marginTop: 0, color: '#92400e' }}>Gestione dati di test</h3>

      {stats && (
        <div style={{ display: 'flex', gap: '2rem', marginBottom: '1.5rem' }}>
          <StatBox label="Righe revenue di test" value={stats.righe_revenue} />
          <StatBox label="Sessioni import di test" value={stats.sessioni_import} />
          <StatBox label="Totale record di test" value={stats.totale} highlight />
        </div>
      )}

      {stats?.totale === 0 && (
        <p style={{ color: '#6b7280', fontSize: 13 }}>Nessun dato di test presente nel database.</p>
      )}

      {stats?.totale > 0 && (
        <>
          {conferma ? (
            <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
              <p style={{ color: '#991b1b', fontWeight: 600, marginTop: 0 }}>
                Sei sicuro? Verranno eliminati {stats.righe_revenue} righe di revenue
                e {stats.sessioni_import} sessioni di import contrassegnate come test.
                L'operazione non è reversibile.
              </p>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                  onClick={handleCancella}
                  disabled={loading}
                  style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
                >
                  Sì, cancella tutti i dati di test
                </button>
                <button
                  onClick={() => setConferma(false)}
                  style={{ background: '#e5e7eb', color: '#374151', border: 'none', padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
                >
                  Annulla
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleCancella}
              disabled={loading}
              style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
            >
              {loading ? 'Cancellazione in corso…' : 'Cancella dati di test'}
            </button>
          )}
        </>
      )}

      {errore && (
        <div style={{ marginTop: '1rem', padding: '0.8rem', background: '#fee2e2', borderRadius: 6, color: '#991b1b', fontSize: 13 }}>
          Errore: {errore}
        </div>
      )}

      {esitoCancellazione && (
        <div style={{ marginTop: '1rem', padding: '0.8rem', background: '#d1fae5', borderRadius: 6, color: '#065f46', fontSize: 13, fontWeight: 600 }}>
          {esitoCancellazione.messaggio}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sezione: gestione moduli
// ---------------------------------------------------------------------------

function GestioneModuli() {
  const [moduli, setModuli] = useState([])
  const [permessi, setPermessi] = useState({})   // { code: { ruolo: { puo_vedere, puo_modificare, puo_importare } } }
  const [nomi, setNomi] = useState({})           // { code: nome editato }
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState({})   // { code: messaggio }

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const { data: lista } = await api.get('/modules/admin/lista-completa').catch(async () => {
        // fallback: costruiamo da dettaglio per ogni modulo
        const { data: base } = await api.get('/modules/')
        const dettagli = await Promise.all(base.map(m => api.get(`/modules/${m.code}`).then(r => r.data)))
        return { data: dettagli }
      })
      // GET /modules/ non restituisce tutti i moduli (solo attivi) — usiamo /modules/{code}
      const { data: moduliBase } = await api.get('/modules/')
      const dettagli = await Promise.all(
        moduliBase.map(m => api.get(`/modules/${m.code}`).then(r => r.data).catch(() => null))
      ).then(res => res.filter(Boolean))

      setModuli(dettagli)
      setNomi(Object.fromEntries(dettagli.map(m => [m.code, m.name])))

      const mappa = {}
      dettagli.forEach(m => {
        mappa[m.code] = {}
        ;(m.permessi || []).forEach(p => { mappa[m.code][p.ruolo] = { ...p } })
      })
      setPermessi(mappa)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carica() }, [carica])

  async function toggleAttivo(modulo) {
    await api.put(`/modules/admin/${modulo.code}`, { attivo: !modulo.attivo })
    setFeedback(f => ({ ...f, [modulo.code]: modulo.attivo ? 'Disattivato' : 'Attivato' }))
    carica()
  }

  async function salvaPermesso(code, ruolo) {
    const p = permessi[code]?.[ruolo]
    if (!p) return
    await api.put(`/modules/admin/${code}/permissions/${ruolo}`, {
      puo_vedere: p.puo_vedere,
      puo_modificare: p.puo_modificare,
      puo_importare: p.puo_importare,
    })
    setFeedback(f => ({ ...f, [`${code}_${ruolo}`]: 'Salvato ✓' }))
    setTimeout(() => setFeedback(f => { const n = { ...f }; delete n[`${code}_${ruolo}`]; return n }), 2000)
  }

  function setPermesso(code, ruolo, campo, val) {
    setPermessi(prev => ({
      ...prev,
      [code]: { ...prev[code], [ruolo]: { ...prev[code]?.[ruolo], [campo]: val } },
    }))
  }

  async function rinominaModulo(code) {
    const nuovoNome = (nomi[code] || '').trim()
    if (!nuovoNome) return
    await api.put(`/modules/admin/${code}`, { name: nuovoNome })
    setFeedback(f => ({ ...f, [`nome_${code}`]: 'Nome salvato ✓' }))
    setTimeout(() => setFeedback(f => { const n = { ...f }; delete n[`nome_${code}`]; return n }), 2000)
    carica()
  }

  async function sposta(idx, dir) {
    const nuovoOrdine = [...moduli]
    const target = idx + dir
    if (target < 0 || target >= nuovoOrdine.length) return
    ;[nuovoOrdine[idx], nuovoOrdine[target]] = [nuovoOrdine[target], nuovoOrdine[idx]]
    await api.put('/modules/admin/ordine', { ordine: nuovoOrdine.map(m => m.code) })
    carica()
  }

  const ruoli = ['admin', 'viewer']
  const campi = [
    { key: 'puo_vedere', label: 'Vede' },
    { key: 'puo_modificare', label: 'Modifica' },
    { key: 'puo_importare', label: 'Importa' },
  ]

  return (
    <div className="card" style={{ marginBottom: '2rem' }}>
      <h3 style={{ marginTop: 0 }}>Gestione Moduli</h3>
      {loading ? <p>Caricamento…</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {moduli.map((m, idx) => (
            <div key={m.code} style={{
              border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem',
              background: m.attivo ? '#fff' : '#f9fafb',
              borderLeft: `4px solid ${m.colore || '#9ca3af'}`,
            }}>
              {/* Intestazione modulo */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: 22 }}>{m.icon}</span>
                <input
                  value={nomi[m.code] ?? m.name}
                  onChange={e => setNomi(n => ({ ...n, [m.code]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && rinominaModulo(m.code)}
                  style={{
                    fontWeight: 700, fontSize: 15, border: '1px solid #d1d5db',
                    borderRadius: 5, padding: '2px 8px', width: 220,
                  }}
                />
                {(nomi[m.code] ?? m.name) !== m.name && (
                  <button onClick={() => rinominaModulo(m.code)}
                    style={{ padding: '2px 10px', fontSize: 12, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                    Salva nome
                  </button>
                )}
                {feedback[`nome_${m.code}`] && (
                  <span style={{ fontSize: 12, color: '#059669' }}>{feedback[`nome_${m.code}`]}</span>
                )}
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 10,
                  background: m.attivo ? '#d1fae5' : '#f3f4f6',
                  color: m.attivo ? '#065f46' : '#6b7280', fontWeight: 600,
                }}>
                  {m.attivo ? 'Attivo' : 'Disattivato'}
                </span>
                {feedback[m.code] && (
                  <span style={{ fontSize: 12, color: '#059669', marginLeft: 4 }}>{feedback[m.code]}</span>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
                  <button onClick={() => sposta(idx, -1)} disabled={idx === 0}
                    style={{ padding: '2px 8px', fontSize: 12, cursor: 'pointer' }}>↑</button>
                  <button onClick={() => sposta(idx, 1)} disabled={idx === moduli.length - 1}
                    style={{ padding: '2px 8px', fontSize: 12, cursor: 'pointer' }}>↓</button>
                  <button onClick={() => toggleAttivo(m)}
                    style={{
                      padding: '3px 12px', fontSize: 12, cursor: 'pointer',
                      background: m.attivo ? '#fee2e2' : '#d1fae5',
                      color: m.attivo ? '#991b1b' : '#065f46',
                      border: 'none', borderRadius: 5,
                    }}>
                    {m.attivo ? 'Disattiva' : 'Attiva'}
                  </button>
                </div>
              </div>

              {/* Tabella permessi per ruolo */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: '#6b7280', fontWeight: 600 }}>Ruolo</th>
                    {campi.map(c => (
                      <th key={c.key} style={{ textAlign: 'center', padding: '4px 8px', color: '#6b7280', fontWeight: 600 }}>{c.label}</th>
                    ))}
                    <th style={{ padding: '4px 8px' }} />
                  </tr>
                </thead>
                <tbody>
                  {ruoli.map(ruolo => {
                    const p = permessi[m.code]?.[ruolo] || { puo_vedere: false, puo_modificare: false, puo_importare: false }
                    return (
                      <tr key={ruolo} style={{ borderTop: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '5px 8px', fontWeight: 600, textTransform: 'capitalize' }}>{ruolo}</td>
                        {campi.map(c => (
                          <td key={c.key} style={{ textAlign: 'center', padding: '5px 8px' }}>
                            <input type="checkbox"
                              checked={!!p[c.key]}
                              onChange={e => setPermesso(m.code, ruolo, c.key, e.target.checked)}
                            />
                          </td>
                        ))}
                        <td style={{ padding: '5px 8px' }}>
                          <button onClick={() => salvaPermesso(m.code, ruolo)}
                            style={{ padding: '2px 10px', fontSize: 11, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                            Salva
                          </button>
                          {feedback[`${m.code}_${ruolo}`] && (
                            <span style={{ marginLeft: 6, color: '#059669', fontSize: 11 }}>
                              {feedback[`${m.code}_${ruolo}`]}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sezione: configurazione modulo Corrispettivi
// ---------------------------------------------------------------------------

function GestioneCorrispettivi() {
  const [tipiDoc, setTipiDoc]     = useState([])
  const [tipiPag, setTipiPag]     = useState([])
  const [prefissi, setPrefissi]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [feedback, setFeedback]   = useState('')

  // Form aggiunta tipo pagamento
  const [nuovoPagCode, setNuovoPagCode] = useState('')
  const [nuovoPagName, setNuovoPagName] = useState('')

  // Form aggiunta prefisso
  const [nuovoPrePrefisso, setNuovoPrePrefisso]     = useState('')
  const [nuovoPreStruttura, setNuovoPreStruttura]   = useState('')
  const [nuovoPreTipo, setNuovoPreTipo]             = useState('lettera_iniziale')
  const [hotels, setHotels]                          = useState([])

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const [dDoc, dPag, dPre, dH] = await Promise.all([
        api.get('/corrispettivi/config/tipi-documento').then(r => r.data).catch(() => []),
        api.get('/corrispettivi/config/tipi-pagamento').then(r => r.data).catch(() => []),
        api.get('/corrispettivi/config/prefissi-struttura').then(r => r.data).catch(() => []),
        api.get('/hotels/').then(r => r.data).catch(() => []),
      ])
      setTipiDoc(dDoc); setTipiPag(dPag); setPrefissi(dPre); setHotels(dH)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { carica() }, [carica])

  function fb(msg) { setFeedback(msg); setTimeout(() => setFeedback(''), 2500) }

  async function toggleDoc(t) {
    await api.put(`/corrispettivi/config/tipi-documento/${t.id}`, { attivo: !t.attivo }).catch(e => {
      fb('Errore: ' + (e.response?.data?.detail || e.message)); return
    })
    fb(t.attivo ? 'Tipo disattivato' : 'Tipo attivato')
    carica()
  }

  async function aggiungiPagamento() {
    if (!nuovoPagCode || !nuovoPagName) { fb('Codice e nome obbligatori'); return }
    try {
      await api.post('/corrispettivi/config/tipi-pagamento', { code: nuovoPagCode, name: nuovoPagName })
      setNuovoPagCode(''); setNuovoPagName('')
      fb('Tipo pagamento aggiunto')
      carica()
    } catch (e) { fb('Errore: ' + (e.response?.data?.detail || e.message)) }
  }

  async function aggiungiPrefisso() {
    if (!nuovoPrePrefisso || !nuovoPreStruttura) { fb('Prefisso e struttura obbligatori'); return }
    try {
      await api.post('/corrispettivi/config/prefissi-struttura', {
        prefisso: nuovoPrePrefisso,
        struttura_code: nuovoPreStruttura,
        tipo: nuovoPreTipo,
      })
      setNuovoPrePrefisso(''); setNuovoPreStruttura(''); setNuovoPreTipo('lettera_iniziale')
      fb('Prefisso aggiunto')
      carica()
    } catch (e) { fb('Errore: ' + (e.response?.data?.detail || e.message)) }
  }

  async function eliminaPrefisso(id) {
    if (!confirm('Eliminare questo prefisso?')) return
    try { await api.delete(`/corrispettivi/config/prefissi-struttura/${id}`); fb('Eliminato'); carica() }
    catch (e) { fb('Errore: ' + (e.response?.data?.detail || e.message)) }
  }

  const inputSm = { fontSize: 12, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4 }
  const btnSm   = { fontSize: 12, padding: '4px 12px', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }

  return (
    <div className="card" style={{ marginBottom: '1.5rem', border: '1px solid #fecaca', background: '#fff5f5' }}>
      <h3 style={{ marginTop: 0, color: '#991b1b' }}>Corrispettivi — Configurazione</h3>
      {loading ? <p style={{ color: '#6b7280' }}>Caricamento…</p> : (
        <>
          {feedback && (
            <div style={{ marginBottom: 12, padding: '6px 12px', background: '#d1fae5', borderRadius: 6, color: '#065f46', fontSize: 13, fontWeight: 600 }}>
              {feedback}
            </div>
          )}

          {/* Tipi documento */}
          <div style={{ marginBottom: 20 }}>
            <h4 style={{ marginTop: 0, marginBottom: 8, color: '#7f1d1d' }}>Tipi documento</h4>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {tipiDoc.map(t => (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: t.attivo ? '#fee2e2' : '#f3f4f6',
                  borderRadius: 8, padding: '6px 12px',
                }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{t.code}</span>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>{t.name}</span>
                  <button onClick={() => toggleDoc(t)} style={{
                    ...btnSm,
                    background: t.attivo ? '#fca5a5' : '#d1fae5',
                    color: t.attivo ? '#7f1d1d' : '#065f46',
                  }}>
                    {t.attivo ? 'Disattiva' : 'Attiva'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Tipi pagamento */}
          <div style={{ marginBottom: 20 }}>
            <h4 style={{ marginTop: 0, marginBottom: 8, color: '#7f1d1d' }}>Tipi pagamento</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {tipiPag.map(t => (
                <span key={t.id} style={{
                  background: t.attivo ? '#fee2e2' : '#f3f4f6',
                  color: t.attivo ? '#7f1d1d' : '#6b7280',
                  borderRadius: 12, padding: '3px 10px', fontSize: 12, fontWeight: 600,
                }}>
                  {t.name} ({t.code})
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={nuovoPagCode} onChange={e => setNuovoPagCode(e.target.value.toUpperCase())}
                placeholder="Codice (es. SATISPAY)" style={{ ...inputSm, width: 140 }} />
              <input value={nuovoPagName} onChange={e => setNuovoPagName(e.target.value)}
                placeholder="Nome (es. Satispay)" style={{ ...inputSm, width: 160 }} />
              <button onClick={aggiungiPagamento} style={{ ...btnSm, background: '#dc2626', color: '#fff' }}>
                + Aggiungi
              </button>
            </div>
          </div>

          {/* Prefissi struttura */}
          <div>
            <h4 style={{ marginTop: 0, marginBottom: 8, color: '#7f1d1d' }}>Prefissi struttura (resolver camera)</h4>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginBottom: 10 }}>
              <thead>
                <tr style={{ background: '#fee2e2' }}>
                  {['Prefisso', 'Struttura', 'Tipo', ''].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '5px 8px', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {prefissi.map(p => (
                  <tr key={p.id} style={{ borderTop: '1px solid #fecaca' }}>
                    <td style={{ padding: '5px 8px', fontWeight: 600 }}>{p.prefisso}</td>
                    <td style={{ padding: '5px 8px' }}>{p.struttura_code}</td>
                    <td style={{ padding: '5px 8px', color: '#6b7280' }}>{p.tipo}</td>
                    <td style={{ padding: '5px 8px' }}>
                      <button onClick={() => eliminaPrefisso(p.id)} style={{ ...btnSm, background: '#fca5a5', color: '#7f1d1d' }}>
                        Elimina
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={nuovoPrePrefisso} onChange={e => setNuovoPrePrefisso(e.target.value)}
                placeholder="Prefisso (es. C)" style={{ ...inputSm, width: 120 }} />
              <select value={nuovoPreStruttura} onChange={e => setNuovoPreStruttura(e.target.value)} style={inputSm}>
                <option value="">— Struttura —</option>
                {hotels.map(h => <option key={h.code} value={h.code}>{h.code} — {h.name}</option>)}
              </select>
              <select value={nuovoPreTipo} onChange={e => setNuovoPreTipo(e.target.value)} style={inputSm}>
                <option value="lettera_iniziale">lettera_iniziale</option>
                <option value="nome_esatto">nome_esatto</option>
                <option value="contiene">contiene</option>
              </select>
              <button onClick={aggiungiPrefisso} style={{ ...btnSm, background: '#dc2626', color: '#fff' }}>
                + Aggiungi
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StatBox({ label, value, highlight }) {
  return (
    <div style={{
      background: highlight ? '#fef3c7' : '#fff',
      border: `1px solid ${highlight ? '#fcd34d' : '#e2e8f0'}`,
      borderRadius: 8,
      padding: '10px 18px',
      minWidth: 140,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: highlight ? '#92400e' : '#1a1a2e' }}>
        {value}
      </div>
    </div>
  )
}
