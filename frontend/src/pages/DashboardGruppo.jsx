import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import api from '../api/client.js'
import { ExportMenu } from '../components/ExportMenu.jsx'
import NavigazioneSnapshot from '../components/NavigazioneSnapshot.jsx'
import pastReferenceArea from '../components/PastReferenceArea.jsx'
import { formatEuro, formatEuroK, formatPerc, formatN, formatData, addDays, calcolaDelta, mostraErrore } from '../utils/format.js'
import {
  Card, Dot, KpiTile, Loading, Messaggio, NavMese, PageHeader, SegmentedControl, StatoVuoto, Table, Td, Th,
} from '../components/ui'
import { colors, coloreStruttura, coloreSerie, COLORI_REVENUE, STILE_CONFRONTO } from '../styles/tokens.js'

const MODALITA_KEY = 'gruppo_modalita'

// Colori delle serie nei trend settimanali di gruppo
const COLORE_TREVPAR = coloreSerie(0)
const COLORE_REVPAR = coloreSerie(1)
const COLORE_REVENUE = coloreSerie(2)
const COLORE_OCCUPAZIONE = colors.info

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
      <PageHeader title="Dashboard Gruppo">
        <SegmentedControl value={modalita} onChange={setModalita} options={[
          { value: 'settimana', label: 'Settimana per settimana' },
          { value: 'stagione', label: 'Stagione intera' },
          { value: 'pace', label: 'Ritmo prenotazioni' },
        ]} />
      </PageHeader>

      {modalita === 'pace' && <SezionePace />}

      {/* Navigazione + confronti */}
      {modalita !== 'pace' && navItems.length > 0 && (
        <NavigazioneSnapshot
          titolo={titoloNav}
          sottotitolo={`${subtitleNav ? `| ${subtitleNav} ` : ''}(${navItems.length} ${modalita === 'settimana' ? 'settimane' : 'snapshot'})`}
          onPrec={() => setNavIdx(i => i + 1)} disPrec={navIdx >= navItems.length - 1}
          onSucc={() => setNavIdx(i => i - 1)} disSucc={navIdx <= 0}
          etichettaPrec={modalita === 'stagione' ? 'Confronta snapshot precedente' : 'Confronta settimana precedente'}
          confrontaPrec={confrontaPrevSett} onConfrontaPrec={setConfrontaPrevSett}
          confrontaAnno={confrontaPrevAnno} onConfrontaAnno={setConfrontaPrevAnno}
          confrontoNonDisponibile={(confrontaPrevSett || confrontaPrevAnno) && !compDisponibile}
        />
      )}

      {modalita !== 'pace' && loading && <Loading />}
      {modalita !== 'pace' && <Messaggio tipo="err">{errore}</Messaggio>}

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
    <Card style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <NavMese anno={anno} mese={mese} onChange={({ anno: a, mese: m }) => { setAnno(a); setMese(m) }} />
        <div style={{ marginLeft: 'auto' }}>
          <SegmentedControl value={vista} onChange={cambiaVista}
            options={[{ value: 'assoluto', label: 'Valore assoluto' }, { value: 'indicizzato', label: 'Crescita indicizzata' }]} />
        </div>
      </div>

      {vista === 'indicizzato' && (
        <p className="ui-text-muted" style={{ margin: '-6px 0 12px' }}>
          Ogni linea parte da 100 alla prima snapshot disponibile: mostra la velocità di crescita del
          pickup a prescindere dal volume assoluto di ciascun hotel.
        </p>
      )}

      {loading && <Loading />}
      <Messaggio tipo="err">{errore}</Messaggio>
      {nessunDato && !loading && !errore && <StatoVuoto>Nessuno snapshot disponibile per questo mese.</StatoVuoto>}

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
            {vista === 'indicizzato' && <ReferenceLine y={100} stroke={colors.textSubtle} strokeDasharray="4 4" />}
            {codiciHotel.map(code => (
              <Line key={code} type="monotone" dataKey={code} stroke={coloreStruttura(code)}
                strokeWidth={2} dot={{ r: 3 }} connectNulls name={code} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </Card>
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

  const exportGruppo = <ExportMenu url={`/export/gruppo${exportParams}`} nome="gruppo_settimanale" snapshot={snapshotDate} />
  const grafico = (titolo, contenuto, conExport = true) => (
    <Card title={titolo} style={{ marginBottom: 24 }} actions={conExport ? exportGruppo : undefined}>
      <ResponsiveContainer width="100%" height={240}>{contenuto}</ResponsiveContainer>
    </Card>
  )

  return (
    <>
      <div className="ui-text-muted" style={{ marginBottom: 8, fontSize: 'var(--fs-base)' }}>
        Hotel attivi: {dati.hotel_attivi.join(', ')} — periodo: {formatData(dati.periodo_da)} – {formatData(dati.periodo_a)}
        {compLabel && datiComp && <span style={{ marginLeft: 8 }}>vs. {compLabel}</span>}
      </div>

      {/* KPI gruppo */}
      <div className="ui-kpi-grid" style={{ marginBottom: 24 }}>
        {[
          ['Camere vendute', 'rooms_sold', formatN],
          ['Occupazione', 'occupancy', formatPerc],
          ['ADR Gruppo', 'adr', formatEuro],
          ['RevPAR', 'revpar', formatEuro],
          ['TRevPAR', 'trevpar', formatEuro],
          ['RMC', 'rmc', formatEuro],
          ['Inc. Rooms', 'inc_rooms', formatPerc],
          ['Inc. F&B', 'inc_fnb', formatPerc],
          ['Inc. Extra', 'inc_extra', formatPerc],
          ['Tot. Revenue', 'revenue_total', formatEuroK],
        ].map(([label, key, fmt]) => (
          <KpiTile key={key} label={label}
            value={kpi[key] != null ? fmt(kpi[key]) : '—'}
            confronto={kpiCompV(key, fmt)} confrontoLabel={compLabel} delta={kpiDelta(key)} />
        ))}
      </div>

      {/* Contributo revenue per hotel */}
      {contributi.length > 0 && (
        <Card title="Contributo revenue per hotel" style={{ marginBottom: 24 }} actions={exportGruppo}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={datiContributoBar} layout="vertical" margin={{ left: 30, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 'auto']} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 13 }} />
              <Tooltip formatter={v => formatEuro(v)} />
              <Legend />
              <ReferenceLine x={0} stroke={colors.textSubtle} strokeWidth={1} />
              <Bar dataKey="revenue_rooms" name="Camere" stackId="r" fill={COLORI_REVENUE.camere} />
              <Bar dataKey="revenue_fnb"   name="F&B"    stackId="r" fill={COLORI_REVENUE.fnb} />
              <Bar dataKey="revenue_extra" name="Extra"  stackId="r" fill={COLORI_REVENUE.extra} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Tabella dettaglio per hotel */}
      {contributi.length > 0 && (
        <Card title="Dettaglio per hotel" style={{ marginBottom: 24 }} actions={exportGruppo}>
          <Table compact>
            <thead>
              <tr>
                <Th>Hotel</Th>
                <Th num>Cam. vend.</Th><Th num>Cam. disp.</Th><Th num>Occup.</Th>
                <Th num>ADR</Th><Th num>RevPAR</Th>
                <Th num>Rev. Camere</Th><Th num>Rev. F&B</Th><Th num>Rev. Extra</Th>
                <Th num tot>Rev. Totale</Th><Th num>% Gruppo</Th>
              </tr>
            </thead>
            <tbody>
              {contributi.map(c => (
                <tr key={c.hotel_code}>
                  <Td><Dot colore={coloreStruttura(c.hotel_code)} /> <span style={{ marginLeft: 4 }}>{c.hotel_name}</span></Td>
                  <Td num>{formatN(c.rooms_sold)}</Td>
                  <Td num>{formatN(c.rooms_available)}</Td>
                  <Td num>{c.occupancy != null ? formatPerc(c.occupancy) : '—'}</Td>
                  <Td num>{c.adr != null ? formatEuro(c.adr) : '—'}</Td>
                  <Td num>{c.revpar != null ? formatEuro(c.revpar) : '—'}</Td>
                  <Td num>{formatEuro(c.revenue_rooms)}</Td>
                  <Td num>{formatEuro(c.revenue_fnb)}</Td>
                  <Td num>{formatEuro(c.revenue_extra)}</Td>
                  <Td num tot>{formatEuro(c.revenue_total)}</Td>
                  <Td num>{c.perc_revenue != null ? formatPerc(c.perc_revenue) : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* Occupazione comparativa per hotel — solo stagione intera */}
      {modalita === 'stagione' && occupazioneComparativa.length > 0 && grafico('Occupazione settimanale per hotel', (
        <LineChart data={occupazioneComparativa} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
          <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} width={42} />
          <Tooltip formatter={(v, name) => [v != null ? `${v.toFixed(1)}%` : '—', name]} />
          <Legend />
          {pastReferenceArea(occupazioneComparativa, 'week_start', 'label', snapshotDate)}
          {hotelesAttivi.map(code => (
            <Line key={code} type="monotone" dataKey={code} stroke={coloreStruttura(code)}
              strokeWidth={2} dot={false} connectNulls name={code} />
          ))}
        </LineChart>
      ), false)}

      {/* Trend settimanale RevPAR / TRevPAR — solo stagione intera */}
      {modalita === 'stagione' && settimane.length > 0 && grafico('Trend settimanale gruppo RevPAR / TRevPAR', (
        <LineChart data={settimaneConfronto} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
          <YAxis tickFormatter={v => formatEuro(v)} />
          <Tooltip formatter={v => formatEuro(v)} />
          <Legend />
          {pastReferenceArea(settimaneConfronto, 'week_start', 'label', snapshotDate)}
          <Line type="monotone" dataKey="trevpar" stroke={COLORE_TREVPAR} dot={false} name="TRevPAR" strokeWidth={2} />
          <Line type="monotone" dataKey="revpar"  stroke={COLORE_REVPAR} dot={false} name="RevPAR"  strokeWidth={2} />
          {datiComp && <>
            <Line type="monotone" dataKey="trevpar_comp" stroke={COLORE_TREVPAR} dot={false} name={`TRevPAR ${compLabel}`} {...STILE_CONFRONTO} />
            <Line type="monotone" dataKey="revpar_comp"  stroke={COLORE_REVPAR} dot={false} name={`RevPAR ${compLabel}`} {...STILE_CONFRONTO} />
          </>}
        </LineChart>
      ))}

      {/* Trend settimanale Revenue — solo stagione intera */}
      {modalita === 'stagione' && settimane.length > 0 && grafico('Trend settimanale Revenue', (
        <LineChart data={settimaneConfronto} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
          <YAxis tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
          <Tooltip formatter={v => formatEuro(v)} />
          <Legend />
          {pastReferenceArea(settimaneConfronto, 'week_start', 'label', snapshotDate)}
          <Line type="monotone" dataKey="revenue_total" stroke={COLORE_REVENUE} dot={false} name="Tot. Revenue" strokeWidth={2} />
          {datiComp && (
            <Line type="monotone" dataKey="revenue_total_comp" stroke={COLORE_REVENUE} dot={false} name={`Tot. Revenue ${compLabel}`} {...STILE_CONFRONTO} />
          )}
        </LineChart>
      ))}

      {/* Trend settimanale Occupazione — solo stagione intera */}
      {modalita === 'stagione' && settimane.length > 0 && grafico('Trend settimanale Occupazione', (
        <LineChart data={settimaneConfronto} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
          <YAxis tickFormatter={v => `${v.toFixed(1)}%`} domain={[0, 100]} />
          <Tooltip formatter={(v, n) => [v != null ? `${Number(v).toFixed(1)}%` : '—', n]} />
          <Legend />
          {pastReferenceArea(settimaneConfronto, 'week_start', 'label', snapshotDate)}
          <Line type="monotone" dataKey="occupancy" stroke={COLORE_OCCUPAZIONE} dot={false} name="Occupazione %" strokeWidth={2} />
          {datiComp && (
            <Line type="monotone" dataKey="occupancy_comp" stroke={COLORE_OCCUPAZIONE} dot={false} name={`Occup. ${compLabel}`} {...STILE_CONFRONTO} />
          )}
        </LineChart>
      ))}

      {/* Aggregati settimanali gruppo — solo stagione intera */}
      {modalita === 'stagione' && settimane.length > 0 && (
        <Card title="Aggregati settimanali gruppo" style={{ marginBottom: 24 }} actions={exportGruppo}>
          <Table compact>
            <thead>
              <tr>
                <Th>Settimana</Th>
                <Th>Hotel</Th><Th num>Cam. vend.</Th><Th num>Occup.</Th>
                <Th num>ADR</Th><Th num>RevPAR</Th><Th num>TRevPAR</Th>
                <Th num>Rev. Camere</Th><Th num>Rev. F&B</Th><Th num>Rev. Extra</Th><Th num tot>Rev. Totale</Th>
              </tr>
            </thead>
            <tbody>
              {settimane.map((s, i) => (
                <tr key={i}>
                  <Td>{s.label}</Td>
                  <Td muted>{s.hotel_attivi?.join(', ')}</Td>
                  <Td num>{formatN(s.rooms_sold)}</Td>
                  <Td num>{s.occupancy != null ? formatPerc(s.occupancy) : '—'}</Td>
                  <Td num>{s.adr     != null ? formatEuro(s.adr)     : '—'}</Td>
                  <Td num>{s.revpar  != null ? formatEuro(s.revpar)  : '—'}</Td>
                  <Td num>{s.trevpar != null ? formatEuro(s.trevpar) : '—'}</Td>
                  <Td num>{formatEuro(s.revenue_rooms)}</Td>
                  <Td num>{formatEuro(s.revenue_fnb)}</Td>
                  <Td num>{formatEuro(s.revenue_extra)}</Td>
                  <Td num tot>{formatEuro(s.revenue_total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  )
}
