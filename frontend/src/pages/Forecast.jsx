import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api/client.js'
import { formatEuro, formatPerc, formatDataIt, mostraErrore } from '../utils/format.js'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import pastReferenceArea from '../components/PastReferenceArea.jsx'

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
