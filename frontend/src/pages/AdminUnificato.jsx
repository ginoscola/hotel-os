import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import AdminUtenti from './AdminUtenti.jsx'
import AdminCentriDiCosto from './AdminCentriDiCosto.jsx'
import api from '../api/client.js'
import { mostraErrore } from '../utils/format.js'

const SEZIONI = [
  {
    gruppo: 'Comune',
    voci: [
      { id: 'utenti',   label: 'Utenti' },
      { id: 'stagioni', label: 'Stagioni operative' },
      { id: 'moduli',   label: 'Gestione moduli' },
    ],
  },
  {
    gruppo: 'Revenue',
    voci: [
      { id: 'revenue-import', label: 'Import massivo' },
      { id: 'revenue-test',   label: 'Dati di test' },
    ],
  },
  {
    gruppo: 'Dipendenti',
    voci: [
      { id: 'dip-cc',     label: 'Centri di costo' },
      { id: 'dip-colori', label: 'Colori CC' },
      { id: 'dip-test',   label: 'Dati di test' },
    ],
  },
  {
    gruppo: 'Corrispettivi',
    voci: [
      { id: 'corr-tipi-doc',        label: 'Tipi documento' },
      { id: 'corr-pagamenti',       label: 'Tipi pagamento' },
      { id: 'corr-prefissi',        label: 'Prefissi struttura' },
      { id: 'corr-classificazione', label: 'Classif. trattamenti' },
    ],
  },
  {
    gruppo: 'USALI',
    voci: [
      { id: 'usali-kpi', label: 'Range KPI' },
      { id: 'usali-cc',  label: 'Mappatura costi lavoro' },
    ],
  },
  {
    gruppo: 'Sistema',
    voci: [
      { id: 'sistema-debug', label: 'Debug & diagnostica' },
    ],
  },
]

