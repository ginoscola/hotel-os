import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import api from '../api/client.js'
import { formatEuro, formatPerc, formatN, formatData, mostraErrore } from '../utils/format.js'
import pastReferenceArea from '../components/PastReferenceArea.jsx'

const MESI_IT = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
]
const HOTEL_CODES = ['CLB', 'DPH', 'INT']
const HOTEL_NOMI = { CLB: 'Club Hotel', DPH: 'Hotel Du Parc', INT: 'Hotel International' }

// Calcolo KPI budget lato frontend (speculare a budget_calculator.py).
// occupancy: % 0-100 (input); adrFnb/adrExtra: € per camera venduta (input).
// camere_vendute e tutti i KPI sono derivati.
function calcolaKpiFrontend(occupancy, adr, adrFnb, adrExtra, roomsAvail) {
  if (!occupancy || !adr) return {}
  const ra = roomsAvail || 0
  const camere = ra ? Math.round(occupancy / 100 * ra) : null
  if (camere === null) return {}
  const revRooms = camere * adr
  const revFnb   = camere * (adrFnb   || 0)
  const revExtra = camere * (adrExtra  || 0)
  const revTotal = revRooms + revFnb + revExtra
  const sd = (n, d) => d ? n / d : null
  return {
    rooms_sold: camere,
    revenue_rooms: revRooms,
    revenue_fnb: revFnb,
    revenue_extra: revExtra,
    revenue_total: revTotal,
    occupancy,
    revpar:    sd(revRooms, ra),
    trevpar:   sd(revTotal, ra),
    rmc:       sd(revTotal, camere),
    inc_rooms: sd(revRooms * 100, revTotal),
    inc_fnb:   sd(revFnb   * 100, revTotal),
    inc_extra: sd(revExtra * 100, revTotal),
  }
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// Speculare a calcola_mese_contabile() in Python:
// restituisce {mese (1-12), anno} del mese con più giorni nella settimana.
function calcolaMeseContabile(ws) {
  const conteggi = {}
  for (let i = 0; i < 7; i++) {
    const d = new Date(ws + 'T00:00:00')
    d.setDate(d.getDate() + i)
    const k = `${d.getFullYear()}-${d.getMonth() + 1}`
    conteggi[k] = (conteggi[k] || 0) + 1
  }
  const [best] = Object.entries(conteggi).sort((a, b) => b[1] - a[1])
  const [anno, mese] = best[0].split('-').map(Number)
  return { mese, anno }
}

// Camere disponibili per una settimana dalla stagione già caricata.
function roomsAvailabileSettimana(ws, stagione) {
  if (!stagione) return null
  const open  = new Date(stagione.open_date  + 'T00:00:00')
  const close = new Date(stagione.close_date + 'T00:00:00')
  let giorni = 0
  for (let i = 0; i < 7; i++) {
    const d = new Date(ws + 'T00:00:00')
    d.setDate(d.getDate() + i)
    if (d >= open && d <= close) giorni++
  }
  return giorni > 0 ? stagione.total_rooms * giorni : null
}

function labelSettimana(ws) {
  const d = new Date(ws + 'T00:00:00')
  const we = new Date(ws + 'T00:00:00')
  we.setDate(we.getDate() + 6)
  const fmt = (dt) => `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}`
  return `${fmt(d)}–${fmt(we)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente badge delta
// ─────────────────────────────────────────────────────────────────────────────
function DeltaBadge({ val, invertita }) {
  if (val == null) return null
  const positivo = invertita ? val < 0 : val > 0
  const colore = positivo ? '#059669' : '#dc2626'
  const segno = val > 0 ? '+' : ''
  return (
    <span style={{ color: colore, fontSize: 11, fontWeight: 600 }}>
      {segno}{val.toFixed(1)}%
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1 — Inserimento Budget
// ─────────────────────────────────────────────────────────────────────────────
function TabInserimento({ hotel, anno, version, onVersionChange }) {
  const [settimane, setSettimane] = useState([])   // da GET /budget
  const [stagione, setStagione] = useState(null)    // da GET /hotels/{code}/seasons/{year}
  const [versioni, setVersioni] = useState(['v1'])
  const [editCell, setEditCell] = useState(null)    // {row, campo}
  const [localEdit, setLocalEdit] = useState({})    // {ws: {campo: val}}
  const [salvataggio, setSalvataggio] = useState({})
  const [mostraModale, setMostraModale] = useState(false)
  const [nuovaVersione, setNuovaVersione] = useState('')
  const [versSource, setVersSource] = useState('v1')
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)
  const debRef = useRef({})

  const caricaDati = useCallback(async () => {
    setLoading(true)
    setErrore(null)
    try {
      const [respBudget, respStag, respVers] = await Promise.all([
        api.get(`/budget/${hotel}/${anno}?version=${version}`),
        api.get(`/hotels/${hotel}/seasons/${anno}`).catch(() => ({ data: null })),
        api.get(`/budget/${hotel}/${anno}/versions`).catch(() => ({ data: { versions: ['v1'] } })),
      ])
      setSettimane(respBudget.data || [])
      setStagione(respStag.data)
      setVersioni(respVers.data.versions.length ? respVers.data.versions : ['v1'])
      setLocalEdit({})
    } catch (e) {
      setErrore(mostraErrore(e))
    } finally {
      setLoading(false)
    }
  }, [hotel, anno, version])

  useEffect(() => { caricaDati() }, [caricaDati])

  // Genera tutte le settimane della stagione (incluse quelle senza budget)
  const tutteLeSettimane = useMemo(() => {
    if (!stagione) return settimane
    const open = stagione.open_date
    const close = stagione.close_date
    if (!open || !close) return settimane
    // Calcola primo sabato ≤ open_date
    const d = new Date(open + 'T00:00:00')
    while (d.getDay() !== 6) d.setDate(d.getDate() - 1)
    const weeks = []
    while (d.toISOString().slice(0, 10) <= close) {
      weeks.push(d.toISOString().slice(0, 10))
      d.setDate(d.getDate() + 7)
    }
    const budgetMap = Object.fromEntries(settimane.map(s => [s.week_start, s]))
    return weeks.map(ws => budgetMap[ws] || { week_start: ws, _vuota: true })
  }, [stagione, settimane])

  function getVal(ws, campo) {
    return localEdit[ws]?.[campo] ?? settimane.find(s => s.week_start === ws)?.[campo] ?? ''
  }

  function handleCellChange(ws, campo, val) {
    setLocalEdit(prev => ({
      ...prev,
      [ws]: { ...(prev[ws] || {}), [campo]: val },
    }))
    // Debounce salvataggio
    clearTimeout(debRef.current[ws])
    debRef.current[ws] = setTimeout(() => salvaSettimana(ws), 500)
  }

  async function salvaSettimana(ws) {
    const entry = settimane.find(s => s.week_start === ws) || {}
    const edit = localEdit[ws] || {}
    const merged = { ...entry, ...edit }
    const occupancy = parseFloat(String((merged.occupancy) || '').replace(',', '.')) || null
    const adr      = parseFloat(String(merged.adr || '').replace(',', '.')) || null
    const adrFnb   = parseFloat(String(merged.adr_fnb || '').replace(',', '.')) || null
    const adrExtra = parseFloat(String(merged.adr_extra || '').replace(',', '.')) || null
    if (!occupancy && !adr) return

    setSalvataggio(p => ({ ...p, [ws]: 'saving' }))
    try {
      await api.put(`/budget/${hotel}/${anno}/${ws}`, {
        version,
        occupancy,
        adr,
        adr_fnb: adrFnb,
        adr_extra: adrExtra,
        notes: merged.notes || null,
      })
      setSalvataggio(p => ({ ...p, [ws]: 'ok' }))
      setTimeout(() => setSalvataggio(p => { const n = { ...p }; delete n[ws]; return n }), 2000)
      // Ricarica solo la riga aggiornata
      const resp = await api.get(`/budget/${hotel}/${anno}/${ws}?version=${version}`)
      setSettimane(prev => {
        const idx = prev.findIndex(s => s.week_start === ws)
        if (idx >= 0) return prev.map((s, i) => i === idx ? resp.data : s)
        return [...prev, resp.data].sort((a, b) => a.week_start.localeCompare(b.week_start))
      })
    } catch {
      setSalvataggio(p => ({ ...p, [ws]: 'err' }))
    }
  }

  async function creaNuovaVersione() {
    try {
      await api.post(`/budget/${hotel}/${anno}/version`, {
        source_version: versSource,
        new_version: nuovaVersione,
      })
      onVersionChange(nuovaVersione)
      setMostraModale(false)
    } catch (e) {
      alert(mostraErrore(e, 'Errore creazione versione'))
    }
  }

  async function importaExcel(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    try {
      const resp = await api.post(`/budget/${hotel}/${anno}/import-excel?version=${version}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      alert(`Importate ${resp.data.n_righe_salvate} settimane`)
      caricaDati()
    } catch (ex) {
      alert(ex.response?.data?.detail || 'Errore import Excel')
    }
    e.target.value = ''
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: 12, color: '#6b7280' }}>Versione</label>
          <select value={version} onChange={e => onVersionChange(e.target.value)} style={{ marginLeft: 6 }}>
            {versioni.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <button onClick={() => setMostraModale(true)} style={{ fontSize: 13 }}>Nuova versione</button>
        <label style={{
          cursor: 'pointer', fontSize: 13,
          padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 6,
          background: '#f9fafb',
        }}>
          Importa da Excel
          <input type="file" accept=".xlsx" onChange={importaExcel} style={{ display: 'none' }} />
        </label>
      </div>

      {errore && <div style={{ color: '#dc2626', marginBottom: '1rem' }}>{errore}</div>}
      {loading && <p>Caricamento…</p>}

      {tutteLeSettimane.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Settimana</th>
                <th>Mese</th>
                <th>Cam.Disp.</th>
                <th style={{ color: '#2563eb' }}>Occup%*</th>
                <th style={{ color: '#2563eb' }}>ADR Cam.*</th>
                <th style={{ color: '#2563eb' }}>ADR F&B*</th>
                <th style={{ color: '#2563eb' }}>ADR Extra*</th>
                <th>Cam.Vend.</th>
                <th>Inc.F&B%</th>
                <th>RevPAR</th>
                <th>TrevPAR</th>
                <th>Rev.Totale</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tutteLeSettimane.map((s) => {
                const ws = s.week_start
                const vuota = !!s._vuota
                const edit = localEdit[ws] || {}
                const occupancy = parseFloat(String((edit.occupancy ?? s.occupancy) || '').replace(',', '.')) || null
                const adr      = parseFloat(String((edit.adr ?? s.adr) || '').replace(',', '.')) || null
                const adrFnb   = parseFloat(String((edit.adr_fnb ?? s.adr_fnb) || '').replace(',', '.')) || null
                const adrExtra = parseFloat(String((edit.adr_extra ?? s.adr_extra) || '').replace(',', '.')) || null
                // Per righe senza DB: calcola mese e cam.disp. dal frontend
                const ra = s.rooms_available_budget ?? s.rooms_available
                  ?? roomsAvailabileSettimana(ws, stagione)
                const { mese: mc, anno: ac } = s.mese_contabile
                  ? { mese: s.mese_contabile, anno: s.anno_contabile }
                  : calcolaMeseContabile(ws)
                const kpi    = calcolaKpiFrontend(occupancy, adr, adrFnb, adrExtra, ra)
                const mese   = `${MESI_IT[mc - 1].slice(0, 3)} ${ac}`
                const stato  = salvataggio[ws]
                const bgColor = vuota ? '#f9fafb' : (occupancy ? '#fff' : '#fffbeb')

                return (
                  <tr key={ws} style={{ background: bgColor }}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{labelSettimana(ws)}</td>
                    <td style={{ fontSize: 12 }}>{mese}</td>
                    <td>{ra ? formatN(ra) : '—'}</td>
                    {['occupancy', 'adr', 'adr_fnb', 'adr_extra'].map(campo => (
                      <td key={campo} style={{ padding: 2 }}>
                        <input
                          type="number"
                          step="0.01"
                          value={edit[campo] ?? s[campo] ?? ''}
                          onChange={ev => handleCellChange(ws, campo, ev.target.value)}
                          style={{
                            width: campo === 'occupancy' ? 52 : 60,
                            border: '1px solid #d1d5db', borderRadius: 4,
                            padding: '2px 4px', fontSize: 12,
                          }}
                        />
                      </td>
                    ))}
                    <td style={{ color: '#6b7280', fontSize: 12 }}>
                      {kpi.rooms_sold != null ? formatN(kpi.rooms_sold) : (s.camere_vendute ? formatN(s.camere_vendute) : '—')}
                    </td>
                    <td style={{ color: '#6b7280', fontSize: 12 }}>
                      {kpi.inc_fnb != null ? formatPerc(kpi.inc_fnb) : '—'}
                    </td>
                    <td>{kpi.revpar != null ? formatEuro(kpi.revpar) : '—'}</td>
                    <td>{kpi.trevpar != null ? formatEuro(kpi.trevpar) : '—'}</td>
                    <td>{kpi.revenue_total != null ? formatEuro(kpi.revenue_total) : '—'}</td>
                    <td style={{ width: 24 }}>
                      {stato === 'saving' && <span style={{ color: '#6b7280', fontSize: 11 }}>⟳</span>}
                      {stato === 'ok' && <span style={{ color: '#059669', fontSize: 11 }}>✓</span>}
                      {stato === 'err' && <span style={{ color: '#dc2626', fontSize: 11 }}>✗</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
            * celle editabili — ADR F&B e ADR Extra sono € per camera venduta — modifiche salvate automaticamente
          </div>
        </div>
      )}

      {mostraModale && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div className="card" style={{ width: 340, padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem' }}>Nuova versione budget</h3>
            <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Copia da versione</label>
            <select value={versSource} onChange={e => setVersSource(e.target.value)} style={{ width: '100%', marginBottom: '0.75rem' }}>
              {versioni.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Nome nuova versione</label>
            <input
              value={nuovaVersione}
              onChange={e => setNuovaVersione(e.target.value)}
              placeholder="es. v2"
              style={{ width: '100%', marginBottom: '1rem', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4 }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setMostraModale(false)} style={{ background: '#f3f4f6' }}>Annulla</button>
              <button onClick={creaNuovaVersione} style={{ background: '#2563eb', color: '#fff' }}>Crea</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2 — Confronto Actual vs Budget
// ─────────────────────────────────────────────────────────────────────────────
function TabConfronto({ hotel, anno, version }) {
  const [dati, setDati] = useState(null)
  const [modalita, setModalita] = useState('settimanale')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    const ep = modalita === 'mensile'
      ? `/budget/${hotel}/${anno}/confronto/mensile?version=${version}`
      : `/budget/${hotel}/${anno}/confronto?version=${version}`
    api.get(ep)
      .then(r => setDati(r.data))
      .catch(() => setDati(null))
      .finally(() => setLoading(false))
  }, [hotel, anno, version, modalita])

  if (loading) return <p>Caricamento…</p>
  if (!dati) return <p style={{ color: '#6b7280' }}>Nessun dato disponibile.</p>

  const righe = modalita === 'mensile' ? dati.mesi : dati.settimane
  const totB  = dati.totali_budget || {}
  const totA  = dati.totali_actual || {}

  // Dati grafico
  const grafici = (dati.settimane || []).map(s => ({
    week_start: s.week_start,
    label: s.week_start ? s.week_start.slice(5) : '',
    budget_occ: s.budget?.occupancy,
    actual_occ: s.actual?.occupancy,
    budget_adr: s.budget?.adr,
    actual_adr: s.actual?.adr,
    budget_rev: s.budget?.revenue_total,
    actual_rev: s.actual?.revenue_total,
  })).filter(g => g.budget_occ != null || g.actual_occ != null)

  const scostPct = (b, a) => (b && a) ? ((a - b) / b * 100) : null

  return (
    <div>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center' }}>
        <label style={{ fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="radio" value="settimanale" checked={modalita === 'settimanale'}
            onChange={() => setModalita('settimanale')} />
          Settimanale
        </label>
        <label style={{ fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="radio" value="mensile" checked={modalita === 'mensile'}
            onChange={() => setModalita('mensile')} />
          Mensile
        </label>
      </div>

      {/* KPI cards riepilogo */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        {[
          { label: 'Budget Revenue', val: formatEuro(totB.revenue_total) },
          { label: 'Actual Revenue', val: formatEuro(totA.revenue_total) },
          { label: 'Scostamento €', val: formatEuro((totA.revenue_total || 0) - (totB.revenue_total || 0)),
            colore: (totA.revenue_total || 0) >= (totB.revenue_total || 0) ? '#059669' : '#dc2626' },
          { label: 'Scostamento %',
            val: formatPerc(scostPct(totB.revenue_total, totA.revenue_total)),
            colore: (totA.revenue_total || 0) >= (totB.revenue_total || 0) ? '#059669' : '#dc2626' },
          { label: 'Budget Camere', val: formatN(totB.rooms_sold) },
          { label: 'Actual Camere', val: formatN(totA.rooms_sold) },
        ].map((c, i) => (
          <div key={i} className="card" style={{ padding: '0.75rem 1rem', minWidth: 140 }}>
            <div style={{ fontSize: 11, color: '#6b7280' }}>{c.label}</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: c.colore }}>{c.val}</div>
          </div>
        ))}
      </div>

      {/* Tabella confronto */}
      <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>{modalita === 'mensile' ? 'Mese' : 'Settimana'}</th>
              <th colSpan={2}>Cam. Vend.</th>
              <th colSpan={2}>Occup. %</th>
              <th colSpan={2}>ADR</th>
              <th colSpan={2}>RevPAR</th>
              <th colSpan={2}>Rev. Totale</th>
              <th>Δ%</th>
            </tr>
            <tr style={{ fontSize: 11, color: '#6b7280' }}>
              <th></th>
              <th>Bdg</th><th>Act</th>
              <th>Bdg</th><th>Act</th>
              <th>Bdg</th><th>Act</th>
              <th>Bdg</th><th>Act</th>
              <th>Bdg</th><th>Act</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {righe.map((r, i) => {
              const b = r.budget || {}
              const a = r.actual || {}
              const sc = r.scostamento
              const sopra = sc?.sopra_budget
              const pct = sc?.percentuale?.revenue_total
              const haAct = r.dati_disponibili !== false && Object.keys(a).length > 0
              return (
                <tr key={i} style={{ background: haAct ? 'inherit' : '#f9fafb' }}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                    {modalita === 'mensile' ? r.label : labelSettimana(r.week_start)}
                  </td>
                  <td>{formatN(b.rooms_sold)}</td>
                  <td style={{ color: haAct ? 'inherit' : '#9ca3af' }}>{haAct ? formatN(a.rooms_sold) : '—'}</td>
                  <td>{b.occupancy != null ? formatPerc(b.occupancy) : '—'}</td>
                  <td style={{ color: haAct ? 'inherit' : '#9ca3af' }}>{haAct ? formatPerc(a.occupancy) : '—'}</td>
                  <td>{b.adr != null ? formatEuro(b.adr) : '—'}</td>
                  <td style={{ color: haAct ? 'inherit' : '#9ca3af' }}>{haAct ? formatEuro(a.adr) : '—'}</td>
                  <td>{b.revpar != null ? formatEuro(b.revpar) : '—'}</td>
                  <td style={{ color: haAct ? 'inherit' : '#9ca3af' }}>{haAct ? formatEuro(a.revpar) : '—'}</td>
                  <td>{formatEuro(b.revenue_total)}</td>
                  <td style={{ color: haAct ? 'inherit' : '#9ca3af' }}>{haAct ? formatEuro(a.revenue_total) : '—'}</td>
                  <td>
                    {haAct && pct != null
                      ? <span style={{ color: sopra ? '#059669' : '#dc2626', fontWeight: 600 }}>
                          {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
                        </span>
                      : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Grafici */}
      {grafici.length > 0 && modalita === 'settimanale' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card sezione">
            <h4 style={{ margin: '0 0 0.5rem' }}>Occupazione %</h4>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={grafici}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={v => `${v}%`} domain={[0, 100]} width={36} />
                <Tooltip formatter={(v, n) => [v != null ? `${v.toFixed(1)}%` : '—', n]} />
                <Legend />
                {pastReferenceArea(grafici, 'week_start', 'label')}
                <Line dataKey="budget_occ" name="Budget" stroke="#94a3b8" strokeDasharray="4 4" dot={false} />
                <Line dataKey="actual_occ" name="Actual" stroke="#3b82f6" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="card sezione">
            <h4 style={{ margin: '0 0 0.5rem' }}>Revenue Totale</h4>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={grafici} barCategoryGap="15%">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={v => `${(v/1000).toFixed(0)}k`} width={40} />
                <Tooltip formatter={v => v != null ? formatEuro(v) : '—'} />
                <Legend />
                {pastReferenceArea(grafici, 'week_start', 'label')}
                <Bar dataKey="budget_rev" name="Budget" fill="#94a3b8" />
                <Bar dataKey="actual_rev" name="Actual" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3 — Proiezione Fine Stagione
// ─────────────────────────────────────────────────────────────────────────────
function TabProiezione({ hotel, anno, version }) {
  const [dati, setDati] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get(`/budget/${hotel}/${anno}/proiezione?version=${version}`)
      .then(r => setDati(r.data))
      .catch(() => setDati(null))
      .finally(() => setLoading(false))
  }, [hotel, anno, version])

  if (loading) return <p>Caricamento…</p>
  if (!dati) return <p style={{ color: '#6b7280' }}>Nessun budget inserito per questo hotel/anno.</p>

  const bud = dati.stagione_budget_totale || {}
  const proj = dati.stagione_proiezione || {}
  const scostRev = (proj.revenue_total || 0) - (bud.revenue_total || 0)
  const scostPct = bud.revenue_total ? (scostRev / bud.revenue_total * 100) : null
  const trendColori = { sopra_budget: '#059669', sotto_budget: '#dc2626', in_linea: '#2563eb' }
  const trendLabel  = { sopra_budget: 'SOPRA BUDGET', sotto_budget: 'SOTTO BUDGET', in_linea: 'IN LINEA' }
  const pct = dati.pct_stagione_completata || 0

  return (
    <div>
      {/* Card principale */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Budget totale stagione</div>
            <div style={{ fontWeight: 700, fontSize: 22 }}>{formatEuro(bud.revenue_total)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Proiezione fine stagione</div>
            <div style={{ fontWeight: 700, fontSize: 22, color: trendColori[dati.trend] }}>
              {formatEuro(proj.revenue_total)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Scostamento</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: trendColori[dati.trend] }}>
              {scostRev > 0 ? '+' : ''}{formatEuro(scostRev)}
              {scostPct != null && ` (${scostPct > 0 ? '+' : ''}${scostPct.toFixed(1)}%)`}
            </div>
          </div>
          <span style={{
            background: trendColori[dati.trend], color: '#fff',
            padding: '4px 14px', borderRadius: 20, fontWeight: 700, fontSize: 13,
            alignSelf: 'center',
          }}>
            {trendLabel[dati.trend]}
          </span>
        </div>

        {/* Barra avanzamento */}
        <div style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
            <span>{dati.settimane_completate} settimane completate su {dati.settimane_totali}</span>
            <span>{pct.toFixed(0)}%</span>
          </div>
          <div style={{ background: '#e5e7eb', borderRadius: 4, height: 10, overflow: 'hidden' }}>
            <div style={{
              width: `${pct}%`, height: '100%',
              background: trendColori[dati.trend], transition: 'width 0.5s',
            }} />
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        {[
          { label: 'Cam. Vend. Budget', val: formatN(bud.rooms_sold), comp: formatN(proj.rooms_sold) },
          { label: 'Rev. Camere Budget', val: formatEuro(bud.revenue_rooms), comp: formatEuro(proj.revenue_rooms) },
          { label: 'Rev. F&B Budget', val: formatEuro(bud.revenue_fnb), comp: formatEuro(proj.revenue_fnb) },
        ].map((c, i) => (
          <div key={i} className="card" style={{ padding: '0.75rem 1rem', minWidth: 160 }}>
            <div style={{ fontSize: 11, color: '#6b7280' }}>{c.label}</div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>{c.val}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>→ {c.comp}</div>
          </div>
        ))}
      </div>

      {/* Tabella dettaglio */}
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Settimana</th>
              <th>Tipo</th>
              <th>Budget</th>
              <th>Actual / Proiezione</th>
              <th>Δ€</th>
            </tr>
          </thead>
          <tbody>
            {(dati.dettaglio || []).map((r, i) => {
              const bRev = r.budget?.revenue_total
              const aRev = r.actual_o_proiezione?.revenue_total
              const delta = (bRev != null && aRev != null) ? aRev - bRev : null
              const tipoColori = { completata: '#059669', proiettata: '#6b7280', in_corso: '#2563eb' }
              return (
                <tr key={i} style={{ background: r.tipo === 'completata' ? '#f0fdf4' : 'inherit' }}>
                  <td style={{ fontSize: 12 }}>{labelSettimana(r.week_start)}</td>
                  <td>
                    <span style={{
                      background: tipoColori[r.tipo] + '20',
                      color: tipoColori[r.tipo],
                      padding: '1px 8px', borderRadius: 10, fontSize: 11,
                    }}>{r.tipo}</span>
                  </td>
                  <td>{formatEuro(bRev)}</td>
                  <td>{formatEuro(aRev)}</td>
                  <td style={{ color: delta != null ? (delta >= 0 ? '#059669' : '#dc2626') : 'inherit' }}>
                    {delta != null ? `${delta >= 0 ? '+' : ''}${formatEuro(delta)}` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4 — Budget Gruppo
// ─────────────────────────────────────────────────────────────────────────────
function TabGruppo({ anno, version }) {
  const [conf, setConf] = useState(null)
  const [proj, setProj] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get(`/budget/gruppo/${anno}/confronto?version=${version}`),
      api.get(`/budget/gruppo/${anno}/proiezione?version=${version}`),
    ]).then(([r1, r2]) => {
      setConf(r1.data)
      setProj(r2.data)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [anno, version])

  if (loading) return <p>Caricamento…</p>
  if (!conf) return <p style={{ color: '#6b7280' }}>Nessun dato di gruppo disponibile.</p>

  const budGruppo = conf.hotel?.reduce((s, h) => s + (h.budget?.revenue_total || 0), 0)
  const actGruppo = conf.hotel?.reduce((s, h) => s + (h.actual?.revenue_total || 0), 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '0.75rem 1rem' }}>
          <div style={{ fontSize: 11, color: '#6b7280' }}>Budget Gruppo</div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{formatEuro(budGruppo)}</div>
        </div>
        <div className="card" style={{ padding: '0.75rem 1rem' }}>
          <div style={{ fontSize: 11, color: '#6b7280' }}>Actual Gruppo</div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{formatEuro(actGruppo)}</div>
        </div>
        <div className="card" style={{ padding: '0.75rem 1rem' }}>
          <div style={{ fontSize: 11, color: '#6b7280' }}>Proiezione Gruppo</div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{formatEuro(proj?.proiezione_gruppo_revenue)}</div>
        </div>
      </div>

      <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Hotel</th>
              <th>Budget Rev.</th>
              <th>Actual Rev.</th>
              <th>Scostamento €</th>
              <th>Scostamento %</th>
              <th>Proiezione</th>
            </tr>
          </thead>
          <tbody>
            {(conf.hotel || []).map((h, i) => {
              const bRev = h.budget?.revenue_total
              const aRev = h.actual?.revenue_total
              const sc = aRev != null && bRev != null ? aRev - bRev : null
              const scPct = sc != null && bRev ? (sc / bRev * 100) : null
              const projH = proj?.hotel?.find(p => p.hotel_code === h.hotel_code)
              return (
                <tr key={i}>
                  <td><strong>{h.hotel_code}</strong> <span style={{ fontSize: 12, color: '#6b7280' }}>{h.hotel_name}</span></td>
                  <td>{formatEuro(bRev)}</td>
                  <td>{aRev != null ? formatEuro(aRev) : '—'}</td>
                  <td style={{ color: sc != null ? (sc >= 0 ? '#059669' : '#dc2626') : 'inherit' }}>
                    {sc != null ? `${sc >= 0 ? '+' : ''}${formatEuro(sc)}` : '—'}
                  </td>
                  <td style={{ color: scPct != null ? (scPct >= 0 ? '#059669' : '#dc2626') : 'inherit' }}>
                    {scPct != null ? `${scPct >= 0 ? '+' : ''}${scPct.toFixed(1)}%` : '—'}
                  </td>
                  <td>{projH ? formatEuro(projH.proiezione) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Grafico comparativo revenue per hotel */}
      {conf.hotel?.length > 0 && (
        <div className="card sezione">
          <h4 style={{ margin: '0 0 0.5rem' }}>Revenue — Budget vs Actual per hotel</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={conf.hotel} margin={{ left: 0, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hotel_code" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={v => `${(v/1000).toFixed(0)}k`} width={42} />
              <Tooltip formatter={v => v != null ? formatEuro(v) : '—'} />
              <Legend />
              <Bar dataKey="budget.revenue_total" name="Budget" fill="#94a3b8" />
              <Bar dataKey="actual.revenue_total" name="Actual" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente principale
// ─────────────────────────────────────────────────────────────────────────────
export default function Budget() {
  const [hotel, setHotel] = useState('DPH')
  const [anno, setAnno] = useState(2026)
  const [version, setVersion] = useState('v1')
  const [tab, setTab] = useState('inserimento')

  const anniDisponibili = [2025, 2026, 2027]
  const tabs = [
    { id: 'inserimento', label: 'Inserimento Budget' },
    { id: 'confronto', label: 'Confronto Actual vs Budget' },
    { id: 'proiezione', label: 'Proiezione Fine Stagione' },
    { id: 'gruppo', label: 'Budget Gruppo' },
  ]

  return (
    <div>
      {/* Selettori hotel / anno / versione (header) */}
      <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {tab !== 'gruppo' && (
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>Hotel</label>
            <select value={hotel} onChange={e => setHotel(e.target.value)}>
              {HOTEL_CODES.map(c => <option key={c} value={c}>{HOTEL_NOMI[c]}</option>)}
            </select>
          </div>
        )}
        <div>
          <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>Anno</label>
          <select value={anno} onChange={e => setAnno(Number(e.target.value))}>
            {anniDisponibili.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        {tab !== 'inserimento' && (
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>Versione</label>
            <select value={version} onChange={e => setVersion(e.target.value)}>
              <option value="v1">v1</option>
              <option value="v2">v2</option>
            </select>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, marginBottom: '1.5rem', borderBottom: '2px solid #e5e7eb' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '8px 18px', fontSize: 14, fontWeight: tab === t.id ? 700 : 400,
              color: tab === t.id ? '#059669' : '#6b7280',
              borderBottom: tab === t.id ? '2px solid #059669' : '2px solid transparent',
              marginBottom: -2,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenuto tab */}
      <div className="card sezione">
        {tab === 'inserimento' && (
          <TabInserimento hotel={hotel} anno={anno} version={version} onVersionChange={setVersion} />
        )}
        {tab === 'confronto' && (
          <TabConfronto hotel={hotel} anno={anno} version={version} />
        )}
        {tab === 'proiezione' && (
          <TabProiezione hotel={hotel} anno={anno} version={version} />
        )}
        {tab === 'gruppo' && (
          <TabGruppo anno={anno} version={version} />
        )}
      </div>
    </div>
  )
}
