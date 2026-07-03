import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import api from '../api/client.js'
import KPICard from '../components/KPICard.jsx'
import { ExportMenu, SezioneHeader } from '../components/ExportMenu.jsx'
import pastReferenceArea from '../components/PastReferenceArea.jsx'
import { formatEuro, formatEuroK, formatPerc, formatN, formatData, addDays, calcolaDelta, mostraErrore } from '../utils/format.js'

const COLORI_HOTEL = { CLB: '#3b82f6', DPH: '#10b981', INT: '#f59e0b' }
const MODALITA_KEY = 'gruppo_modalita'

const styleToggle = (attivo) => ({
  padding: '7px 20px',
  background: attivo ? '#3b82f6' : '#e5e7eb',
  color: attivo ? '#fff' : '#374151',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
  transition: 'background 0.15s',
})

export default function DashboardGruppo() {
  const [modalita, setModalita] = useState(
    () => localStorage.getItem(MODALITA_KEY) || 'settimana'
  )

  // Navigazione modalità settimana
  const [settimane, setSettimane] = useState([])
  const [weekIdx, setWeekIdx] = useState(0)

  // Navigazione modalità stagione
  const [snapshots, setSnapshots] = useState([])
  const [snapIdx, setSnapIdx] = useState(0)

  const [confrontaPrevSett, setConfrontaPrevSett] = useState(false)
  const [confrontaPrevAnno, setConfrontaPrevAnno] = useState(false)

  const [dati, setDati] = useState(null)
  const [datiComp, setDatiComp] = useState(null)
  const [compDisponibile, setCompDisponibile] = useState(true)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)
  const [settimanePerHotel, setSettimanePerHotel] = useState({})

  // Persiste modalità e reset navigazione al cambio
  useEffect(() => {
    localStorage.setItem(MODALITA_KEY, modalita)
    setDati(null)
    setDatiComp(null)
    setWeekIdx(0)
    setSnapIdx(0)
    setConfrontaPrevSett(false)
    setConfrontaPrevAnno(false)
  }, [modalita])

  // Carica entrambe le liste al mount (per evitare ritardi al cambio modalità)
  useEffect(() => {
    api.get('/settimane/gruppo')
      .then(({ data }) => setSettimane(data.settimane || []))
      .catch(() => setSettimane([]))
    api.get('/dashboard/gruppo/snapshots')
      .then(({ data }) => setSnapshots(data.snapshots || []))
      .catch(() => setSnapshots([]))
  }, [])

  const currentWeek = settimane[weekIdx] || null
  const currentSnap = snapshots[snapIdx] || null

  // Snapshot di confronto per modalità stagione
  const compSnap = useMemo(() => {
    if (!confrontaPrevSett && !confrontaPrevAnno) return null
    if (modalita !== 'stagione' || !currentSnap) return null
    if (confrontaPrevSett) return snapshots[snapIdx + 1] || null
    if (confrontaPrevAnno) {
      const target = new Date(addDays(currentSnap.snapshot_date, -364) + 'T00:00:00')
      const closest = snapshots.reduce((best, s) => {
        if (!best) return s
        const d1 = Math.abs(new Date(s.snapshot_date + 'T00:00:00') - target)
        const d2 = Math.abs(new Date(best.snapshot_date + 'T00:00:00') - target)
        return d1 < d2 ? s : best
      }, null)
      if (!closest) return null
      const days = Math.abs((new Date(closest.snapshot_date + 'T00:00:00') - target) / 86400000)
      return days <= 30 ? closest : null
    }
    return null
  }, [modalita, confrontaPrevSett, confrontaPrevAnno, currentSnap, snapshots, snapIdx])

  const caricaDati = useCallback(async () => {
    if (modalita === 'pace') return
    if (modalita === 'settimana' && !currentWeek) return
    if (modalita === 'stagione' && !currentSnap) return
    setLoading(true)
    setErrore(null)
    try {
      let url, urlComp = null
      const confrontoAttivo = confrontaPrevSett || confrontaPrevAnno

      if (modalita === 'stagione') {
        url = `/dashboard/gruppo?modalita=stagione&snapshot=${currentSnap.snapshot_date}`
        if (confrontoAttivo && compSnap) {
          urlComp = `/dashboard/gruppo?modalita=stagione&snapshot=${compSnap.snapshot_date}`
        }
      } else {
        const snap = currentWeek.snapshot_date ? `&snapshot=${currentWeek.snapshot_date}` : ''
        url = `/dashboard/gruppo?modalita=settimana&settimana=${currentWeek.week_start}${snap}`
        if (confrontaPrevSett) {
          urlComp = `/dashboard/gruppo?modalita=settimana&settimana=${addDays(currentWeek.week_start, -7)}${snap}`
        } else if (confrontaPrevAnno) {
          urlComp = `/dashboard/gruppo?modalita=settimana&settimana=${addDays(currentWeek.week_start, -364)}`
        }
      }

      const { data } = await api.get(url)
      setDati(data)

      // In modalità stagione carica l'occupazione settimanale per-hotel in parallelo
      if (modalita === 'stagione') {
        const codici = data.hotel_attivi || []
        const risultati = await Promise.all(
          codici.map(code =>
            api.get(`/dashboard/hotel/${code}?snapshot=${currentSnap.snapshot_date}`)
              .then(r => ({ code, settimane: r.data.settimane || [] }))
              .catch(() => ({ code, settimane: [] }))
          )
        )
        const byHotel = {}
        risultati.forEach(({ code, settimane }) => { byHotel[code] = settimane })
        setSettimanePerHotel(byHotel)
      } else {
        setSettimanePerHotel({})
      }

      if (confrontoAttivo && urlComp) {
        try {
          const { data: comp } = await api.get(urlComp)
          setDatiComp(comp)
          setCompDisponibile(true)
        } catch {
          setDatiComp(null)
          setCompDisponibile(false)
        }
      } else {
        setDatiComp(null)
        setCompDisponibile(
          !confrontoAttivo ||
          (modalita === 'stagione' ? !!compSnap : true)
        )
      }
    } catch (err) {
      setErrore(mostraErrore(err))
      setDati(null)
    } finally {
      setLoading(false)
    }
  }, [modalita, currentWeek, currentSnap, compSnap, confrontaPrevSett, confrontaPrevAnno])

  useEffect(() => { caricaDati() }, [caricaDati])

  // Navigazione unificata in base alla modalità
  const navItems = modalita === 'settimana' ? settimane : snapshots
  const navIdx   = modalita === 'settimana' ? weekIdx   : snapIdx
  const setNavIdx = modalita === 'settimana' ? setWeekIdx : setSnapIdx

  let titoloNav = '', subtitleNav = ''
  if (modalita === 'settimana' && currentWeek) {
    titoloNav   = `Settimana ${currentWeek.label}`
    subtitleNav = currentWeek.snapshot_label ? `snapshot ${currentWeek.snapshot_label}` : ''
  } else if (modalita === 'stagione' && currentSnap) {
    titoloNav   = `Stagione ${currentSnap.snapshot_date.slice(0, 4)} — Gruppo`
    subtitleNav = `snapshot ${currentSnap.label}`
  }

  const compLabel = confrontaPrevSett
    ? (modalita === 'stagione' ? (compSnap?.label || 'snap. prec.') : 'sett. prec.')
    : confrontaPrevAnno ? 'anno prec.' : null

  return (
    <div>
      <h2 style={{ marginBottom: '1rem' }}>Dashboard Gruppo</h2>

      {/* Toggle modalità */}
      <div className="card" style={{
        marginBottom: '1rem',
        display: 'flex', alignItems: 'center', gap: '0.5rem',
      }}>
        <span style={{ fontSize: 13, color: '#6b7280', marginRight: 4, fontWeight: 600 }}>
          Visualizzazione:
        </span>
        <button style={styleToggle(modalita === 'settimana')} onClick={() => setModalita('settimana')}>
          Settimana per settimana
        </button>
        <button style={styleToggle(modalita === 'stagione')} onClick={() => setModalita('stagione')}>
          Stagione intera
        </button>
        <button style={styleToggle(modalita === 'pace')} onClick={() => setModalita('pace')}>
          Ritmo prenotazioni
        </button>
      </div>

      {modalita === 'pace' && <SezionePace />}

      {/* Navigazione + confronti */}
      {modalita !== 'pace' && navItems.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <button
              onClick={() => setNavIdx(i => i + 1)}
              disabled={navIdx >= navItems.length - 1}
              style={{ padding: '4px 12px', fontSize: 13 }}
            >← Prec.</button>

            <div style={{ flex: 1, textAlign: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{titoloNav}</span>
              {subtitleNav && (
                <span style={{ color: '#6b7280', fontSize: 12, marginLeft: 8 }}>
                  | {subtitleNav}
                </span>
              )}
              <span style={{ color: '#6b7280', fontSize: 12, marginLeft: 8 }}>
                ({navItems.length} {modalita === 'settimana' ? 'settimane' : 'snapshot'})
              </span>
            </div>

            <button
              onClick={() => setNavIdx(i => i - 1)}
              disabled={navIdx <= 0}
              style={{ padding: '4px 12px', fontSize: 13 }}
            >Succ. →</button>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', fontSize: 13, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={confrontaPrevSett}
                onChange={e => {
                  setConfrontaPrevSett(e.target.checked)
                  if (e.target.checked) setConfrontaPrevAnno(false)
                }} />
              {modalita === 'stagione' ? 'Confronta snapshot precedente' : 'Confronta settimana precedente'}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={confrontaPrevAnno}
                onChange={e => {
                  setConfrontaPrevAnno(e.target.checked)
                  if (e.target.checked) setConfrontaPrevSett(false)
                }} />
              Confronta anno precedente
            </label>
            {(confrontaPrevSett || confrontaPrevAnno) && !compDisponibile && (
              <span style={{
                background: '#e5e7eb', color: '#6b7280',
                padding: '2px 10px', borderRadius: 12, fontSize: 12,
              }}>
                Dati confronto non disponibili
              </span>
            )}
          </div>
        </div>
      )}

      {modalita !== 'pace' && loading && <p>Caricamento…</p>}
      {modalita !== 'pace' && errore && (
        <div style={{
          padding: '1rem', background: '#fee2e2',
          borderRadius: 8, color: '#991b1b', marginBottom: '1rem',
        }}>
          {errore}
        </div>
      )}

      {modalita !== 'pace' && dati && (
        <ContenutoDashboardGruppo
          dati={dati}
          datiComp={compDisponibile ? datiComp : null}
          compLabel={compLabel}
          modalita={modalita}
          isAnnoPrecedente={confrontaPrevAnno}
          settimanePerHotel={settimanePerHotel}
          snapshotDate={currentSnap?.snapshot_date}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ritmo prenotazioni (booking pace) — crescita OTB di un mese target
// attraverso tutti gli snapshot, una linea per hotel
// ---------------------------------------------------------------------------

const MESI_PACE = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
                    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
const PACE_VISTA_KEY = 'pace_vista'

function SezionePace() {
  const oggi = new Date()
  const [mese, setMese] = useState(oggi.getMonth() + 1)
  const [anno, setAnno] = useState(oggi.getFullYear())
  const [dati, setDati] = useState(null)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)
  const [vista, setVista] = useState(() => localStorage.getItem(PACE_VISTA_KEY) || 'assoluto')

  const cambiaVista = (v) => { setVista(v); localStorage.setItem(PACE_VISTA_KEY, v) }

  useEffect(() => {
    setLoading(true)
    setErrore(null)
    api.get(`/forecast/pace-gruppo?anno=${anno}&mese=${mese}`)
      .then(({ data }) => setDati(data))
      .catch(err => { setErrore(mostraErrore(err)); setDati(null) })
      .finally(() => setLoading(false))
  }, [anno, mese])

  const mesePrec = () => { if (mese === 1) { setMese(12); setAnno(a => a - 1) } else setMese(m => m - 1) }
  const meseSucc = () => { if (mese === 12) { setMese(1); setAnno(a => a + 1) } else setMese(m => m + 1) }

  // Unisce i punti di ogni struttura in righe per snapshot_date: { snapshot_date, DPH, CLB, INT }
  const chartData = useMemo(() => {
    if (!dati) return []
    const perData = {}
    dati.strutture.forEach(s => {
      s.punti.forEach(p => {
        if (!perData[p.snapshot_date]) perData[p.snapshot_date] = { snapshot_date: p.snapshot_date }
        perData[p.snapshot_date][s.hotel_code] = p.otb_revenue
      })
    })
    return Object.values(perData).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
  }, [dati])

  const codiciHotel = dati ? dati.strutture.map(s => s.hotel_code) : []
  const nessunDato = dati && chartData.length === 0

  // Vista indicizzata (base 100 alla prima snapshot disponibile per hotel): confronta la
  // FORMA della crescita a prescindere dal volume assoluto, per capire chi sta accelerando
  // di più nel pickup, indipendentemente dalla dimensione/fatturato complessivo dell'hotel.
  const chartDataIndicizzato = useMemo(() => {
    const basi = {}
    codiciHotel.forEach(code => {
      const primo = chartData.find(d => d[code] != null && d[code] !== 0)
      basi[code] = primo ? primo[code] : null
    })
    return chartData.map(d => {
      const row = { snapshot_date: d.snapshot_date }
      codiciHotel.forEach(code => {
        const base = basi[code]
        row[code] = (d[code] != null && base) ? (d[code] / base) * 100 : null
      })
      return row
    })
  }, [chartData, codiciHotel])

  const datiGrafico = vista === 'indicizzato' ? chartDataIndicizzato : chartData

  return (
    <div className="card sezione" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button onClick={mesePrec} style={{ padding: '4px 12px', fontSize: 13 }}>← Prec.</button>
        <div style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 15 }}>
          {MESI_PACE[mese]} {anno}
        </div>
        <button onClick={meseSucc} style={{ padding: '4px 12px', fontSize: 13 }}>Succ. →</button>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['assoluto', 'Valore assoluto'], ['indicizzato', 'Crescita indicizzata']].map(([v, l]) => (
            <button key={v} onClick={() => cambiaVista(v)} style={{
              padding: '4px 12px', borderRadius: 6, border: '1px solid', fontSize: 13,
              cursor: 'pointer', fontWeight: vista === v ? 700 : 400,
              background: vista === v ? '#1e3a5f' : '#f8fafc',
              color: vista === v ? '#fff' : '#64748b',
              borderColor: vista === v ? '#1e3a5f' : '#e2e8f0',
            }}>{l}</button>
          ))}
        </div>
      </div>

      {vista === 'indicizzato' && (
        <p style={{ color: '#6b7280', fontSize: 12.5, margin: '-0.5rem 0 0.75rem' }}>
          Ogni linea parte da 100 alla prima snapshot disponibile: mostra la velocità di crescita del
          pickup a prescindere dal volume assoluto di ciascun hotel.
        </p>
      )}

      {loading && <p>Caricamento…</p>}
      {errore && (
        <div style={{ padding: '1rem', background: '#fee2e2', borderRadius: 8, color: '#991b1b', marginBottom: '1rem' }}>
          {errore}
        </div>
      )}
      {nessunDato && !loading && !errore && (
        <p style={{ color: '#6b7280', fontSize: 13 }}>Nessuno snapshot disponibile per questo mese.</p>
      )}

      {chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={datiGrafico} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="snapshot_date" tick={{ fontSize: 10 }} tickFormatter={formatData} />
            <YAxis tickFormatter={vista === 'indicizzato' ? (v => v.toFixed(0)) : (v => `${(v / 1000).toFixed(0)}k`)} />
            <Tooltip
              labelFormatter={formatData}
              formatter={vista === 'indicizzato' ? (v => v != null ? v.toFixed(1) : '—') : (v => formatEuro(v))}
            />
            <Legend />
            {vista === 'indicizzato' && (
              <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="4 4" />
            )}
            {codiciHotel.map(code => (
              <Line
                key={code}
                type="monotone"
                dataKey={code}
                stroke={COLORI_HOTEL[code] || '#999'}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
                name={code}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Contenuto dashboard gruppo
// ---------------------------------------------------------------------------

function ContenutoDashboardGruppo({ dati, datiComp, compLabel, modalita, isAnnoPrecedente, settimanePerHotel = {}, snapshotDate }) {
  const kpi      = dati.kpi_gruppo
  const kpiComp  = datiComp?.kpi_gruppo || null
  const contributi = dati.contributi || []
  const settimane  = dati.settimane  || []

  function kpiDelta(key) { return calcolaDelta(kpi[key], kpiComp?.[key]) }
  function kpiCompV(key, fmt) { return kpiComp ? (kpiComp[key] != null ? fmt(kpiComp[key]) : '—') : null }

  const exportParams = dati.periodo_da && dati.periodo_a
    ? `?da=${dati.periodo_da}&a=${dati.periodo_a}` : ''

  // Merge per week_start (non per indice) per evitare confronti sfasati
  // tra snapshot con numero di settimane diverso.
  // "Anno precedente": le settimane di confronto sono a -364 giorni → allineiamo
  // sottraendo 364 dalla chiave corrente prima di cercare nella mappa.
  const settimaneConfronto = useMemo(() => {
    if (!datiComp) return settimane.map(s => ({ ...s }))
    const compMap = {}
    ;(datiComp.settimane || []).forEach(c => { compMap[c.week_start] = c })
    return settimane.map(s => {
      const chiaveComp = isAnnoPrecedente ? addDays(s.week_start, -364) : s.week_start
      const comp = compMap[chiaveComp]
      return {
        ...s,
        trevpar_comp:       comp?.trevpar        ?? null,
        revpar_comp:        comp?.revpar         ?? null,
        revenue_total_comp: comp?.revenue_total  ?? null,
        occupancy_comp:     comp?.occupancy      ?? null,
      }
    })
  }, [settimane, datiComp, isAnnoPrecedente])

  // Dati per grafico occupazione comparativa per hotel (solo modalità stagione)
  const occupazioneComparativa = useMemo(() => {
    const codici = Object.keys(settimanePerHotel)
    if (codici.length === 0) return []
    const tutteWeek = new Set()
    codici.forEach(code => settimanePerHotel[code].forEach(w => tutteWeek.add(w.week_start)))
    return [...tutteWeek].sort().map(ws => {
      const row = { week_start: ws, label: ws }
      codici.forEach(code => {
        const w = settimanePerHotel[code].find(s => s.week_start === ws)
        if (w && !row.label.includes('/')) row.label = w.label
        row[code] = w?.occupancy != null ? Math.round(w.occupancy * 10) / 10 : null
      })
      return row
    })
  }, [settimanePerHotel])

  const hotelesAttivi = Object.keys(settimanePerHotel)

  const datiContributoBar = contributi.map(c => ({
    name: c.hotel_code,
    revenue_rooms: c.revenue_rooms,
    revenue_fnb:   c.revenue_fnb,
    revenue_extra: c.revenue_extra,
  }))

  return (
    <>
      <div style={{ marginBottom: '0.5rem', color: '#6b7280', fontSize: 13 }}>
        Hotel attivi: {dati.hotel_attivi.join(', ')} — periodo: {formatData(dati.periodo_da)} – {formatData(dati.periodo_a)}
        {compLabel && datiComp && (
          <span style={{ marginLeft: 8, color: '#9ca3af' }}>vs. {compLabel}</span>
        )}
      </div>

      {/* KPI gruppo */}
      <div className="grid-kpi sezione">
        <KPICard label="Camere vendute" value={formatN(kpi.rooms_sold)}
          compValue={kpiCompV('rooms_sold', formatN)} compLabel={compLabel} delta={kpiDelta('rooms_sold')} />
        <KPICard label="Occupazione" value={kpi.occupancy != null ? formatPerc(kpi.occupancy) : '—'}
          compValue={kpiCompV('occupancy', formatPerc)} compLabel={compLabel} delta={kpiDelta('occupancy')} />
        <KPICard label="ADR Gruppo" value={kpi.adr != null ? formatEuro(kpi.adr) : '—'}
          compValue={kpiCompV('adr', formatEuro)} compLabel={compLabel} delta={kpiDelta('adr')} />
        <KPICard label="RevPAR" value={kpi.revpar != null ? formatEuro(kpi.revpar) : '—'}
          compValue={kpiCompV('revpar', formatEuro)} compLabel={compLabel} delta={kpiDelta('revpar')} />
        <KPICard label="TRevPAR" value={kpi.trevpar != null ? formatEuro(kpi.trevpar) : '—'}
          compValue={kpiCompV('trevpar', formatEuro)} compLabel={compLabel} delta={kpiDelta('trevpar')} />
        <KPICard label="RMC" value={kpi.rmc != null ? formatEuro(kpi.rmc) : '—'}
          compValue={kpiCompV('rmc', formatEuro)} compLabel={compLabel} delta={kpiDelta('rmc')} />
        <KPICard label="Inc. Rooms" value={kpi.inc_rooms != null ? formatPerc(kpi.inc_rooms) : '—'}
          compValue={kpiCompV('inc_rooms', formatPerc)} compLabel={compLabel} delta={kpiDelta('inc_rooms')} />
        <KPICard label="Inc. F&B" value={kpi.inc_fnb != null ? formatPerc(kpi.inc_fnb) : '—'}
          compValue={kpiCompV('inc_fnb', formatPerc)} compLabel={compLabel} delta={kpiDelta('inc_fnb')} />
        <KPICard label="Inc. Extra" value={kpi.inc_extra != null ? formatPerc(kpi.inc_extra) : '—'}
          compValue={kpiCompV('inc_extra', formatPerc)} compLabel={compLabel} delta={kpiDelta('inc_extra')} />
        <KPICard label="Tot. Revenue" value={kpi.revenue_total != null ? formatEuroK(kpi.revenue_total) : '—'}
          compValue={kpiCompV('revenue_total', formatEuroK)} compLabel={compLabel} delta={kpiDelta('revenue_total')} />
      </div>

      {/* Contributo revenue per hotel */}
      {contributi.length > 0 && (
        <div className="card sezione">
          <SezioneHeader titolo="Contributo revenue per hotel"
            exportUrl={`/export/gruppo${exportParams}`} exportNome="gruppo_settimanale" />
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={datiContributoBar} layout="vertical" margin={{ left: 30, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 'auto']} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 13 }} />
              <Tooltip formatter={v => formatEuro(v)} />
              <Legend />
              <ReferenceLine x={0} stroke="#9ca3af" strokeWidth={1} />
              <Bar dataKey="revenue_rooms" name="Camere" stackId="r" fill="#3b82f6" />
              <Bar dataKey="revenue_fnb"   name="F&B"    stackId="r" fill="#10b981" />
              <Bar dataKey="revenue_extra" name="Extra"  stackId="r" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tabella dettaglio per hotel */}
      {contributi.length > 0 && (
        <div className="card sezione">
          <SezioneHeader titolo="Dettaglio per hotel"
            exportUrl={`/export/gruppo${exportParams}`} exportNome="gruppo_settimanale" />
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Hotel</th>
                  <th>Cam. vend.</th><th>Cam. disp.</th><th>Occup.</th>
                  <th>ADR</th><th>RevPAR</th>
                  <th>Rev. Camere</th><th>Rev. F&B</th><th>Rev. Extra</th>
                  <th>Rev. Totale</th><th>% Gruppo</th>
                </tr>
              </thead>
              <tbody>
                {contributi.map(c => (
                  <tr key={c.hotel_code}>
                    <td>
                      <span style={{
                        display: 'inline-block', width: 10, height: 10,
                        borderRadius: '50%',
                        background: COLORI_HOTEL[c.hotel_code] || '#999', marginRight: 6,
                      }} />
                      {c.hotel_name}
                    </td>
                    <td>{formatN(c.rooms_sold)}</td>
                    <td>{formatN(c.rooms_available)}</td>
                    <td>{c.occupancy != null ? formatPerc(c.occupancy) : '—'}</td>
                    <td>{c.adr != null ? formatEuro(c.adr) : '—'}</td>
                    <td>{c.revpar != null ? formatEuro(c.revpar) : '—'}</td>
                    <td>{formatEuro(c.revenue_rooms)}</td>
                    <td>{formatEuro(c.revenue_fnb)}</td>
                    <td>{formatEuro(c.revenue_extra)}</td>
                    <td>{formatEuro(c.revenue_total)}</td>
                    <td>{c.perc_revenue != null ? formatPerc(c.perc_revenue) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Occupazione comparativa per hotel — solo stagione intera */}
      {modalita === 'stagione' && occupazioneComparativa.length > 0 && (
        <div className="card sezione">
          <SezioneHeader titolo="Occupazione settimanale per hotel" />
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={occupazioneComparativa} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} width={42} />
              <Tooltip formatter={(v, name) => [v != null ? `${v.toFixed(1)}%` : '—', name]} />
              <Legend />
              {pastReferenceArea(occupazioneComparativa, 'week_start', 'label', snapshotDate)}
              {hotelesAttivi.map(code => (
                <Line
                  key={code}
                  type="monotone"
                  dataKey={code}
                  stroke={COLORI_HOTEL[code] || '#999'}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  name={code}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Trend settimanale RevPAR / TRevPAR — solo stagione intera */}
      {modalita === 'stagione' && settimane.length > 0 && (
        <div className="card sezione">
          <SezioneHeader titolo="Trend settimanale gruppo RevPAR / TRevPAR"
            exportUrl={`/export/gruppo${exportParams}`} exportNome="gruppo_settimanale" />
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={settimaneConfronto} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => formatEuro(v)} />
              <Tooltip formatter={v => formatEuro(v)} />
              <Legend />
              {pastReferenceArea(settimaneConfronto, 'week_start', 'label', snapshotDate)}
              <Line type="monotone" dataKey="trevpar" stroke="#3b82f6" dot={false} name="TRevPAR" strokeWidth={2} />
              <Line type="monotone" dataKey="revpar"  stroke="#10b981" dot={false} name="RevPAR"  strokeWidth={2} />
              {datiComp && <>
                <Line type="monotone" dataKey="trevpar_comp" stroke="#93c5fd" dot={false} strokeDasharray="4 4" name={`TRevPAR ${compLabel}`} />
                <Line type="monotone" dataKey="revpar_comp"  stroke="#6ee7b7" dot={false} strokeDasharray="4 4" name={`RevPAR ${compLabel}`} />
              </>}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Trend settimanale Revenue — solo stagione intera */}
      {modalita === 'stagione' && settimane.length > 0 && (
        <div className="card sezione">
          <SezioneHeader titolo="Trend settimanale Revenue"
            exportUrl={`/export/gruppo${exportParams}`} exportNome="gruppo_settimanale" />
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={settimaneConfronto} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={v => formatEuro(v)} />
              <Legend />
              {pastReferenceArea(settimaneConfronto, 'week_start', 'label', snapshotDate)}
              <Line type="monotone" dataKey="revenue_total" stroke="#f59e0b" dot={false} name="Tot. Revenue" strokeWidth={2} />
              {datiComp && (
                <Line type="monotone" dataKey="revenue_total_comp" stroke="#fcd34d" dot={false} strokeDasharray="4 4" name={`Tot. Revenue ${compLabel}`} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Trend settimanale Occupazione — solo stagione intera */}
      {modalita === 'stagione' && settimane.length > 0 && (
        <div className="card sezione">
          <SezioneHeader titolo="Trend settimanale Occupazione"
            exportUrl={`/export/gruppo${exportParams}`} exportNome="gruppo_settimanale" />
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={settimaneConfronto} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => `${v.toFixed(1)}%`} domain={[0, 100]} />
              <Tooltip formatter={(v, n) => [v != null ? `${Number(v).toFixed(1)}%` : '—', n]} />
              <Legend />
              {pastReferenceArea(settimaneConfronto, 'week_start', 'label', snapshotDate)}
              <Line type="monotone" dataKey="occupancy" stroke="#8b5cf6" dot={false} name="Occupazione %" strokeWidth={2} />
              {datiComp && (
                <Line type="monotone" dataKey="occupancy_comp" stroke="#c4b5fd" dot={false} strokeDasharray="4 4" name={`Occup. ${compLabel}`} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Aggregati settimanali gruppo — solo stagione intera */}
      {modalita === 'stagione' && settimane.length > 0 && (
        <div className="card sezione">
          <SezioneHeader titolo="Aggregati settimanali gruppo"
            exportUrl={`/export/gruppo${exportParams}`} exportNome="gruppo_settimanale" />
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Settimana</th>
                  <th>Hotel</th><th>Cam. vend.</th><th>Occup.</th>
                  <th>ADR</th><th>RevPAR</th><th>TRevPAR</th>
                  <th>Rev. Camere</th><th>Rev. F&B</th><th>Rev. Extra</th><th>Rev. Totale</th>
                </tr>
              </thead>
              <tbody>
                {settimane.map((s, i) => (
                  <tr key={i}>
                    <td>{s.label}</td>
                    <td>{s.hotel_attivi?.join(', ')}</td>
                    <td>{formatN(s.rooms_sold)}</td>
                    <td>{s.occupancy != null ? formatPerc(s.occupancy) : '—'}</td>
                    <td>{s.adr     != null ? formatEuro(s.adr)     : '—'}</td>
                    <td>{s.revpar  != null ? formatEuro(s.revpar)  : '—'}</td>
                    <td>{s.trevpar != null ? formatEuro(s.trevpar) : '—'}</td>
                    <td>{formatEuro(s.revenue_rooms)}</td>
                    <td>{formatEuro(s.revenue_fnb)}</td>
                    <td>{formatEuro(s.revenue_extra)}</td>
                    <td>{formatEuro(s.revenue_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Componenti di supporto
// ---------------------------------------------------------------------------