export default function AdminUnificato() {
  const [params, setParams] = useSearchParams()
  const sezione = params.get('s') || 'utenti'

  function vai(id) {
    setParams({ s: id })
  }

  return (
    <div style={{ display: 'flex', gap: 0, minHeight: 'calc(100vh - 120px)' }}>

      {/* ── Sidebar ── */}
      <aside style={{
        width: 220,
        flexShrink: 0,
        borderRight: '1px solid #e2e8f0',
        paddingTop: 8,
        background: '#f8fafc',
      }}>
        {SEZIONI.map(({ gruppo, voci }) => (
          <div key={gruppo} style={{ marginBottom: 4 }}>
            <div style={{
              padding: '10px 18px 4px',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#94a3b8',
            }}>
              {gruppo}
            </div>
            {voci.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => vai(id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 18px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 14,
                  background: sezione === id ? '#e0f2fe' : 'transparent',
                  color: sezione === id ? '#0369a1' : '#374151',
                  fontWeight: sezione === id ? 600 : 400,
                  borderRight: sezione === id ? '3px solid #0369a1' : '3px solid transparent',
                  transition: 'background 0.1s',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ))}
      </aside>

      {/* ── Contenuto ── */}
      <main style={{ flex: 1, padding: '24px 32px' }}>
        <Contenuto sezione={sezione} />
      </main>
    </div>
  )
}

function Contenuto({ sezione }) {
  if (sezione === 'utenti')        return <AdminUtenti />
  if (sezione === 'stagioni')      return <GestioneStagioni />
  if (sezione === 'moduli')        return <GestioneModuli />
  if (sezione === 'revenue-import') return <RevenueImportMassivo />
  if (sezione === 'revenue-test')  return <RevenueDatiTest />
  if (sezione === 'dip-cc')           return <DipCentriDiCosto />
  if (sezione === 'dip-colori')       return <DipColoriCC />
  if (sezione === 'dip-test')         return <DipDatiTest />
  if (sezione === 'corr-tipi-doc')    return <CorrTipiDocumento />
  if (sezione === 'corr-pagamenti')   return <CorrTipiPagamento />
  if (sezione === 'corr-prefissi')        return <CorrPrefissiStruttura />
  if (sezione === 'corr-classificazione') return <CorrClassificazioneTrattamenti />
  if (sezione === 'usali-kpi')            return <UsaliKpiConfig />
  if (sezione === 'usali-cc')             return <UsaliCCMapping />
  if (sezione === 'sistema-debug')        return <SistemaDebug />
  return <Placeholder sezione={sezione} />
}

// ---------------------------------------------------------------------------
// Stagioni operative
// ---------------------------------------------------------------------------

function GestioneStagioni() {
  const ANNO_CORRENTE = 2026
  const [anno, setAnno] = useState(ANNO_CORRENTE)
  const [hotels, setHotels] = useState([])
  const [stagioni, setStagioni] = useState({})
  const [form, setForm] = useState({})
  const [salvando, setSalvando] = useState({})
  const [esiti, setEsiti] = useState({})
  const [loadingAnno, setLoadingAnno] = useState(false)

  useEffect(() => {
    api.get('/hotels/').then(({ data }) => setHotels(data)).catch(() => {})
  }, [])

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
          ? { open_date: stagione.open_date, close_date: stagione.close_date, total_rooms: String(stagione.total_rooms), notes: stagione.notes || '' }
          : { open_date: '', close_date: '', total_rooms: String(hotel?.default_rooms || ''), notes: '' }
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
        season_year: anno, open_date: f.open_date, close_date: f.close_date,
        total_rooms: Number(f.total_rooms), notes: f.notes || null,
      })
      const { data } = await api.get(`/hotels/${code}/seasons/${anno}`)
      setStagioni(prev => ({ ...prev, [code]: data }))
      setEsiti(prev => ({ ...prev, [code]: { ok: true, msg: 'Salvato' } }))
    } catch (err) {
      setEsiti(prev => ({ ...prev, [code]: { ok: false, msg: mostraErrore(err) } }))
    } finally {
      setSalvando(prev => ({ ...prev, [code]: false }))
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: 20 }}>Stagioni operative</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
        <label style={{ fontWeight: 600, fontSize: 13 }}>Anno:</label>
        <select value={anno} onChange={e => setAnno(Number(e.target.value))}
          style={{ padding: '4px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}>
          {[2024, 2025, 2026, 2027].map(y => <option key={y}>{y}</option>)}
        </select>
        {loadingAnno && <span style={{ color: '#9ca3af', fontSize: 12 }}>Caricamento…</span>}
      </div>
      {hotels.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Hotel', 'Apertura', 'Chiusura', 'Camere', 'Note', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hotels.map(h => {
                const f = form[h.code] || {}
                const esito = esiti[h.code]
                const nonConfigurata = stagioni[h.code] == null
                return (
                  <tr key={h.code} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                      {h.name}
                      {nonConfigurata && <span style={{ marginLeft: 6, fontSize: 10, color: '#f59e0b' }}>non configurata</span>}
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <input type="date" value={f.open_date || ''} onChange={e => aggiornaForm(h.code, 'open_date', e.target.value)}
                        style={{ fontSize: 12, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4 }} />
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <input type="date" value={f.close_date || ''} onChange={e => aggiornaForm(h.code, 'close_date', e.target.value)}
                        style={{ fontSize: 12, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4 }} />
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <input type="number" value={f.total_rooms || ''} onChange={e => aggiornaForm(h.code, 'total_rooms', e.target.value)}
                        min="1" max="999" style={{ fontSize: 12, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4, width: 64 }} />
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <input type="text" value={f.notes || ''} onChange={e => aggiornaForm(h.code, 'notes', e.target.value)}
                        placeholder="facoltativo" style={{ fontSize: 12, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4, width: '100%', minWidth: 100 }} />
                    </td>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                      <button onClick={() => salva(h.code)} disabled={salvando[h.code] || !f.open_date || !f.close_date}
                        style={{ fontSize: 12, padding: '4px 14px', background: (!f.open_date || !f.close_date) ? '#9ca3af' : '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>
                        {salvando[h.code] ? '…' : 'Salva'}
                      </button>
                      {esito && (
                        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: esito.ok ? '#059669' : '#dc2626' }}>
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
// Gestione moduli
// ---------------------------------------------------------------------------

function GestioneModuli() {
  const [moduli, setModuli] = useState([])
  const [permessi, setPermessi] = useState({})
  const [nomi, setNomi] = useState({})
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState({})

  const carica = useCallback(async () => {
    setLoading(true)
    try {
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
      puo_vedere: p.puo_vedere, puo_modificare: p.puo_modificare, puo_importare: p.puo_importare,
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
    <div>
      <h2 style={{ marginTop: 0, marginBottom: 20 }}>Gestione Moduli</h2>
      {loading ? <p style={{ color: '#9ca3af' }}>Caricamento…</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {moduli.map((m, idx) => (
            <div key={m.code} className="card" style={{
              borderLeft: `4px solid ${m.colore || '#9ca3af'}`,
              background: m.attivo ? '#fff' : '#f9fafb',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: 22 }}>{m.icon}</span>
                <input
                  value={nomi[m.code] ?? m.name}
                  onChange={e => setNomi(n => ({ ...n, [m.code]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && rinominaModulo(m.code)}
                  style={{ fontWeight: 700, fontSize: 15, border: '1px solid #d1d5db', borderRadius: 5, padding: '2px 8px', width: 220 }}
                />
                {(nomi[m.code] ?? m.name) !== m.name && (
                  <button onClick={() => rinominaModulo(m.code)}
                    style={{ padding: '2px 10px', fontSize: 12, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                    Salva nome
                  </button>
                )}
                {feedback[`nome_${m.code}`] && <span style={{ fontSize: 12, color: '#059669' }}>{feedback[`nome_${m.code}`]}</span>}
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 10,
                  background: m.attivo ? '#d1fae5' : '#f3f4f6',
                  color: m.attivo ? '#065f46' : '#6b7280', fontWeight: 600,
                }}>
                  {m.attivo ? 'Attivo' : 'Disattivato'}
                </span>
                {feedback[m.code] && <span style={{ fontSize: 12, color: '#059669' }}>{feedback[m.code]}</span>}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
                  <button onClick={() => sposta(idx, -1)} disabled={idx === 0} style={{ padding: '2px 8px', fontSize: 12, cursor: 'pointer' }}>↑</button>
                  <button onClick={() => sposta(idx, 1)} disabled={idx === moduli.length - 1} style={{ padding: '2px 8px', fontSize: 12, cursor: 'pointer' }}>↓</button>
                  <button onClick={() => toggleAttivo(m)} style={{
                    padding: '3px 12px', fontSize: 12, cursor: 'pointer',
                    background: m.attivo ? '#fee2e2' : '#d1fae5',
                    color: m.attivo ? '#991b1b' : '#065f46',
                    border: 'none', borderRadius: 5,
                  }}>
                    {m.attivo ? 'Disattiva' : 'Attiva'}
                  </button>
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: '#6b7280', fontWeight: 600 }}>Ruolo</th>
                    {campi.map(c => <th key={c.key} style={{ textAlign: 'center', padding: '4px 8px', color: '#6b7280', fontWeight: 600 }}>{c.label}</th>)}
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
                            <input type="checkbox" checked={!!p[c.key]}
                              onChange={e => setPermesso(m.code, ruolo, c.key, e.target.checked)} />
                          </td>
                        ))}
                        <td style={{ padding: '5px 8px' }}>
                          <button onClick={() => salvaPermesso(m.code, ruolo)}
                            style={{ padding: '2px 10px', fontSize: 11, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                            Salva
                          </button>
                          {feedback[`${m.code}_${ruolo}`] && (
                            <span style={{ marginLeft: 6, color: '#059669', fontSize: 11 }}>{feedback[`${m.code}_${ruolo}`]}</span>
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
// Revenue — Import massivo
// ---------------------------------------------------------------------------

function RevenueImportMassivo() {
  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: 20 }}>Import Massivo</h2>
      <div className="card">
        <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0, marginBottom: '1.5rem' }}>
          Importa in blocco tutte le coppie di file CSV/Excel da una cartella del server.
        </p>
        <a
          href="/import/bulk"
          style={{
            display: 'inline-block', padding: '9px 20px',
            background: '#3b82f6', color: '#fff', borderRadius: 6,
            textDecoration: 'none', fontWeight: 600, fontSize: 14,
          }}
        >
          Vai all'Import Massivo →
        </a>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Revenue — Dati di test
// ---------------------------------------------------------------------------

function RevenueDatiTest() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)
  const [conferma, setConferma] = useState(false)
  const [esitoCancellazione, setEsitoCancellazione] = useState(null)

  const caricaStats = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/test-stats')
      setStats(data)
    } catch { setStats(null) }
  }, [])

  useEffect(() => { caricaStats() }, [caricaStats])

  async function handleCancella() {
    if (!conferma) { setConferma(true); return }
    setLoading(true); setErrore(null); setEsitoCancellazione(null); setConferma(false)
    try {
      const { data } = await api.delete('/admin/test-data')
      setEsitoCancellazione(data)
      await caricaStats()
    } catch (err) {
      setErrore(mostraErrore(err))
    } finally { setLoading(false) }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: 20 }}>Dati di test — Revenue</h2>
      <div className="card" style={{ border: '1px solid #fcd34d', background: '#fffbeb' }}>
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
          conferma ? (
            <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
              <p style={{ color: '#991b1b', fontWeight: 600, marginTop: 0 }}>
                Sei sicuro? Verranno eliminati {stats.righe_revenue} righe revenue e {stats.sessioni_import} sessioni import di test.
                L'operazione non è reversibile.
              </p>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button onClick={handleCancella} disabled={loading}
                  style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                  Sì, cancella tutti i dati di test
                </button>
                <button onClick={() => setConferma(false)}
                  style={{ background: '#e5e7eb', color: '#374151', border: 'none', padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                  Annulla
                </button>
              </div>
            </div>
          ) : (
            <button onClick={handleCancella} disabled={loading}
              style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
              {loading ? 'Cancellazione in corso…' : 'Cancella dati di test'}
            </button>
          )
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
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dipendenti — Centri di costo
// ---------------------------------------------------------------------------

function DipCentriDiCosto() {
  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: 20 }}>Centri di Costo</h2>
      <AdminCentriDiCosto />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dipendenti — Colori CC
// ---------------------------------------------------------------------------

const _CC_PALETTE = [
  '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4',
  '#f97316', '#84cc16', '#ec4899', '#6366f1', '#14b8a6',
]
function _hashCC(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
function _hexToRgb(hex) {
  const h = (hex || '#888888').replace('#', '')
  return { r: parseInt(h.slice(0, 2), 16) || 136, g: parseInt(h.slice(2, 4), 16) || 136, b: parseInt(h.slice(4, 6), 16) || 136 }
}

function DipColoriCC() {
  const [albero, setAlbero] = useState([])
  const [colori, setColori] = useState(null)
  const [modificato, setModificato] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [esito, setEsito] = useState(null)

  useEffect(() => {
    api.get('/cost-centers/albero').then(r => setAlbero(r.data)).catch(() => {})
    api.get('/config/cc-colori/mappa').then(r => setColori(r.data)).catch(() => {})
  }, [])

  const hexPerNome = (nome) => {
    const v = colori?.[nome]
    if (v && /^#[0-9a-fA-F]{6}$/i.test(v)) return v
    return _CC_PALETTE[_hashCC(nome) % _CC_PALETTE.length]
  }

  const badgeDaHex = (hex, tintPct) => {
    const { r, g, b } = _hexToRgb(hex)
    const bg = (c) => Math.round(c + (255 - c) * tintPct)
    const dark = (c) => Math.round(c * 0.48)
    return {
      background: `rgb(${bg(r)}, ${bg(g)}, ${bg(b)})`,
      border: `1px solid rgba(${r}, ${g}, ${b}, 0.38)`,
      color: `rgb(${dark(r)}, ${dark(g)}, ${dark(b)})`,
      padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
    }
  }

  async function salva() {
    setSalvando(true); setEsito(null)
    try {
      await api.put('/config/cc-colori/mappa', colori)
      setModificato(false)
      setEsito({ ok: true, msg: 'Colori salvati correttamente.' })
    } catch (e) {
      setEsito({ ok: false, msg: mostraErrore(e, 'Errore nel salvataggio.') })
    } finally { setSalvando(false) }
  }

  if (colori === null) return <p style={{ color: '#9ca3af' }}>Caricamento…</p>

  const nomiDB = [...new Set(
    albero.flatMap(s => (s.categorie || []).flatMap(cat => (cat.reparti || []).map(r => (r.name || '').toLowerCase().trim()))).filter(Boolean)
  )].sort()
  const nomiExtra = Object.keys(colori).filter(k => !nomiDB.includes(k)).sort()
  const tuttiNomi = [...nomiDB, ...nomiExtra]

  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: 8 }}>Colori Centri di Costo</h2>
      <p style={{ color: '#64748b', fontSize: 13, marginBottom: 4 }}>
        Scegli il colore base di ogni tipo di reparto. Le strutture usano varianti graduate automaticamente.
      </p>
      <p style={{ color: '#94a3b8', fontSize: 12, marginBottom: 16 }}>
        I reparti senza colore personalizzato (<em>auto</em>) usano un colore generato automaticamente.
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <thead>
          <tr style={{ background: '#2d6a9f' }}>
            {['Reparto', 'Colore base', 'Hex', 'Anteprima strutture →', ''].map(h => (
              <th key={h} style={{ padding: '10px 12px', color: '#fff', fontWeight: 700, textAlign: 'left', fontSize: 12 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tuttiNomi.map((nome, idx) => {
            const hex = hexPerNome(nome)
            const isCustom = Object.prototype.hasOwnProperty.call(colori, nome) && /^#[0-9a-fA-F]{6}$/i.test(colori[nome])
            return (
              <tr key={nome} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                <td style={{ padding: '9px 12px', fontWeight: 600, fontSize: 13, minWidth: 110 }}>
                  {nome}
                  {!isCustom && <span style={{ marginLeft: 6, fontSize: 10, color: '#94a3b8', background: '#f1f5f9', borderRadius: 4, padding: '1px 4px' }}>auto</span>}
                </td>
                <td style={{ padding: '9px 12px', textAlign: 'center', width: 56 }}>
                  <input type="color" value={hex}
                    onChange={e => { setColori(p => ({ ...p, [nome]: e.target.value })); setModificato(true); setEsito(null) }}
                    style={{ width: 36, height: 28, border: 'none', borderRadius: 4, cursor: 'pointer', padding: 2, background: 'none' }} />
                </td>
                <td style={{ padding: '9px 12px', width: 90 }}>
                  <input type="text" value={hex} maxLength={7} spellCheck={false}
                    onChange={e => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) { setColori(p => ({ ...p, [nome]: e.target.value })); setModificato(true); setEsito(null) } }}
                    style={{ width: 80, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontFamily: 'monospace', fontSize: 12 }} />
                </td>
                <td style={{ padding: '6px 12px' }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[['CLB', 0.55], ['DPH', 0.72], ['INT', 0.85], ['COMUNE', 0.94]].map(([s, t]) => (
                      <span key={s} style={badgeDaHex(hex, t)}>{s}</span>
                    ))}
                  </div>
                </td>
                <td style={{ padding: '9px 12px', textAlign: 'center', width: 80 }}>
                  {isCustom ? (
                    <button onClick={() => { setColori(p => { const c = { ...p }; delete c[nome]; return c }); setModificato(true); setEsito(null) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#64748b', textDecoration: 'underline' }}>
                      ripristina
                    </button>
                  ) : (
                    <button onClick={() => { setColori(p => ({ ...p, [nome]: hex })); setModificato(true); setEsito(null) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#2d6a9f', textDecoration: 'underline' }}>
                      personalizza
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
        <button onClick={salva} disabled={!modificato || salvando}
          style={{ padding: '9px 24px', background: modificato ? '#2d6a9f' : '#e5e7eb', color: modificato ? '#fff' : '#9ca3af', border: 'none', borderRadius: 6, cursor: modificato ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: 14 }}>
          {salvando ? 'Salvataggio…' : '💾 Salva colori'}
        </button>
        {esito && <span style={{ fontSize: 13, color: esito.ok ? '#16a34a' : '#dc2626', fontWeight: 500 }}>{esito.ok ? '✓ ' : '✗ '}{esito.msg}</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dipendenti — Dati di test
// ---------------------------------------------------------------------------

function DipDatiTest() {
  const [stats, setStats] = useState(null)
  const [cancellando, setCancellando] = useState(false)
  const [esito, setEsito] = useState(null)
  const [elimImport, setElimImport]   = useState(true)
  const [elimDip, setElimDip]         = useState(false)

  const carica = useCallback(async () => {
    api.get('/dipendenti/admin/test-stats').then(r => setStats(r.data)).catch(() => {})
  }, [])

  useEffect(() => { carica() }, [carica])

  async function elimina() {
    if (!elimImport) { setEsito({ ok: false, msg: 'Seleziona almeno "Import di test" per procedere.' }); return }
    const msg = elimDip
      ? `Verranno eliminati ${stats.payroll_imports} import di test e ${stats.dipendenti_orfani} dipendenti senza altri dati.\nContinuare?`
      : `Verranno eliminati ${stats.payroll_imports} import di test.\nLe anagrafiche e le classificazioni CC dei dipendenti saranno mantenute.\nContinuare?`
    if (!confirm(msg)) return
    setCancellando(true); setEsito(null)
    try {
      const { data } = await api.delete(`/dipendenti/admin/test-data?elimina_dipendenti=${elimDip}`)
      setEsito({ ok: true, msg: data.messaggio })
      await carica()
    } catch (e) {
      setEsito({ ok: false, msg: mostraErrore(e, 'Errore nella cancellazione.') })
    } finally { setCancellando(false) }
  }

  const nessunTest = stats && stats.payroll_imports === 0

  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: 20 }}>Dati di test — Dipendenti</h2>
      <div className="card" style={{ border: '1px solid #fcd34d', background: '#fffbeb' }}>

        {/* Contatori */}
        {stats && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
            {[
              { label: 'Import di test',    value: stats.payroll_imports },
              { label: 'Voci di costo',     value: stats.payroll_entries },
              { label: 'Record mensili',    value: stats.employee_monthly },
              { label: 'Dip. senza altri dati', value: stats.dipendenti_orfani },
            ].map(s => (
              <div key={s.label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 18px', minWidth: 140, textAlign: 'center' }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: s.value > 0 ? '#d97706' : '#94a3b8' }}>{s.value}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {nessunTest && <p style={{ color: '#94a3b8', fontSize: 13 }}>Nessun dato di test presente.</p>}

        {!nessunTest && stats && (
          <>
            {/* Checkbox selezione */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={elimImport} onChange={e => setElimImport(e.target.checked)}
                  style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#1e293b' }}>
                    Import di test ({stats.payroll_imports} import, {stats.payroll_entries} voci, {stats.employee_monthly} record mensili)
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    Elimina i file importati come test e tutti i dati economici collegati.
                  </div>
                </div>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: stats.dipendenti_orfani === 0 ? 'not-allowed' : 'pointer', opacity: stats.dipendenti_orfani === 0 ? 0.5 : 1 }}>
                <input type="checkbox" checked={elimDip} disabled={stats.dipendenti_orfani === 0}
                  onChange={e => setElimDip(e.target.checked)}
                  style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#1e293b' }}>
                    Anagrafiche dipendenti senza altri dati ({stats.dipendenti_orfani} dipendenti)
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    Elimina i dipendenti che esistono solo negli import di test. Se un dipendente ha anche dati reali, viene mantenuto insieme alle sue classificazioni CC.
                  </div>
                </div>
              </label>
            </div>

            <button onClick={elimina} disabled={cancellando || !elimImport}
              style={{
                padding: '9px 20px',
                background: elimImport ? '#dc2626' : '#e5e7eb',
                color: elimImport ? '#fff' : '#9ca3af',
                border: 'none', borderRadius: 6,
                cursor: elimImport ? 'pointer' : 'not-allowed',
                fontWeight: 600, fontSize: 14,
              }}>
              {cancellando ? 'Cancellazione in corso…' : '🗑️ Elimina selezionati'}
            </button>
          </>
        )}

        {esito && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: esito.ok ? '#d1fae5' : '#fee2e2', color: esito.ok ? '#065f46' : '#991b1b' }}>
            {esito.msg}
          </div>
        )}
      </div>
    </div>
  )
}

function StatBox({ label, value, highlight }) {
  return (
    <div style={{
      background: highlight ? '#fef3c7' : '#fff',
      border: `1px solid ${highlight ? '#fcd34d' : '#e2e8f0'}`,
      borderRadius: 8, padding: '10px 18px', minWidth: 140, textAlign: 'center',
    }}>
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: highlight ? '#92400e' : '#1a1a2e' }}>{value}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Corrispettivi — helpers condivisi
// ---------------------------------------------------------------------------

const inputSm = { fontSize: 12, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4 }
const btnSm   = { fontSize: 12, padding: '4px 12px', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }

function useFeedback() {
  const [msg, setMsg] = useState('')
  const fb = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }
  return [msg, fb]
}

// ---------------------------------------------------------------------------
// Corrispettivi — Tipi documento
// ---------------------------------------------------------------------------

function CorrTipiDocumento() {
  const [tipiDoc, setTipiDoc] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, fb] = useFeedback()

  const carica = useCallback(async () => {
    setLoading(true)
    api.get('/corrispettivi/config/tipi-documento').then(r => setTipiDoc(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])
  useEffect(() => { carica() }, [carica])

  async function toggleDoc(t) {
    try {
      await api.put(`/corrispettivi/config/tipi-documento/${t.id}`, { attivo: !t.attivo })
      fb(t.attivo ? 'Tipo disattivato' : 'Tipo attivato')
      carica()
    } catch (e) { fb('Errore: ' + mostraErrore(e)) }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: 20 }}>Tipi documento — Corrispettivi</h2>
      {msg && <div style={{ marginBottom: 12, padding: '6px 12px', background: '#d1fae5', borderRadius: 6, color: '#065f46', fontSize: 13, fontWeight: 600 }}>{msg}</div>}
      {loading ? <p style={{ color: '#9ca3af' }}>Caricamento…</p> : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tipiDoc.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: t.attivo ? '#fee2e2' : '#f3f4f6', borderRadius: 8, padding: '6px 12px' }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{t.code}</span>
              <span style={{ fontSize: 12, color: '#6b7280' }}>{t.name}</span>
              <button onClick={() => toggleDoc(t)} style={{ ...btnSm, background: t.attivo ? '#fca5a5' : '#d1fae5', color: t.attivo ? '#7f1d1d' : '#065f46' }}>
                {t.attivo ? 'Disattiva' : 'Attiva'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Corrispettivi — Tipi pagamento
// ---------------------------------------------------------------------------

function CorrTipiPagamento() {
  const [tipiPag, setTipiPag] = useState([])
  const [loading, setLoading] = useState(true)
  const [nuovoCode, setNuovoCode] = useState('')
  const [nuovoName, setNuovoName] = useState('')
  const [msg, fb] = useFeedback()

  const carica = useCallback(async () => {
    setLoading(true)
    api.get('/corrispettivi/config/tipi-pagamento').then(r => setTipiPag(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])
  useEffect(() => { carica() }, [carica])

  async function aggiungi() {
    if (!nuovoCode || !nuovoName) { fb('Codice e nome obbligatori'); return }
    try {
      await api.post('/corrispettivi/config/tipi-pagamento', { code: nuovoCode, name: nuovoName })
      setNuovoCode(''); setNuovoName('')
      fb('Tipo pagamento aggiunto')
      carica()
    } catch (e) { fb('Errore: ' + mostraErrore(e)) }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: 20 }}>Tipi pagamento — Corrispettivi</h2>
      {msg && <div style={{ marginBottom: 12, padding: '6px 12px', background: '#d1fae5', borderRadius: 6, color: '#065f46', fontSize: 13, fontWeight: 600 }}>{msg}</div>}
      {loading ? <p style={{ color: '#9ca3af' }}>Caricamento…</p> : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {tipiPag.map(t => (
              <span key={t.id} style={{ background: t.attivo ? '#fee2e2' : '#f3f4f6', color: t.attivo ? '#7f1d1d' : '#6b7280', borderRadius: 12, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
                {t.name} ({t.code})
              </span>
            ))}
          </div>
          <div className="card" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Aggiungi:</span>
            <input value={nuovoCode} onChange={e => setNuovoCode(e.target.value.toUpperCase())}
              placeholder="Codice (es. SATISPAY)" style={{ ...inputSm, width: 160 }} />
            <input value={nuovoName} onChange={e => setNuovoName(e.target.value)}
              placeholder="Nome (es. Satispay)" style={{ ...inputSm, width: 180 }} />
            <button onClick={aggiungi} style={{ ...btnSm, background: '#dc2626', color: '#fff' }}>+ Aggiungi</button>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Corrispettivi — Classificazione trattamenti (Analisi Ricavi)
// ---------------------------------------------------------------------------

const CATEGORIE_DISPONIBILI = ['RO', 'BB', 'HB', 'FB', 'AI', 'Altro']

function CorrClassificazioneTrattamenti() {
  const [righe, setRighe] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState({})  // codice → {nome_display, categoria, escludi, ordine}
  const [saving, setSaving] = useState(null)
  const [msg, fb] = useFeedback()

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/analisi-ricavi/classificazione')
      setRighe(r.data)
    } catch (e) {
      fb(mostraErrore(e), 'err')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carica() }, [carica])

  const avviaEdit = (r) => {
    setEditing(prev => ({
      ...prev,
      [r.codice]: { nome_display: r.nome_display, categoria: r.categoria || '',
                    escludi: r.escludi, ordine: r.ordine, colore: r.colore || '' },
    }))
  }
  const cancellaEdit = (codice) => {
    setEditing(prev => { const n = { ...prev }; delete n[codice]; return n })
  }
  const aggiornaEdit = (codice, campo, valore) => {
    setEditing(prev => ({ ...prev, [codice]: { ...prev[codice], [campo]: valore } }))
  }

  const salva = async (codice) => {
    setSaving(codice)
    try {
      const body = editing[codice]
      await api.put(`/analisi-ricavi/classificazione/${encodeURIComponent(codice)}`, {
        ...body,
        categoria: body.categoria || null,
        ordine: Number(body.ordine),
        colore: body.colore || null,
      })
      fb(`Classificazione '${codice}' salvata.`, 'ok')
      cancellaEdit(codice)
      carica()
    } catch (e) {
      fb(mostraErrore(e), 'err')
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <p style={{ color: '#64748b' }}>Caricamento...</p>

  const nonClassificati = righe.filter(r => !r.categoria && !r.escludi)

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Classificazione Trattamenti</h2>
      <p style={{ color: '#64748b', fontSize: 14 }}>
        Mappa i codici di trattamento (listino) alle macrocategorie usate nell'Analisi Ricavi.
        I codici marcati come "Escludi" vengono redistribuiti proporzionalmente tra gli altri.
      </p>

      {msg && (
        <div style={{ padding: '8px 14px', borderRadius: 6, marginBottom: 16,
                      background: msg.tipo === 'ok' ? '#d1fae5' : '#fee2e2',
                      color: msg.tipo === 'ok' ? '#065f46' : '#991b1b', fontSize: 14 }}>
          {msg.testo}
        </div>
      )}

      {nonClassificati.length > 0 && (
        <div style={{ padding: '10px 14px', background: '#fef3c7', borderRadius: 8,
                      border: '1px solid #f59e0b', marginBottom: 16, fontSize: 13 }}>
          ⚠ {nonClassificati.length} codic{nonClassificati.length > 1 ? 'i' : 'e'} non classificat{nonClassificati.length > 1 ? 'i' : 'o'}:{' '}
          {nonClassificati.map(r => <strong key={r.codice}>{r.codice} </strong>)}
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#1e293b', color: '#fff' }}>
            <th style={{ padding: '9px 12px', textAlign: 'left' }}>Codice</th>
            <th style={{ padding: '9px 12px', textAlign: 'left' }}>Nome display</th>
            <th style={{ padding: '9px 12px', textAlign: 'left' }}>Categoria</th>
            <th style={{ padding: '9px 12px', textAlign: 'center' }}>Escludi</th>
            <th style={{ padding: '9px 12px', textAlign: 'center' }}>Ordine</th>
            <th style={{ padding: '9px 12px', textAlign: 'left' }}>Colore</th>
            <th style={{ padding: '9px 12px' }} />
          </tr>
        </thead>
        <tbody>
          {righe.map((r, i) => {
            const ed = editing[r.codice]
            const isEven = i % 2 === 0
            return (
              <tr key={r.codice} style={{ background: isEven ? '#f8fafc' : '#fff' }}>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                  {r.codice}
                  {r.escludi && !ed && (
                    <span style={{ marginLeft: 6, fontSize: 10, background: '#fee2e2',
                                   color: '#991b1b', padding: '1px 6px', borderRadius: 4,
                                   fontFamily: 'inherit' }}>escluso</span>
                  )}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  {ed ? (
                    <input value={ed.nome_display}
                           onChange={e => aggiornaEdit(r.codice, 'nome_display', e.target.value)}
                           style={{ width: '90%', padding: '4px 8px', borderRadius: 5,
                                    border: '1px solid #cbd5e1' }} />
                  ) : r.nome_display}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  {ed ? (
                    <select value={ed.categoria || ''}
                            onChange={e => aggiornaEdit(r.codice, 'categoria', e.target.value)}
                            style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid #cbd5e1' }}>
                      <option value="">— nessuna —</option>
                      {CATEGORIE_DISPONIBILI.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    r.categoria
                      ? <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px',
                                       borderRadius: 4, fontWeight: 600 }}>{r.categoria}</span>
                      : <span style={{ color: '#94a3b8' }}>—</span>
                  )}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                  {ed ? (
                    <input type="checkbox" checked={ed.escludi}
                           onChange={e => aggiornaEdit(r.codice, 'escludi', e.target.checked)} />
                  ) : (
                    r.escludi ? '✓' : ''
                  )}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                  {ed ? (
                    <input type="number" value={ed.ordine}
                           onChange={e => aggiornaEdit(r.codice, 'ordine', e.target.value)}
                           style={{ width: 60, padding: '4px 6px', borderRadius: 5,
                                    border: '1px solid #cbd5e1', textAlign: 'center' }} />
                  ) : r.ordine}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  {ed ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <label style={{ cursor: 'pointer', display: 'inline-flex' }} title="Seleziona colore">
                        <span style={{ width: 20, height: 20, borderRadius: 4, display: 'inline-block',
                                       background: ed.colore || '#e2e8f0', border: '1px solid #cbd5e1' }} />
                        <input type="color" value={ed.colore || '#6366f1'}
                               onChange={e => aggiornaEdit(r.codice, 'colore', e.target.value)}
                               style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
                      </label>
                      <input
                        type="text"
                        value={ed.colore}
                        onChange={e => aggiornaEdit(r.codice, 'colore', e.target.value)}
                        placeholder="#rrggbb"
                        maxLength={7}
                        spellCheck={false}
                        style={{ width: 72, padding: '4px 6px', borderRadius: 5, fontSize: 12,
                                 fontFamily: 'monospace', border: '1px solid #cbd5e1' }}
                      />
                    </span>
                  ) : (
                    r.colore
                      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 14, height: 14, borderRadius: 3, background: r.colore,
                                         border: '1px solid #cbd5e1', display: 'inline-block' }} />
                          <code style={{ fontSize: 12 }}>{r.colore}</code>
                        </span>
                      : <span style={{ color: '#94a3b8', fontSize: 12 }}>auto</span>
                  )}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                  {ed ? (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button onClick={() => salva(r.codice)} disabled={saving === r.codice}
                              style={{ padding: '4px 12px', background: '#1e293b', color: '#fff',
                                       border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>
                        {saving === r.codice ? '...' : 'Salva'}
                      </button>
                      <button onClick={() => cancellaEdit(r.codice)}
                              style={{ padding: '4px 10px', background: '#e2e8f0', border: 'none',
                                       borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => avviaEdit(r)}
                            style={{ padding: '4px 12px', background: 'transparent',
                                     border: '1px solid #cbd5e1', borderRadius: 5,
                                     cursor: 'pointer', fontSize: 12, color: '#475569' }}>
                      Modifica
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Corrispettivi — Prefissi struttura
// ---------------------------------------------------------------------------

function CorrPrefissiStruttura() {
  const [prefissi, setPrefissi] = useState([])
  const [hotels, setHotels] = useState([])
  const [loading, setLoading] = useState(true)
  const [nuovoPrefisso, setNuovoPrefisso] = useState('')
  const [nuovaStruttura, setNuovaStruttura] = useState('')
  const [nuovoTipo, setNuovoTipo] = useState('lettera_iniziale')
  const [msg, fb] = useFeedback()

  const carica = useCallback(async () => {
    setLoading(true)
    const [dPre, dH] = await Promise.all([
      api.get('/corrispettivi/config/prefissi-struttura').then(r => r.data).catch(() => []),
      api.get('/hotels/').then(r => r.data).catch(() => []),
    ])
    setPrefissi(dPre); setHotels(dH); setLoading(false)
  }, [])
  useEffect(() => { carica() }, [carica])

  async function aggiungi() {
    if (!nuovoPrefisso || !nuovaStruttura) { fb('Prefisso e struttura obbligatori'); return }
    try {
      await api.post('/corrispettivi/config/prefissi-struttura', { prefisso: nuovoPrefisso, struttura_code: nuovaStruttura, tipo: nuovoTipo })
      setNuovoPrefisso(''); setNuovaStruttura(''); setNuovoTipo('lettera_iniziale')
      fb('Prefisso aggiunto'); carica()
    } catch (e) { fb('Errore: ' + mostraErrore(e)) }
  }

  async function elimina(id) {
    if (!confirm('Eliminare questo prefisso?')) return
    try { await api.delete(`/corrispettivi/config/prefissi-struttura/${id}`); fb('Eliminato'); carica() }
    catch (e) { fb('Errore: ' + mostraErrore(e)) }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: 20 }}>Prefissi struttura — Corrispettivi</h2>
      {msg && <div style={{ marginBottom: 12, padding: '6px 12px', background: '#d1fae5', borderRadius: 6, color: '#065f46', fontSize: 13, fontWeight: 600 }}>{msg}</div>}
      {loading ? <p style={{ color: '#9ca3af' }}>Caricamento…</p> : (
        <>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 20 }}>
            <thead>
              <tr style={{ background: '#fee2e2' }}>
                {['Prefisso', 'Struttura', 'Tipo', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {prefissi.map(p => (
                <tr key={p.id} style={{ borderTop: '1px solid #fecaca' }}>
                  <td style={{ padding: '6px 10px', fontWeight: 600 }}>{p.prefisso}</td>
                  <td style={{ padding: '6px 10px' }}>{p.struttura_code}</td>
                  <td style={{ padding: '6px 10px', color: '#6b7280' }}>{p.tipo}</td>
                  <td style={{ padding: '6px 10px' }}>
                    <button onClick={() => elimina(p.id)} style={{ ...btnSm, background: '#fca5a5', color: '#7f1d1d' }}>Elimina</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="card" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Aggiungi:</span>
            <input value={nuovoPrefisso} onChange={e => setNuovoPrefisso(e.target.value)}
              placeholder="Prefisso (es. C)" style={{ ...inputSm, width: 120 }} />
            <select value={nuovaStruttura} onChange={e => setNuovaStruttura(e.target.value)} style={inputSm}>
              <option value="">— Struttura —</option>
              {hotels.map(h => <option key={h.code} value={h.code}>{h.code} — {h.name}</option>)}
            </select>
            <select value={nuovoTipo} onChange={e => setNuovoTipo(e.target.value)} style={inputSm}>
              <option value="lettera_iniziale">lettera_iniziale</option>
              <option value="nome_esatto">nome_esatto</option>
              <option value="contiene">contiene</option>
            </select>
            <button onClick={aggiungi} style={{ ...btnSm, background: '#dc2626', color: '#fff' }}>+ Aggiungi</button>
          </div>
        </>
      )}
    </div>
  )
}

function Placeholder({ sezione }) {
  const tutti = SEZIONI.flatMap(g => g.voci)
  const voce = tutti.find(v => v.id === sezione)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: 200, border: '2px dashed #e2e8f0', borderRadius: 12,
      color: '#94a3b8', fontSize: 15,
    }}>
      [{voce?.label ?? sezione}] — sezione da implementare
    </div>
  )
}

// ---------------------------------------------------------------------------
// USALI — Mappatura CC → voce costo lavoro
// ---------------------------------------------------------------------------

const VOCE_OPTIONS = [
  { val: 'camere', label: 'Camere', color: '#3b82f6' },
  { val: 'fnb',    label: 'F&B',    color: '#10b981' },
  { val: null,     label: 'Altri reparti (default)', color: '#94a3b8' },
]

function UsaliCCMapping() {
  const [albero, setAlbero] = useState([])
  const [mapping, setMapping] = useState({})
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    Promise.all([
      api.get('/cost-centers/albero'),
      api.get('/usali/cc-mapping'),
    ]).then(([ra, rm]) => {
      setAlbero(ra.data)
      setMapping(rm.data)
    }).catch(e => alert(mostraErrore(e)))
  }, [])

  function setVoce(ccCode, val) {
    setMapping(prev => {
      const next = { ...prev }
      if (val === null) delete next[ccCode]
      else next[ccCode] = val
      return next
    })
  }

  async function salva() {
    setSalvando(true); setMsg(null)
    try {
      await api.put('/usali/cc-mapping', mapping)
      setMsg({ tipo: 'ok', testo: 'Mappatura salvata.' })
    } catch (e) {
      setMsg({ tipo: 'err', testo: mostraErrore(e) })
    } finally { setSalvando(false) }
  }

  if (!albero.length) return <div style={{ padding: 24, color: '#94a3b8' }}>Caricamento…</div>

  return (
    <div style={{ maxWidth: 720 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Mappatura costi del lavoro</h3>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
        Assegna ogni Centro di Costo a una voce USALI. I costi vengono letti automaticamente
        dal modulo Dipendenti. Senza assegnazione → <strong>Altri reparti</strong>.
      </p>

      {albero.map(struttura => (
        <div key={struttura.code} style={{ marginBottom: 20, border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
          {/* Header struttura */}
          <div style={{ background: '#1e293b', color: '#fff', padding: '7px 14px', fontWeight: 600, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{struttura.name} <span style={{ fontSize: 11, opacity: 0.6, fontWeight: 400 }}>({struttura.code})</span></span>
            {/* Toggle rapido per tutta la struttura */}
            <div style={{ display: 'flex', gap: 4 }}>
              {VOCE_OPTIONS.map(o => (
                <button key={String(o.val)} onClick={() => {
                  const allCodes = [struttura.code,
                    ...struttura.categorie.flatMap(c => [c.code, ...c.reparti.map(r => r.code)])]
                  allCodes.forEach(cc => setVoce(cc, o.val))
                }} style={{ padding: '2px 8px', fontSize: 11, border: 'none', borderRadius: 4, cursor: 'pointer', background: o.color, color: '#fff', opacity: 0.85 }}>
                  Tutti {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Categorie e reparti */}
          {struttura.categorie.map(cat => (
            <div key={cat.code}>
              {/* Riga categoria */}
              <ToggleRigaCC
                code={cat.code} name={cat.name} tipo="categoria"
                voce={mapping[cat.code] ?? null} onChange={v => setVoce(cat.code, v)}
              />
              {/* Reparti figli */}
              {cat.reparti.map(rep => (
                <ToggleRigaCC
                  key={rep.code}
                  code={rep.code} name={rep.name} tipo="reparto"
                  voce={mapping[rep.code] ?? null} onChange={v => setVoce(rep.code, v)}
                  indent
                />
              ))}
            </div>
          ))}
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={salva} disabled={salvando}
          style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {salvando ? 'Salvataggio…' : 'Salva mappatura'}
        </button>
        {msg && <span style={{ fontSize: 13, color: msg.tipo === 'ok' ? '#16a34a' : '#dc2626' }}>{msg.testo}</span>}
      </div>
    </div>
  )
}

function ToggleRigaCC({ code, name, tipo, voce, onChange, indent }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', padding: '5px 14px',
      paddingLeft: indent ? 32 : 14,
      background: tipo === 'categoria' ? '#f8fafc' : '#fff',
      borderBottom: '1px solid #f1f5f9',
      gap: 12,
    }}>
      <span style={{ flex: 1, fontSize: 13, color: '#374151' }}>
        {tipo === 'reparto' && <span style={{ color: '#cbd5e1', marginRight: 6 }}>└</span>}
        {name}
        <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>{code}</span>
      </span>
      <div style={{ display: 'flex', gap: 3 }}>
        {VOCE_OPTIONS.map(o => {
          const attivo = voce === o.val
          return (
            <button key={String(o.val)} onClick={() => onChange(o.val)}
              style={{
                padding: '3px 10px', fontSize: 12, border: `1px solid ${attivo ? o.color : '#e2e8f0'}`,
                borderRadius: 4, cursor: 'pointer', fontWeight: attivo ? 600 : 400,
                background: attivo ? o.color : '#fff',
                color: attivo ? '#fff' : '#64748b',
              }}>
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// USALI — Range KPI
// ---------------------------------------------------------------------------

const KPI_CODES = ['ebitdar_pct', 'fnb_cost_pct', 'lavoro_pct', 'utenze_pct']
const KPI_LABELS = {
  ebitdar_pct: 'EBITDAR su ricavi',
  fnb_cost_pct: 'F&B cost su ricavi',
  lavoro_pct: 'Costo del lavoro su ricavi',
  utenze_pct: 'Costo energetico su ricavi',
}

function UsaliKpiConfig() {
  const [config, setConfig] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    api.get('/usali/kpi-config').then(r => setConfig(r.data)).catch(e => alert(mostraErrore(e)))
  }, [])

  function aggiornaRange(tipo, kpiCode, campo, valore) {
    setConfig(prev => ({
      ...prev,
      [tipo]: {
        ...prev[tipo],
        [kpiCode]: { ...prev[tipo][kpiCode], [campo]: valore },
      },
    }))
  }

  async function salva() {
    setSalvando(true)
    setMsg(null)
    try {
      await api.put('/usali/kpi-config', config)
      setMsg({ tipo: 'ok', testo: 'Range KPI salvati.' })
    } catch (e) {
      setMsg({ tipo: 'err', testo: mostraErrore(e) })
    } finally {
      setSalvando(false)
    }
  }

  if (!config) return <div style={{ padding: 24, color: '#94a3b8' }}>Caricamento…</div>

  const tipi = [
    { id: 'hotel', label: 'Hotel (DPH / CLB / INT)' },
    { id: 'ristoranti', label: 'Ristoranti (MMS / BON)' },
  ]

  return (
    <div style={{ maxWidth: 680 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Range KPI USALI</h3>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
        I range definiscono la zona verde (●) del semaforo nella pagina USALI.
        Sotto il minimo → arancione; sopra il massimo → rosso.
      </p>

      {tipi.map(({ id, label }) => (
        <div key={id} style={{ marginBottom: 24, border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ background: '#334155', color: '#fff', padding: '8px 14px', fontWeight: 600, fontSize: 13 }}>
            {label}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>KPI</th>
                <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, color: '#374151', width: 100 }}>Min %</th>
                <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, color: '#374151', width: 100 }}>Max %</th>
                <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, color: '#94a3b8', width: 90 }}>Range</th>
              </tr>
            </thead>
            <tbody>
              {KPI_CODES.map((kpiCode, vi) => {
                const rng = config[id]?.[kpiCode] ?? { lo: 0, hi: 0 }
                return (
                  <tr key={kpiCode} style={{ background: vi % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '6px 14px', color: '#374151' }}>{KPI_LABELS[kpiCode]}</td>
                    <td style={{ padding: '4px 10px', textAlign: 'center' }}>
                      <input
                        type="number" min={0} max={100} step={0.5}
                        value={rng.lo ?? ''}
                        onChange={e => aggiornaRange(id, kpiCode, 'lo', parseFloat(e.target.value))}
                        style={{ width: 70, textAlign: 'center', padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
                      />
                    </td>
                    <td style={{ padding: '4px 10px', textAlign: 'center' }}>
                      <input
                        type="number" min={0} max={100} step={0.5}
                        value={rng.hi ?? ''}
                        onChange={e => aggiornaRange(id, kpiCode, 'hi', parseFloat(e.target.value))}
                        style={{ width: 70, textAlign: 'center', padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
                      />
                    </td>
                    <td style={{ padding: '4px 10px', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
                      {rng.lo}% – {rng.hi}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={salva}
          disabled={salvando}
          style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          {salvando ? 'Salvataggio…' : 'Salva range'}
        </button>
        {msg && (
          <span style={{ fontSize: 13, color: msg.tipo === 'ok' ? '#16a34a' : '#dc2626' }}>
            {msg.testo}
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Debug & diagnostica
// ---------------------------------------------------------------------------

function SistemaDebug() {
  const [debugOn, setDebugOn] = useState(
    () => localStorage.getItem('debug_errori') === 'true'
  )

  function toggleDebug() {
    const nuovo = !debugOn
    localStorage.setItem('debug_errori', nuovo ? 'true' : 'false')
    setDebugOn(nuovo)
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 24px', fontSize: 20, fontWeight: 700, color: '#1e3a5f' }}>
        Debug & diagnostica
      </h2>

      <div style={{
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
        padding: '20px 24px', maxWidth: 520,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Toggle */}
          <button
            onClick={toggleDebug}
            style={{
              width: 52, height: 28, borderRadius: 14, border: 'none',
              cursor: 'pointer', padding: 0,
              background: debugOn ? '#16a34a' : '#cbd5e1',
              position: 'relative', transition: 'background 0.2s',
              flexShrink: 0,
            }}
            title={debugOn ? 'Disattiva modalità debug' : 'Attiva modalità debug'}
          >
            <span style={{
              display: 'block', width: 22, height: 22, borderRadius: '50%',
              background: '#fff', position: 'absolute',
              top: 3, left: debugOn ? 27 : 3,
              transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </button>
          <div>
            <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 15 }}>
              Modalità debug errori
              {debugOn && (
                <span style={{
                  marginLeft: 10, fontSize: 11, fontWeight: 700,
                  background: '#dcfce7', color: '#15803d',
                  padding: '2px 8px', borderRadius: 99,
                }}>
                  ATTIVA
                </span>
              )}
            </div>
            <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>
              {debugOn
                ? 'I messaggi di errore mostrano il dettaglio completo del backend (stack trace, SQL).'
                : 'I messaggi di errore mostrano solo il testo breve senza dettagli tecnici.'}
            </div>
          </div>
        </div>

        <div style={{
          marginTop: 16, padding: '10px 14px',
          background: debugOn ? '#fef9c3' : '#f8fafc',
          border: `1px solid ${debugOn ? '#fde047' : '#e2e8f0'}`,
          borderRadius: 8, fontSize: 12, color: '#64748b',
        }}>
          <strong>Nota:</strong> questa impostazione è salvata nel browser (localStorage).
          È attiva solo su questo dispositivo e viene mantenuta tra le sessioni.
          Disattivare prima di condividere lo schermo con utenti finali.
        </div>
      </div>
    </div>
  )
}
