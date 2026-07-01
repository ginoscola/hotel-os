import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceArea,
} from 'recharts'
import api from '../api/client.js'
import KPICard from '../components/KPICard.jsx'
import { ExportMenu, SezioneHeader } from '../components/ExportMenu.jsx'
import pastReferenceArea from '../components/PastReferenceArea.jsx'
import { useSnapshotConfronto } from '../hooks/useSnapshotConfronto.js'
import {
  formatEuro, formatPerc, formatN, formatData, addDays, calcolaDelta, mostraErrore,
} from '../utils/format.js'

const HOTEL_CODES = ['CLB', 'DPH', 'INT']
const HOTEL_NOMI = { CLB: 'Club Hotel', DPH: 'Hotel Du Parc', INT: 'Hotel International' }

const MESI_IT = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
]

function aggregaMensile(giorni) {
  const mesi = {}
  for (const g of giorni) {
    if (!g.data) continue
    const ym = g.data.slice(0, 7)
    if (!mesi[ym]) {
      mesi[ym] = {
        ym, rooms_sold: 0, rooms_available: 0,
        revenue_rooms: 0, revenue_fnb: 0, revenue_extra: 0, revenue_total: 0,
        giorni_presenze: 0,
      }
    }
    const m = mesi[ym]
    m.rooms_sold     += g.rooms_sold     || 0
    m.rooms_available += g.rooms_available || 0
    m.revenue_rooms  += g.revenue_rooms  || 0
    m.revenue_fnb    += g.revenue_fnb    || 0
    m.revenue_extra  += g.revenue_extra  || 0
    m.revenue_total  += g.revenue_total  || 0
    if ((g.rooms_sold || 0) > 0) m.giorni_presenze += 1
  }
  return Object.values(mesi)
    .filter(m => m.rooms_sold > 0)
    .sort((a, b) => a.ym.localeCompare(b.ym))
    .map(m => {
      const [year, month] = m.ym.split('-')
      const label    = `${MESI_IT[parseInt(month) - 1]} ${year}`
      const rs = m.rooms_sold, ra = m.rooms_available, rt = m.revenue_total
      return {
        label,
        giorni:      m.giorni_presenze,
        rooms_sold:  rs,
        rooms_available: ra,
        revenue_rooms:  m.revenue_rooms,
        revenue_fnb:    m.revenue_fnb,
        revenue_extra:  m.revenue_extra,
        revenue_total:  rt,
        occupancy: ra > 0 ? (rs / ra * 100) : null,
        adr:       rs > 0 ? (m.revenue_rooms / rs) : null,
        rmc:       rs > 0 ? (rt / rs) : null,
        revpar:    ra > 0 ? (m.revenue_rooms / ra) : null,
        trevpar:   ra > 0 ? (rt / ra) : null,
        inc_rooms: rt > 0 ? (m.revenue_rooms / rt * 100) : null,
        inc_fnb:   rt > 0 ? (m.revenue_fnb   / rt * 100) : null,
        inc_extra: rt > 0 ? (m.revenue_extra  / rt * 100) : null,
      }
    })
}

/**
 * Allinea i dati di confronto ai giorni correnti.
 * Per "anno precedente": le date di confronto (es. 2025-05-03) vengono
 * spostate di +364 giorni per collimare con le date 2026.
 * Per "settimana precedente": allineamento per data esatta.
 */
function mergeConfrontoGiorni(giorni, giorniComp, isAnnoPrecedente) {
  if (!giorniComp || giorniComp.length === 0) return giorni
  const compMap = {}
  giorniComp.forEach(g => {
    const key = isAnnoPrecedente ? addDays(g.data, 364) : g.data
    compMap[key] = g
  })
  return giorni.map(g => {
    const comp = compMap[g.data]
    return {
      ...g,
      occupancy_comp: comp?.occupancy ?? null,
      revenue_rooms_comp: comp?.revenue_rooms ?? null,
      revenue_fnb_comp: comp?.revenue_fnb ?? null,
      revenue_extra_comp: comp?.revenue_extra ?? null,
      revenue_total_comp: comp?.revenue_total ?? null,
    }
  })
}

