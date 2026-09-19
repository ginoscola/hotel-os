import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api/client.js'
import { formatEuro, formatPerc, formatDataIt, mostraErrore } from '../utils/format.js'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import pastReferenceArea from '../components/PastReferenceArea.jsx'
import { isAdmin } from '../utils/auth.js'

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const MESI_LABEL = [
  'Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
  'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre',
]

// ---------------------------------------------------------------------------
// Componente principale
// ---------------------------------------------------------------------------

export default function Forecast() {
  const [tabAttiva, setTabAttiva] = useState('riepilogo')
  const [anno, setAnno] = useState(new Date().getFullYear())
  const [hotelSelezionato, setHotelSelezionato] = useState('all')
  const [hotels, setHotels] = useState([])
  const [datiRiepilogo, setDatiRiepilogo] = useState(null)
  const [caricando, setCaricando] = useState(false)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    api.get('/hotels/').then(r => setHotels(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (tabAttiva === 'riepilogo') caricaSummary()
  }, [anno, hotelSelezionato, tabAttiva])

  async function caricaSummary() {
    setCaricando(true)
    setErrore(null)
    try {
      const r = await api.get('/forecast/summary', {
        params: { anno, hotel_code: hotelSelezionato },
      })
      setDatiRiepilogo(r.data)
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore nel caricamento dati'))
    } finally {
      setCaricando(false)
    }
  }

  const stileTab = (t) => ({
    padding: '0.55rem 1.2rem',
    border: 'none',
    borderBottom: tabAttiva === t ? '3px solid #8B5CF6' : '3px solid transparent',
    background: 'none',
    cursor: 'pointer',
    fontWeight: tabAttiva === t ? 700 : 400,
    color: tabAttiva === t ? '#8B5CF6' : '#555',
    fontSize: '0.95rem',
    transition: 'all 0.15s',
  })

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.2rem', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', color: '#1a1a2e' }}>📈 Forecast & OTB</h1>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={anno} onChange={e => setAnno(Number(e.target.value))} style={stileSelect}>
            {[2024, 2025, 2026, 2027].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={hotelSelezionato} onChange={e => setHotelSelezionato(e.target.value)} style={stileSelect}>
            <option value="all">Tutti gli hotel</option>
            {hotels.map(h => <option key={h.code} value={h.code}>{h.name}</option>)}
          </select>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ borderBottom: '1px solid #e5e7eb', marginBottom: '1.4rem', display: 'flex' }}>
        <button style={stileTab('riepilogo')} onClick={() => setTabAttiva('riepilogo')}>Riepilogo Stagione</button>
        <button style={stileTab('pace')} onClick={() => setTabAttiva('pace')}>Pace Chart</button>
        <button style={stileTab('maturato')} onClick={() => setTabAttiva('maturato')}>Maturato</button>
        <button style={stileTab('cancellazioni')} onClick={() => setTabAttiva('cancellazioni')}>Cancellazioni</button>
        <button style={stileTab('importa-cancellazioni')} onClick={() => setTabAttiva('importa-cancellazioni')}>Importa Cancellazioni Welcome</button>
      </div>

      {tabAttiva === 'riepilogo' && (
        <TabRiepilogo
          dati={datiRiepilogo}
          caricando={caricando}
          errore={errore}
          anno={anno}
          hotelCode={hotelSelezionato}
          hotels={hotels}
          onAggiornato={caricaSummary}
        />
      )}
      {tabAttiva === 'pace' && (
        <TabPace
          anno={anno}
          hotels={hotels}
          hotelIniziale={hotelSelezionato !== 'all' ? hotelSelezionato : ''}
        />
      )}
      {tabAttiva === 'maturato' && (
        <TabMaturato
          anno={anno}
          hotels={hotels}
          hotelSelezionato={hotelSelezionato}
          onAggiornato={caricaSummary}
        />
      )}
      {tabAttiva === 'cancellazioni' && (
        <TabCancellazioni anno={anno} hotelCode={hotelSelezionato} hotels={hotels} />
      )}
      {tabAttiva === 'importa-cancellazioni' && <TabImportaCancellazioni />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 1 — Riepilogo Stagione
// ---------------------------------------------------------------------------

function TabRiepilogo({ dati, caricando, errore, anno, hotelCode, hotels, onAggiornato }) {
  const [editCell, setEditCell] = useState(null)   // { mese, campo: 'budget'|'pickup' }
  const [editVal, setEditVal] = useState('')
  const [salvataggio, setSalvataggio] = useState({})
  const inputRef = useRef(null)

  useEffect(() => {
    if (editCell && inputRef.current) inputRef.current.focus()
  }, [editCell])

  const isSingle = hotelCode !== 'all'

  function apriEdit(mese, campo, valoreCorrente) {
    if (!isSingle) return
    setEditCell({ mese, campo })
    setEditVal(valoreCorrente != null ? String(valoreCorrente) : '')
  }

  async function salva(mese, campo) {
    const valore = parseFloat(String(editVal).replace(',', '.'))
    if (isNaN(valore)) { setEditCell(null); return }
    setSalvataggio(s => ({ ...s, [mese]: 'saving' }))
    setEditCell(null)
    try {
      if (campo === 'budget') {
        await api.put('/forecast/budget', { hotel_code: hotelCode, anno, mese, budget_revenue: valore })
      } else {
        await api.put('/forecast/pickup-config', { hotel_code: hotelCode, anno, mese, pickup_rate: valore / 100 })
      }
      setSalvataggio(s => ({ ...s, [mese]: 'ok' }))
      setTimeout(() => setSalvataggio(s => { const c = { ...s }; delete c[mese]; return c }), 2000)
      onAggiornato()
    } catch {
      setSalvataggio(s => ({ ...s, [mese]: 'err' }))
      setTimeout(() => setSalvataggio(s => { const c = { ...s }; delete c[mese]; return c }), 3000)
    }
  }

  function handleKeyDown(e, mese, campo) {
    if (e.key === 'Enter') salva(mese, campo)
    if (e.key === 'Escape') setEditCell(null)
  }

  function badgeDelta(pct) {
    if (pct == null) return null
    const pos = pct >= 0
    return (
      <span style={{
        fontSize: '0.75rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4,
        background: pos ? '#dcfce7' : '#fee2e2', color: pos ? '#166534' : '#991b1b',
      }}>
        {pos ? '+' : ''}{pct.toFixed(1)}%
      </span>
    )
  }

  if (caricando) return <Caricamento />
  if (errore) return <Errore msg={errore} />
  if (!dati) return null

  return (
    <div>
      {!isSingle && (
        <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '0.8rem' }}>
          Vista consolidata — seleziona un hotel per modificare Budget e Pickup%
        </p>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.87rem' }}>
          <thead>
            <tr style={{ background: '#1e3a5f', color: '#fff' }}>
              <Th>Mese</Th>
              <Th align="right">OTB Rev.</Th>
              <Th align="center" title="Data dell'ultimo upload Revenue">Snapshot</Th>
              <Th align="right" title="Maturato manuale inserito (override OTB)">Maturato</Th>
              <Th align="center" title="Clicca per modificare (solo singolo hotel)">{isSingle ? 'Pickup % ✏' : 'Pickup %'}</Th>
              <Th align="right">Forecast</Th>
              <Th align="center">{isSingle ? 'Budget ✏' : 'Budget'}</Th>
              <Th align="right">Consuntivo</Th>
              <Th align="center">Delta</Th>
            </tr>
          </thead>
          <tbody>
            {dati.mesi.map(r => {
              const bg = r.is_past ? '#f8fafc' : '#fff'
              const stato = salvataggio[r.mese]
              const hasMaturato = r.maturato_revenue != null

              return (
                <tr key={r.mese} style={{ background: bg, borderBottom: '1px solid #e5e7eb' }}>
                  {/* Mese */}
                  <td style={{ ...stCella, fontWeight: 600, color: r.is_past ? '#9ca3af' : '#1a1a2e' }}>
                    {r.mese_label}
                    {r.is_past && <span style={{ marginLeft: 4, fontSize: '0.68rem', color: '#d1d5db' }}>●</span>}
                  </td>

                  {/* OTB */}
                  <td style={{ ...stCella, textAlign: 'right', color: r.is_past ? '#9ca3af' : '#374151' }}>
                    {r.otb_revenue != null ? formatEuro(r.otb_revenue) : '—'}
                  </td>

                  {/* Snapshot date */}
                  <td style={{ ...stCella, textAlign: 'center', fontSize: '0.78rem', color: '#9ca3af' }}>
                    {r.otb_snapshot_date ? formatDataIt(r.otb_snapshot_date) : '—'}
                  </td>

                  {/* Maturato */}
                  <td style={{ ...stCella, textAlign: 'right' }}>
                    {hasMaturato ? (
                      <span style={{ color: '#7c3aed', fontWeight: 600 }} title={r.maturato_al ? `al ${formatDataIt(r.maturato_al)}` : ''}>
                        {formatEuro(r.maturato_revenue)}
                        {r.maturato_al && (
                          <span style={{ fontSize: '0.72rem', color: '#a78bfa', marginLeft: 4 }}>
                            al {formatDataIt(r.maturato_al)}
                          </span>
                        )}
                      </span>
                    ) : <span style={{ color: '#d1d5db' }}>—</span>}
                  </td>

                  {/* Pickup % */}
                  <td style={{ ...stCella, textAlign: 'center' }}>
                    {editCell?.mese === r.mese && editCell.campo === 'pickup' ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                        <input
                          ref={inputRef}
                          value={editVal}
                          onChange={e => setEditVal(e.target.value)}
                          onBlur={() => salva(r.mese, 'pickup')}
                          onKeyDown={e => handleKeyDown(e, r.mese, 'pickup')}
                          style={{ width: 58, padding: '2px 4px', border: '1px solid #8B5CF6', borderRadius: 4, fontSize: '0.85rem' }}
                        />
                        <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>%</span>
                      </span>
                    ) : (
                      <span
                        onClick={() => apriEdit(r.mese, 'pickup', r.pickup_rate != null ? r.pickup_rate * 100 : null)}
                        style={{ cursor: isSingle ? 'pointer' : 'default', color: r.pickup_rate != null ? '#7c3aed' : '#d1d5db' }}
                        title={isSingle ? 'Clicca per modificare' : ''}
                      >
                        {r.pickup_rate != null ? `+${(r.pickup_rate * 100).toFixed(1)}%` : '—'}
                      </span>
                    )}
                  </td>

                  {/* Forecast */}
                  <td style={{ ...stCella, textAlign: 'right', fontWeight: r.forecast_revenue != null ? 600 : 400 }}>
                    {r.forecast_revenue != null ? (
                      <span style={{ color: hasMaturato ? '#7c3aed' : '#1e3a5f' }}>
                        {formatEuro(r.forecast_revenue)}
                      </span>
                    ) : '—'}
                  </td>

                  {/* Budget */}
                  <td style={{ ...stCella, textAlign: 'center' }}>
                    {editCell?.mese === r.mese && editCell.campo === 'budget' ? (
                      <input
                        ref={inputRef}
                        value={editVal}
                        onChange={e => setEditVal(e.target.value)}
                        onBlur={() => salva(r.mese, 'budget')}
                        onKeyDown={e => handleKeyDown(e, r.mese, 'budget')}
                        style={{ width: 100, padding: '2px 4px', border: '1px solid #8B5CF6', borderRadius: 4, fontSize: '0.85rem' }}
                      />
                    ) : (
                      <span
                        onClick={() => apriEdit(r.mese, 'budget', r.budget_revenue)}
                        style={{ cursor: isSingle ? 'pointer' : 'default', color: r.budget_revenue != null ? '#374151' : '#d1d5db' }}
                        title={isSingle ? 'Clicca per modificare' : ''}
                      >
                        {r.budget_revenue != null ? formatEuro(r.budget_revenue) : '—'}
                      </span>
                    )}
                    {stato === 'saving' && <span style={{ marginLeft: 4, color: '#9ca3af', fontSize: '0.7rem' }}>⟳</span>}
                    {stato === 'ok' && <span style={{ marginLeft: 4, color: '#16a34a', fontSize: '0.7rem' }}>✓</span>}
                    {stato === 'err' && <span style={{ marginLeft: 4, color: '#dc2626', fontSize: '0.7rem' }}>✗</span>}
                  </td>

                  {/* Consuntivo */}
                  <td style={{ ...stCella, textAlign: 'right' }}>
                    {r.consuntivo_revenue != null
                      ? <strong style={{ color: '#065f46' }}>{formatEuro(r.consuntivo_revenue)}</strong>
                      : <span style={{ color: '#d1d5db' }}>—</span>}
                  </td>

                  {/* Delta */}
                  <td style={{ ...stCella, textAlign: 'center' }}>{badgeDelta(r.delta_pct)}</td>
                </tr>
              )
            })}

            {/* Riga totale */}
            <tr className="riga-totale" style={{ background: '#1e3a5f', color: '#fff', fontWeight: 700 }}>
              <td style={stCellaHeader}>Totale stagione</td>
              <td style={{ ...stCellaHeader, textAlign: 'right' }}>{dati.totale_otb != null ? formatEuro(dati.totale_otb) : '—'}</td>
              <td style={stCellaHeader}></td>
              <td style={stCellaHeader}></td>
              <td style={stCellaHeader}></td>
              <td style={{ ...stCellaHeader, textAlign: 'right' }}>{dati.totale_forecast != null ? formatEuro(dati.totale_forecast) : '—'}</td>
              <td style={{ ...stCellaHeader, textAlign: 'center' }}>{dati.totale_budget != null ? formatEuro(dati.totale_budget) : '—'}</td>
              <td style={{ ...stCellaHeader, textAlign: 'right' }}>{dati.totale_consuntivo != null ? formatEuro(dati.totale_consuntivo) : '—'}</td>
              <td style={stCellaHeader}>
                {dati.totale_budget > 0 && (dati.totale_consuntivo || dati.totale_forecast) && (() => {
                  const v = dati.totale_consuntivo || dati.totale_forecast
                  const pct = ((v - dati.totale_budget) / dati.totale_budget) * 100
                  return (
                    <span style={{ color: pct >= 0 ? '#86efac' : '#fca5a5', fontSize: '0.82rem' }}>
                      {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                    </span>
                  )
                })()}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '0.6rem', fontSize: '0.78rem', color: '#9ca3af', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        <span>● Mesi passati — Consuntivo reale da modulo Revenue</span>
        <span style={{ color: '#7c3aed' }}>■ Forecast in viola = calcolato su Maturato manuale</span>
        {isSingle && <span>✏ Clicca su Budget o Pickup% per modificare — Invio per salvare</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 2 — Pace Chart
// ---------------------------------------------------------------------------

function TabPace({ anno, hotels, hotelIniziale }) {
  const [hotelPace, setHotelPace] = useState(hotelIniziale || '')
  const [mesePace, setMesePace] = useState(new Date().getMonth() + 1)
  const [datiPace, setDatiPace] = useState(null)
  const [caricando, setCaricando] = useState(false)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    if (hotelPace) caricaPace()
  }, [hotelPace, mesePace, anno])

  async function caricaPace() {
    if (!hotelPace) return
    setCaricando(true)
    setErrore(null)
    try {
      const r = await api.get('/forecast/pace', { params: { anno, mese: mesePace, hotel_code: hotelPace } })
      setDatiPace(r.data)
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore nel caricamento'))
      setDatiPace(null)
    } finally {
      setCaricando(false)
    }
  }

  const punti = datiPace?.punti || []
  const datiGrafico = punti.map(p => ({ data: formatDataIt(p.snapshot_date), otb: p.otb_revenue }))

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.8rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={stileLabel}>Hotel</label>
        <select value={hotelPace} onChange={e => setHotelPace(e.target.value)} style={stileSelect}>
          <option value="">— seleziona —</option>
          {hotels.map(h => <option key={h.code} value={h.code}>{h.name}</option>)}
        </select>
        <label style={stileLabel}>Mese target</label>
        <select value={mesePace} onChange={e => setMesePace(Number(e.target.value))} style={stileSelect}>
          {MESI_LABEL.map((nome, i) => <option key={i + 1} value={i + 1}>{nome}</option>)}
        </select>
      </div>

      {!hotelPace && (
        <div style={{ color: '#6b7280', textAlign: 'center', padding: '3rem' }}>
          Seleziona un hotel per visualizzare il Pace Chart
        </div>
      )}

      {caricando && <Caricamento />}
      {errore && <Errore msg={errore} />}

      {datiPace && !caricando && (
        <>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <CardKpi titolo="OTB attuale" valore={punti.length ? formatEuro(punti[punti.length - 1].otb_revenue) : '—'} colore="#8B5CF6" />
            <CardKpi
              titolo={datiPace.maturato_revenue != null ? `Maturato al ${formatDataIt(datiPace.maturato_al)}` : 'Maturato manuale'}
              valore={datiPace.maturato_revenue != null ? formatEuro(datiPace.maturato_revenue) : 'non inserito'}
              colore="#7c3aed"
            />
            <CardKpi
              titolo={`Forecast${datiPace.pickup_rate != null ? ` (pickup +${(datiPace.pickup_rate * 100).toFixed(0)}%)` : ''}`}
              valore={datiPace.forecast_revenue != null ? formatEuro(datiPace.forecast_revenue) : '—'}
              colore="#1e3a5f"
            />
            <CardKpi titolo="Budget" valore={datiPace.budget_revenue != null ? formatEuro(datiPace.budget_revenue) : 'non impostato'} colore="#374151" />
          </div>

          {punti.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#6b7280', padding: '3rem', background: '#f9fafb', borderRadius: 10 }}>
              Nessun dato OTB per {MESI_LABEL[mesePace - 1]} {anno}.<br />
              <span style={{ fontSize: '0.85rem' }}>I dati provengono dagli upload settimanali del modulo Revenue.</span>
            </div>
          ) : (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '1.2rem' }}>
              <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#374151' }}>
                Crescita OTB — {datiPace.mese_label} {anno} · {datiPace.hotel_code}
              </h3>
              <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: '#9ca3af' }}>
                Ogni punto = un upload settimanale del modulo Revenue
              </p>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={datiGrafico} margin={{ top: 5, right: 40, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="data" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11 }} width={55} />
                  <Tooltip formatter={v => formatEuro(v)} labelFormatter={l => `Upload del ${l}`} />
                  <Legend />
                  {pastReferenceArea(datiGrafico, 'data')}
                  <Line type="monotone" dataKey="otb" name="OTB Revenue" stroke="#8B5CF6" strokeWidth={2.5} dot={{ r: 5 }} activeDot={{ r: 7 }} />
                  {datiPace.budget_revenue != null && (
                    <ReferenceLine y={datiPace.budget_revenue} stroke="#374151" strokeDasharray="6 3"
                      label={{ value: `Budget ${formatEuro(datiPace.budget_revenue)}`, position: 'insideTopRight', fontSize: 11, fill: '#374151' }} />
                  )}
                  {datiPace.maturato_revenue != null && (
                    <ReferenceLine y={datiPace.maturato_revenue} stroke="#7c3aed" strokeDasharray="4 4"
                      label={{ value: `Maturato ${formatEuro(datiPace.maturato_revenue)}`, position: 'insideBottomRight', fontSize: 11, fill: '#7c3aed' }} />
                  )}
                  {datiPace.forecast_revenue != null && datiPace.pickup_rate != null && (
                    <ReferenceLine y={datiPace.forecast_revenue} stroke="#1e3a5f" strokeDasharray="4 4"
                      label={{ value: `Forecast ${formatEuro(datiPace.forecast_revenue)}`, position: 'insideTopLeft', fontSize: 11, fill: '#1e3a5f' }} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 3 — Maturato manuale
// ---------------------------------------------------------------------------

function TabMaturato({ anno, hotels, hotelSelezionato, onAggiornato }) {
  // Form inserimento
  const [formHotel, setFormHotel] = useState(hotelSelezionato !== 'all' ? hotelSelezionato : '')
  const [formMese, setFormMese] = useState(new Date().getMonth() + 1)
  const [formData, setFormData] = useState(new Date().toISOString().slice(0, 10))
  const [formRevenue, setFormRevenue] = useState('')
  const [formRoomNights, setFormRoomNights] = useState('')
  const [formNote, setFormNote] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [esito, setEsito] = useState(null)   // { ok, msg }

  // Lista maturati inseriti
  const [lista, setLista] = useState([])
  const [eliminando, setEliminando] = useState(null)

  const caricaLista = useCallback(async () => {
    try {
      const r = await api.get('/forecast/maturato', {
        params: { anno, hotel_code: hotelSelezionato },
      })
      setLista(r.data)
    } catch {}
  }, [anno, hotelSelezionato])

  useEffect(() => { caricaLista() }, [caricaLista])

  async function handleSalva(e) {
    e.preventDefault()
    const revenue = parseFloat(String(formRevenue).replace(',', '.'))
    if (!formHotel || isNaN(revenue) || !formData) return
    setSalvando(true)
    setEsito(null)
    try {
      const r = await api.put('/forecast/maturato', {
        hotel_code: formHotel,
        anno,
        mese: formMese,
        data_riferimento: formData,
        maturato_revenue: revenue,
        maturato_room_nights: formRoomNights ? parseInt(formRoomNights) : null,
        note: formNote || null,
      })
      setEsito({ ok: true, msg: `Salvato: ${r.data.mese_label} ${anno} · ${formatEuro(r.data.maturato_revenue)} al ${formatDataIt(r.data.data_riferimento)}` })
      setFormRevenue('')
      setFormRoomNights('')
      setFormNote('')
      caricaLista()
      onAggiornato()
    } catch (err) {
      setEsito({ ok: false, msg: err.response?.data?.detail || 'Errore durante il salvataggio' })
    } finally {
      setSalvando(false)
    }
  }

  async function handleElimina(id) {
    if (!window.confirm('Eliminare questo record maturato?')) return
    setEliminando(id)
    try {
      await api.delete(`/forecast/maturato/${id}`)
      caricaLista()
      onAggiornato()
    } catch (err) {
      alert(err.response?.data?.detail || 'Errore durante l\'eliminazione')
    } finally {
      setEliminando(null)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '2.5rem' }}>

      {/* Form inserimento */}
      <div>
        <h3 style={{ margin: '0 0 1.2rem', fontSize: '1.05rem', color: '#374151' }}>Inserisci maturato</h3>
        <p style={{ margin: '0 0 1.2rem', fontSize: '0.83rem', color: '#6b7280', lineHeight: 1.5 }}>
          Il maturato è la revenue confermata su un mese fino alla data indicata.
          Sostituisce l'OTB calcolato automaticamente nel calcolo del forecast.
        </p>

        <form onSubmit={handleSalva} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {/* Hotel */}
          <div>
            <label style={stileLabel}>Hotel *</label>
            <select value={formHotel} onChange={e => setFormHotel(e.target.value)} style={{ ...stileSelect, width: '100%' }} required>
              <option value="">— seleziona —</option>
              {hotels.map(h => <option key={h.code} value={h.code}>{h.name}</option>)}
            </select>
          </div>

          {/* Mese */}
          <div>
            <label style={stileLabel}>Mese *</label>
            <select value={formMese} onChange={e => setFormMese(Number(e.target.value))} style={{ ...stileSelect, width: '100%' }}>
              {MESI_LABEL.map((nome, i) => <option key={i + 1} value={i + 1}>{nome}</option>)}
            </select>
          </div>

          {/* Data riferimento */}
          <div>
            <label style={stileLabel}>Al giorno *</label>
            <input
              type="date"
              value={formData}
              onChange={e => setFormData(e.target.value)}
              required
              style={{ ...stileSelect, width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          {/* Revenue */}
          <div>
            <label style={stileLabel}>Revenue maturata (€) *</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="es. 45000.00"
              value={formRevenue}
              onChange={e => setFormRevenue(e.target.value)}
              required
              style={{ ...stileSelect, width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          {/* Room nights (opzionale) */}
          <div>
            <label style={stileLabel}>Room nights (opzionale)</label>
            <input
              type="number"
              min="0"
              placeholder="es. 312"
              value={formRoomNights}
              onChange={e => setFormRoomNights(e.target.value)}
              style={{ ...stileSelect, width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          {/* Note */}
          <div>
            <label style={stileLabel}>Note (opzionale)</label>
            <textarea
              rows={2}
              value={formNote}
              onChange={e => setFormNote(e.target.value)}
              placeholder="es. Dato estratto dal PMS il 10/06"
              style={{ ...stileSelect, width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          <button
            type="submit"
            disabled={salvando || !formHotel || !formRevenue}
            style={{
              padding: '0.65rem',
              background: salvando || !formHotel || !formRevenue ? '#d1d5db' : '#8B5CF6',
              color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
              fontWeight: 700, fontSize: '0.95rem',
            }}
          >
            {salvando ? 'Salvataggio…' : 'Salva maturato'}
          </button>
        </form>

        {esito && (
          <div style={{
            marginTop: '0.8rem', padding: '0.7rem 1rem', borderRadius: 8, fontSize: '0.87rem',
            background: esito.ok ? '#dcfce7' : '#fee2e2',
            color: esito.ok ? '#166534' : '#991b1b',
          }}>
            {esito.ok ? '✓ ' : '✗ '}{esito.msg}
          </div>
        )}
      </div>

      {/* Lista maturati */}
      <div>
        <h3 style={{ margin: '0 0 1.2rem', fontSize: '1.05rem', color: '#374151' }}>
          Maturati inseriti — {anno}
        </h3>

        {lista.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '0.88rem' }}>
            Nessun maturato inserito per {anno}.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.87rem' }}>
            <thead>
              <tr style={{ background: '#f3f4f6', color: '#374151' }}>
                <Th>Hotel</Th>
                <Th>Mese</Th>
                <Th align="center">Al giorno</Th>
                <Th align="right">Revenue</Th>
                <Th align="right">RN</Th>
                <Th>Note</Th>
                <Th align="center">Azioni</Th>
              </tr>
            </thead>
            <tbody>
              {lista.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ ...stCella, fontWeight: 600 }}>
                    <span style={{ background: '#ede9fe', color: '#7c3aed', padding: '2px 7px', borderRadius: 4, fontSize: '0.8rem' }}>
                      {r.hotel_code}
                    </span>
                  </td>
                  <td style={stCella}>{r.mese_label}</td>
                  <td style={{ ...stCella, textAlign: 'center', fontSize: '0.82rem', color: '#6b7280' }}>
                    {formatDataIt(r.data_riferimento)}
                  </td>
                  <td style={{ ...stCella, textAlign: 'right', fontWeight: 700, color: '#7c3aed' }}>
                    {formatEuro(r.maturato_revenue)}
                  </td>
                  <td style={{ ...stCella, textAlign: 'right', color: '#6b7280' }}>
                    {r.maturato_room_nights ?? '—'}
                  </td>
                  <td style={{ ...stCella, fontSize: '0.8rem', color: '#9ca3af', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.note || '—'}
                  </td>
                  <td style={{ ...stCella, textAlign: 'center' }}>
                    <button
                      onClick={() => handleElimina(r.id)}
                      disabled={eliminando === r.id}
                      style={{ border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                      {eliminando === r.id ? '…' : '🗑'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#9ca3af' }}>
          Il maturato sovrascrive l'OTB calcolato da daily_revenue nel tab Riepilogo.
          Inserendo un nuovo valore per lo stesso hotel/mese si aggiorna il precedente.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 4 — Cancellazioni (import Welcome)
// ---------------------------------------------------------------------------

function TabCancellazioni({ anno, hotelCode, hotels }) {
  const [hotelFiltro, setHotelFiltro] = useState(hotelCode || 'all')
  const [canaliDisponibili, setCanaliDisponibili] = useState([])
  const [canaliSelezionati, setCanaliSelezionati] = useState([])
  const [arrivoDa, setArrivoDa] = useState('')
  const [arrivoA, setArrivoA] = useState('')
  const [prenotazioneDa, setPrenotazioneDa] = useState('')
  const [prenotazioneA, setPrenotazioneA] = useState('')
  const [ricercaInput, setRicercaInput] = useState('')
  const [ricerca, setRicerca] = useState('')

  const [dati, setDati] = useState(null)
  const [righe, setRighe] = useState(null)
  const [pagina, setPagina] = useState(1)
  const [errore, setErrore] = useState(null)
  const [caricandoDati, setCaricandoDati] = useState(false)
  const [rigaInModifica, setRigaInModifica] = useState(null)
  const [eliminandoId, setEliminandoId] = useState(null)
  const [ordinaPer, setOrdinaPer] = useState('data_prenotazione')
  const [direzione, setDirezione] = useState('desc')
  const [vistaPeriodo, setVistaPeriodo] = useState(() => localStorage.getItem('cancellazioni_vista_periodo') || 'mensile')
  const [vistaMetrica, setVistaMetrica] = useState(() => localStorage.getItem('cancellazioni_vista_metrica') || 'prenotazioni')

  useEffect(() => {
    localStorage.setItem('cancellazioni_vista_periodo', vistaPeriodo)
  }, [vistaPeriodo])

  useEffect(() => {
    localStorage.setItem('cancellazioni_vista_metrica', vistaMetrica)
  }, [vistaMetrica])

  function ordinaColonna(campo) {
    if (ordinaPer === campo) {
      setDirezione(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setOrdinaPer(campo)
      setDirezione('asc')
    }
  }

  // Debounce della ricerca libera: evita una richiesta per ogni carattere digitato.
  useEffect(() => {
    const t = setTimeout(() => setRicerca(ricercaInput), 400)
    return () => clearTimeout(t)
  }, [ricercaInput])

  // Elenco canali disponibili — NON dipende dai canali selezionati, altrimenti la lista di
  // checkbox si restringerebbe da sola man mano che se ne selezionano.
  useEffect(() => {
    api.get('/prenotazioni-cancellate/canali', {
      params: { anno, hotel_code: hotelFiltro, arrivo_da: arrivoDa || undefined, arrivo_a: arrivoA || undefined, prenotazione_da: prenotazioneDa || undefined, prenotazione_a: prenotazioneA || undefined },
    }).then(r => setCanaliDisponibili(r.data.canali)).catch(() => {})
  }, [anno, hotelFiltro, arrivoDa, arrivoA, prenotazioneDa, prenotazioneA])

  const paramsFiltri = {
    anno,
    hotel_code: hotelFiltro,
    canali: canaliSelezionati.length ? canaliSelezionati.join(',') : undefined,
    arrivo_da: arrivoDa || undefined,
    arrivo_a: arrivoA || undefined,
    prenotazione_da: prenotazioneDa || undefined,
    prenotazione_a: prenotazioneA || undefined,
  }

  const caricaReport = useCallback(async () => {
    setCaricandoDati(true)
    setErrore(null)
    try {
      const r = await api.get('/prenotazioni-cancellate/report', { params: paramsFiltri })
      setDati(r.data)
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore nel caricamento'))
      setDati(null)
    } finally {
      setCaricandoDati(false)
    }
  }, [anno, hotelFiltro, canaliSelezionati, arrivoDa, arrivoA, prenotazioneDa, prenotazioneA])

  const caricaRighe = useCallback(async () => {
    try {
      const r = await api.get('/prenotazioni-cancellate/', {
        params: { ...paramsFiltri, q: ricerca || undefined, ordina_per: ordinaPer, direzione, pagina, per_pagina: 20 },
      })
      setRighe(r.data)
    } catch {}
  }, [anno, hotelFiltro, canaliSelezionati, arrivoDa, arrivoA, prenotazioneDa, prenotazioneA, ricerca, ordinaPer, direzione, pagina])

  useEffect(() => { caricaReport() }, [caricaReport])
  useEffect(() => { caricaRighe() }, [caricaRighe])
  useEffect(() => { setPagina(1) }, [canaliSelezionati, arrivoDa, arrivoA, prenotazioneDa, prenotazioneA, anno, hotelFiltro, ricerca, ordinaPer, direzione])

  async function handleElimina(riga) {
    if (!window.confirm(`Eliminare definitivamente la prenotazione ${riga.numero_prenotazione || riga.id} (${riga.cliente || 'senza nome'}, ${riga.hotel_code})?`)) return
    setEliminandoId(riga.id)
    try {
      await api.delete(`/prenotazioni-cancellate/${riga.id}?conferma=true`)
      caricaRighe()
    } catch (e) {
      alert(mostraErrore(e))
    } finally {
      setEliminandoId(null)
    }
  }

  const datiGrafico = dati ? dati.per_mese.map(m => ({ mese: m.mese_label, n: m.n, importo: m.importo })) : []
  const datiGraficoArrivo = dati ? dati.per_mese_arrivo.map(m => ({ mese: m.mese_label, n: m.n, importo: m.importo })) : []
  const datiGraficoGiorno = dati ? dati.per_giorno.map(g => ({ giorno: g.data.slice(5), n: g.n, importo: g.importo })) : []
  const datiGraficoGiornoArrivo = dati ? dati.per_giorno_arrivo.map(g => ({ giorno: g.data.slice(5), n: g.n, importo: g.importo })) : []
  const giornaliero = vistaPeriodo === 'giornaliero'
  const fatturato = vistaMetrica === 'fatturato'
  const metricaKey = fatturato ? 'importo' : 'n'
  const metricaNome = fatturato ? 'Importo cancellato' : 'Camere cancellate'
  const metricaFormatter = v => fatturato ? formatEuro(v) : v

  return (
    <div>
      <p style={{ margin: '0 0 1.2rem', fontSize: '0.85rem', color: '#6b7280', lineHeight: 1.5 }}>
        Dato reale (una riga = una camera cancellata), da import manuale dell'export Welcome
        "PrenotazioniWeb" filtrato per mese di prenotazione — complementare alla stima nella tab
        "Cancellazioni". Limite noto: l'export non riporta la data di cancellazione, solo quella
        di prenotazione originale (a meno di non averla aggiunta a mano, vedi tab "Importa
        Cancellazioni Welcome").
      </p>

      <div style={{ display: 'flex', gap: '0.8rem', marginBottom: '1.2rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={stileLabel}>Struttura</label>
          <select value={hotelFiltro} onChange={e => setHotelFiltro(e.target.value)} style={stileSelect}>
            <option value="all">Tutti gli hotel</option>
            {hotels.map(h => <option key={h.code} value={h.code}>{h.name}</option>)}
          </select>
        </div>
        <div>
          <label style={stileLabel}>Canale</label>
          <select
            value={canaliSelezionati[0] || ''}
            onChange={e => setCanaliSelezionati(e.target.value ? [e.target.value] : [])}
            style={stileSelect}
          >
            <option value="">Tutti</option>
            {canaliDisponibili.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={stileLabel}>Arrivo da</label>
          <input type="date" value={arrivoDa} onChange={e => setArrivoDa(e.target.value)} style={stileSelect} />
        </div>
        <div>
          <label style={stileLabel}>Arrivo a</label>
          <input type="date" value={arrivoA} onChange={e => setArrivoA(e.target.value)} style={stileSelect} />
        </div>
        <div>
          <label style={stileLabel}>Prenotazione da</label>
          <input type="date" value={prenotazioneDa} onChange={e => setPrenotazioneDa(e.target.value)} style={stileSelect} />
        </div>
        <div>
          <label style={stileLabel}>Prenotazione a</label>
          <input type="date" value={prenotazioneA} onChange={e => setPrenotazioneA(e.target.value)} style={stileSelect} />
        </div>
      </div>

      {caricandoDati && <Caricamento />}
      {errore && <Errore msg={errore} />}

      {dati && !caricandoDati && (
        <>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <CardKpi titolo="Camere cancellate" valore={dati.totale_n} colore="#dc2626" />
            <CardKpi titolo="Importo cancellato" valore={formatEuro(dati.totale_importo)} colore="#dc2626" />
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', marginLeft: 'auto' }}>
              <div style={{ display: 'inline-flex', background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8, padding: 3 }}>
                <button onClick={() => setVistaPeriodo('mensile')} style={stileToggleBtn(vistaPeriodo === 'mensile')}>Mensile</button>
                <button onClick={() => setVistaPeriodo('giornaliero')} style={stileToggleBtn(vistaPeriodo === 'giornaliero')}>Giornaliero</button>
              </div>
              <div style={{ display: 'inline-flex', background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8, padding: 3 }}>
                <button onClick={() => setVistaMetrica('prenotazioni')} style={stileToggleBtn(vistaMetrica === 'prenotazioni')}>Prenotazioni</button>
                <button onClick={() => setVistaMetrica('fatturato')} style={stileToggleBtn(vistaMetrica === 'fatturato')}>Fatturato</button>
              </div>
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '1.2rem', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#374151' }}>
              Per {giornaliero ? 'giorno' : 'mese'} di prenotazione — {anno} · {dati.hotel_code}
            </h3>
            <ResponsiveContainer width="100%" height={280}>
              {giornaliero ? (
                <LineChart data={datiGraficoGiorno} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="giorno" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={20} />
                  <YAxis tick={{ fontSize: 11 }} width={fatturato ? 60 : 40} allowDecimals={false} />
                  <Tooltip formatter={metricaFormatter} />
                  <Legend />
                  <Line type="monotone" dataKey={metricaKey} name={metricaNome} stroke="#dc2626" strokeWidth={2} dot={false} />
                </LineChart>
              ) : (
                <BarChart data={datiGrafico} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={fatturato ? 60 : 40} allowDecimals={false} />
                  <Tooltip formatter={metricaFormatter} />
                  <Legend />
                  <Bar dataKey={metricaKey} name={metricaNome} fill="#dc2626" radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>

          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '1.2rem', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#374151' }}>
              Per {giornaliero ? 'giorno' : 'mese'} di arrivo — {anno} · {dati.hotel_code}
            </h3>
            <ResponsiveContainer width="100%" height={280}>
              {giornaliero ? (
                <LineChart data={datiGraficoGiornoArrivo} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="giorno" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={20} />
                  <YAxis tick={{ fontSize: 11 }} width={fatturato ? 60 : 40} allowDecimals={false} />
                  <Tooltip formatter={metricaFormatter} />
                  <Legend />
                  <Line type="monotone" dataKey={metricaKey} name={metricaNome} stroke="#b91c1c" strokeWidth={2} dot={false} />
                </LineChart>
              ) : (
                <BarChart data={datiGraficoArrivo} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={fatturato ? 60 : 40} allowDecimals={false} />
                  <Tooltip formatter={metricaFormatter} />
                  <Legend />
                  <Bar dataKey={metricaKey} name={metricaNome} fill="#b91c1c" radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
            <div>
              <h4 style={{ margin: '0 0 0.6rem', fontSize: '0.9rem', color: '#374151' }}>Per struttura</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead><tr style={{ background: '#f3f4f6' }}><Th>Hotel</Th><Th align="right">N.</Th><Th align="right">Importo</Th></tr></thead>
                <tbody>
                  {dati.per_hotel.map(h => (
                    <tr key={h.hotel_code} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={stCella}>{h.hotel_code}</td>
                      <td style={{ ...stCella, textAlign: 'right' }}>{h.n}</td>
                      <td style={{ ...stCella, textAlign: 'right' }}>{formatEuro(h.importo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h4 style={{ margin: '0 0 0.6rem', fontSize: '0.9rem', color: '#374151' }}>Per canale</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead><tr style={{ background: '#f3f4f6' }}><Th>Canale</Th><Th align="right">N.</Th><Th align="right">Importo</Th></tr></thead>
                <tbody>
                  {dati.per_canale.map(c => (
                    <tr key={c.canale} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={stCella}>{c.canale}</td>
                      <td style={{ ...stCella, textAlign: 'right' }}>{c.n}</td>
                      <td style={{ ...stCella, textAlign: 'right' }}>{formatEuro(c.importo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.6rem' }}>
            <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#374151' }}>Dettaglio prenotazioni cancellate</h4>
            <input
              type="text"
              placeholder="Cerca su tutti i campi (cliente, camera, codice, importo, data...)"
              value={ricercaInput}
              onChange={e => setRicercaInput(e.target.value)}
              style={{ ...stileSelect, minWidth: 320 }}
            />
          </div>
          {righe && (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: '#1e3a5f', color: '#fff' }}>
                    <ThOrd campo="hotel_code" ordinaPer={ordinaPer} direzione={direzione} onClick={ordinaColonna}>Hotel</ThOrd>
                    <ThOrd campo="canale" ordinaPer={ordinaPer} direzione={direzione} onClick={ordinaColonna}>Canale</ThOrd>
                    <ThOrd campo="numero_prenotazione" ordinaPer={ordinaPer} direzione={direzione} onClick={ordinaColonna}>Codice Prenotazione</ThOrd>
                    <ThOrd campo="data_prenotazione" align="center" ordinaPer={ordinaPer} direzione={direzione} onClick={ordinaColonna}>Data prenotazione</ThOrd>
                    <ThOrd campo="data_cancellazione" align="center" ordinaPer={ordinaPer} direzione={direzione} onClick={ordinaColonna}>Data cancellazione</ThOrd>
                    <ThOrd campo="arrivo" align="center" ordinaPer={ordinaPer} direzione={direzione} onClick={ordinaColonna}>Arrivo</ThOrd>
                    <ThOrd campo="partenza" align="center" ordinaPer={ordinaPer} direzione={direzione} onClick={ordinaColonna}>Partenza</ThOrd>
                    <ThOrd campo="cliente" ordinaPer={ordinaPer} direzione={direzione} onClick={ordinaColonna}>Cliente</ThOrd>
                    <ThOrd campo="tipo_camera" ordinaPer={ordinaPer} direzione={direzione} onClick={ordinaColonna}>Camera</ThOrd>
                    <ThOrd campo="importo" align="right" ordinaPer={ordinaPer} direzione={direzione} onClick={ordinaColonna}>Importo</ThOrd>
                    <Th align="center">Azioni</Th>
                  </tr>
                </thead>
                <tbody>
                  {righe.righe.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={stCella}>{r.hotel_code}</td>
                      <td style={stCella}>{r.canale}</td>
                      <td style={stCella}>
                        {r.numero_prenotazione || <span style={{ color: '#d1d5db' }}>—</span>}
                        {r.modificato_manualmente && (
                          <span title="Corretta manualmente — non verrà mai sovrascritta da un reimport" style={{ marginLeft: 5, fontSize: '0.75rem' }}>✏️</span>
                        )}
                      </td>
                      <td style={{ ...stCella, textAlign: 'center' }}>{formatDataIt(r.data_prenotazione)}</td>
                      <td style={{ ...stCella, textAlign: 'center' }}>
                        {r.data_cancellazione
                          ? formatDataIt(r.data_cancellazione)
                          : <span style={{ color: '#9ca3af' }} title="Data cancellazione non disponibile — mostrata la data in cui questa riga è stata rilevata per la prima volta da un import">
                              ~{formatDataIt(r.data_rilevata)}
                            </span>}
                      </td>
                      <td style={{ ...stCella, textAlign: 'center' }}>{formatDataIt(r.arrivo)}</td>
                      <td style={{ ...stCella, textAlign: 'center' }}>{formatDataIt(r.partenza)}</td>
                      <td style={stCella}>{r.cliente}</td>
                      <td style={stCella}>{r.tipo_camera}</td>
                      <td style={{ ...stCella, textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>{formatEuro(r.importo)}</td>
                      <td style={{ ...stCella, textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {isAdmin() && (
                          <>
                            <button
                              onClick={() => setRigaInModifica(r)}
                              style={{ border: '1px solid #d1d5db', background: '#fff', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: '0.8rem', marginRight: 4 }}
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleElimina(r)}
                              disabled={eliminandoId === r.id}
                              style={{ border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: '0.8rem' }}
                            >
                              {eliminandoId === r.id ? '…' : '🗑'}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginTop: '0.8rem', fontSize: '0.85rem' }}>
                <button disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)} style={{ cursor: pagina <= 1 ? 'default' : 'pointer' }}>◀</button>
                <span>Pagina {righe.pagina} — {righe.totale} risultati</span>
                <button disabled={pagina * righe.per_pagina >= righe.totale} onClick={() => setPagina(p => p + 1)} style={{ cursor: 'pointer' }}>▶</button>
              </div>
            </>
          )}
        </>
      )}

      {rigaInModifica && (
        <ModaleModificaCancellazione
          riga={rigaInModifica}
          hotels={hotels}
          onClose={() => setRigaInModifica(null)}
          onSalvato={() => { setRigaInModifica(null); caricaRighe() }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modale — modifica prenotazione cancellata
// ---------------------------------------------------------------------------

function ModaleModificaCancellazione({ riga, hotels, onClose, onSalvato }) {
  const [form, setForm] = useState({
    hotel_code: riga.hotel_code || '',
    canale: riga.canale || '',
    canale_vendita: riga.canale_vendita || '',
    codice_ota: riga.codice_ota || '',
    numero_prenotazione: riga.numero_prenotazione || '',
    data_cancellazione: riga.data_cancellazione || '',
    data_prenotazione: riga.data_prenotazione || '',
    arrivo: riga.arrivo || '',
    partenza: riga.partenza || '',
    pax: riga.pax ?? 0,
    cliente: riga.cliente || '',
    email: riga.email || '',
    tipo_camera: riga.tipo_camera || '',
    trattamento: riga.trattamento || '',
    mercato: riga.mercato || '',
    importo: riga.importo ?? 0,
  })
  const [salvando, setSalvando] = useState(false)
  const [errore, setErrore] = useState(null)

  function set(campo, valore) { setForm(f => ({ ...f, [campo]: valore })) }

  async function salva() {
    setSalvando(true)
    setErrore(null)
    try {
      await api.put(`/prenotazioni-cancellate/${riga.id}`, {
        ...form,
        data_cancellazione: form.data_cancellazione || null,
        email: form.email || null,
        trattamento: form.trattamento || null,
        mercato: form.mercato || null,
        numero_prenotazione: form.numero_prenotazione || null,
        pax: Number(form.pax) || 0,
        importo: Number(form.importo) || 0,
      })
      onSalvato()
    } catch (e) {
      setErrore(mostraErrore(e))
    } finally {
      setSalvando(false)
    }
  }

  const campo = (label, key, tipo = 'text') => (
    <div>
      <label style={stileLabel}>{label}</label>
      <input type={tipo} value={form[key]} onChange={e => set(key, e.target.value)} style={{ ...stileSelect, width: '100%' }} />
    </div>
  )

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '1.5rem', width: 640, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1.05rem', color: '#1a1a2e' }}>Modifica prenotazione cancellata</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginBottom: '1rem' }}>
          <div>
            <label style={stileLabel}>Hotel</label>
            <select value={form.hotel_code} onChange={e => set('hotel_code', e.target.value)} style={{ ...stileSelect, width: '100%' }}>
              {hotels.map(h => <option key={h.code} value={h.code}>{h.name}</option>)}
            </select>
          </div>
          {campo('Codice Prenotazione', 'numero_prenotazione')}
          {campo('Canale', 'canale')}
          {campo('Canale vendita', 'canale_vendita')}
          {campo('Codice OTA', 'codice_ota')}
          {campo('Camera', 'tipo_camera')}
          {campo('Data prenotazione', 'data_prenotazione', 'date')}
          {campo('Data cancellazione', 'data_cancellazione', 'date')}
          {campo('Arrivo', 'arrivo', 'date')}
          {campo('Partenza', 'partenza', 'date')}
          {campo('Pax', 'pax', 'number')}
          {campo('Importo (€)', 'importo', 'number')}
          {campo('Cliente', 'cliente')}
          {campo('Email', 'email')}
          {campo('Trattamento', 'trattamento')}
          {campo('Mercato', 'mercato')}
        </div>

        {riga.dati_grezzi && Object.keys(riga.dati_grezzi).length > 0 && (
          <details style={{ marginBottom: '1rem' }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: '#6b7280', fontWeight: 600 }}>
              Dati grezzi dal file (sola lettura, {Object.keys(riga.dati_grezzi).length} campi)
            </summary>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', marginTop: '0.6rem' }}>
              <tbody>
                {Object.entries(riga.dati_grezzi).map(([k, v]) => (
                  <tr key={k} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.3rem 0.6rem', color: '#6b7280', fontWeight: 600, whiteSpace: 'nowrap' }}>{k}</td>
                    <td style={{ padding: '0.3rem 0.6rem', color: '#374151' }}>{v === null || v === '' ? '—' : String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}

        {errore && <div style={{ marginBottom: '1rem' }}><Errore msg={errore} /></div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
          <button onClick={onClose} disabled={salvando} style={{ padding: '0.5rem 1.1rem', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>
            Annulla
          </button>
          <button onClick={salva} disabled={salvando} style={{ padding: '0.5rem 1.1rem', borderRadius: 6, border: 'none', background: '#8B5CF6', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            {salvando ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 5 — Importa Cancellazioni Welcome
// ---------------------------------------------------------------------------

function TabImportaCancellazioni() {
  const [meseUpload, setMeseUpload] = useState('') // '' = intera stagione (nessun filtro/etichetta di mese)
  const [annoUpload, setAnnoUpload] = useState(new Date().getFullYear())
  const [sovrascrivi, setSovrascrivi] = useState(false)
  const [caricando, setCaricando] = useState(false)
  const [esitoImport, setEsitoImport] = useState(null)
  const inputRef = useRef(null)

  const [storico, setStorico] = useState(null)
  const [eliminando, setEliminando] = useState(null)

  const caricaStorico = useCallback(async () => {
    try {
      const r = await api.get('/prenotazioni-cancellate/import/storico')
      setStorico(r.data)
    } catch {}
  }, [])

  useEffect(() => { caricaStorico() }, [caricaStorico])

  async function handleUpload(file) {
    if (!file) return
    if (!file.name.toLowerCase().match(/\.(csv|xlsx)$/)) {
      setEsitoImport({ ok: false, msg: 'Seleziona un file CSV o XLSX' })
      return
    }
    setCaricando(true)
    setEsitoImport(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const qsMese = meseUpload ? `&mese=${meseUpload}` : ''
      const onConflict = sovrascrivi ? 'aggiorna' : 'salta'
      const { data } = await api.post(
        `/prenotazioni-cancellate/import?anno=${annoUpload}&on_conflict=${onConflict}${qsMese}`,
        form, { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      setEsitoImport({
        ok: true,
        msg: `Importate ${data.n_inserite} righe`
          + (data.n_aggiornate ? `, aggiornate ${data.n_aggiornate}` : '')
          + ` (${data.n_saltate} già presenti, non toccate).`
          + (data.warning.length ? ' ' + data.warning.join(' ') : ''),
        bloccate: data.messaggi_bloccate || [],
      })
      caricaStorico()
    } catch (err) {
      setEsitoImport({ ok: false, msg: mostraErrore(err) })
    } finally {
      setCaricando(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleElimina(id) {
    if (!window.confirm('Eliminare questo import e tutte le righe collegate?')) return
    setEliminando(id)
    try {
      await api.delete(`/prenotazioni-cancellate/import/${id}?conferma=true`)
      caricaStorico()
    } catch (err) {
      alert(mostraErrore(err))
    } finally {
      setEliminando(null)
    }
  }

  if (!isAdmin()) {
    return (
      <div style={{ textAlign: 'center', color: '#6b7280', padding: '3rem' }}>
        Sezione riservata agli amministratori.
      </div>
    )
  }

  return (
    <div>
      <p style={{ margin: '0 0 1.2rem', fontSize: '0.85rem', color: '#6b7280', lineHeight: 1.5 }}>
        Carica qui l'export Welcome "Elenco Prenotazioni" (o, in formato legacy, "PrenotazioniWeb"
        foglio DISDETTE). Ogni riga porta già le proprie date reali: "Mese" qui sotto è solo
        un'etichetta per lo storico import, lascialo su "Intera stagione" per un file che copre
        più mesi o tutti gli hotel insieme. Il dato importato compare nella tab "Cancellazioni".
      </p>

      <div style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 10, padding: '1rem', marginBottom: '2rem' }}>
        <h3 style={{ margin: '0 0 0.8rem', fontSize: '0.95rem', color: '#9a3412' }}>Importa export Welcome</h3>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={stileLabel}>Mese (etichetta, opzionale)</label>
          <select value={meseUpload} onChange={e => setMeseUpload(e.target.value ? Number(e.target.value) : '')} style={stileSelect}>
            <option value="">Intera stagione</option>
            {MESI_LABEL.map((nome, i) => <option key={i + 1} value={i + 1}>{nome}</option>)}
          </select>
          <label style={stileLabel}>Anno</label>
          <select value={annoUpload} onChange={e => setAnnoUpload(Number(e.target.value))} style={stileSelect}>
            {[2024, 2025, 2026, 2027].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <input ref={inputRef} type="file" accept=".csv,.xlsx" onChange={e => handleUpload(e.target.files[0])} disabled={caricando} />
          {caricando && <span style={{ color: '#9a3412', fontSize: '0.85rem' }}>Caricamento…</span>}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.7rem', fontSize: '0.85rem', color: '#9a3412', cursor: 'pointer' }}>
          <input type="checkbox" checked={sovrascrivi} onChange={e => setSovrascrivi(e.target.checked)} />
          Sovrascrivi prenotazioni già presenti (solo quelle mai modificate a mano — le modificate non vengono mai toccate)
        </label>
        {esitoImport && (
          <div style={{
            marginTop: '0.7rem', padding: '0.6rem 0.9rem', borderRadius: 8, fontSize: '0.85rem',
            background: esitoImport.ok ? '#dcfce7' : '#fee2e2', color: esitoImport.ok ? '#166534' : '#991b1b',
          }}>
            {esitoImport.ok ? '✓ ' : '✗ '}{esitoImport.msg}
          </div>
        )}
        {esitoImport?.bloccate?.length > 0 && (
          <div style={{ marginTop: '0.6rem', padding: '0.6rem 0.9rem', borderRadius: 8, fontSize: '0.82rem', background: '#fef3c7', color: '#92400e' }}>
            <strong>{esitoImport.bloccate.length} prenotazioni non importate perché già modificate a mano:</strong>
            <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
              {esitoImport.bloccate.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </div>
        )}
      </div>

      <h3 style={{ margin: '0 0 0.8rem', fontSize: '0.95rem', color: '#374151' }}>Import effettuati</h3>
      {storico && (
        storico.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '0.88rem' }}>Nessun import ancora effettuato.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.87rem' }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <Th>File</Th><Th>Mese prenotazione</Th><Th align="right">Righe valide</Th>
                <Th align="right">Fuori mese</Th><Th align="center">Caricato il</Th><Th align="center">Azioni</Th>
              </tr>
            </thead>
            <tbody>
              {storico.map(imp => (
                <tr key={imp.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={stCella}>{imp.nome_file}</td>
                  <td style={stCella}>{imp.mese_label} {imp.anno}</td>
                  <td style={{ ...stCella, textAlign: 'right' }}>{imp.n_righe_valide}</td>
                  <td style={{ ...stCella, textAlign: 'right', color: imp.n_righe_fuori_mese ? '#d97706' : '#d1d5db' }}>
                    {imp.n_righe_fuori_mese || '—'}
                  </td>
                  <td style={{ ...stCella, textAlign: 'center', color: '#6b7280' }}>{formatDataIt(imp.created_at)}</td>
                  <td style={{ ...stCella, textAlign: 'center' }}>
                    <button
                      onClick={() => handleElimina(imp.id)}
                      disabled={eliminando === imp.id}
                      style={{ border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                      {eliminando === imp.id ? '…' : '🗑'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sottocomponenti
// ---------------------------------------------------------------------------

function CardKpi({ titolo, valore, colore }) {
  return (
    <div style={{
      flex: '1 1 160px', background: '#fff', border: '1px solid #e5e7eb',
      borderRadius: 10, padding: '0.9rem 1.1rem', borderTop: `3px solid ${colore}`,
    }}>
      <div style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.3rem' }}>{titolo}</div>
      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: colore }}>{valore}</div>
    </div>
  )
}

function Th({ children, align = 'left', title }) {
  return (
    <th title={title} style={{ padding: '0.6rem 0.75rem', textAlign: align, fontSize: '0.8rem', fontWeight: 700 }}>
      {children}
    </th>
  )
}

// Intestazione cliccabile per ordinare una tabella lato server (vedi TabCancellazioni).
function ThOrd({ children, campo, ordinaPer, direzione, onClick, align = 'left' }) {
  const attiva = ordinaPer === campo
  return (
    <th
      onClick={() => onClick(campo)}
      title="Clicca per ordinare"
      style={{
        padding: '0.6rem 0.75rem', textAlign: align, fontSize: '0.8rem', fontWeight: 700,
        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
      }}
    >
      {children}{attiva && (direzione === 'asc' ? ' ▲' : ' ▼')}
    </th>
  )
}

function Caricamento() {
  return <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>Caricamento…</div>
}

function Errore({ msg }) {
  return <div style={{ padding: '1rem', color: '#b91c1c', background: '#fee2e2', borderRadius: 8 }}>{msg}</div>
}

// ---------------------------------------------------------------------------
// Stili condivisi
// ---------------------------------------------------------------------------

const stCella = { padding: '0.52rem 0.75rem' }

const stCellaHeader = { padding: '0.52rem 0.75rem', color: '#fff' }

const stileSelect = {
  padding: '0.4rem 0.7rem',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: '0.9rem',
  background: '#fff',
  cursor: 'pointer',
}

const stileLabel = {
  display: 'block',
  fontSize: '0.8rem',
  color: '#6b7280',
  marginBottom: '0.3rem',
  fontWeight: 500,
}

function stileToggleBtn(attivo) {
  return {
    padding: '0.4rem 0.9rem',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '0.83rem',
    fontWeight: attivo ? 700 : 500,
    background: attivo ? '#ea580c' : 'transparent',
    color: attivo ? '#fff' : '#9a3412',
  }
}