// Formatta solo le date Sabato (inizio settimana commerciale) per l'asse X
function tickFormatterSabato(isoDate) {
  const d = new Date(isoDate + 'T00:00:00')
  if (d.getDay() === 6) {
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  return ''
}

export default function DashboardHotel() {
  const { hotelCode } = useParams()
  const navigate = useNavigate()
  const [hotel, setHotel] = useState((hotelCode || 'CLB').toUpperCase())

  const [snapshots, setSnapshots] = useState([])
  const [snapIdx, setSnapIdx] = useState(0)

  const [confrontaPrevSett, setConfrontaPrevSett] = useState(false)
  const [confrontaPrevAnno, setConfrontaPrevAnno] = useState(false)

  const [dati, setDati] = useState(null)
  const [datiComp, setDatiComp] = useState(null)
  const [compDisponibile, setCompDisponibile] = useState(true)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)

  const [giornalieriEspansi, setGiornalieriEspansi] = useState(false)

  // Sincronizza hotel state con il parametro URL (navigazione da NavBar)
  useEffect(() => {
    if (hotelCode) setHotel(hotelCode.toUpperCase())
  }, [hotelCode])

  // Carica lista snapshot al cambio hotel
  useEffect(() => {
    setDati(null)
    setDatiComp(null)
    setSnapshots([])
    setSnapIdx(0)
    api.get(`/snapshots/${hotel}`)
      .then(({ data }) => setSnapshots(data.snapshots || []))
      .catch(() => setSnapshots([]))
    const saved = localStorage.getItem(`giornalieri_${hotel}`)
    setGiornalieriEspansi(saved === 'true')
  }, [hotel])

  const currentSnap = snapshots[snapIdx] || null

  const compSnap = useSnapshotConfronto({ snapshots, snapIdx, confrontaPrevSett, confrontaPrevAnno })

  // Carica dati dashboard al cambio snapshot o confronto
  const caricaDati = useCallback(async () => {
    if (!currentSnap) return
    setLoading(true)
    setErrore(null)
    try {
      const { data } = await api.get(
        `/dashboard/hotel/${hotel}?snapshot=${currentSnap.snapshot_date}`
      )
      setDati(data)

      const confrontoAttivo = confrontaPrevSett || confrontaPrevAnno
      if (confrontoAttivo && compSnap) {
        try {
          const { data: comp } = await api.get(
            `/dashboard/hotel/${hotel}?snapshot=${compSnap.snapshot_date}`
          )
          setDatiComp(comp)
          setCompDisponibile(true)
        } catch {
          setDatiComp(null)
          setCompDisponibile(false)
        }
      } else {
        setDatiComp(null)
        setCompDisponibile(!confrontoAttivo || !!(confrontoAttivo && compSnap))
      }
    } catch (err) {
      setErrore(mostraErrore(err))
      setDati(null)
    } finally {
      setLoading(false)
    }
  }, [hotel, currentSnap, compSnap, confrontaPrevSett, confrontaPrevAnno])

  useEffect(() => { caricaDati() }, [caricaDati])

  function handleHotelChange(code) {
    setHotel(code)
    navigate(`/dashboard/hotel/${code}`)
  }

  function toggleGiornalieri() {
    const v = !giornalieriEspansi
    setGiornalieriEspansi(v)
    localStorage.setItem(`giornalieri_${hotel}`, String(v))
  }

  const compLabel = confrontaPrevSett
    ? (compSnap ? compSnap.label : 'sett. prec.')
    : confrontaPrevAnno ? 'anno prec.' : null

  const confrontoAttivo = confrontaPrevSett || confrontaPrevAnno
  const mostraCompNonDisp = confrontoAttivo && !compDisponibile

  return (
    <div>
      {/* Selezione hotel */}
      <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Hotel</label>
          <select value={hotel} onChange={e => handleHotelChange(e.target.value)}>
            {HOTEL_CODES.map(c => <option key={c} value={c}>{HOTEL_NOMI[c]}</option>)}
          </select>
        </div>
      </div>

      {/* Navigazione snapshot */}
      {snapshots.length > 0 && currentSnap && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <button
              onClick={() => setSnapIdx(i => i + 1)}
              disabled={snapIdx >= snapshots.length - 1}
              style={{ padding: '4px 12px', fontSize: 13 }}
            >← Prec.</button>

            <div style={{ flex: 1, textAlign: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>
                Snapshot {currentSnap.label}
              </span>
              <span style={{ color: '#6b7280', fontSize: 12, marginLeft: 8 }}>
                ({snapshots.length} snapshot disponibili)
              </span>
              {currentSnap.n_anomalie > 0 && (
                <span title={`${currentSnap.n_anomalie} anomali${currentSnap.n_anomalie === 1 ? 'a' : 'e'} rilevat${currentSnap.n_anomalie === 1 ? 'a' : 'e'} durante l'import`}
                  style={{
                    marginLeft: 10, background: '#fef3c7', color: '#92400e',
                    border: '1px solid #fbbf24', padding: '2px 8px',
                    borderRadius: 12, fontSize: 11, cursor: 'default',
                  }}>
                  ⚠ {currentSnap.n_anomalie} anomali{currentSnap.n_anomalie === 1 ? 'a' : 'e'}
                </span>
              )}
            </div>

            <button
              onClick={() => setSnapIdx(i => i - 1)}
              disabled={snapIdx <= 0}
              style={{ padding: '4px 12px', fontSize: 13 }}
            >Succ. →</button>
          </div>

          {/* Toggle confronti (mutuamente esclusivi) */}
          <div style={{ display: 'flex', gap: '1.5rem', fontSize: 13, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={confrontaPrevSett}
                onChange={e => {
                  setConfrontaPrevSett(e.target.checked)
                  if (e.target.checked) setConfrontaPrevAnno(false)
                }} />
              Confronta snapshot precedente
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={confrontaPrevAnno}
                onChange={e => {
                  setConfrontaPrevAnno(e.target.checked)
                  if (e.target.checked) setConfrontaPrevSett(false)
                }} />
              Confronta anno precedente
            </label>
            {mostraCompNonDisp && (
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

      {snapshots.length === 0 && !loading && (
        <div className="card" style={{ color: '#6b7280', textAlign: 'center', padding: '2rem' }}>
          Nessuna snapshot disponibile per {HOTEL_NOMI[hotel] || hotel}. Importare prima i file CSV.
        </div>
      )}

      {loading && <p>Caricamento…</p>}
      {errore && (
        <div style={{
          padding: '1rem', background: '#fee2e2',
          borderRadius: 8, color: '#991b1b', marginBottom: '1rem',
        }}>
          {errore}
        </div>
      )}

      {dati && (
        <ContenutoDashboard
          dati={dati}
          datiComp={compDisponibile ? datiComp : null}
          compLabel={compLabel}
          isAnnoPrecedente={confrontaPrevAnno}
          hotel={hotel}
          currentSnap={currentSnap}
          giornalieriEspansi={giornalieriEspansi}
          onToggleGiornalieri={toggleGiornalieri}
        />
      )}
    </div>
  )
}

function CardCorrispettivi({ hotel, data }) {
  const [kpi, setKpi] = useState(null)

  useEffect(() => {
    if (!data) return
    setKpi(null)
    api.get(`/corrispettivi/kpi/giornaliero?data=${data}&struttura_code=${hotel}`)
      .then(r => setKpi(r.data))
      .catch(() => setKpi(null))
  }, [hotel, data])

  if (!kpi || kpi.n_documenti === 0) return null

  return (
    <div className="card sezione" style={{ marginTop: '1rem' }}>
      <h3 style={{ margin: '0 0 0.75rem' }}>Corrispettivi — {data}</h3>
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Documenti</div>
          <div style={{ fontWeight: 600, fontSize: 20 }}>{kpi.n_documenti}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Incassato</div>
          <div style={{ fontWeight: 600, fontSize: 20 }}>{formatEuro(kpi.totale_incassato)}</div>
        </div>
        {kpi.totale_sospeso > 0 && (
          <div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Sospeso</div>
            <div style={{ fontWeight: 600, fontSize: 20, color: '#d97706' }}>{formatEuro(kpi.totale_sospeso)}</div>
          </div>
        )}
        {kpi.n_sospesi_aperti > 0 && (
          <div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Sospesi aperti</div>
            <div style={{ fontWeight: 600, fontSize: 20, color: '#ef4444' }}>{kpi.n_sospesi_aperti}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function TabellaAggregatiMensili({ mesi }) {
  if (!mesi || mesi.length === 0) return null

  const tot = mesi.reduce((acc, m) => {
    acc.rooms_sold      += m.rooms_sold
    acc.rooms_available += m.rooms_available
    acc.revenue_rooms   += m.revenue_rooms
    acc.revenue_fnb     += m.revenue_fnb
    acc.revenue_extra   += m.revenue_extra
    acc.revenue_total   += m.revenue_total
    acc.giorni          += m.giorni
    return acc
  }, { rooms_sold: 0, rooms_available: 0, revenue_rooms: 0, revenue_fnb: 0, revenue_extra: 0, revenue_total: 0, giorni: 0 })

  const { rooms_sold: rs, rooms_available: ra, revenue_total: rt } = tot
  const totKpi = {
    occupancy: ra > 0 ? (rs / ra * 100) : null,
    adr:       rs > 0 ? (tot.revenue_rooms / rs) : null,
    rmc:       rs > 0 ? (rt / rs) : null,
    revpar:    ra > 0 ? (tot.revenue_rooms / ra) : null,
    trevpar:   ra > 0 ? (rt / ra) : null,
    inc_rooms: rt > 0 ? (tot.revenue_rooms / rt * 100) : null,
    inc_fnb:   rt > 0 ? (tot.revenue_fnb   / rt * 100) : null,
    inc_extra: rt > 0 ? (tot.revenue_extra  / rt * 100) : null,
  }

  return (
    <div className="card sezione">
      <h3 style={{ margin: '0 0 0.75rem' }}>Aggregati mensili — intera stagione</h3>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Mese</th>
              <th>Gg.</th>
              <th>Cam. vend.</th>
              <th>Occup. %</th>
              <th>ADR</th>
              <th>RMC</th>
              <th>RevPAR</th>
              <th>TRevPAR</th>
              <th>Inc. Rooms</th>
              <th>Inc. F&B</th>
              <th>Inc. Extra</th>
              <th>Rev. Totale</th>
            </tr>
          </thead>
          <tbody>
            {mesi.map((m, i) => (
              <tr key={i}>
                <td>{m.label}</td>
                <td>{m.giorni}</td>
                <td>{formatN(m.rooms_sold)}</td>
                <td>{m.occupancy != null ? formatPerc(m.occupancy) : '—'}</td>
                <td>{m.adr != null ? formatEuro(m.adr) : '—'}</td>
                <td>{m.rmc != null ? formatEuro(m.rmc) : '—'}</td>
                <td>{m.revpar != null ? formatEuro(m.revpar) : '—'}</td>
                <td>{m.trevpar != null ? formatEuro(m.trevpar) : '—'}</td>
                <td>{m.inc_rooms != null ? formatPerc(m.inc_rooms) : '—'}</td>
                <td>{m.inc_fnb != null ? formatPerc(m.inc_fnb) : '—'}</td>
                <td>{m.inc_extra != null ? formatPerc(m.inc_extra) : '—'}</td>
                <td>{formatEuro(m.revenue_total)}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700, borderTop: '2px solid #e5e7eb', background: '#f9fafb' }}>
              <td>TOTALE STAGIONE</td>
              <td>{tot.giorni}</td>
              <td>{formatN(tot.rooms_sold)}</td>
              <td>{totKpi.occupancy != null ? formatPerc(totKpi.occupancy) : '—'}</td>
              <td>{totKpi.adr != null ? formatEuro(totKpi.adr) : '—'}</td>
              <td>{totKpi.rmc != null ? formatEuro(totKpi.rmc) : '—'}</td>
              <td>{totKpi.revpar != null ? formatEuro(totKpi.revpar) : '—'}</td>
              <td>{totKpi.trevpar != null ? formatEuro(totKpi.trevpar) : '—'}</td>
              <td>{totKpi.inc_rooms != null ? formatPerc(totKpi.inc_rooms) : '—'}</td>
              <td>{totKpi.inc_fnb != null ? formatPerc(totKpi.inc_fnb) : '—'}</td>
              <td>{totKpi.inc_extra != null ? formatPerc(totKpi.inc_extra) : '—'}</td>
              <td>{formatEuro(tot.revenue_total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ContenutoDashboard({
  dati, datiComp, compLabel, isAnnoPrecedente,
  hotel, currentSnap, giornalieriEspansi, onToggleGiornalieri,
}) {
  const kpi      = dati.kpi_stagione ?? {}
  const kpiComp  = datiComp?.kpi_stagione ?? null
  const giorni   = dati.giorni || []
  const settimane = dati.settimane || []
  const refStart  = dati.settimana_ref_start || null
  const refEnd    = dati.settimana_ref_end || null

  const giorniMerged = useMemo(
    () => mergeConfrontoGiorni(giorni, datiComp?.giorni, isAnnoPrecedente),
    [giorni, datiComp, isAnnoPrecedente]
  )

  const mesiAggregati = useMemo(() => aggregaMensile(giorni), [giorni])

  function kpiDelta(key) { return calcolaDelta(kpi[key], kpiComp?.[key]) }
  function kpiCompV(key, fmt) {
    return kpiComp ? (kpiComp[key] != null ? fmt(kpiComp[key]) : '—') : null
  }

  const snapParam = currentSnap ? `snapshot=${currentSnap.snapshot_date}` : ''
  const exportSett = `/export/hotel/${hotel}/settimanale?${snapParam}`
  const exportGiorn = `/export/hotel/${hotel}/giornaliero?${snapParam}`

  // Etichetta intestazione settimana di riferimento
  const refLabel = refStart
    ? (() => {
        const d = new Date(refStart + 'T00:00:00')
        const de = new Date(refEnd + 'T00:00:00')
        const fmt = (dt) => `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}`
        return `${fmt(d)}–${fmt(de)}`
      })()
    : null

  return (
    <>
      {/* KPI stagione — totali intera stagione nella snapshot */}
      <div className="card sezione">
        <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>KPI stagione</h3>
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            {dati.periodo_da && dati.periodo_a
              ? `${formatData(dati.periodo_da)} – ${formatData(dati.periodo_a)}`
              : ''}
            {compLabel && datiComp && (
              <span style={{ marginLeft: 8, color: '#9ca3af' }}>vs. {compLabel}</span>
            )}
          </span>
        </div>
        <div className="grid-kpi">
          <KPICard label="Camere vendute"
            value={kpi.rooms_sold != null ? formatN(kpi.rooms_sold) : '—'}
            compValue={kpiCompV('rooms_sold', formatN)}
            compLabel={compLabel} delta={kpiDelta('rooms_sold')} />
          <KPICard label="Occupazione"
            value={kpi.occupancy != null ? formatPerc(kpi.occupancy) : '—'}
            compValue={kpiCompV('occupancy', formatPerc)}
            compLabel={compLabel} delta={kpiDelta('occupancy')} />
          <KPICard label="ADR"
            value={kpi.adr != null ? formatEuro(kpi.adr) : '—'}
            compValue={kpiCompV('adr', formatEuro)}
            compLabel={compLabel} delta={kpiDelta('adr')} />
          <KPICard label="RMC"
            value={kpi.rmc != null ? formatEuro(kpi.rmc) : '—'}
            compValue={kpiCompV('rmc', formatEuro)}
            compLabel={compLabel} delta={kpiDelta('rmc')} />
          <KPICard label="RevPAR"
            value={kpi.revpar != null ? formatEuro(kpi.revpar) : '—'}
            compValue={kpiCompV('revpar', formatEuro)}
            compLabel={compLabel} delta={kpiDelta('revpar')} />
          <KPICard label="TRevPAR"
            value={kpi.trevpar != null ? formatEuro(kpi.trevpar) : '—'}
            compValue={kpiCompV('trevpar', formatEuro)}
            compLabel={compLabel} delta={kpiDelta('trevpar')} />
          <KPICard label="Inc. Rooms"
            value={kpi.inc_rooms != null ? formatPerc(kpi.inc_rooms) : '—'}
            compValue={kpiCompV('inc_rooms', formatPerc)}
            compLabel={compLabel} delta={kpiDelta('inc_rooms')} />
          <KPICard label="Inc. F&B"
            value={kpi.inc_fnb != null ? formatPerc(kpi.inc_fnb) : '—'}
            compValue={kpiCompV('inc_fnb', formatPerc)}
            compLabel={compLabel} delta={kpiDelta('inc_fnb')} />
          <KPICard label="Inc. Extra"
            value={kpi.inc_extra != null ? formatPerc(kpi.inc_extra) : '—'}
            compValue={kpiCompV('inc_extra', formatPerc)}
            compLabel={compLabel} delta={kpiDelta('inc_extra')} />
          <KPICard label="Tot. Revenue"
            value={kpi.revenue_total != null ? formatEuro(kpi.revenue_total) : '—'}
            compValue={kpiCompV('revenue_total', formatEuro)}
            compLabel={compLabel} delta={kpiDelta('revenue_total')} />
        </div>
      </div>

      {/* Grafico occupazione giornaliera — intera stagione */}
      <div className="card sezione">
        <SezioneHeader titolo="Occupazione giornaliera — intera stagione"
          exportUrl={exportGiorn} exportNome={`${hotel}_giornaliero`} />
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={giorniMerged} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="data" tickFormatter={tickFormatterSabato}
              interval={0} tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={v => `${v}%`} domain={[0, 100]} width={40} />
            <Tooltip
              labelFormatter={val => {
                const d = new Date(val + 'T00:00:00')
                return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
              }}
              formatter={(v, n) => [v != null ? `${Number(v).toFixed(1)}%` : '—', n]}
            />
            <Legend />
            {pastReferenceArea(giorniMerged, 'data', null, currentSnap?.snapshot_date)}
            {/* Area di evidenziazione settimana di riferimento */}
            {refStart && refEnd && (
              <ReferenceArea x1={refStart} x2={refEnd}
                fill="#3b82f6" fillOpacity={0.1}
                label={{ value: 'Sett. rif.', position: 'insideTopLeft', fontSize: 9, fill: '#3b82f6' }} />
            )}
            <Line type="monotone" dataKey="occupancy" stroke="#3b82f6" dot={false}
              name="Occupazione %" strokeWidth={2} />
            {datiComp && (
              <Line type="monotone" dataKey="occupancy_comp" stroke="#f97316" dot={false}
                strokeDasharray="4 4" name={`Occup. ${compLabel}`} strokeWidth={1.5} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Grafico revenue giornaliero — linee in confronto, barre a tipologia senza confronto */}
      <div className="card sezione">
        <SezioneHeader
          titolo={datiComp
            ? 'Revenue totale giornaliero — confronto'
            : 'Revenue giornaliero per tipologia — intera stagione'}
          exportUrl={exportGiorn} exportNome={`${hotel}_giornaliero`} />
        <ResponsiveContainer width="100%" height={260}>
          {datiComp ? (
            <LineChart data={giorniMerged} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="data" tickFormatter={tickFormatterSabato}
                interval={0} tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => `${(v / 1000).toFixed(0)}k`} width={40} />
              <Tooltip
                labelFormatter={val => {
                  const d = new Date(val + 'T00:00:00')
                  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
                }}
                formatter={v => v != null ? formatEuro(v) : '—'}
              />
              <Legend />
              {pastReferenceArea(giorniMerged, 'data', null, currentSnap?.snapshot_date)}
              {refStart && refEnd && (
                <ReferenceArea x1={refStart} x2={refEnd}
                  fill="#3b82f6" fillOpacity={0.08} />
              )}
              <Line dataKey="revenue_total" name="Revenue" stroke="#3b82f6"
                dot={false} strokeWidth={2} connectNulls />
              <Line dataKey="revenue_total_comp" name={`Revenue ${compLabel}`}
                stroke="#f97316" dot={false} strokeWidth={2}
                strokeDasharray="4 2" connectNulls />
            </LineChart>
          ) : (
            <BarChart data={giorniMerged} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}
              barCategoryGap="10%">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="data" tickFormatter={tickFormatterSabato}
                interval={0} tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => `${(v / 1000).toFixed(0)}k`} width={40} />
              <Tooltip
                labelFormatter={val => {
                  const d = new Date(val + 'T00:00:00')
                  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
                }}
                formatter={v => formatEuro(v)}
              />
              <Legend />
              {pastReferenceArea(giorniMerged, 'data', null, currentSnap?.snapshot_date)}
              {refStart && refEnd && (
                <ReferenceArea x1={refStart} x2={refEnd}
                  fill="#3b82f6" fillOpacity={0.08} />
              )}
              <Bar dataKey="revenue_rooms" name="Camere" fill="#3b82f6" stackId="curr" />
              <Bar dataKey="revenue_fnb" name="F&B" fill="#10b981" stackId="curr" />
              <Bar dataKey="revenue_extra" name="Extra" fill="#f59e0b" stackId="curr" />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Tabella aggregati settimanali — intera stagione */}
      {settimane.length > 0 && (
        <div className="card sezione">
          <SezioneHeader titolo="Aggregati settimanali — intera stagione"
            exportUrl={exportSett} exportNome={`${hotel}_settimanale`} />
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Settimana</th>
                  <th>Gg.</th>
                  <th>Cam. vend.</th>
                  <th>Occup. %</th>
                  <th>ADR</th>
                  <th>RMC</th>
                  <th>RevPAR</th>
                  <th>TRevPAR</th>
                  <th>Inc. Rooms</th>
                  <th>Inc. F&B</th>
                  <th>Inc. Extra</th>
                  <th>Rev. Totale</th>
                </tr>
              </thead>
              <tbody>
                {settimane.map((s, i) => {
                  const isRef = refStart && s.week_start === refStart
                  const incompleta = !s.settimana_completa
                  return (
                    <tr key={i} style={{
                      fontStyle: incompleta ? 'italic' : 'normal',
                      color: incompleta ? '#6b7280' : 'inherit',
                      background: isRef ? '#eff6ff' : 'inherit',
                      fontWeight: isRef ? 700 : 'normal',
                    }}>
                      <td>
                        {isRef && (
                          <span style={{
                            display: 'inline-block', width: 6, height: 6,
                            borderRadius: '50%', background: '#3b82f6',
                            marginRight: 6, verticalAlign: 'middle',
                          }} />
                        )}
                        {s.label}
                      </td>
                      <td>{s.giorni}</td>
                      <td>{formatN(s.rooms_sold)}</td>
                      <td>{s.occupancy != null ? formatPerc(s.occupancy) : '—'}</td>
                      <td>{s.adr != null ? formatEuro(s.adr) : '—'}</td>
                      <td>{s.rmc != null ? formatEuro(s.rmc) : '—'}</td>
                      <td>{s.revpar != null ? formatEuro(s.revpar) : '—'}</td>
                      <td>{s.trevpar != null ? formatEuro(s.trevpar) : '—'}</td>
                      <td>{s.inc_rooms != null ? formatPerc(s.inc_rooms) : '—'}</td>
                      <td>{s.inc_fnb != null ? formatPerc(s.inc_fnb) : '—'}</td>
                      <td>{s.inc_extra != null ? formatPerc(s.inc_extra) : '—'}</td>
                      <td>{formatEuro(s.revenue_total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
            ● = settimana di riferimento della snapshot &nbsp;|&nbsp; <em>corsivo</em> = settimana parziale
          </div>
        </div>
      )}

      {/* Aggregati mensili — intera stagione */}
      <TabellaAggregatiMensili mesi={mesiAggregati} />

      {/* Tabella giornaliera — collassabile */}
      {giorni.length > 0 && (
        <div className="card sezione">
          <div
            onClick={onToggleGiornalieri}
            style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <h3 style={{ margin: 0 }}>
              Dati giornalieri ({giorni.length} giorni) {giornalieriEspansi ? '▲' : '▼'}
            </h3>
            <ExportMenu
              url={exportGiorn}
              nome={`${hotel}_giornaliero`}
              onClick={e => e.stopPropagation()}
            />
          </div>
          {giornalieriEspansi && (
            <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Giorno</th>
                    <th>Cam. vend.</th>
                    <th>PAX</th>
                    <th>Occup.</th>
                    <th>ADR</th>
                    <th>RMC</th>
                    <th>RevPAR</th>
                    <th>TRevPAR</th>
                    <th>Rev. Camere</th>
                    <th>Rev. F&B</th>
                    <th>Rev. Extra</th>
                    <th>Rev. Totale</th>
                  </tr>
                </thead>
                <tbody>
                  {giorni.map((g, i) => (
                    <tr key={i} style={
                      refStart && g.data >= refStart && g.data <= refEnd
                        ? { background: '#eff6ff' } : {}
                    }>
                      <td>{g.label}</td>
                      <td>{formatN(g.rooms_sold)}</td>
                      <td>{formatN(g.pax)}</td>
                      <td>{g.occupancy != null ? formatPerc(g.occupancy) : '—'}</td>
                      <td>{g.adr != null ? formatEuro(g.adr) : '—'}</td>
                      <td>{g.rmc != null ? formatEuro(g.rmc) : '—'}</td>
                      <td>{g.revpar != null ? formatEuro(g.revpar) : '—'}</td>
                      <td>{g.trevpar != null ? formatEuro(g.trevpar) : '—'}</td>
                      <td>{formatEuro(g.revenue_rooms)}</td>
                      <td>{formatEuro(g.revenue_fnb)}</td>
                      <td>{formatEuro(g.revenue_extra)}</td>
                      <td>{formatEuro(g.revenue_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Card Corrispettivi — mostra KPI del giorno di riferimento se disponibili */}
      {refStart && (
        <CardCorrispettivi
          hotel={hotel}
          data={refStart}
        />
      )}
    </>
  )
}

